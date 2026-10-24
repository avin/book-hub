package backup

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"book-hub/internal/database"
	"book-hub/internal/domain"
	"book-hub/internal/storage/files"
	"github.com/google/uuid"
)

type bookRecord struct {
	ID, Hash, Location, Format string
	Size                       int64
}

func (b bookRecord) archiveName() string { return path.Join("books", b.Hash[:2], b.Hash+"."+b.Format) }

type coverRecord struct {
	BookID           string
	Cover, Thumbnail sql.NullString
}
type libraryInventory struct {
	Books   []bookRecord
	Covers  []coverRecord
	Version int64
}

func readInventory(ctx context.Context, driver, directory string) (libraryInventory, error) {
	if driver == "postgres" {
		return readPostgresInventory(filepath.Join(directory, "database.sql"))
	}
	db, err := database.OpenSQLite(ctx, sqliteURL(filepath.Join(directory, "database.sqlite")), false)
	if err != nil {
		return libraryInventory{}, err
	}
	defer db.Close()
	var inventory libraryInventory
	var dirty bool
	if err := db.QueryRowContext(ctx, "SELECT version, dirty FROM schema_migrations").Scan(&inventory.Version, &dirty); err != nil {
		return inventory, err
	}
	if dirty {
		return inventory, fmt.Errorf("backup schema has an unfinished migration")
	}
	var integrity string
	if err := db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil {
		return inventory, err
	}
	if integrity != "ok" {
		return inventory, fmt.Errorf("SQLite integrity check failed: %s", integrity)
	}
	rows, err := db.QueryContext(ctx, "SELECT id, sha256, storage_path, size_bytes, format FROM book_files WHERE EXISTS (SELECT 1 FROM user_books WHERE book_file_id = book_files.id) ORDER BY id")
	if err != nil {
		return inventory, err
	}
	for rows.Next() {
		var book bookRecord
		if err := rows.Scan(&book.ID, &book.Hash, &book.Location, &book.Size, &book.Format); err != nil {
			rows.Close()
			return inventory, err
		}
		if err := validateBookRecord(book); err != nil {
			rows.Close()
			return inventory, err
		}
		inventory.Books = append(inventory.Books, book)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return inventory, err
	}
	rows, err = db.QueryContext(ctx, "SELECT id, cover_path, cover_thumbnail_path FROM user_books ORDER BY id")
	if err != nil {
		return inventory, err
	}
	defer rows.Close()
	for rows.Next() {
		var cover coverRecord
		if err := rows.Scan(&cover.BookID, &cover.Cover, &cover.Thumbnail); err != nil {
			return inventory, err
		}
		inventory.Covers = append(inventory.Covers, cover)
	}
	return inventory, rows.Err()
}

func validateBookRecord(book bookRecord) error {
	if _, err := uuid.Parse(book.ID); err != nil {
		return fmt.Errorf("invalid book identity in backup")
	}
	decoded, err := hex.DecodeString(book.Hash)
	if err != nil || len(decoded) != 32 || strings.ToLower(book.Hash) != book.Hash || book.Size < 0 || book.Location == "" || strings.ContainsRune(book.Location, 0) {
		return fmt.Errorf("invalid book integrity metadata in backup")
	}
	if _, err := domain.NormalizeBookFormat("book." + book.Format); err != nil {
		return fmt.Errorf("invalid book format in backup")
	}
	return nil
}

