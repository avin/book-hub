import { describe, expect, it } from 'vitest';
import {
  applyBulkTags,
  createBookDraft,
  finalizeDraftPreparation,
  isDjvuBookFile,
  isEpubBookFile,
  isSupportedBookFile,
  markDraftUploadFailed,
  markDraftUploading,
  removeDraft,
  updateDraft,
} from './uploadDraftModel';
import { mergeTagOptions } from '@/components/common/TagsSelect/tagUtils';

function file(name: string, type = '') {
  return new File(['book'], name, { type });
}

describe('upload draft model', () => {
  it('создаёт черновики с прежними статусами подготовки для форматов', () => {
    expect(createBookDraft(file('first.pdf', 'application/pdf'), 'pdf')).toMatchObject({
      title: 'first',
      coverStatus: 'pending',
      epubValidationStatus: 'ready',
      djvuValidationStatus: 'ready',
      uploadStatus: 'idle',
    });
    expect(createBookDraft(file('second.epub'), 'epub')).toMatchObject({
      epubValidationStatus: 'pending',
    });
    expect(createBookDraft(file('third.DJV'), 'djvu')).toMatchObject({
      djvuValidationStatus: 'pending',
    });
  });

  it('сохраняет правила поддерживаемых форматов', () => {
    expect(isSupportedBookFile(file('book.pdf'))).toBe(true);
    expect(isSupportedBookFile(file('book.fb2'))).toBe(true);
    expect(isSupportedBookFile(file('book.epub'))).toBe(true);
    expect(isSupportedBookFile(file('book.djvu'))).toBe(true);
    expect(isSupportedBookFile(file('book.txt'))).toBe(false);
    expect(isEpubBookFile(file('book.epub'))).toBe(true);
    expect(isDjvuBookFile(file('book.DJV'))).toBe(true);
  });

  it('обновляет только целевой черновик и сохраняет порядок тегов', () => {
    const first = createBookDraft(file('first.pdf'), 'first');
    const second = createBookDraft(file('second.pdf'), 'second');
    const updated = updateDraft([first, second], 'first', (draft) => ({
      ...draft,
      tags: ['one'],
    }));

    expect(applyBulkTags(updated, ['one', 'two'])).toMatchObject([
      { id: 'first', tags: ['one', 'two'] },
      { id: 'second', tags: ['one', 'two'] },
    ]);
    expect(
      mergeTagOptions(
        ['existing'],
        updated.flatMap((draft) => draft.tags),
      ),
    ).toEqual(['existing', 'one']);
    expect(removeDraft(updated, 'first')).toEqual([second]);
  });

  it('сохраняет переходы upload и завершения подготовки', () => {
    const pending = createBookDraft(file('book.pdf'), 'book');

    expect(markDraftUploading(pending)).toMatchObject({
      uploadStatus: 'uploading',
      uploadError: undefined,
    });
    expect(markDraftUploadFailed(pending, 'failed')).toMatchObject({
      uploadStatus: 'failed',
      uploadError: 'failed',
    });
    expect(
      finalizeDraftPreparation({
        ...pending,
        coverFile: file('cover.png'),
        coverPreviewUrl: 'blob:cover',
        coverSource: 'manual',
        titleExtracting: true,
      }),
    ).toMatchObject({
      coverStatus: 'missing',
      coverFile: undefined,
      coverPreviewUrl: undefined,
      coverSource: undefined,
      titleExtracting: false,
    });
  });
});
