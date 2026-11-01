import type { ReflowableReaderSettings } from './reflowableTypes';

export const defaultSettings: ReflowableReaderSettings = {
  backgroundColor: '#f7f3ea',
  textColor: '#211f1b',
  linkColor: '#24527a',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 19,
  lineHeight: 1.62,
  paragraphSpacing: 14,
  paragraphIndent: 28,
  sidePadding: 12,
};

type FontAxis = { min: number; max: number };

export const fontOptions = [
  { label: 'Sans', value: 'system-ui, sans-serif' },
  { label: 'Sans Serif', value: 'sans-serif' },
  { label: 'Literata', value: '"Literata", "Noto Serif", "Noto Sans", serif' },
  { label: 'Noto Serif', value: '"Noto Serif", "Noto Sans", serif' },
  { label: 'Source Serif 4', value: '"Source Serif 4", "Noto Serif", "Noto Sans", serif' },
  { label: 'Lora', value: '"Lora", "Noto Serif", "Noto Sans", serif' },
  { label: 'Merriweather', value: '"Merriweather", "Noto Serif", "Noto Sans", serif' },
  { label: 'PT Serif', value: '"PT Serif", "Noto Serif", "Noto Sans", serif' },
  { label: 'IBM Plex Serif', value: '"IBM Plex Serif", "Noto Serif", "Noto Sans", serif' },
  { label: 'Golos Text', value: '"Golos Text", "Noto Sans", sans-serif' },
  { label: 'Noto Sans', value: '"Noto Sans", sans-serif' },
  { label: 'Open Sans', value: '"Open Sans", "Noto Sans", sans-serif' },
  { label: 'Roboto', value: '"Roboto", "Noto Sans", sans-serif' },
  { label: 'PT Sans', value: '"PT Sans", "Noto Sans", sans-serif' },
  { label: 'IBM Plex Sans', value: '"IBM Plex Sans", "Noto Sans", sans-serif' },
  { label: 'Inter', value: '"Inter", "Noto Sans", sans-serif' },
  { label: 'Cousine', value: '"Cousine", "Noto Sans", monospace' },
];

// Ranges from the fvar tables of the bundled WOFF2 files, not the full upstream fonts.
const variableAxes: Record<string, { weight: FontAxis; opticalSize?: FontAxis } | undefined> = {
  Literata: { weight: { min: 200, max: 900 }, opticalSize: { min: 7, max: 72 } },
  'Noto Serif': { weight: { min: 100, max: 900 } },
  'Source Serif 4': { weight: { min: 200, max: 900 }, opticalSize: { min: 8, max: 60 } },
  Lora: { weight: { min: 400, max: 700 } },
  Merriweather: { weight: { min: 300, max: 900 }, opticalSize: { min: 18, max: 144 } },
  'Golos Text': { weight: { min: 400, max: 900 } },
  'Noto Sans': { weight: { min: 100, max: 900 } },
  'Open Sans': { weight: { min: 300, max: 800 } },
  Roboto: { weight: { min: 100, max: 900 } },
  'IBM Plex Sans': { weight: { min: 100, max: 700 } },
  Inter: { weight: { min: 100, max: 900 }, opticalSize: { min: 14, max: 32 } },
};

export function primaryFontFamily(fontFamily: string) {
  return fontFamily
    .split(',')[0]
    .trim()
    .replace(/^["']|["']$/g, '');
}

export function readerFontAxes(fontFamily: string) {
  return variableAxes[primaryFontFamily(fontFamily)];
}

export function readerFontWeight(settings: ReflowableReaderSettings, weight = 400) {
  const axis = readerFontAxes(settings.fontFamily)?.weight;
  const value = settings.fontWeight;
  if (!axis || value === undefined || !Number.isFinite(value)) return weight;
  const base = Math.min(axis.max, Math.max(axis.min, value));
  return weight === 400 ? base : Math.max(weight, base);
}

export function readerFontOpticalSize(settings: ReflowableReaderSettings) {
  const axis = readerFontAxes(settings.fontFamily)?.opticalSize;
  const value = settings.fontOpticalSize;
  if (!axis || value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(axis.max, Math.max(axis.min, value));
}
