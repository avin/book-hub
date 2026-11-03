import { expect, it, vi } from 'vitest';
import { createBookDraft, type BookDraft } from './uploadDraftModel';
import useUploadDraftPreparation from './useUploadDraftPreparation';

const extraction = vi.hoisted(() => ({
  prepareBookFile: vi.fn(),
  prepareCoverFile: vi.fn(),
  extractBookTitle: vi.fn(),
}));
vi.mock('./coverExtraction', () => extraction);

it('не прерывает проверку EPUB при выборе обложки и извлечении названия', async () => {
  let finishBook!: (result: { coverFile?: File }) => void;
  let bookSignal: AbortSignal | undefined;
  extraction.prepareBookFile.mockImplementation((_file, options) => {
    bookSignal = options.signal;
    return new Promise((resolve) => {
      finishBook = resolve;
    });
  });
  const cover = new File(['cover'], 'cover.png', { type: 'image/png' });
  extraction.prepareCoverFile.mockResolvedValue(cover);
  extraction.extractBookTitle.mockResolvedValue('Название');
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cover');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  let draft: BookDraft = createBookDraft(new File(['book'], 'book.epub'), 'book');
  const update = (_id: string, fn: (draft: BookDraft) => BookDraft) => {
    draft = fn(draft);
  };
  const preparation = useUploadDraftPreparation({
    findDraft: () => draft,
    updateDraft: update,
    updatePreparedDraft: (id, _generation, fn) => update(id, fn),
    setCover: (_id, file, status) => {
      draft = { ...draft, coverFile: file, coverSource: 'manual', coverStatus: status };
    },
    errorMessage: (_error, fallback) => fallback,
    messages: {
      invalidEpub: () => 'invalid',
      coverCouldNotBeExtracted: () => 'cover',
      titleCouldNotBeExtracted: () => 'title',
    },
  });
  const book = preparation.prepareDraft(draft, 0);
  await vi.waitFor(() => expect(bookSignal).toBeDefined());
  await Promise.all([
    preparation.prepareManualCover('book', cover, 0),
    preparation.extractTitle('book', 0),
  ]);
  expect(bookSignal?.aborted).toBe(false);
  expect(draft.epubValidationStatus).toBe('pending');
  finishBook({});
  await book;
  expect(draft).toMatchObject({
    epubValidationStatus: 'ready',
    coverSource: 'manual',
    coverFile: cover,
    title: 'Название',
  });
  createObjectURL.mockRestore();
  vi.restoreAllMocks();
});