// Only pg_dump's supported plain COPY format is accepted here. This is an
// inventory reader, not an interpreter or a validator for arbitrary SQL.
func readPostgresInventory(filePath string) (libraryInventory, error) {
	input, err := os.Open(filePath)
	if err != nil {
		return libraryInventory{}, err
	}
	defer input.Close()
	reader := bufio.NewReader(input)
	var inventory libraryInventory
	books := make(map[string]bookRecord)
	owned := make(map[string]bool)
	seen := make(map[string]bool)
	header, complete := false, false
	var table string
	var columns []string
	for {
		line, readErr := reader.ReadString('\n')
		if readErr != nil && readErr != io.EOF {
			return inventory, readErr
		}
		line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
		if table != "" {
			if line == `\.` {
				table, columns = "", nil
			} else {
				values := strings.Split(line, "\t")
				if len(values) != len(columns) {
					return inventory, fmt.Errorf("malformed pg_dump COPY row in %s", table)
				}
				if table == "book_files" || table == "user_books" || table == "schema_migrations" {
					row := make(map[string]sql.NullString, len(values))
					for i, value := range values {
						decoded, err := decodeCopyText(value)
						if err != nil {
							return inventory, err
						}
						row[columns[i]] = decoded
					}
					get := func(name string) (string, error) {
						value, ok := row[name]
						if !ok || !value.Valid {
							return "", fmt.Errorf("missing %s in pg_dump %s", name, table)
						}
						return value.String, nil
					}
					switch table {
					case "book_files":
						var book bookRecord
						for name, target := range map[string]*string{"id": &book.ID, "sha256": &book.Hash, "storage_path": &book.Location, "format": &book.Format} {
							value, err := get(name)
							if err != nil {
								return inventory, err
							}
							*target = value
						}
						size, err := get("size_bytes")
						if err != nil {
							return inventory, err
						}
						book.Size, err = strconv.ParseInt(size, 10, 64)
						if err != nil {
							return inventory, fmt.Errorf("invalid book size in pg_dump")
						}
						if err := validateBookRecord(book); err != nil {
							return inventory, err
						}
						if _, duplicate := books[book.ID]; duplicate {
							return inventory, fmt.Errorf("duplicate book in pg_dump")
						}
						books[book.ID] = book
					case "user_books":
						id, err := get("id")
						if err != nil {
							return inventory, err
						}
						fileID, err := get("book_file_id")
						if err != nil {
							return inventory, err
						}
						if _, err := uuid.Parse(id); err != nil {
							return inventory, fmt.Errorf("invalid user book identity in pg_dump")
						}
						owned[fileID] = true
						cover, hasCover := row["cover_path"]
						thumb, hasThumb := row["cover_thumbnail_path"]
						if !hasCover || !hasThumb {
							return inventory, fmt.Errorf("missing image columns in pg_dump")
						}
						inventory.Covers = append(inventory.Covers, coverRecord{id, cover, thumb})
					case "schema_migrations":
						if inventory.Version != 0 {
							return inventory, fmt.Errorf("multiple schema versions in pg_dump")
						}
						version, err := get("version")
						if err != nil {
							return inventory, err
						}
						inventory.Version, err = strconv.ParseInt(version, 10, 64)
						if err != nil {
							return inventory, err
						}
						dirty, err := get("dirty")
						if err != nil || dirty != "f" {
							return inventory, fmt.Errorf("unfinished schema migration in pg_dump")
						}
					}
				}
			}
		} else if strings.HasPrefix(line, "COPY ") {
			declaration, ok := strings.CutSuffix(strings.TrimPrefix(line, "COPY "), ") FROM stdin;")
			if !ok {
				return inventory, fmt.Errorf("unsupported pg_dump COPY declaration")
			}
			name, fields, ok := strings.Cut(declaration, " (")
			if !ok {
				return inventory, fmt.Errorf("malformed pg_dump COPY declaration")
			}
			parts := strings.Split(name, ".")
			table = strings.Trim(parts[len(parts)-1], `"`)
			if seen[table] {
				return inventory, fmt.Errorf("duplicate pg_dump table: %s", table)
			}
			seen[table] = true
			columns = strings.Split(fields, ", ")
			for i := range columns {
				columns[i] = strings.Trim(columns[i], `"`)
			}
		} else if line == "-- PostgreSQL database dump" {
			header = true
		} else if line == "-- PostgreSQL database dump complete" {
			complete = true
		}
		if readErr == io.EOF {
			break
		}
	}
	if !header || !complete || table != "" || !seen["book_files"] || !seen["user_books"] || !seen["schema_migrations"] || inventory.Version < 1 {
		return inventory, fmt.Errorf("unsupported or incomplete pg_dump COPY backup")
	}
	for id := range owned {
		book, ok := books[id]
		if !ok {
			return inventory, fmt.Errorf("user book refers to a missing original in pg_dump")
		}
		inventory.Books = append(inventory.Books, book)
	}
	return inventory, nil
}

