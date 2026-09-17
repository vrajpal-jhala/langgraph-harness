// Serializes concurrent calls sharing a key; self-deletes once idle so this never grows unbounded.
const locks = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(key) ?? Promise.resolve();
  const run = prior.then(fn);
  const tail: Promise<void> = run
    .catch(() => undefined)
    .then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
  locks.set(key, tail);
  return run;
}
