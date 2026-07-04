package migrations_test

import (
	"os"
	"strings"
	"testing"
)

func TestInitialMigrationDefinesRequiredTablesAndConstraints(t *testing.T) {
	up, err := os.ReadFile("000001_initial.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(up)
	for _, required := range []string{
		"create table users",
		"create table book_files",
		"create table user_books",
		"create table reading_progress",
		"create table sessions",
		"unique (user_id, book_file_id)",
		"format in ('pdf', 'fb2')",
		"progress_percent >= 0 and progress_percent <= 100",
		"on delete cascade",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("migration missing %q", required)
		}
	}
}

func TestInitialDownMigrationDropsTables(t *testing.T) {
	down, err := os.ReadFile("000001_initial.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(down)
	for _, required := range []string{"drop table if exists sessions", "drop table if exists users"} {
		if !strings.Contains(sql, required) {
			t.Fatalf("down migration missing %q", required)
		}
	}
}
