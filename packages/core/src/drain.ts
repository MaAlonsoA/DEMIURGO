// Drain mode: the operator asks the API to stop starting new work so it can be restarted safely (connection draining:
// Kubernetes documentation, «Pod lifecycle: Termination of Pods»; Google SRE book ch. 7, drain before maintenance).
// The flag is a file at the repository root, which compose bind-mounts at /app: the host and the api container see the
// same file, and it needs no migration. Content: JSON `{ reason, since }`. A file (not the database) is on purpose:
// the host script can set it with the API down, and a restart or a restored snapshot never changes it.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Drain = { draining: boolean; reason: string | null; since: string | null };

/** Path of the flag: `DEMIURGO_DRAIN_FILE` (tests) or `<repo root>/.demiurgo-drain`. */
export function drainFile(): string {
  return process.env.DEMIURGO_DRAIN_FILE ?? fileURLToPath(new URL('../../../.demiurgo-drain', import.meta.url));
}

/** Reads the flag at every use (one small file). Any unreadable or odd content still counts as draining when the file exists. */
export function readDrain(file: string = drainFile()): Drain {
  if (!existsSync(file)) return { draining: false, reason: null, since: null };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { reason?: unknown; since?: unknown };
    return { draining: true, reason: typeof parsed.reason === 'string' ? parsed.reason : null, since: typeof parsed.since === 'string' ? parsed.since : null };
  } catch {
    return { draining: true, reason: null, since: null };
  }
}

export function isDraining(file?: string): boolean {
  return readDrain(file).draining;
}

export function setDrain(reason: string, file: string = drainFile(), now: Date = new Date()): Drain {
  const since = now.toISOString();
  writeFileSync(file, `${JSON.stringify({ reason, since })}\n`);
  return { draining: true, reason, since };
}

export function clearDrain(file: string = drainFile()): void {
  rmSync(file, { force: true });
}
