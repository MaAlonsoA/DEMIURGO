// What the pages of runs derive from the API (spec §4.9): their events in the log, their retries
// and how long they took. The words of a run's events live here: they are only shown on its page.

import type { EventRow, Run, RunListItem } from '../../api/types.ts';
import { between } from '../../lib/time.ts';
import { whoOf } from '../../words.ts';

/** States of a run in the order of the filter of Activity. */
export const RUN_STATES = ['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'] as const;

/** What each event of a run's life means, in product words. */
export const EVENT_WORDS: Record<string, string> = {
  'run.request': 'Requested',
  'run.retry': 'Requested again (retry)',
  'run.begin': 'Started',
  'run.complete': 'Finished',
  'run.fail': 'Failed',
  'run.cancel': 'Cancelled',
  'run.interrupt': 'Interrupted',
  'context_pack.build': 'Context gathered',
  'message.post': 'Wrote in the thread',
  'question.raise': 'Asked a question',
  'question.infer': 'Assumed an answer',
  'batch.submit': 'Proposed',
};

type Cause = { run?: string } | null;

/** Events of a run: its own, those it caused, and the building of its context pack. */
export function runEvents(events: readonly EventRow[], run: Pick<Run, 'id' | 'context_pack_id'>): EventRow[] {
  return events.filter(
    (e) =>
      e.entity_id === run.id ||
      (e.cause as Cause)?.run === run.id ||
      (run.context_pack_id !== null && e.entity_id === run.context_pack_id),
  );
}

/** Retries of a run, oldest first. */
export function retriesOf(runId: string, runs: readonly RunListItem[]): RunListItem[] {
  return runs.filter((r) => r.retry_of === runId).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** How long it ran (or has been running): from its start, or from its request while queued. */
export function runDuration(run: Pick<Run, 'state' | 'created_at' | 'started_at' | 'finished_at'>, now = Date.now()): string {
  if (run.state === 'queued') return between(run.created_at, null, now);
  if (!run.started_at) return run.finished_at ? between(run.created_at, run.finished_at, now) : '';
  return between(run.started_at, run.finished_at, now);
}

/** Who asked for a run, short: the tooltip of its mark says the rest. */
export function askedBy(actor: string): string {
  const who = whoOf(actor);
  if (who.kind === 'you') return 'You';
  if (who.kind === 'agent') return `Agent · ${who.name}`;
  return who.name;
}

/** The same, as a phrase: "Requested by you", "Requested automatically". */
export function requestedBy(actor: string): string {
  const who = whoOf(actor);
  if (who.kind === 'automatic') return 'Requested automatically';
  return `Requested by ${who.kind === 'you' ? 'you' : askedBy(actor)}`;
}

const NOUNS: Record<string, [string, string]> = {
  decision: ['decision', 'decisions'],
  fdr: ['feature', 'features'],
  adr: ['tech decision', 'tech decisions'],
  exploration: ['thread', 'threads'],
  review: ['review', 'reviews'],
};

/** What a batch holds, in words: "1 decision", "2 features and 1 thread". */
export function proposalsInWords(types: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  const parts = [...counts].map(([t, n]) => {
    const [one, many] = NOUNS[t] ?? ['proposal', 'proposals'];
    return `${n} ${n === 1 ? one : many}`;
  });
  if (parts.length <= 1) return parts[0] ?? 'nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
