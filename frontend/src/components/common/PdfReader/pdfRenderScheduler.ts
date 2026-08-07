export type PdfRenderTaskKind = 'bitmap' | 'filter' | 'text';

export type PdfScheduledOperation<Result> = {
  promise: Promise<Result>;
  cancel?: () => void;
};

export type PdfRenderSchedulerTask<Result> = {
  id: string;
  pageNumber: number;
  kind: PdfRenderTaskKind;
  priority: number;
  run: () => PdfScheduledOperation<Result>;
  commit: (result: Result) => void;
  release?: (result: Result) => void;
  onError?: (error: unknown) => void;
};

type QueuedTask = PdfRenderSchedulerTask<unknown> & {
  generation: number;
  sequence: number;
};

export function createPdfRenderScheduler() {
  let generation = 0;
  let sequence = 0;
  let released = false;
  let running: (QueuedTask & { cancelled: boolean; cancelOperation?: () => void }) | undefined;
  const queue: QueuedTask[] = [];
  const bitmapReadyPages = new Set<number>();

  const nextRunnableTaskIndex = () => {
    let result = -1;

    for (let index = 0; index < queue.length; index += 1) {
      const task = queue[index];

      if (task.kind === 'text' && !bitmapReadyPages.has(task.pageNumber)) {
        continue;
      }

      if (
        result < 0 ||
        task.priority < queue[result].priority ||
        (task.priority === queue[result].priority && task.sequence < queue[result].sequence)
      ) {
        result = index;
      }
    }

    return result;
  };

  const pump = () => {
    if (released || running) {
      return;
    }

    const index = nextRunnableTaskIndex();

    if (index < 0) {
      return;
    }

    const task = queue.splice(index, 1)[0];
    const current: QueuedTask & { cancelled: boolean; cancelOperation?: () => void } = {
      ...task,
      cancelled: false,
    };
    running = current;

    let operation: PdfScheduledOperation<unknown>;

    try {
      operation = task.run();
      current.cancelOperation = operation.cancel;
    } catch (error) {
      running = undefined;
      if (!current.cancelled && current.generation === generation) {
        current.onError?.(error);
      }
      pump();
      return;
    }

    void operation.promise
      .then((result) => {
        if (!current.cancelled && current.generation === generation && !released) {
          current.commit(result);
          if (current.kind === 'bitmap') {
            bitmapReadyPages.add(current.pageNumber);
          }
        } else {
          current.release?.(result);
        }
      })
      .catch((error) => {
        if (!current.cancelled && current.generation === generation && !released) {
          current.onError?.(error);
        }
      })
      .finally(() => {
        if (running === current) {
          running = undefined;
        }
        pump();
      });
  };

  return {
    beginGeneration() {
      generation += 1;
      queue.length = 0;
      bitmapReadyPages.clear();

      if (running) {
        running.cancelled = true;
        running.cancelOperation?.();
      }

      return generation;
    },
    enqueue<Result>(task: PdfRenderSchedulerTask<Result>) {
      if (released) {
        return;
      }

      const existingIndex = queue.findIndex(
        (candidate) => candidate.id === task.id && candidate.generation === generation,
      );

      if (existingIndex >= 0) {
        queue.splice(existingIndex, 1);
      }

      queue.push({ ...task, generation, sequence: sequence++ } as QueuedTask);
      pump();
    },
    markBitmapReady(pageNumber: number) {
      bitmapReadyPages.add(pageNumber);
      pump();
    },
    currentGeneration() {
      return generation;
    },
    release() {
      if (released) {
        return;
      }

      released = true;
      generation += 1;
      queue.length = 0;
      bitmapReadyPages.clear();

      if (running) {
        running.cancelled = true;
        running.cancelOperation?.();
      }
    },
  };
}
