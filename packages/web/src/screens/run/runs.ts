// What the pages of runs derive from the API (DESIGN.md §3.4, §4.2): their events in the log,
// their attempts, how long they took, and the words of a run's life that only these pages show.
// Pure and unit-tested; other screens import `runDuration` and `proposalsInWords` from here.

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

/** How the run talked to its engine (FDR-AGE-002). */
export const SESSION_WORDS: Record<string, string> = {
  none: 'None: the whole context',
  fresh: 'New conversation, whole context',
  resumed: 'Continued: only what was added',
};

/** Each event an engine call records, in words. */
export const CALL_EVENT_WORDS: Record<string, string> = {
  started: 'Started',
  thinking: 'Thinking',
  message: 'Wrote',
  usage: 'Counted usage',
  result: 'Answered',
  error: 'Error',
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

/**
 * Every attempt of the work a run belongs to, oldest first: the runs it retries (up to the first),
 * itself, and every retry made from any of them. A retry is a new run on the same context pack.
 */
export function attemptsOf<T extends Pick<RunListItem, 'id' | 'retry_of' | 'created_at'>>(
  runId: string,
  runs: readonly T[],
): T[] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  let root = byId.get(runId);
  if (!root) return [];
  const seen = new Set<string>([root.id]);
  while (root.retry_of && byId.has(root.retry_of) && !seen.has(root.retry_of)) {
    root = byId.get(root.retry_of) as T;
    seen.add(root.id);
  }
  const chain: T[] = [];
  const visit = new Set<string>();
  const queue: T[] = [root];
  while (queue.length > 0) {
    const r = queue.shift() as T;
    if (visit.has(r.id)) continue;
    visit.add(r.id);
    chain.push(r);
    for (const x of runs) if (x.retry_of === r.id) queue.push(x);
  }
  return chain.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : 1));
}

/** How long it ran (or has been running): from its start, or from its request while queued. */
export function runDuration(run: Pick<Run, 'state' | 'created_at' | 'started_at' | 'finished_at'>, now = Date.now()): string {
  if (run.state === 'queued') return between(run.created_at, null, now);
  if (!run.started_at) return run.finished_at ? between(run.created_at, run.finished_at, now) : '';
  return between(run.started_at, run.finished_at, now);
}

/** Who asked for a run, short: "You", "Agent · claude-code", "Automatic". */
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

/** The title of a run's page: "Draft a feature" for a draft, else the action's word. */
export function runTitle(action: string, words: Record<string, string>): string {
  return action === 'design_proposal' ? 'Draft a feature' : (words[action] ?? action);
}

/** "explorer · Claude · Opus · high": which agent ran it and on which engine, as far as it is known. */
export function agentAndEngine(agent: string | null | undefined, engine: string | null): string {
  return [agent, engine].filter(Boolean).join(' · ');
}

/**
 * What the person can do next after a run stopped, in words (DESIGN.md §4.2, R09): an interrupted
 * run was DEMIURGO, not the content, so a plain retry; an output that didn't match the format is
 * more likely to work on another engine.
 */
export function nextStep(run: Pick<Run, 'state' | 'failure_kind'>): string | null {
  if (run.state === 'interrupted' || run.failure_kind === 'infra')
    return "It wasn't the content: DEMIURGO stopped. Retry runs it again as it was.";
  if (run.state === 'cancelled') return 'Retry runs it again on the same context.';
  if (run.state !== 'failed') return null;
  switch (run.failure_kind) {
    case 'invalid_output':
      return "The engine answered in a shape DEMIURGO can't use. Retrying with another engine is more likely to work.";
    case 'timeout':
      return 'Retry gives it another go; another engine may answer faster.';
    case 'agent_error':
      return 'Retry runs it again on the same context, or retry it once with another engine.';
    case 'stale_knowledge':
      return 'Retry runs it again once DEMIURGO has caught up with your latest changes.';
    default:
      return 'Retry runs it again on the same context, or retry it once with another engine.';
  }
}

/** A time with its seconds, and the day when it isn't today: "18:52:03", "24 Sep 18:52:03". */
export function clockTime(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const today = new Date(now).toDateString() === d.toDateString();
  return today ? time : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
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
