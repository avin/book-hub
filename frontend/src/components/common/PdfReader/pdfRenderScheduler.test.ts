import { describe, expect, it, vi } from 'vitest';
import { createPdfRenderScheduler, type PdfRenderTaskKind } from './pdfRenderScheduler';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('PDF render scheduler', () => {
  it('после rapid jump запускает latest target раньше queued stale targets', async () => {
    const scheduler = createPdfRenderScheduler();
    const started: number[] = [];
    const operations = new Map<number, ReturnType<typeof deferred<number>>>();

    for (const pageNumber of [12, 20, 28, 36, 40]) {
      scheduler.beginGeneration();
      const operation = deferred<number>();
      operations.set(pageNumber, operation);
      scheduler.enqueue({
        id: `page-${pageNumber}`,
        pageNumber,
        kind: 'bitmap',
        priority: 0,
        run: () => {
          started.push(pageNumber);
          return { promise: operation.promise };
        },
        commit: vi.fn(),
      });
    }

    expect(started).toEqual([12]);
    operations.get(12)!.resolve(12);
    await settle();
    expect(started).toEqual([12, 40]);
  });

  it('не commit-ит stale in-flight result и освобождает его', async () => {
    const scheduler = createPdfRenderScheduler();
    const operation = deferred<string>();
    const commit = vi.fn();
    const release = vi.fn();

    scheduler.beginGeneration();
    scheduler.enqueue({
      id: 'old',
      pageNumber: 1,
      kind: 'bitmap',
      priority: 0,
      run: () => ({ promise: operation.promise }),
      commit,
      release,
    });
    scheduler.beginGeneration();
    operation.resolve('pixels');
    await settle();

    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith('pixels');
  });

  it('удаляет queued bitmap и text tasks старого generation', async () => {
    const scheduler = createPdfRenderScheduler();
    const running = deferred<string>();
    const starts: string[] = [];
    const enqueue = (id: string, kind: PdfRenderTaskKind, promise: Promise<string>) =>
      scheduler.enqueue({
        id,
        pageNumber: 1,
        kind,
        priority: kind === 'text' ? 3 : 1,
        run: () => {
          starts.push(id);
          return { promise };
        },
        commit: vi.fn(),
      });

    scheduler.beginGeneration();
    enqueue('running', 'bitmap', running.promise);
    enqueue('queued-bitmap', 'bitmap', Promise.resolve('bitmap'));
    enqueue('queued-text', 'text', Promise.resolve('text'));
    scheduler.beginGeneration();
    running.resolve('done');
    await settle();

    expect(starts).toEqual(['running']);
  });

  it('не запускает text до первого bitmap актуальной страницы', async () => {
    const scheduler = createPdfRenderScheduler();
    const starts: string[] = [];

    scheduler.beginGeneration();
    scheduler.enqueue({
      id: 'text',
      pageNumber: 2,
      kind: 'text',
      priority: 0,
      run: () => {
        starts.push('text');
        return { promise: Promise.resolve('text') };
      },
      commit: vi.fn(),
    });
    scheduler.enqueue({
      id: 'bitmap',
      pageNumber: 2,
      kind: 'bitmap',
      priority: 1,
      run: () => {
        starts.push('bitmap');
        return { promise: Promise.resolve('bitmap') };
      },
      commit: vi.fn(),
    });
    await settle();

    expect(starts).toEqual(['bitmap', 'text']);
  });

  it('pruneQueue удаляет только неактуальные queued tasks без сброса generation', async () => {
    const scheduler = createPdfRenderScheduler();
    const starts: string[] = [];
    const running = deferred<string>();

    scheduler.beginGeneration();
    scheduler.enqueue({
      id: 'running',
      pageNumber: 1,
      kind: 'bitmap',
      priority: 0,
      run: () => {
        starts.push('running');
        return { promise: running.promise };
      },
      commit: vi.fn(),
    });
    scheduler.enqueue({
      id: 'keep',
      pageNumber: 2,
      kind: 'bitmap',
      priority: 0,
      run: () => {
        starts.push('keep');
        return { promise: Promise.resolve('keep') };
      },
      commit: vi.fn(),
    });
    scheduler.enqueue({
      id: 'drop',
      pageNumber: 3,
      kind: 'bitmap',
      priority: 0,
      run: () => {
        starts.push('drop');
        return { promise: Promise.resolve('drop') };
      },
      commit: vi.fn(),
    });
    scheduler.pruneQueue((task) => task.id === 'running' || task.id === 'keep');
    running.resolve('done');
    await settle();

    expect(starts).toEqual(['running', 'keep']);
    expect(scheduler.currentGeneration()).toBe(1);
  });

  it('interruptRunning отменяет in-flight задачу без сброса generation', async () => {
    const scheduler = createPdfRenderScheduler();
    const operation = deferred<string>();
    const cancel = vi.fn();
    const commit = vi.fn();
    const onAbort = vi.fn();

    scheduler.beginGeneration();
    scheduler.enqueue({
      id: 'running',
      pageNumber: 1,
      kind: 'bitmap',
      priority: 0,
      run: () => ({ promise: operation.promise, cancel }),
      commit,
      onAbort,
    });
    scheduler.interruptRunning();
    operation.resolve('pixels');
    await settle();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(scheduler.currentGeneration()).toBe(1);
  });

  it('release отменяет работу и безопасен при повторном вызове', async () => {
    const scheduler = createPdfRenderScheduler();
    const operation = deferred<string>();
    const cancel = vi.fn();
    const commit = vi.fn();

    scheduler.beginGeneration();
    scheduler.enqueue({
      id: 'bitmap',
      pageNumber: 1,
      kind: 'bitmap',
      priority: 0,
      run: () => ({ promise: operation.promise, cancel }),
      commit,
    });
    scheduler.release();
    scheduler.release();
    operation.resolve('pixels');
    await settle();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });
});
