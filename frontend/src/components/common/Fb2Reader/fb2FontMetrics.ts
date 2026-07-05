import type { Fb2ReaderSettings } from "./fb2Types";

function primaryFontFamily(fontFamily: string) {
  const trimmed = fontFamily.trim();
  const quoted = trimmed.match(/^["']([^"']+)["']/);

  if (quoted) {
    return quoted[1];
  }

  return trimmed.split(",")[0]?.trim() ?? trimmed;
}

export function isSystemFontStack(fontFamily: string) {
  const primary = primaryFontFamily(fontFamily).toLowerCase();

  return (
    primary === "system-ui" ||
    primary === "ui-sans-serif" ||
    primary === "sans-serif" ||
    primary === "serif" ||
    primary === "monospace"
  );
}

export function readerLayoutFontSpec(
  settings: Fb2ReaderSettings,
  fontSize = settings.fontSize,
  weight = 400,
  style: "normal" | "italic" = "normal",
) {
  const family = isSystemFontStack(settings.fontFamily)
    ? settings.fontFamily
    : `"${primaryFontFamily(settings.fontFamily)}"`;

  return `${style} ${weight} ${fontSize}px ${family}`;
}

export function isReaderLayoutFontReady(settings: Fb2ReaderSettings) {
  if (typeof document === "undefined") {
    return true;
  }

  return document.fonts.check(readerLayoutFontSpec(settings));
}

export function loadReaderLayoutFonts(settings: Fb2ReaderSettings) {
  if (typeof document === "undefined") {
    return Promise.resolve();
  }

  const loads = [
    document.fonts.load(readerLayoutFontSpec(settings)),
    document.fonts.load(readerLayoutFontSpec(settings, settings.fontSize, 700)),
    document.fonts.load(readerLayoutFontSpec(settings, settings.fontSize, 500, "italic")),
  ];

  return Promise.all(loads).then(() => undefined);
}

export function fontFamilyForMeasurement(settings: Fb2ReaderSettings) {
  if (isSystemFontStack(settings.fontFamily)) {
    return settings.fontFamily.includes(",") ? settings.fontFamily : `"${settings.fontFamily}"`;
  }

  return `"${primaryFontFamily(settings.fontFamily)}"`;
}

export function webFontMeasureWidthFudge(settings: Fb2ReaderSettings) {
  if (isSystemFontStack(settings.fontFamily)) {
    return 0;
  }

  return Math.max(2, Math.round(settings.fontSize * 0.14));
}
