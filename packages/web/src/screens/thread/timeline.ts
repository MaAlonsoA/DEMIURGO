// A thread in one order (DESIGN.md §3.3): its messages, the questions DEMIURGO showed and its runs,
// by time. DEMIURGO's messages of the same run go together (its reply and its observations). A run
// shows only while it works, when it failed or was cancelled, and when it left a draft ready; a
// finished conversation speaks through its messages. Also: the approved decisions Draft it starts
// from, and the live progress of a run in words without a second clock.

import type { Message, ProductRow, QueuedRun, Question, RunListItem } from '../../api/types.ts';
import { whoOf } from '../../words.ts';

export type RunDisplay = 'working' | 'failed' | 'retried' | 'cancelled' | 'draft' | 'directions';

export type TimelineItem =
  | { type: 'message'; key: string; at: number; message: Message; by: 'you' | 'agent' | 'automatic' }
  | { type: 'demiurgo'; key: string; at: number; runId: string | null; reply: Message | null; observations: Message[] }
  | { type: 'run'; key: string; at: number; run: RunListItem; display: RunDisplay }
  | { type: 'question'; key: string; at: number; question: Question }
  | { type: 'queued'; key: string; at: number; action: string }
  /** Optimistic: the person just asked for a reply and the server has not shown its run yet. */
  | { type: 'starting'; key: string; at: number };

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : 0);

/** What DEMIURGO can draft from a thread, as the API says it (one dedicated agent per kind). */
export type ThreadDraft = {
  kind: 'epic' | 'feature' | 'tasks' | 'design_directions' | 'design_system' | 'screens';
  why: string | null;
  suggested: boolean;
  action: 'epic_plan' | 'feature_design' | 'task_plan' | 'design_directions' | 'design_system_plan' | 'screen_design';
  scope: { type: string; id: string };
  /** A draft of this is already in flight: `batchId` when a proposal waits for review, null while a run is working. */
  pending?: { runId: string | null; batchId: string | null } | null;
};

/** The runs whose batch is a draft of a record. */
export const DRAFT_ACTIONS: readonly string[] = ['design_proposal', 'epic_plan', 'feature_design', 'task_plan', 'design_system_plan', 'screen_design'];

export const isActive = (run: Pick<RunListItem, 'state'>): boolean => run.state === 'queued' || run.state === 'running';

/** How a run shows in its thread, or null when its messages already say it all. */
export function runDisplay(run: RunListItem, runs: readonly RunListItem[]): RunDisplay | null {
  if (isActive(run)) return 'working';
  const retried = runs.some((r) => r.retry_of === run.id);
  if (run.state === 'failed' || run.state === 'interrupted') return retried ? 'retried' : 'failed';
  if (run.state === 'cancelled') return 'cancelled';
  if (run.state === 'completed' && run.batch_id && DRAFT_ACTIONS.includes(run.action)) return 'draft';
  // Visual directions propose nothing to accept: the run's card shows them, to choose one.
  if (run.state === 'completed' && run.action === 'design_directions') return 'directions';
  return null;
}

export function buildTimeline(
  messages: readonly Message[],
  runs: readonly RunListItem[],
  questions: readonly Question[] = [],
  queued: readonly QueuedRun[] = [],
  startingSince: number | null = null,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const side = sideRuns(messages);
  let group: Extract<TimelineItem, { type: 'demiurgo' }> | null = null;
  for (const m of messages) {
    // What was said about one question lives in its "Go deeper" side conversation, and so does
    // everything the run that answered there wrote (its observations carry no question).
    if (m.question_id || (m.run_id && side.has(m.run_id))) continue;
    const kind = whoOf(m.author).kind;
    if (kind === 'demiurgo') {
      if (!group || group.runId !== m.run_id) {
        group = { type: 'demiurgo', key: `d:${m.id}`, at: time(m.created_at), runId: m.run_id, reply: null, observations: [] };
        items.push(group);
      }
      if (m.kind) group.observations.push(m);
      else if (!group.reply) group.reply = m;
      else group.observations.push(m);
      continue;
    }
    group = null;
    items.push({ type: 'message', key: `m:${m.id}`, at: time(m.created_at), message: m, by: kind });
  }
  // DEMIURGO's questions are its messages too, from when each was shown (the caller passes the visible ones; the reserve stays hidden).
  for (const q of questions) {
    // A question the thread reveals before the server marked it shown goes at the end.
    items.push({ type: 'question', key: `q:${q.id}`, at: q.shown_at ? time(q.shown_at) : Number.MAX_SAFE_INTEGER, question: q });
  }
  for (const run of runs) {
    const display = runDisplay(run, runs);
    if (!display) continue;
    const at = display === 'working' ? time(run.created_at) : time(run.finished_at ?? run.created_at);
    items.push({ type: 'run', key: `r:${run.id}`, at, run, display });
  }
  // Requests the server holds until knowledge is up to date: no run exists yet, so they show as waiting.
  for (const q of queued) items.push({ type: 'queued', key: `w:${q.key}`, at: time(q.created_at), action: q.action });
  if (startingSince !== null) items.push({ type: 'starting', key: 'w:starting', at: startingSince });
  // Stable: what happened at the same instant keeps the order above (messages first).
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.at - b.item.at || a.i - b.i)
    .map(({ item }) => item);
}

