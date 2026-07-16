export const defaultFixedLayoutPageWidthOverflow = 0;

export const fixedLayoutPageWidthOverflowRange = {
  min: 0,
  max: 80,
  step: 1,
} as const;

export function clampFixedLayoutPageWidthOverflow(value: number) {
  return Math.round(
    Math.min(
      fixedLayoutPageWidthOverflowRange.max,
      Math.max(fixedLayoutPageWidthOverflowRange.min, value),
    ),
  );
}
