// Jev's judgments for «insisting» (build/insisted.ts): two questions a regex or a trigram cannot answer well.
// 1. `sameRequestNoul`: does the blocking comment of the latest `request_changes` review ask for the same change as one
//    of the review before (any path, wording may differ), meaning the earlier request was not addressed?
// 2. `stuckNoul`: do the builder's accumulated progress notes say it is stuck (same approach again, no cause found, gave up)?
// They only add signals: they never block and never replace the deterministic ones. Without TYPESAFE_API_KEY, when
// `jevAllowed` is false or on any error they return null and nothing changes.
// Threshold: 0.8 is «convención nuestra». The TypeSafe citation-check cookbook acts only on a high probability; it does
// not fix 0.8, and nothing here claims it does (acting on a wrong guess costs a session, so it asks for more than 0.5).

import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import type { Services } from '../services.ts';
import { jevAllowed } from './aspect.ts';
import { recordedCall } from './calls.ts';
import { JEV_DEFAULT_MODEL, jevCostUsd } from './jev.ts';
import { questionVersion } from './question-version.ts';

/** A signal fires from this probability (convención nuestra, see the header). */
export const SESSION_SIGNAL_THRESHOLD = 0.8;
/** Pairs asked in one request: one Noul each (convención nuestra, the same cap as task-needs). */
export const MAX_PAIRS = 20;
/** Characters of one comment or of the notes sent to Jev (convención nuestra). */
const MAX_TEXT_CHARS = 2000;
const MAX_NOTES_CHARS = 8000;

const SAME_QUESTION = 'Does `current` ask for the same change as `previous`, meaning the earlier request was not addressed?';
const STUCK_QUESTION = 'Do these progress notes say the builder is stuck: it tried the same approach again, could not find the cause, or gave up on a criterion?';
const SAME_QUESTION_AT = 'Does `pairs[{i}].current` ask for the same change as `pairs[{i}].previous`, meaning the earlier request was not addressed?';

export const SAME_REQUEST_QUESTION_VERSION = questionVersion('session_signals.same_request_noul', SAME_QUESTION);
export const STUCK_QUESTION_VERSION = questionVersion('session_signals.stuck_noul', STUCK_QUESTION);

type Client = Pick<TypeSafeClient, 'systemOne'>;
export type SignalDeps = {
  /** Tests pass a fake client; by default it is the TypeSafe API with the key. */
  client?: Client;
};

const clientOf = (deps: SignalDeps): Client => deps.client ?? new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, defaultModel: JEV_DEFAULT_MODEL, timeout: 30_000 });
const clip = (text: string, max: number): string => text.slice(0, max);

/** The (current, previous) pairs of blocking comments, at most MAX_PAIRS. */
export function blockingPairs(previous: readonly string[], current: readonly string[]): { current: string; previous: string }[] {
  const out: { current: string; previous: string }[] = [];
  for (const c of current) for (const p of previous) if (out.length < MAX_PAIRS) out.push({ current: clip(c, MAX_TEXT_CHARS), previous: clip(p, MAX_TEXT_CHARS) });
  return out;
}

export function buildSameRequest(pairs: readonly { current: string; previous: string }[]) {
  const questions: Record<string, ReturnType<typeof noul>> = {};
  pairs.forEach((_, i) => {
    questions[`same_${i}`] = noul(SAME_QUESTION_AT.replaceAll('{i}', String(i)), {
      true: {
        what: 'The current comment asks for the same change the previous one asked for, so the earlier request was left undone.',
        examples: ['Both say the delete button must ask for confirmation', 'Both say the endpoint still returns 500 for an empty list'],
      },
      false: {
        what: 'The current comment asks for something different: the earlier request was done and a new problem appeared.',
        examples: ['The previous one asked for a label and the current one asks for a database index', 'Both touch the same file but about different behaviour'],
      },
    });
  });
  return { state: { pairs: pairs.map((p) => ({ ...p })) }, questions };
}

export function buildStuck(notes: string) {
  return {
    state: { notes: clip(notes, MAX_NOTES_CHARS) },
    questions: {
      stuck: noul(STUCK_QUESTION, {
        true: {
          what: 'The notes show the builder repeating an approach that did not work, not finding the cause, or giving up on a criterion.',
          examples: ['I tried the same fix again and the test still fails; I do not know why', 'Could not make criterion 3 pass, leaving it for the reviewer'],
        },
        false: {
          what: 'The notes show steady progress or a new approach after a setback.',
          examples: ['Implemented the endpoint and the table; next the screen', 'The first fix failed, so I changed the query and it now passes'],
        },
      }),
    },
  };
}

const pOf = (answer: { noul?: number } | undefined): number | null => (typeof answer?.noul === 'number' && !Number.isNaN(answer.noul) ? Math.min(1, Math.max(0, answer.noul)) : null);

/**
 * The highest probability that a blocking comment of `current` asks for the same change as one of `previous`
 * (any path, at most MAX_PAIRS pairs), or null when Jev was not asked or failed. The caller compares it with
 * SESSION_SIGNAL_THRESHOLD.
 */
export async function sameRequestNoul(services: Pick<Services, 'db' | 'logger'>, projectId: string, previous: readonly string[], current: readonly string[], deps: SignalDeps = {}): Promise<number | null> {
  if (!jevAllowed()) return null;
  const pairs = blockingPairs(previous, current);
  if (pairs.length === 0) return null;
  try {
    const model = JEV_DEFAULT_MODEL;
    const client = clientOf(deps);
    let tokens = 0;
    const answers = await recordedCall(services.db, { projectId, question: 'session_same_request', questionVersion: SAME_REQUEST_QUESTION_VERSION, model }, async (note) => {
      const { state, questions } = buildSameRequest(pairs);
      const r = await client.systemOne({ state, questions, model });
      tokens += r.usage.input_tokens;
      note(r.usage.input_tokens);
      return r.answers as Record<string, { noul?: number } | undefined>;
    });
    const ps = pairs.map((_, i) => pOf(answers[`same_${i}`])).filter((p): p is number => p !== null);
    services.logger.info('Jev judged whether the review repeats an earlier request', { projectId, pairs: pairs.length, input_tokens: tokens, usd: jevCostUsd(tokens) });
    return ps.length === 0 ? null : Math.max(...ps);
  } catch (err) {
    services.logger.error('Jev could not judge whether the review repeats an earlier request', { projectId, error: String(err) });
    return null;
  }
}

/** The probability that the progress notes say the builder is stuck, or null when Jev was not asked or failed. */
export async function stuckNoul(services: Pick<Services, 'db' | 'logger'>, projectId: string, notes: string, deps: SignalDeps = {}): Promise<number | null> {
  if (!jevAllowed() || !notes.trim()) return null;
  try {
    const model = JEV_DEFAULT_MODEL;
    const client = clientOf(deps);
    let tokens = 0;
    const answers = await recordedCall(services.db, { projectId, question: 'session_stuck', questionVersion: STUCK_QUESTION_VERSION, model }, async (note) => {
      const { state, questions } = buildStuck(notes);
      const r = await client.systemOne({ state, questions, model });
      tokens += r.usage.input_tokens;
      note(r.usage.input_tokens);
      return r.answers as Record<string, { noul?: number } | undefined>;
    });
    services.logger.info('Jev judged whether the builder is stuck', { projectId, input_tokens: tokens, usd: jevCostUsd(tokens) });
    return pOf(answers.stuck);
  } catch (err) {
    services.logger.error('Jev could not judge whether the builder is stuck', { projectId, error: String(err) });
    return null;
  }
}
