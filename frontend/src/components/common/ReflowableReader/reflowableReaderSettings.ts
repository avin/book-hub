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
  sidePadding: 8,
};

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
