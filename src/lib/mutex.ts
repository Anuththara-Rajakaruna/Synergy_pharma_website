// Simple promise-based mutex to prevent concurrent JSON file writes.
// Multiple simultaneous requests will queue writes instead of corrupting data.

const locks = new Map<string, Promise<void>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const current = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  locks.set(key, next);

  await current;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === next) {
      locks.delete(key);
    }
  }
}