func decodeCopyText(value string) (sql.NullString, error) {
	if value == `\N` {
		return sql.NullString{}, nil
	}
	var result strings.Builder
	for i := 0; i < len(value); i++ {
		if value[i] != '\\' {
			result.WriteByte(value[i])
			continue
		}
		i++
		if i == len(value) {
			return sql.NullString{}, fmt.Errorf("truncated pg_dump COPY escape")
		}
		switch value[i] {
		case 'b':
			result.WriteByte('\b')
		case 'f':
			result.WriteByte('\f')
		case 'n':
			result.WriteByte('\n')
		case 'r':
			result.WriteByte('\r')
		case 't':
			result.WriteByte('\t')
		case 'v':
			result.WriteByte('\v')
		default:
			base, start, limit := 8, i, 3
			if value[i] == 'x' {
				base, start, limit = 16, i+1, 2
			}
			end := start
			for end < len(value) && end-start < limit {
				_, err := strconv.ParseUint(value[start:end+1], base, 8)
				if err != nil {
					break
				}
				end++
			}
			if end > start {
				number, _ := strconv.ParseUint(value[start:end], base, 8)
				result.WriteByte(byte(number))
				i = end - 1
			} else {
				result.WriteByte(value[i])
			}
		}
	}
	return sql.NullString{String: result.String(), Valid: true}, nil
}

func rewriteLocations(ctx context.Context, rawURL string, inventory libraryInventory, originals files.Originals, images string) error {
	connection, err := database.Parse(rawURL)
	if err != nil {
		return err
	}
	var db *sql.DB
	if connection.Driver == "sqlite" {
		db, err = database.OpenSQLite(ctx, rawURL, false)
	} else {
		db, err = sql.Open("pgx", rawURL)
	}
	if err != nil {
		return err
	}
	defer db.Close()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, book := range inventory.Books {
		if _, err := tx.ExecContext(ctx, "UPDATE book_files SET storage_path = $1 WHERE id = $2", originals.BookPath(book.Hash, book.Format), book.ID); err != nil {
			return err
		}
	}
	for _, cover := range inventory.Covers {
		var original, thumbnail any
		if cover.Cover.Valid {
			name, err := imageName(cover.Cover.String)
			if err != nil {
				return err
			}
			original = filepath.Join(images, name)
		}
		if cover.Thumbnail.Valid {
			name, err := imageName(cover.Thumbnail.String)
			if err != nil {
				return err
			}
			thumbnail = filepath.Join(images, name)
		}
		if _, err := tx.ExecContext(ctx, "UPDATE user_books SET cover_path = $1, cover_thumbnail_path = $2 WHERE id = $3", original, thumbnail, cover.BookID); err != nil {
			return err
		}
	}
	// These rows have no owners and may name an already deleted old original.
	if _, err := tx.ExecContext(ctx, "DELETE FROM original_deletions"); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM book_files WHERE NOT EXISTS (SELECT 1 FROM user_books WHERE book_file_id = book_files.id)"); err != nil {
		return err
	}
	return tx.Commit()
}

func imageName(location string) (string, error) {
	name := path.Base(strings.ReplaceAll(location, `\`, "/"))
	if name == "" || name == "." || name == ".." || name == "/" || strings.ContainsAny(name, ":\x00") {
		return "", fmt.Errorf("invalid image location in backup")
	}
	return name, nil
}
