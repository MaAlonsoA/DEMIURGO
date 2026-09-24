// The verifiability check of a statement, the same pure function the server runs when it saves
// a version (packages/domain/src/records.ts, no imports of its own). It only warns, never blocks.

import { verifiabilityWarnings } from '../../../../domain/src/records.ts';

const LABEL = 'CHECK';

/** The warnings of a statement, without the code the server puts in front. */
export function statementWarnings(statement: string): string[] {
  if (statement.trim() === '') return [];
  return verifiabilityWarnings(LABEL, statement).map((w) => w.slice(LABEL.length + 1).trim());
}
