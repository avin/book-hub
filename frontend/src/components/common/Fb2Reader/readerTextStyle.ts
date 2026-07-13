import type { JSX } from 'solid-js';
import type { ReaderTextStyle } from './fb2Types';

export function readerTextStyle(value: ReaderTextStyle | undefined): JSX.CSSProperties | undefined {
  if (!value) return undefined;

  return {
    'text-align': value.textAlign,
    'font-style': value.fontStyle,
    'font-weight': value.fontWeight,
    'text-decoration-line': value.textDecorationLine,
    'white-space': value.whiteSpace,
  };
}
