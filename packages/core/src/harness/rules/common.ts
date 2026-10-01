// Helpers the queue, schema and files rules share: reading stored step details (some old rows keep JSON as a
// string), the real files of a request (G01) and minutes between timestamps. Pure.

export const iso = (d: unknown): string => (d === null || d === undefined ? '' : new Date(d as Date | string).toISOString());
export const ms = (d: unknown): number => new Date(d as Date | string).getTime();
export const minutesBetween = (from: unknown, to: unknown): number => Math.max(0, Math.round(((ms(to) - ms(from)) / 60_000) * 10) / 10);

/** Parses a value stored as JSON text (the old footprint format); anything else passes through. */
export function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export const objectOf = (value: unknown): Record<string, unknown> => {
  const v = parseJson(value);
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};

type StepLike = { id: string; attempt: number; stage: string; outcome: string; detail: unknown; created_at: unknown };

/** The paths of a footprint, in either format: an object or a JSON string, files as `{path}` or as plain strings. */
export function footprintPaths(footprint: unknown): string[] | null {
  const files = objectOf(footprint).files;
  if (!Array.isArray(files)) return null;
  return files.map((f) => (typeof f === 'string' ? f : (objectOf(f).path as unknown))).filter((p): p is string => typeof p === 'string' && p.length > 0);
}

/**
 * The files the request really changed (G01): the footprint of the merge step (the whole pull request), else the
 * files of the latest successful commit step. Null when nothing stored says (the request did not get that far).
 */
export function realFilesOf(steps: readonly StepLike[]): string[] | null {
  const ok = steps.filter((s) => s.outcome === 'ok');
  for (const s of [...ok].reverse()) {
    if (s.stage !== 'merge' && s.stage !== 'footprint') continue;
    const paths = footprintPaths(objectOf(s.detail).footprint);
    if (paths) return [...new Set(paths)];
  }
  for (const s of [...ok].reverse()) {
    if (s.stage !== 'commit') continue;
    const files = objectOf(s.detail).files;
    if (Array.isArray(files)) return [...new Set(files.filter((f): f is string => typeof f === 'string'))];
  }
  return null;
}
