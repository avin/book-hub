import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../ReflowableReader/reflowableReaderSettings';
import { buildVirtualLayout, findBlockIndex } from '../ReflowableReader/reflowableLayout';
import { binaryToDataUrl } from '../ReflowableReader/reflowableBinary';
import {
  findReflowableSearchMatches,
  normalizeSearchQuery,
} from '../ReflowableReader/reflowableSearch';
import { parseFb2 } from './fb2Parser';
import { decodeFb2Text } from '@/bookFormats/fb2TextDecoder';
import { isExternalHref, normalizeInternalHref } from '../ReflowableReader/linkUtils';

describe('FB2 core', () => {
  it('разбирает метаданные, текст, сноски и встроенную обложку', () => {
    const document = parseFb2(`<?xml version="1.0"?><FictionBook>
      <description><title-info><book-title>Тестовая книга</book-title><author><first-name>Иван</first-name><last-name>Петров</last-name></author><coverpage><image l:href="#cover" xmlns:l="http://www.w3.org/1999/xlink"/></coverpage></title-info></description>
      <body><section id="chapter"><title><p>Глава</p></title><p>Привет <a l:href="#note" xmlns:l="http://www.w3.org/1999/xlink">мир</a>.</p></section></body>
      <body name="notes"><section id="note"><p>Текст сноски</p></section></body>
      <binary id="cover" content-type="image/png">aGVsbG8=</binary>
    </FictionBook>`);

    expect(document.title).toBe('Тестовая книга');
    expect(document.authors).toEqual(['Иван Петров']);
    expect(document.binaries.get('cover')).toMatchObject({ contentType: 'image/png' });
    expect(document.notes.get('note')?.blocks[0]?.inlines?.[0]?.text).toBe('Текст сноски');
    expect(document.blocks.some((block) => block.kind === 'title')).toBe(true);
    expect(binaryToDataUrl(document.binaries.get('cover'))).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('находит текст сквозь inline-узлы и строит устойчивую виртуальную раскладку', () => {
    const blocks = parseFb2(
      '<FictionBook><body><section><p>Первый <strong>тест</strong></p><p>Второй тест</p></section></body></FictionBook>',
    ).blocks;
    const matches = findReflowableSearchMatches(blocks, ' тест ');
    const layout = buildVirtualLayout(
      [
        { id: 'first', kind: 'emptyLine', level: 0, role: 'body' },
        { id: 'second', kind: 'emptyLine', level: 0, role: 'body' },
      ],
      600,
      defaultSettings,
    );

    expect(normalizeSearchQuery('  ТЕСТ\n')).toBe('ТЕСТ');
    expect(matches).toHaveLength(2);
    expect(layout.offsets).toEqual([...layout.offsets].sort((left, right) => left - right));
    expect(layout.totalHeight).toBeGreaterThan(0);
    expect(findBlockIndex(layout.offsets, layout.offsets[1]! + 1)).toBe(1);
    expect(findBlockIndex([], 100)).toBe(0);
  });

  it('декодирует windows-1251 и нормализует ссылки', () => {
    const bytes = new Uint8Array([
      60, 63, 120, 109, 108, 32, 101, 110, 99, 111, 100, 105, 110, 103, 61, 34, 119, 105, 110, 45,
      49, 50, 53, 49, 34, 63, 62, 207, 240, 232, 226, 229, 242,
    ]);

    expect(decodeFb2Text(bytes)).toContain('Привет');
    expect(isExternalHref('https://example.com')).toBe(true);
    expect(isExternalHref('#chapter')).toBe(false);
    expect(normalizeInternalHref('#chapter')).toBe('chapter');
    expect(normalizeInternalHref('https://example.com')).toBe('https://example.com');
  });
});
