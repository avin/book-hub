export type PdfFilterId = 'invert';

export type PdfInvertFilter = {
  id: 'invert';
  enabled: boolean;
  strength: number;
};

export type PdfFilterChain = PdfInvertFilter[];

export const defaultPdfFilterChain = (): PdfFilterChain => [
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

export function sanitizePdfFilterChain(value: unknown): PdfFilterChain | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const invert = value.find(
    (filter): filter is Record<string, unknown> => isRecord(filter) && filter.id === 'invert',
  );

  if (!invert) {
    return undefined;
  }

  const strength = finiteNumber(invert.strength);

  return [
    {
      id: 'invert',
      enabled: invert.enabled === true,
      strength: clamp(strength ?? 1, 0, 1),
    },
  ];
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

export function invertFilterFromChain(chain: PdfFilterChain) {
  return chain.find((filter) => filter.id === 'invert');
}
