/** Minimal push-based async iterable used to bridge callback APIs (XHR) to `for await`. */
export function createAsyncQueue<T>() {
  const items: T[] = [];
  let done = false;
  let failure: unknown;
  let wake: (() => void) | null = null;

  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  return {
    push(item: T) {
      if (done) return;
      items.push(item);
      notify();
    },
    end() {
      done = true;
      notify();
    },
    fail(error: unknown) {
      if (done) return;
      failure = error;
      done = true;
      notify();
    },
    get isDone() {
      return done;
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
      while (true) {
        if (items.length > 0) {
          yield items.shift() as T;
          continue;
        }
        if (done) {
          if (failure) throw failure;
          return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
