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

export const pdfSoftTextEnhancementDefaults = {
  strokeWidth: 0.65,
  strength: 0.8,
} as const;

export const pdfSoftTextEnhancementRanges = {
  strokeWidth: { min: 0, max: 2, step: 0.01 },
  strength: { min: 0, max: 1, step: 0.01 },
} as const;

export const pdfVisualAdjustmentDefaults = {
  brightness: 0,
  contrast: 1,
  gamma: 1,
} as const;

export const pdfVisualAdjustmentRanges = {
  brightness: { min: -1, max: 1, step: 0.01 },
  contrast: { min: 0, max: 3, step: 0.01 },
  gamma: { min: 0.2, max: 3, step: 0.01 },
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

export type PdfSoftTextEnhancementFilter = {
  id: 'softTextEnhancement';
  enabled: boolean;
  strokeWidth: number;
  strength: number;
};

export type PdfInvertFilter = {
  id: 'invert';
  enabled: boolean;
  strength: number;
};

export type PdfVisualAdjustmentFilter = {
  id: 'visualAdjustment';
  enabled: boolean;
  brightness: number;
  contrast: number;
  gamma: number;
};

export type PdfWarmthFilter = {
  id: 'warmth';
  enabled: boolean;
  strength: number;
};

export type PdfGrayscaleFilter = {
  id: 'grayscale';
  enabled: boolean;
  strength: number;
};

export type PdfFilter =
  | PdfTextEnhancementFilter
  | PdfSoftTextEnhancementFilter
  | PdfInvertFilter
  | PdfVisualAdjustmentFilter
  | PdfWarmthFilter
  | PdfGrayscaleFilter;
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
  {
    id: 'visualAdjustment',
    enabled: false,
    ...pdfVisualAdjustmentDefaults,
  },
  {
    id: 'warmth',
    enabled: false,
    strength: 0.5,
  },
  {
    id: 'grayscale',
    enabled: false,
    strength: 1,
  },
  {
    id: 'softTextEnhancement',
    enabled: false,
    ...pdfSoftTextEnhancementDefaults,
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

function sanitizeSoftTextEnhancementFilter(
  value: Record<string, unknown>,
): PdfSoftTextEnhancementFilter {
  const strokeWidth = finiteNumber(value.strokeWidth);
  const strength = finiteNumber(value.strength);

  return {
    id: 'softTextEnhancement',
    enabled: value.enabled === true,
    strokeWidth: clamp(
      strokeWidth ?? pdfSoftTextEnhancementDefaults.strokeWidth,
      pdfSoftTextEnhancementRanges.strokeWidth.min,
      pdfSoftTextEnhancementRanges.strokeWidth.max,
    ),
    strength: clamp(
      strength ?? pdfSoftTextEnhancementDefaults.strength,
      pdfSoftTextEnhancementRanges.strength.min,
      pdfSoftTextEnhancementRanges.strength.max,
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

function sanitizeVisualAdjustmentFilter(value: Record<string, unknown>): PdfVisualAdjustmentFilter {
  const brightness = finiteNumber(value.brightness);
  const contrast = finiteNumber(value.contrast);
  const gamma = finiteNumber(value.gamma);

  return {
    id: 'visualAdjustment',
    enabled: value.enabled === true,
    brightness: clamp(
      brightness ?? pdfVisualAdjustmentDefaults.brightness,
      pdfVisualAdjustmentRanges.brightness.min,
      pdfVisualAdjustmentRanges.brightness.max,
    ),
    contrast: clamp(
      contrast ?? pdfVisualAdjustmentDefaults.contrast,
      pdfVisualAdjustmentRanges.contrast.min,
      pdfVisualAdjustmentRanges.contrast.max,
    ),
    gamma: clamp(
      gamma ?? pdfVisualAdjustmentDefaults.gamma,
      pdfVisualAdjustmentRanges.gamma.min,
      pdfVisualAdjustmentRanges.gamma.max,
    ),
  };
}

function sanitizeStrengthFilter<T extends PdfWarmthFilter | PdfGrayscaleFilter>(
  value: Record<string, unknown>,
  id: T['id'],
  defaultStrength: number,
): T {
  const strength = finiteNumber(value.strength);

  return {
    id,
    enabled: value.enabled === true,
    strength: clamp(strength ?? defaultStrength, 0, 1),
  } as T;
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

    if (filter.id === 'softTextEnhancement' && !seen.has('softTextEnhancement')) {
      sanitizedFilters.push(sanitizeSoftTextEnhancementFilter(filter));
      seen.add('softTextEnhancement');
    }

    if (filter.id === 'invert' && !seen.has('invert')) {
      sanitizedFilters.push(sanitizeInvertFilter(filter));
      seen.add('invert');
    }

    if (filter.id === 'visualAdjustment' && !seen.has('visualAdjustment')) {
      sanitizedFilters.push(sanitizeVisualAdjustmentFilter(filter));
      seen.add('visualAdjustment');
    }

    if (filter.id === 'warmth' && !seen.has('warmth')) {
      sanitizedFilters.push(sanitizeStrengthFilter<PdfWarmthFilter>(filter, 'warmth', 0.5));
      seen.add('warmth');
    }

    if (filter.id === 'grayscale' && !seen.has('grayscale')) {
      sanitizedFilters.push(sanitizeStrengthFilter<PdfGrayscaleFilter>(filter, 'grayscale', 1));
      seen.add('grayscale');
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

export function softTextEnhancementFilterFromChain(chain: PdfFilterChain) {
  return chain.find(
    (filter): filter is PdfSoftTextEnhancementFilter => filter.id === 'softTextEnhancement',
  );
}

export function invertFilterFromChain(chain: PdfFilterChain) {
  return chain.find((filter): filter is PdfInvertFilter => filter.id === 'invert');
}

export function visualAdjustmentFilterFromChain(chain: PdfFilterChain) {
  return chain.find(
    (filter): filter is PdfVisualAdjustmentFilter => filter.id === 'visualAdjustment',
  );
}

export function warmthFilterFromChain(chain: PdfFilterChain) {
  return chain.find((filter): filter is PdfWarmthFilter => filter.id === 'warmth');
}

export function grayscaleFilterFromChain(chain: PdfFilterChain) {
  return chain.find((filter): filter is PdfGrayscaleFilter => filter.id === 'grayscale');
}

export type FixedLayoutTextEnhancementFilter = PdfTextEnhancementFilter;
export type FixedLayoutSoftTextEnhancementFilter = PdfSoftTextEnhancementFilter;
export type FixedLayoutInvertFilter = PdfInvertFilter;
export type FixedLayoutVisualAdjustmentFilter = PdfVisualAdjustmentFilter;
export type FixedLayoutWarmthFilter = PdfWarmthFilter;
export type FixedLayoutGrayscaleFilter = PdfGrayscaleFilter;
export type FixedLayoutFilter = PdfFilter;
export type FixedLayoutFilterChain = PdfFilterChain;

export const defaultFixedLayoutFilterChain = defaultPdfFilterChain;
export const sanitizeFixedLayoutFilterChain = sanitizePdfFilterChain;
export const normalizedFixedLayoutFilterChain = normalizedPdfFilterChain;
export const fixedLayoutFilterChainKey = pdfFilterChainKey;
export const hasEnabledFixedLayoutFilters = hasEnabledPdfFilters;
export const textEnhancementFilterFromFixedLayoutChain = textEnhancementFilterFromChain;
export const softTextEnhancementFilterFromFixedLayoutChain = softTextEnhancementFilterFromChain;
export const invertFilterFromFixedLayoutChain = invertFilterFromChain;
export const visualAdjustmentFilterFromFixedLayoutChain = visualAdjustmentFilterFromChain;
export const warmthFilterFromFixedLayoutChain = warmthFilterFromChain;
export const grayscaleFilterFromFixedLayoutChain = grayscaleFilterFromChain;
