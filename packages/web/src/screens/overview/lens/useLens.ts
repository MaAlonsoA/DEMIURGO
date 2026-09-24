// The "What changed" lens of the overview: the events since the last visit in this browser,
// told in lines, and which cards changed. "Show everything" turns it off for this session.

import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { batchQuery, changesQuery } from '../../../api/queries.ts';
import type { BatchDetail, ProductState } from '../../../api/types.ts';
import { useTables } from '../../../lib/hooks.ts';
import { dayTime } from '../../../lib/time.ts';
import { changedOf, type LensLine, linesOf, nothingConfirmedChanged } from './lines.ts';
import { type Visit, visits } from './visit.ts';

/** Projects where the person chose "Show everything" in this session. */
const off = new Set<string>();

export type Lens = {
  baseline: Visit | null;
  since: string | null;
  lines: LensLine[];
  /** There is something to show: the lens can be turned on. */
  available: boolean;
  on: boolean;
  setOn: (on: boolean) => void;
  records: Map<string, string | null>;
  threads: Map<string, string | null>;
  nothingConfirmed: boolean;
};

const MAX_BATCHES = 12;

export function useLens(projectId: string, state: ProductState | undefined): Lens {
  const baseline = visits.baseline(projectId);
  const tables = useTables();
  const [on, setOnState] = useState(() => !off.has(projectId));
  const changes = useQuery({ ...changesQuery(projectId, baseline?.event ?? '0'), enabled: baseline !== null });
  const batchKeys = (changes.data?.things ?? [])
    .filter((t) => t.kind === 'batch')
    .map((t) => t.key)
    .slice(0, MAX_BATCHES);
  // The batches tell who proposed what, and which records they are about.
  const batchResults = useQueries({ queries: batchKeys.map((id) => ({ ...batchQuery(projectId, id), retry: false })) });
  const batches: Record<string, BatchDetail | undefined> = {};
  batchKeys.forEach((id, i) => {
    batches[id] = batchResults[i]?.data;
  });
  const records: Record<string, { title: string; checks: number }> = {};
  for (const r of [...(state?.designs ?? []), ...(state?.decisions ?? [])])
    records[r.code] = { title: r.title, checks: r.checks };

  const lines = changes.data ? linesOf(changes.data, { batches, records }) : [];
  const changed = changedOf(lines);
  const available = lines.length > 0;
  return {
    baseline,
    since: baseline?.at ? dayTime(baseline.at) : null,
    lines,
    available,
    on: on && available,
    setOn: (v) => {
      if (v) off.delete(projectId);
      else off.add(projectId);
      setOnState(v);
    },
    records: changed.records,
    threads: changed.threads,
    nothingConfirmed: changes.data && tables ? nothingConfirmedChanged(changes.data, tables) : false,
  };
}
