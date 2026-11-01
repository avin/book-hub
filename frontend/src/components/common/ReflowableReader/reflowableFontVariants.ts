import { primaryFontFamily, readerFontOpticalSize } from './reflowableReaderSettings';
import type { ReflowableReaderSettings } from './reflowableTypes';

export function readerFontFamily(settings: ReflowableReaderSettings) {
  const opticalSize = readerFontOpticalSize(settings);
  if (opticalSize === undefined) return settings.fontFamily;
  return `"Book Hub ${primaryFontFamily(settings.fontFamily)} opsz ${opticalSize}", ${settings.fontFamily}`;
}

function fontFaceRules(): { rule: CSSFontFaceRule; baseUrl: string }[] {
  const result: { rule: CSSFontFaceRule; baseUrl: string }[] = [];
  for (const sheet of document.styleSheets) {
    // Reader fonts are self-hosted; unrelated cross-origin stylesheets may deny access.
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (rule instanceof CSSFontFaceRule) {
        result.push({ rule, baseUrl: sheet.href ?? document.baseURI });
      }
    }
  }
  return result;
}

export function createReaderFontVariants() {
  const variants = new Map<string, FontFace[]>();
  return {
    prepare(settings: ReflowableReaderSettings) {
      const opticalSize = readerFontOpticalSize(settings);
      if (opticalSize === undefined) return;
      const family = primaryFontFamily(readerFontFamily(settings));
      if (variants.has(family)) return;

      const originalFamily = primaryFontFamily(settings.fontFamily);
      const faces: FontFace[] = [];
      for (const { rule, baseUrl } of fontFaceRules()) {
        if (primaryFontFamily(rule.style.getPropertyValue('font-family')) !== originalFamily)
          continue;
        const source = rule.style
          .getPropertyValue('src')
          .replace(
            /url\((['"]?)(.*?)\1\)/g,
            (_, _quote: string, url: string) => `url("${new URL(url, baseUrl).href}")`,
          );
        // Pretext measures through Canvas, which has no font-variation-settings property.
        // A font-face alias gives DOM and Canvas exactly the same optical-size instance.
        const descriptors: FontFaceDescriptors & { variationSettings: string } = {
          style: rule.style.getPropertyValue('font-style'),
          weight: rule.style.getPropertyValue('font-weight'),
          unicodeRange: rule.style.getPropertyValue('unicode-range'),
          variationSettings: `"opsz" ${opticalSize}`,
          display: 'swap',
        };
        const face = new FontFace(family, source, descriptors);
        document.fonts.add(face);
        faces.push(face);
      }
      variants.set(family, faces);
    },
    dispose() {
      for (const faces of variants.values()) {
        for (const face of faces) document.fonts.delete(face);
      }
      variants.clear();
    },
  };
}
