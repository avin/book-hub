export const defaultPdfPageWidthOverflow = 0;

export const pdfPageWidthOverflowRange = {
  min: 0,
  max: 20,
  step: 1,
} as const;

export function clampPdfPageWidthOverflow(value: number) {
  return Math.round(
    Math.min(pdfPageWidthOverflowRange.max, Math.max(pdfPageWidthOverflowRange.min, value)),
  );
}
