package httpapi

import (
	"net/url"
	"path/filepath"
	"strings"
	"unicode"
)

func bookDownloadFilename(title, format string) string {
	title = sanitizeBookTitle(title)
	if title == "" {
		title = "book"
	}
	return title + "." + format
}

func sanitizeBookTitle(value string) string {
	value = strings.TrimSpace(value)
	var b strings.Builder
	prevSpace := false

	for _, r := range value {
		switch {
		case r < 32:
			continue
		case r == '\\', r == '/', r == ':', r == '*', r == '?', r == '"', r == '<', r == '>', r == '|':
			continue
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			prevSpace = false
		case r == ' ':
			if b.Len() == 0 || prevSpace {
				continue
			}
			b.WriteRune(' ')
			prevSpace = true
		case r == '.', r == '-', r == '_', r == '(', r == ')', r == '+', r == ',':
			b.WriteRune(r)
			prevSpace = false
		default:
			continue
		}
	}

	return strings.Trim(strings.TrimSpace(b.String()), ".")
}

func asciiBookFilenameFallback(filename string) string {
	ext := filepath.Ext(filename)
	base := strings.TrimSuffix(filename, ext)
	var b strings.Builder
	prevUnderscore := false

	for _, r := range base {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevUnderscore = false
		case r == '.', r == '-', r == '_':
			b.WriteRune(r)
			prevUnderscore = r == '_'
		case r == ' ':
			if b.Len() == 0 || prevUnderscore {
				continue
			}
			b.WriteRune('_')
			prevUnderscore = true
		default:
			continue
		}
	}

	result := strings.Trim(b.String(), "._")
	if result == "" || isWeakASCIIFallback(base, result) {
		result = "book"
	}
	if ext == "" {
		return result
	}
	return result + ext
}

func isWeakASCIIFallback(originalBase, ascii string) bool {
	originalLetters := 0
	for _, r := range originalBase {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			originalLetters++
		}
	}
	asciiLetters := 0
	for _, r := range ascii {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			asciiLetters++
		}
	}
	return originalLetters > 0 && asciiLetters < originalLetters/2
}

func bookFileContentDisposition(disposition, title, format string) string {
	filename := bookDownloadFilename(title, format)
	ascii := asciiBookFilenameFallback(filename)
	return disposition +
		`; filename="` + ascii + `"; filename*=UTF-8''` + url.PathEscape(filename)
}
