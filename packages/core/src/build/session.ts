// Whether a retry of a build attempt continues the builder's previous agent session or starts fresh.
// Continuing keeps what the agent already read and learned, and the retry prompt only carries the new feedback
// (Anthropic, «Effective harnesses for long-running agents», is the source of the progress notes used when fresh).

import { readdir } from 'node:fs/promises';

/** Consecutive resumes allowed before a fresh session starts again (our convention: a long session drifts and fills its context). */
export const MAX_CONSECUTIVE_RESUMES = 2;

export type BuilderSession = { mode: 'fresh' | 'resumed'; id?: string; reason: string };

/** What an earlier builder step of the same build request recorded, oldest first. */
export type PreviousBuilderAttempt = {
  provider: string;
  model: string;
  /** The `session` of its step detail, absent when it recorded none. */
  session?: { mode: 'fresh' | 'resumed'; id?: string } | undefined;
  /** Whether the session files are still on disk (only the latest attempt's matters). */
  filesExist: boolean;
};

/**
 * Decides the session of the next builder attempt (our convention, not a published standard): resume when the
 * latest attempt used the same provider and model, recorded its session id, its session files still exist and
 * fewer than MAX_CONSECUTIVE_RESUMES resumes happened in a row; otherwise start fresh with the full brief.
 */
export function builderSessionPlan(previous: readonly PreviousBuilderAttempt[], engine: { provider: string; model: string }): BuilderSession {
  const last = previous.at(-1);
  if (!last) return { mode: 'fresh', reason: 'First attempt: nothing to continue.' };
  if (last.provider !== engine.provider || last.model !== engine.model) {
    return { mode: 'fresh', reason: `The engine changed (${last.provider} ${last.model} to ${engine.provider} ${engine.model}): a session cannot move between engines.` };
  }
  const id = last.session?.id;
  if (!id) return { mode: 'fresh', reason: 'The previous attempt recorded no session id.' };
  if (!last.filesExist) return { mode: 'fresh', reason: 'The previous session files are no longer there.' };
  let resumes = 0;
  for (let i = previous.length - 1; i >= 0 && previous[i]?.session?.mode === 'resumed'; i--) resumes++;
  if (resumes >= MAX_CONSECUTIVE_RESUMES) return { mode: 'fresh', reason: `The session was already continued ${resumes} times in a row: starting a fresh one with the progress notes.` };
  return { mode: 'resumed', id, reason: 'Same engine, session id recorded and files present: continuing the previous session.' };
}

/** Whether the session folder holds a file of that session (Claude `<cwd>/<id>.jsonl`, Codex `rollout-…-<id>.jsonl`). */
export async function sessionFilesExist(dir: string, id: string): Promise<boolean> {
  try {
    const entries = await readdir(dir, { recursive: true });
    return entries.some((e) => e.includes(id));
  } catch {
    return false;
  }
}
