import type { ReflowableBinary } from './reflowableTypes';

export function binaryToDataUrl(binary: ReflowableBinary | undefined) {
  if (!binary) {
    return undefined;
  }

  return `data:${binary.contentType};base64,${binary.data}`;
}
