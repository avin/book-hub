export const pdfTextEnhancementDefaults = {
  strokeWidth: 0.7,
  threshold: 0.62,
  contrast: 1.85,
  grayLevels: 8,
  toneShift: -0.65,
} as const;

export const pdfTextEnhancementRanges = {
  strokeWidth: { min: 0, max: 2, step: 0.01 },
  threshold: { min: 0, max: 1, step: 0.01 },
  contrast: { min: 0, max: 3, step: 0.01 },
  grayLevels: { min: 2, max: 16, step: 1 },
  toneShift: { min: -1, max: 1, step: 0.01 },
} as const;

export type PdfTextEnhancementFilter = {
  id: 'textEnhancement';
  enabled: boolean;
  strokeWidth: number;
  threshold: number;
  contrast: number;
  grayLevels: number;
  toneShift: number;
};

export type PdfInvertFilter = {
  id: 'invert';
  enabled: boolean;
  strength: number;
};

export type PdfFilter = PdfTextEnhancementFilter | PdfInvertFilter;
export type PdfFilterChain = PdfFilter[];

export const defaultPdfFilterChain = (): PdfFilterChain => [
  {
    id: 'textEnhancement',
    enabled: false,
    ...pdfTextEnhancementDefaults,
  },
  {
    id: 'invert',
    enabled: false,
    strength: 1,
  },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizeTextEnhancementFilter(value: Record<string, unknown>): PdfTextEnhancementFilter {
  const strokeWidth = finiteNumber(value.strokeWidth);
  const threshold = finiteNumber(value.threshold);
  const contrast = finiteNumber(value.contrast);
  const grayLevels = finiteNumber(value.grayLevels);
  const toneShift = finiteNumber(value.toneShift);

  return {
    id: 'textEnhancement',
    enabled: value.enabled === true,
    strokeWidth: clamp(
      strokeWidth ?? pdfTextEnhancementDefaults.strokeWidth,
      pdfTextEnhancementRanges.strokeWidth.min,
      pdfTextEnhancementRanges.strokeWidth.max,
    ),
    threshold: clamp(
      threshold ?? pdfTextEnhancementDefaults.threshold,
      pdfTextEnhancementRanges.threshold.min,
      pdfTextEnhancementRanges.threshold.max,
    ),
    contrast: clamp(
      contrast ?? pdfTextEnhancementDefaults.contrast,
      pdfTextEnhancementRanges.contrast.min,
      pdfTextEnhancementRanges.contrast.max,
    ),
    grayLevels: Math.round(
      clamp(
        grayLevels ?? pdfTextEnhancementDefaults.grayLevels,
        pdfTextEnhancementRanges.grayLevels.min,
        pdfTextEnhancementRanges.grayLevels.max,
      ),
    ),
    toneShift: clamp(
      toneShift ?? pdfTextEnhancementDefaults.toneShift,
      pdfTextEnhancementRanges.toneShift.min,
      pdfTextEnhancementRanges.toneShift.max,
    ),
  };
}

function sanitizeInvertFilter(value: Record<string, unknown>): PdfInvertFilter {
  const strength = finiteNumber(value.strength);

  return {
    id: 'invert',
    enabled: value.enabled === true,
    strength: clamp(strength ?? 1, 0, 1),
  };
}

export function sanitizePdfFilterChain(value: unknown): PdfFilterChain | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const filters = value.filter(isRecord);
  const sanitizedFilters: PdfFilterChain = [];
  const seen = new Set<PdfFilter['id']>();

  for (const filter of filters) {
    if (
      (filter.id === 'textEnhancement' || filter.id === 'enhanceText') &&
      !seen.has('textEnhancement')
    ) {
      sanitizedFilters.push(sanitizeTextEnhancementFilter(filter));
      seen.add('textEnhancement');
    }

    if (filter.id === 'invert' && !seen.has('invert')) {
      sanitizedFilters.push(sanitizeInvertFilter(filter));
      seen.add('invert');
    }
  }

  if (sanitizedFilters.length === 0) {
    return undefined;
  }

  for (const filter of defaultPdfFilterChain()) {
    if (!seen.has(filter.id)) {
      sanitizedFilters.push(filter);
    }
  }

  return sanitizedFilters;
}

export function normalizedPdfFilterChain(value: unknown): PdfFilterChain {
  return sanitizePdfFilterChain(value) ?? defaultPdfFilterChain();
}

export function pdfFilterChainKey(chain: PdfFilterChain) {
  return JSON.stringify(chain);
}

export function hasEnabledPdfFilters(chain: PdfFilterChain) {
  return chain.some((filter) => filter.enabled);
}

export function textEnhancementFilterFromChain(chain: PdfFilterChain) {
  return chain.find(
    (filter): filter is PdfTextEnhancementFilter => filter.id === 'textEnhancement',
  );
}

export function invertFilterFromChain(chain: PdfFilterChain) {
  return chain.find((filter): filter is PdfInvertFilter => filter.id === 'invert');
}
