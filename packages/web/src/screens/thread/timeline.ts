// A thread in one order (DESIGN.md §3.3): its messages, the questions DEMIURGO showed and its runs,
// by time. DEMIURGO's messages of the same run go together (its reply and its observations). A run
// shows only while it works, when it failed or was cancelled, and when it left a draft ready; a
// finished conversation speaks through its messages. Also: the approved decisions Draft it starts
// from, and the live progress of a run in words without a second clock.

import type { Message, ProductRow, Question, RunListItem } from '../../api/types.ts';
import { whoOf } from '../../words.ts';

export type RunDisplay = 'working' | 'failed' | 'retried' | 'cancelled' | 'draft';

export type TimelineItem =
  | { type: 'message'; key: string; at: number; message: Message; by: 'you' | 'agent' | 'automatic' }
  | { type: 'demiurgo'; key: string; at: number; runId: string | null; reply: Message | null; observations: Message[] }
  | { type: 'run'; key: string; at: number; run: RunListItem; display: RunDisplay }
  | { type: 'question'; key: string; at: number; question: Question };

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : 0);

export const isActive = (run: Pick<RunListItem, 'state'>): boolean => run.state === 'queued' || run.state === 'running';

/** How a run shows in its thread, or null when its messages already say it all. */
export function runDisplay(run: RunListItem, runs: readonly RunListItem[]): RunDisplay | null {
  if (isActive(run)) return 'working';
  const retried = runs.some((r) => r.retry_of === run.id);
  if (run.state === 'failed' || run.state === 'interrupted') return retried ? 'retried' : 'failed';
  if (run.state === 'cancelled') return 'cancelled';
  if (run.state === 'completed' && run.batch_id && run.action === 'design_proposal') return 'draft';
  return null;
}

export function buildTimeline(
  messages: readonly Message[],
  runs: readonly RunListItem[],
  questions: readonly Question[] = [],
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
  // DEMIURGO's questions are its messages too, from when each was shown (the reserve stays hidden).
  for (const q of questions) {
    if (!q.shown_at) continue;
    items.push({ type: 'question', key: `q:${q.id}`, at: time(q.shown_at), question: q });
  }
  for (const run of runs) {
    const display = runDisplay(run, runs);
    if (!display) continue;
    const at = display === 'working' ? time(run.created_at) : time(run.finished_at ?? run.created_at);
    items.push({ type: 'run', key: `r:${run.id}`, at, run, display });
  }
  // Stable: what happened at the same instant keeps the order above (messages first).
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.at - b.item.at || a.i - b.i)
    .map(({ item }) => item);
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
