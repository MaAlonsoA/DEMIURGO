// What a save said, carried to the page it opens (DESIGN.md §3.6): record_version.create answers with
// warnings (e.g. a check that may be hard to verify) that the old form dropped when it navigated
// away (INVENTORY INV-NEWVER, UX problem). The form leaves them here for the version's page, which
// shows them once. In memory: a reload has already shown them.

const pending = new Map<string, string[]>();

const keyOf = (code: string, n: number) => `${code}@${n}`;

export function leaveSaveWarnings(code: string, n: number, warnings: readonly string[]): void {
  if (warnings.length > 0) pending.set(keyOf(code, n), [...warnings]);
}

/** The warnings left for this version, if any; they are handed over once. */
export function takeSaveWarnings(code: string, n: number): string[] {
  const key = keyOf(code, n);
  const w = pending.get(key) ?? [];
  pending.delete(key);
  return w;
}
