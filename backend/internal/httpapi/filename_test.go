package httpapi

import (
	"strings"
	"testing"
)

func TestBookDownloadFilenamePreservesUnicodeTitle(t *testing.T) {
	title := "Мейерс С. - Эффективный и современный C++. 42 рекомендации по использованию C++11 и C++14 - 2016"
	filename := bookDownloadFilename(title, "pdf")

	if !strings.Contains(filename, "Мейерс") {
		t.Fatalf("expected Cyrillic title to be preserved, got %q", filename)
	}
	if !strings.HasSuffix(filename, ".pdf") {
		t.Fatalf("expected .pdf extension, got %q", filename)
	}
}

func TestBookFileContentDispositionIncludesUTF8Filename(t *testing.T) {
	title := "Мейерс С. - Эффективный и современный C++. 42 рекомендации"
	header := bookFileContentDisposition("attachment", title, "pdf")

	if !strings.Contains(header, "filename*=") {
		t.Fatalf("expected RFC 5987 filename*, got %q", header)
	}
	if !strings.Contains(header, "%D0%9C%D0%B5%D0%B9%D0%B5%D1%80%D1%81") {
		t.Fatalf("expected UTF-8 encoded Cyrillic in header, got %q", header)
	}
}

func TestAsciiBookFilenameFallbackUsesNeutralNameForMostlyUnicodeTitle(t *testing.T) {
	filename := bookDownloadFilename("Мейерс С. - Эффективный C++", "pdf")
	ascii := asciiBookFilenameFallback(filename)

	if ascii != "book.pdf" {
		t.Fatalf("expected neutral ASCII fallback, got %q", ascii)
	}
}

func TestSanitizeBookTitleRemovesPathSeparators(t *testing.T) {
	title := sanitizeBookTitle(`  ..\evil/notes:  `)
	if strings.ContainsAny(title, `\/:`) {
		t.Fatalf("expected path separators to be removed, got %q", title)
	}
}
