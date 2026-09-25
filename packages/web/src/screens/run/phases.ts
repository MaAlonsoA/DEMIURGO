// The phase strip of a run (DESIGN.md §3.4, R01 R05 R10): Requested → Context → Model → Result,
// each with the time it began, derived only from what the API already gives — the run's times and
// failure, when its context pack was built, and whether an engine call answered. The phase where
// the run stopped is marked, so "failed" says where, not only that. Pure and unit-tested.

import type { Run } from '../../api/types.ts';

export type PhaseKey = 'requested' | 'context' | 'model' | 'result';

/** done: it happened; current: it is happening now; stopped: the run ended here; pending: not (yet) reached. */
export type PhaseState = 'done' | 'current' | 'stopped' | 'pending';

export type Phase = { key: PhaseKey; label: string; state: PhaseState; at: string | null };

export const PHASE_LABELS: Record<PhaseKey, string> = {
  requested: 'Requested',
  context: 'Context',
  model: 'Model',
  result: 'Result',
};

/** The words of each phase state, shown next to the icon (never color alone). */
export const PHASE_STATE_WORDS: Record<PhaseState, string> = {
  done: 'Done',
  current: 'Now',
  stopped: 'Stopped here',
  pending: 'Not reached',
};

type RunFacts = Pick<Run, 'state' | 'failure_kind' | 'created_at' | 'started_at' | 'finished_at' | 'context_pack_id'>;

/** Failures that happen while the engine works; the others happen once it answered. */
const MODEL_FAILURES = new Set(['agent_error', 'timeout']);
const RESULT_FAILURES = new Set(['invalid_output', 'stale_knowledge']);

export function phasesOf(
  run: RunFacts,
  {
    contextAt = null,
    answered = false,
  }: {
    /** When its context pack was built (the context_pack.build event), if known. */
    contextAt?: string | null;
    /** Whether an engine call of the run answered (a call in state ok). */
    answered?: boolean;
  } = {},
): Phase[] {
  const phase = (key: PhaseKey, state: PhaseState, at: string | null): Phase => ({ key, label: PHASE_LABELS[key], state, at });
  const requested = phase('requested', 'done', run.created_at);
  const hasContext = run.context_pack_id !== null;
  const ended = !(run.state === 'queued' || run.state === 'running');

  // Without a context pack: it is being gathered, or the run ended before it had one.
  if (!hasContext) {
    return [
      requested,
      phase('context', ended ? (run.state === 'completed' ? 'done' : 'stopped') : 'current', null),
      phase('model', ended && run.state === 'completed' ? 'done' : 'pending', run.started_at),
      phase('result', run.state === 'completed' ? 'done' : 'pending', run.state === 'completed' ? run.finished_at : null),
    ];
  }
  const context = phase('context', 'done', contextAt ?? run.created_at);

  if (run.state === 'queued') return [requested, context, phase('model', 'pending', null), phase('result', 'pending', null)];
  if (run.state === 'running')
    return [requested, context, phase('model', 'current', run.started_at), phase('result', 'pending', null)];
  if (run.state === 'completed')
    return [requested, context, phase('model', 'done', run.started_at), phase('result', 'done', run.finished_at)];

  // It ended without completing: where was it?
  const atResult =
    (run.failure_kind !== null && RESULT_FAILURES.has(run.failure_kind)) ||
    (!(run.failure_kind !== null && MODEL_FAILURES.has(run.failure_kind)) && answered);
  if (!run.started_at && !answered)
    // Cancelled (or stopped) before an engine took it.
    return [requested, context, phase('model', 'stopped', null), phase('result', 'pending', null)];
  if (atResult) return [requested, context, phase('model', 'done', run.started_at), phase('result', 'stopped', run.finished_at)];
  return [requested, context, phase('model', 'stopped', run.started_at), phase('result', 'pending', null)];
}
