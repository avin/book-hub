import type { JSX } from 'solid-js';
import type { ReflowableTextStyle } from './reflowableTypes';

export function readerTextStyle(
  value: ReflowableTextStyle | undefined,
): JSX.CSSProperties | undefined {
  if (!value) return undefined;

  return {
    'text-align': value.textAlign,
    'font-style': value.fontStyle,
    'font-weight':
      value.fontWeight === 'normal'
        ? 'var(--fb2-font-weight, 400)'
        : value.fontWeight === 'bold'
          ? 'max(700, var(--fb2-font-weight, 400))'
          : undefined,
    'text-decoration-line': value.textDecorationLine,
    'white-space': value.whiteSpace,
  };
}
