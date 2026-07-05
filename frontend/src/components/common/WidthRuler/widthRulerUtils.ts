import type { JSX } from "solid-js";

export const widthRulerTicks = Array.from({ length: 81 }, (_, index) => index - 40);

export function clampWidth(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function computeWidthRulerMarkers(
  rulerElement: HTMLDivElement | undefined,
  customWidth: number | undefined,
  availableWidth: number,
  minHalfWidth = 140,
  maxHalfWidth?: number,
): { left: JSX.CSSProperties; right: JSX.CSSProperties } {
  if (!customWidth || !rulerElement) {
    return { left: { display: "none" }, right: { display: "none" } };
  }

  const rulerRect = rulerElement.getBoundingClientRect();
  const halfCap = maxHalfWidth ?? availableWidth / 2;
  const halfWidth = clampWidth(customWidth / 2, minHalfWidth, halfCap);
  const centerX = rulerRect.width / 2;

  return {
    left: { left: `${centerX - halfWidth}px` },
    right: { left: `${centerX + halfWidth}px` },
  };
}

export function applyWidthRulerPointer(
  event: PointerEvent | MouseEvent,
  options: {
    rulerElement: HTMLDivElement;
    contentLeft?: number;
    contentRight?: number;
    availableWidth: number;
    minHalfWidth: number;
    maxHalfWidth?: number;
    onWidthChange: (width: number | undefined) => void;
    onGuideX: (x: number) => void;
  },
) {
  const rulerRect = options.rulerElement.getBoundingClientRect();
  const halfCap = options.maxHalfWidth ?? options.availableWidth / 2;

  if (
    options.contentLeft !== undefined &&
    options.contentRight !== undefined &&
    (event.clientX <= options.contentLeft || event.clientX >= options.contentRight)
  ) {
    options.onWidthChange(undefined);
    options.onGuideX(event.clientX);
    return;
  }

  const center = rulerRect.left + rulerRect.width / 2;
  const side = event.clientX < center ? -1 : 1;
  const nextHalfWidth = clampWidth(Math.abs(event.clientX - center), options.minHalfWidth, halfCap);
  const nextWidth = nextHalfWidth * 2;

  options.onGuideX(center + side * nextHalfWidth);
  options.onWidthChange(Math.round(nextWidth));
}