/** How long the optimistic «Starting…» line may wait for the run to show up (convention nuestra). */
export const STARTING_MAX_MS = 90_000;
/** Client and server clocks may differ a little. */
const CLOCK_SLACK_MS = 5_000;

/**
 * Whether to still show «Sent · DEMIURGO will reply…»: the person asked for a reply at `since` and
 * nothing the server shows (a run, a queued request, a DEMIURGO message) has taken its place yet.
 */
export function stillStarting(input: {
  since: number | null;
  now: number;
  runs: readonly Pick<RunListItem, 'created_at'>[];
  queued: readonly unknown[];
  messages: readonly Pick<Message, 'author' | 'created_at'>[];
}): boolean {
  const { since, now, runs, queued, messages } = input;
  if (since === null || now - since > STARTING_MAX_MS) return false;
  if (queued.length > 0) return false;
  if (runs.some((r) => time(r.created_at) >= since - CLOCK_SLACK_MS)) return false;
  return !messages.some((m) => whoOf(m.author).kind === 'demiurgo' && time(m.created_at) >= since);
}

/** The queued requests that belong to a thread: aimed at it, or at the record version it drafts. */
export function queuedOf(
  queued: readonly QueuedRun[],
  thread: { id: string; origin_id: string | null; draft?: { scope: { id: string } } | null },
): QueuedRun[] {
  const ids = new Set([thread.id, thread.draft?.scope.id, thread.origin_id].filter((x): x is string => !!x));
  return queued.filter((q) => ids.has(q.scope_id));
}

export type Draftable = { versionId: string; code: string; title: string; version: number; bornHere: boolean };

/** Approved decisions a draft can start from: those born in this thread first. */
export function draftableDecisions(rows: readonly ProductRow[], explorationId: string): Draftable[] {
  return rows
    .filter((r) => r.type === 'decision' && r.current_id !== null && r.current !== null)
    .map((r) => ({
      versionId: r.current_id ?? '',
      code: r.code,
      title: r.title,
      version: r.current ?? 0,
      bornHere: r.origin_exploration === explorationId,
    }))
    .sort((a, b) => Number(b.bornHere) - Number(a.bornHere) || a.code.localeCompare(b.code));
}

/**
 * The live progress of a run without its own clock ("Thinking… 1,240 tokens"): the card already
 * shows the run's elapsed time, and two clocks that disagree read as a fault (INVENTORY Part C).
 */
export function progressWords(text: string): string {
  return text.replace(/(?:\s·)?\s\d+:\d{2}(?::\d{2})?$/, '').trim();
}

/** The runs that answered in a "Go deeper" side conversation, with the question each one was about. */
export function sideRuns(messages: readonly Message[]): Map<string, string> {
  const side = new Map<string, string>();
  for (const m of messages) if (m.question_id && m.run_id) side.set(m.run_id, m.question_id);
  return side;
}

/** The side conversation ("Go deeper") about one question, oldest first, with all its runs wrote. */
export function sideMessages(messages: readonly Message[], questionId: string): Message[] {
  const side = sideRuns(messages);
  return messages
    .filter((m) => m.question_id === questionId || (m.run_id !== null && side.get(m.run_id) === questionId))
    .sort((a, b) => time(a.created_at) - time(b.created_at));
}
