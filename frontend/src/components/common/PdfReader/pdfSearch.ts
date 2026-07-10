export type PdfSearchMatch = {
  pageNumber: number;
  start: number;
  end: number;
  key: string;
};

export type PdfTextItem = {
  str: string;
};

export function normalizePdfSearchQuery(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

export function pdfTextItemsToSearchText(items: PdfTextItem[]) {
  return items
    .map((item) => item.str)
    .filter((text) => text.trim().length > 0)
    .join(' ');
}

export function findPdfSearchMatches(
  pageTexts: ReadonlyMap<number, string>,
  query: string,
): PdfSearchMatch[] {
  const normalizedQuery = normalizePdfSearchQuery(query).toLocaleLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  const matches: PdfSearchMatch[] = [];

  for (const [pageNumber, pageText] of pageTexts) {
    const searchableText = pageText.toLocaleLowerCase();
    let offset = 0;
    let matchNumber = 0;

    while (offset <= searchableText.length - normalizedQuery.length) {
      const matchStart = searchableText.indexOf(normalizedQuery, offset);

      if (matchStart === -1) {
        break;
      }

      matches.push({
        pageNumber,
        start: matchStart,
        end: matchStart + normalizedQuery.length,
        key: `pdf-search-${pageNumber}-${matchNumber}`,
      });

      matchNumber += 1;
      offset = matchStart + normalizedQuery.length;
    }
  }

  return matches;
}
