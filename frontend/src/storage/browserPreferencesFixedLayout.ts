import {
  sanitizePdfFilterChain,
  type PdfFilterChain,
} from '@/components/common/PdfReader/pdfFilters';
import {
  clampPdfPageWidthOverflow,
  defaultPdfPageWidthOverflow,
} from '@/components/common/PdfReader/pdfPageSettings';
import {
  finiteNumber,
  fixedLayoutReaderPreferences,
  fixedLayoutReaderPreferencesForWrite,
  isRecord,
  readerPreferencesForWrite,
  unitIntervalNumber,
  updatePreferences,
} from './browserPreferencesCore';

export function getFixedLayoutReaderContentWidthPreference() {
  return finiteNumber(fixedLayoutReaderPreferences()?.contentWidth);
}

export function setFixedLayoutReaderContentWidthPreference(contentWidth: number | undefined) {
  updatePreferences((preferences) => ({
    ...preferences,
    readers: {
      ...readerPreferencesForWrite(preferences),
      fixedLayout: {
        ...fixedLayoutReaderPreferencesForWrite(preferences),
        ...(contentWidth === undefined ? { contentWidth: undefined } : { contentWidth }),
      },
    },
  }));
}

export function getFixedLayoutReaderPageWidthOverflowPreference(bookId: string) {
  const pageWidthOverflows = fixedLayoutReaderPreferences()?.pageWidthOverflows;
  if (!isRecord(pageWidthOverflows)) return defaultPdfPageWidthOverflow;

  const value = finiteNumber(pageWidthOverflows[bookId]);
  return value === undefined ? defaultPdfPageWidthOverflow : clampPdfPageWidthOverflow(value);
}

export function setFixedLayoutReaderPageWidthOverflowPreference(bookId: string, value: number) {
  updatePreferences((preferences) => {
    const current = fixedLayoutReaderPreferencesForWrite(preferences)?.pageWidthOverflows;
    const pageWidthOverflows = isRecord(current) ? current : {};

    return {
      ...preferences,
      readers: {
        ...readerPreferencesForWrite(preferences),
        fixedLayout: {
          ...fixedLayoutReaderPreferencesForWrite(preferences),
          pageWidthOverflows: { ...pageWidthOverflows, [bookId]: clampPdfPageWidthOverflow(value) },
        },
      },
    };
  });
}

export function getFixedLayoutReaderHorizontalScrollPositionPreference(bookId: string) {
  const positions = fixedLayoutReaderPreferences()?.horizontalScrollPositions;
  return isRecord(positions) ? unitIntervalNumber(positions[bookId]) : undefined;
}

export function setFixedLayoutReaderHorizontalScrollPositionPreference(
  bookId: string,
  position: number | undefined,
) {
  updatePreferences((preferences) => {
    const current = fixedLayoutReaderPreferencesForWrite(preferences)?.horizontalScrollPositions;
    const positions = { ...(isRecord(current) ? current : {}) };
    if (position === undefined) delete positions[bookId];
    else positions[bookId] = Math.min(1, Math.max(0, position));

    return {
      ...preferences,
      readers: {
        ...readerPreferencesForWrite(preferences),
        fixedLayout: {
          ...fixedLayoutReaderPreferencesForWrite(preferences),
          horizontalScrollPositions: positions,
        },
      },
    };
  });
}

export function getFixedLayoutReaderFilterChainPreference(bookId: string) {
  const chains = fixedLayoutReaderPreferences()?.filterChains;
  return isRecord(chains) ? sanitizePdfFilterChain(chains[bookId]) : undefined;
}

export function setFixedLayoutReaderFilterChainPreference(bookId: string, chain: PdfFilterChain) {
  updatePreferences((preferences) => {
    const current = fixedLayoutReaderPreferencesForWrite(preferences)?.filterChains;
    const filterChains = isRecord(current) ? current : {};

    return {
      ...preferences,
      readers: {
        ...readerPreferencesForWrite(preferences),
        fixedLayout: {
          ...fixedLayoutReaderPreferencesForWrite(preferences),
          filterChains: { ...filterChains, [bookId]: chain },
        },
      },
    };
  });
}
