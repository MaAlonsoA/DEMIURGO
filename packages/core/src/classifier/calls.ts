// The cost of Jev, one row per request (salud-del-harness §6.4). Best effort: writing the row never fails or delays
// the judgment it measures (a failed insert is swallowed). A call that a retry could repeat passes a `callKey`, so the
// same call is stored once.

import type { Db } from '../db/connection.ts';
import { buildEngineMark } from '../harness/engine.ts';
import { JEV_DEFAULT_MODEL, jevCostUsd } from './jev.ts';

export type CallBase = {
  projectId: string;
  /** Which question: `size`, `layers`, `testability`, `review_findings`, `test_reuse`, `fix_check`, `code_rerank`… */
  question: string;
  questionVersion?: string | null;
  judgmentTable?: string | null;
  judgmentIds?: readonly string[];
  /** Idempotency key of a call a retry could repeat. */
  callKey?: string | null;
  model?: string;
};

export type CallRecord = CallBase & { /** The model Jev's response says answered, when the call reported it. */ modelReported?: string | null; inputTokens: number; outputTokens?: number; durationMs: number | null; outcome: 'ok' | 'error' };

/** Writes one row; never throws. Returns whether a new row was written. */
export async function recordClassifierCall(db: Pick<Db, 'insertInto'>, call: CallRecord): Promise<boolean> {
  try {
    const row = await db
      .insertInto('classifier_calls')
      .values({
        project_id: call.projectId,
        question: call.question,
        question_version: call.questionVersion ?? null,
        judgment_table: call.judgmentTable ?? null,
        judgment_ids: [...(call.judgmentIds ?? [])],
        call_key: call.callKey ?? null,
        model: call.model ?? JEV_DEFAULT_MODEL,
        input_tokens: call.inputTokens,
        output_tokens: call.outputTokens ?? 0,
        duration_ms: call.durationMs === null ? null : Math.round(call.durationMs),
        cost_usd: jevCostUsd(call.inputTokens),
        outcome: call.outcome,
        engine: JSON.stringify(buildEngineMark({ provider: 'jev', model: call.model ?? JEV_DEFAULT_MODEL, modelReported: call.modelReported ?? null, jevModel: call.modelReported ?? null })),
      })
      .onConflict((oc) => oc.columns(['project_id', 'call_key']).where('call_key', 'is not', null).doNothing())
      .returning('id')
      .executeTakeFirst();
    return Boolean(row);
  } catch {
    return false;
  }
}

/**
 * Runs `run`, timing it, and records the call. `note(inputTokens)` is how the judge reports its usage (the same
 * `onUsage` hook the classifiers already have). A run that throws is recorded as an `error` and rethrown; a run that
 * returns without reporting usage made no request (no key, nothing to judge) and records nothing.
 */
export async function recordedCall<T>(db: Pick<Db, 'insertInto'> | null | undefined, base: CallBase, run: (note: (inputTokens: number, outputTokens?: number, modelReported?: string) => void) => Promise<T>): Promise<T> {
  const started = Date.now();
  let input = 0;
  let output = 0;
  let noted = false;
  let modelReported: string | null = null;
  const note = (inputTokens: number, outputTokens = 0, reported?: string): void => {
    noted = true;
    if (reported) modelReported = reported;
    input += inputTokens;
    output += outputTokens;
  };
  try {
    const result = await run(note);
    if (db && noted) await recordClassifierCall(db, { ...base, modelReported, inputTokens: input, outputTokens: output, durationMs: Date.now() - started, outcome: 'ok' });
    return result;
  } catch (e) {
    if (db) await recordClassifierCall(db, { ...base, modelReported, inputTokens: input, outputTokens: output, durationMs: Date.now() - started, outcome: 'error' });
    throw e;
  }
}
