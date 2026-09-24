// A thread in one order (spec §4.7): its messages and its runs by time. DEMIURGO's messages of the
// same run go together (its reply and its observations). A run shows only while it works, when it
// failed or was cancelled, and when it left a draft ready; a finished conversation speaks through
// its messages.

import type { Message, ProductRow, RunListItem } from '../../api/types.ts';
import { whoOf } from '../../words.ts';

export type RunDisplay = 'working' | 'failed' | 'retried' | 'cancelled' | 'draft';

export type TimelineItem =
  | { type: 'message'; key: string; at: number; message: Message; by: 'you' | 'agent' | 'automatic' }
  | { type: 'demiurgo'; key: string; at: number; runId: string | null; reply: Message | null; observations: Message[] }
  | { type: 'run'; key: string; at: number; run: RunListItem; display: RunDisplay };

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

export function buildTimeline(messages: readonly Message[], runs: readonly RunListItem[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let group: Extract<TimelineItem, { type: 'demiurgo' }> | null = null;
  for (const m of messages) {
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
