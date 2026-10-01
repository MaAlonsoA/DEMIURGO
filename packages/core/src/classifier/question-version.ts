// The version of a question put to Jev: a short sha256 of its text and its levels, so opinions given by
// different wordings can be compared (observability, queries/calibration.ts). Stable: the same parts always
// give the same version, whatever the order of the keys inside them.

import { createHash } from 'node:crypto';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  }
  return value;
}

/** 12 hex characters of the sha256 of the parts. */
export function questionVersion(...parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(stable(parts))).digest('hex').slice(0, 12);
}
