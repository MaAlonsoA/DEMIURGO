// Pure logic of the map (FDR-INT-002): the lanes by area, what an element is connected to, what
// waits on the person, and the words of each relation.

import type { MapQuestion, MapRelation, ProductMap, Relation } from '../../api/views.ts';

export type Lane = {
  area: string;
  /** Features (FDR): cards. */
  features: ProductMap['records'];
  /** Decisions and tech decisions: the rules the features follow, as nodes. */
  rules: ProductMap['records'];
};

export function lanesOf(map: ProductMap): Lane[] {
  return map.areas.map((area) => {
    const inArea = map.records.filter((r) => r.domain === area).toSorted((a, b) => a.code.localeCompare(b.code));
    return { area, features: inArea.filter((r) => r.type === 'fdr'), rules: inArea.filter((r) => r.type !== 'fdr') };
  });
}

/** The element and everything a relation joins it to, in either direction. */
export function connectedTo(code: string, relations: readonly MapRelation[]): Set<string> {
  const out = new Set([code]);
  for (const r of relations) {
    if (r.from === code) out.add(r.to);
    if (r.to === code) out.add(r.from);
  }
  return out;
}

export function waitingOn(code: string, questions: readonly MapQuestion[]): MapQuestion[] {
  return questions.filter((q) => q.affects.includes(code));
}

const WORDS: Record<Relation, { from: string; to: string }> = {
  needs: { from: 'Needs', to: 'Needed by' },
  follows: { from: 'Rules it follows', to: 'Followed by' },
  conflicts: { from: 'Conflicts with', to: 'Conflicts with' },
  affects: { from: 'Affects', to: 'Affected by' },
};

/** The relation seen from its origin (`from`) or from its target (`to`). */
export function relationWord(kind: Relation, end: 'from' | 'to'): string {
  return WORDS[kind][end];
}

/** How each relation is drawn: rust for conflicts, dashed while the link waits for review. */
export function relationStroke(r: MapRelation): { color: string; dash: string | undefined; width: number } {
  const color =
    r.kind === 'conflicts' ? 'var(--color-problem-fill)' : r.kind === 'follows' ? 'var(--color-inactive)' : 'var(--color-ink-3)';
  return { color, dash: r.under_review || r.kind === 'affects' ? '5 4' : undefined, width: r.kind === 'needs' ? 1.75 : 1.25 };
}
