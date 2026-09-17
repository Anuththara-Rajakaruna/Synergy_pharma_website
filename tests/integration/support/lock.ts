// Cross-process lock around the shared integration database and bucket. `npm run test:integration`
// already runs files one at a time; the lock keeps results correct when files are started in
// parallel some other way (they then wait for each other instead of dropping each other's data).

import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function tryAcquire(file: string): boolean {
  try {
    const fd = openSync(file, "wx");
    writeSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  // Remove a lock left behind by a process that no longer exists.
  try {
    const owner = Number.parseInt(readFileSync(file, "utf8"), 10);
    if (!Number.isInteger(owner) || (owner !== process.pid && !isAlive(owner))) unlinkSync(file);
  } catch {
    // The owner released it in the meantime.
  }
  return false;
}

export async function acquireSuiteLock(name: string, timeoutMs = 10 * 60 * 1000): Promise<() => void> {
  const file = path.join(tmpdir(), `${name}.integration.lock`);
  const deadline = Date.now() + timeoutMs;
  while (!tryAcquire(file)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for the integration test lock ${file}.`);
    await sleep(250);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      unlinkSync(file);
    } catch {
      // Already removed.
    }
  };
}
