// The "What changed" lens of the overview (DESIGN.md §3.5, INV-LENS-01…12): the events since the
// person's last visit in this browser, told in lines, and which records and threads changed. It
// follows the stream now (the `changes` query is invalidated by events), without the person's own
// actions of this session (own.ts). "Show everything" turns it off for this project until reload.

import { useQueries, useQuery } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import { batchQuery, changesQuery } from '../../../api/queries.ts';
import type { BatchDetail, ChangedThing, ProductState } from '../../../api/types.ts';
import { usePerson, useTables } from '../../../lib/hooks.ts';
import { changedOf, type LensLine, linesOf, nothingConfirmedChanged } from './lines.ts';
import { APP_STARTED, onSessionStart, sessionStartEvent, withoutOwn } from './own.ts';
import { type Visit, visits } from './visit.ts';

/** Projects where the person chose "Show everything" in this session. */
const off = new Set<string>();

export type Lens = {
  baseline: Visit | null;
  /** When the last visit was (ISO), for "since Thu 18:52". */
  since: string | null;
  lines: LensLine[];
  /** The thing each line tells, by line id. */
  things: Map<string, ChangedThing>;
  /** There is something to show: the lens can be turned on. */
  available: boolean;
  on: boolean;
  setOn: (on: boolean) => void;
  /** Changed records (code → short note) and threads (id → short note). */
  records: Map<string, string | null>;
  threads: Map<string, string | null>;
  nothingConfirmed: boolean;
};

/** Batches told in detail (who proposed, about which records); later ones keep generic words. */
const MAX_BATCHES = 30;

export function useLens(projectId: string, state: ProductState | undefined): Lens {
  const baseline = visits.baseline(projectId);
  const tables = useTables();
  const person = usePerson();
  const [on, setOnState] = useState(() => !off.has(projectId));
  const sinceEvent = useSyncExternalStore(onSessionStart, () => sessionStartEvent(projectId));
  const changes = useQuery({ ...changesQuery(projectId, baseline?.event ?? '0'), enabled: baseline !== null });
  const told = changes.data
    ? withoutOwn(changes.data, person ? `human:${person}` : null, { event: sinceEvent, at: APP_STARTED })
    : undefined;
  const batchKeys = (told?.things ?? [])
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

  const lines = told ? linesOf(told, { batches, records }) : [];
  const changed = changedOf(lines);
  const available = lines.length > 0;
  return {
    baseline,
    since: baseline?.at || null,
    lines,
    things: new Map((told?.things ?? []).map((t) => [`${t.kind}:${t.key}`, t])),
    available,
    on: on && available,
    setOn: (v) => {
      if (v) off.delete(projectId);
      else off.add(projectId);
      setOnState(v);
    },
    records: changed.records,
    threads: changed.threads,
    nothingConfirmed: told && tables ? nothingConfirmedChanged(told, tables) : false,
  };
}
