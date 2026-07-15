import type { JSX } from 'solid-js';
import type { ReflowableTextStyle } from './reflowableTypes';

export function readerTextStyle(
  value: ReflowableTextStyle | undefined,
): JSX.CSSProperties | undefined {
  if (!value) return undefined;

  return {
    'text-align': value.textAlign,
    'font-style': value.fontStyle,
    'font-weight': value.fontWeight,
    'text-decoration-line': value.textDecorationLine,
    'white-space': value.whiteSpace,
  };
}
