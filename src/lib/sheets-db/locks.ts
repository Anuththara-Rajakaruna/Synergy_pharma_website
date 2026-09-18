// Per-key mutual exclusion inside one server process.
//
// Google Sheets has no unique indexes and no compare-and-swap, so two requests that both want to
// create "the one application for this job and email" have to be ordered by us. This lock does
// that for the common case - two clicks from the same person land on the same warm instance -
// and the store on top of it reconciles the rest after the fact (src/lib/sheets-db/table.ts),
// which is what actually makes the rule hold across serverless instances.
//
// Holders are queued in arrival order. A lock is always released, including when the guarded
// function throws, and a holder that hangs is not allowed to block the key forever.

const DEFAULT_TIMEOUT_MS = 30_000;

type Waiter = { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

type LockState = { held: boolean; queue: Waiter[] };

declare global {
  var __synergySheetLocks: Map<string, LockState> | undefined;
}

// Kept on globalThis so a dev-mode hot reload does not hand out a second, independent lock map
// for the same keys.
const locks: Map<string, LockState> = (globalThis.__synergySheetLocks ??= new Map());

function stateFor(key: string): LockState {
  let state = locks.get(key);
  if (!state) {
    state = { held: false, queue: [] };
    locks.set(key, state);
  }
  return state;
}

function release(key: string): void {
  const state = locks.get(key);
  if (!state) return;
  const next = state.queue.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve();
    return;
  }
  state.held = false;
  // Nothing waiting: drop the entry so the map cannot grow without bound across many keys
  // (one per candidate email, one per record id, ...).
  locks.delete(key);
}

async function acquire(key: string, timeoutMs: number): Promise<void> {
  const state = stateFor(key);
  if (!state.held) {
    state.held = true;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = state.queue.indexOf(waiter);
        if (index !== -1) state.queue.splice(index, 1);
        // Falling back to an unguarded run would be worse than failing: the caller would race.
        reject(new Error(`Timed out waiting for the "${key}" lock.`));
      }, timeoutMs),
    };
    state.queue.push(waiter);
  });
}

// Runs `fn` with exclusive access to `key`. Nested calls on the same key would deadlock, so a
// guarded function must not take the same lock again.
export async function withLock<T>(key: string, fn: () => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
  await acquire(key, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await fn();
  } finally {
    release(key);
  }
}

// Takes several locks at once, always in sorted order so two callers that need the same pair can
// never deadlock by taking them in opposite orders.
export async function withLocks<T>(keys: string[], fn: () => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
  const ordered = [...new Set(keys)].sort();
  if (ordered.length === 0) return fn();
  const [first, ...rest] = ordered;
  return withLock(first, () => (rest.length === 0 ? fn() : withLocks(rest, fn, opts)), opts);
}

// Test and diagnostics helper: how many keys are currently locked or queued.
export function activeLockCount(): number {
  return locks.size;
}
