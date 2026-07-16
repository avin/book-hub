const fb2EncodingPattern = /encoding\s*=\s*["']([^"']+)["']/i;
const fb2DeclarationScanBytes = 512;
const defaultFb2Encoding = 'utf-8';

// Каноникализация алиасов кодировок к именам, принимаемым TextDecoder.
function normalizeEncoding(encoding: string): string {
  const normalized = encoding.trim().toLowerCase();

  if (normalized === '') {
    return defaultFb2Encoding;
  }

  switch (normalized) {
    case 'utf8':
      return 'utf-8';
    case 'cp1251':
    case 'windows-1251':
    case 'win-1251':
    case '1251':
      return 'windows-1251';
    case 'cp1252':
    case 'windows-1252':
    case '1252':
      return 'windows-1252';
    case 'koi8r':
    case 'koi8-r':
      return 'koi8-r';
    case 'koi8u':
    case 'koi8-u':
      return 'koi8-u';
    default:
      return normalized;
  }
}

function detectFb2Encoding(bytes: Uint8Array): string {
  const slice = bytes.subarray(0, Math.min(bytes.length, fb2DeclarationScanBytes));
  let header = '';

  for (let i = 0; i < slice.length; i++) {
    const byte = slice[i];

    if (byte === 0) {
      // Нулевой байт — это уже бинарные данные за пределами XML-декларации.
      break;
    }

    header += String.fromCharCode(byte);
  }

  const match = fb2EncodingPattern.exec(header);

  if (!match) {
    return defaultFb2Encoding;
  }

  return normalizeEncoding(match[1]);
}

function decodeBytes(bytes: Uint8Array): string {
  const encoding = detectFb2Encoding(bytes);

  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    // Неизвестная браузеру кодировка — откатываемся к UTF-8, чтобы не уронить чтение.
    return new TextDecoder(defaultFb2Encoding, { fatal: false }).decode(bytes);
  }
}

// Декодирует байты FB2-файла в строку с учётом encoding из XML-декларации.
export function decodeFb2Text(bytes: Uint8Array): string {
  return decodeBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

// Читает Blob/File/Response FB2-файла и декодирует с учётом encoding из XML-декларации.
export async function readFb2BlobText(blob: Blob): Promise<string> {
  return decodeFb2Text(new Uint8Array(await blob.arrayBuffer()));
}
