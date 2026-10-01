// Jev checks the «LGTM with comments» waiver after the deterministic `minorChange` rules passed (build/lgtm.ts).
// One request (speculative fan-out, https://docs.typesafe.ai/patterns/fan-out: every question shares one state). Per `fix`
// comment: a Noul asks whether the comment is a mechanical change, and a Choice asks how the file's diff relates to what
// the comment asks (exactly / more / less). The review is waived only if Jev agrees for every fix.
//
// Thresholds are «convención nuestra», starting point from TypeSafe's citation-check cookbook (0.8 confidence threshold,
// escalate below it); tune on our data. Below them the answer is «not sure», and not sure means the normal review.
// Without TYPESAFE_API_KEY, or on any error, `checkFixes` returns null and the caller keeps the deterministic result.

import { TypeSafeClient, choice, noul } from '@typesafe-ai/sdk';
import { jevAllowed } from './aspect.ts';
import { JEV_DEFAULT_MODEL, jevCostUsd } from './jev.ts';

/** Probability from which a fix comment counts as mechanical (convención nuestra, starting point 0.8 from the citation-check cookbook). */
export const FIX_MECHANICAL_THRESHOLD = 0.8;
/** Confidence from which «exactly» counts (convención nuestra, starting point 0.8 from the citation-check cookbook). */
export const FIX_MATCH_CONFIDENCE = 0.8;
/** Characters of each file's diff sent to Jev (convención nuestra). */
export const MAX_FIX_DIFF_CHARS = 6000;

type Client = Pick<TypeSafeClient, 'systemOne'>;

export type FixInput = { path: string; line: number | null; comment: string; diff: string };
export type FixCheckUsage = { input_tokens: number; usd: number };
export type FixCheckAnswers = {
  /** Per fix, in order. `null` means Jev gave no usable answer (counts as not sure). */
  mechanical: (number | null)[];
  match: ({ choice: string; confidence: number } | null)[];
};
export type FixCheckVerdict = { ok: boolean; failed: string[]; usage: FixCheckUsage };

const MATCH_OPTIONS = {
  exactly: 'The diff does what the comment asks and nothing else.',
  more: 'The diff does what the comment asks but also changes other behavior.',
  less: 'The diff does not do all of what the comment asks, or does something else.',
} as const;

/** Splits a `git diff` output into the diff of each file (keyed by its new path), each cut to MAX_FIX_DIFF_CHARS. Pure. */
export function diffsByFile(diff: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of diff.split(/^(?=diff --git )/m)) {
    const m = /^diff --git a\/.* b\/(.*)$/m.exec(part);
    if (m) out[m[1] as string] = part.slice(0, MAX_FIX_DIFF_CHARS);
  }
  return out;
}

/** The request: the shared state and the questions `m<i>` (Noul) and `d<i>` (Choice). Pure. */
export function buildFixCheckRequest(fixes: readonly FixInput[]) {
  const state = { fixes: fixes.map((f) => ({ path: f.path, line: f.line, comment: f.comment, diff: f.diff.slice(0, MAX_FIX_DIFF_CHARS) })) };
  const questions: Record<string, ReturnType<typeof noul> | ReturnType<typeof choice>> = {};
  fixes.forEach((_, i) => {
    questions[`m${i}`] = noul(
      `Is \`fixes[${i}].comment\` a mechanical change that needs no design judgement (rename, typo, import order, spelled-out one-line fix, add a flag, remove an unused import)?`,
      {
        true: 'The comment asks for a mechanical change: the exact edit is clear from the comment and needs no design decision.',
        false: 'The comment asks for something that needs judgement: a design choice, new behavior or a change of approach.',
      },
    );
    questions[`d${i}`] = choice(`How does \`fixes[${i}].diff\` relate to what \`fixes[${i}].comment\` asks?`, MATCH_OPTIONS);
  });
  return { state, questions };
}

/** Waive only when every Noul is at least FIX_MECHANICAL_THRESHOLD and every Choice is `exactly` with confidence at least FIX_MATCH_CONFIDENCE. Pure. */
export function fixCheckVerdict(answers: FixCheckAnswers, paths: readonly string[], usage: FixCheckUsage = { input_tokens: 0, usd: 0 }): FixCheckVerdict {
  const failed: string[] = [];
  paths.forEach((path, i) => {
    const p = answers.mechanical[i];
    if (typeof p !== 'number' || Number.isNaN(p) || p < FIX_MECHANICAL_THRESHOLD) failed.push(`fix_not_mechanical:${path}`);
    const m = answers.match[i];
    if (!m || m.choice !== 'exactly' || !(m.confidence >= FIX_MATCH_CONFIDENCE)) failed.push(`fix_diff_mismatch:${path}`);
  });
  return { ok: failed.length === 0, failed, usage };
}

/** Jev's verdict on the fixes; null without key, without fixes or on any error (the caller keeps the deterministic result). Never throws. */
export async function checkFixes(args: { fixes: readonly FixInput[]; client?: Client }): Promise<FixCheckVerdict | null> {
  if (args.fixes.length === 0 || (!args.client && !jevAllowed())) return null;
  try {
    const model = JEV_DEFAULT_MODEL;
    const client = args.client ?? new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, defaultModel: model, timeout: 30_000 });
    const { state, questions } = buildFixCheckRequest(args.fixes);
    const r = await client.systemOne({ state: state as never, questions: questions as never, model });
    const raw = r.answers as unknown as Record<string, { noul?: number; choice?: string; confidence?: number } | undefined>;
    const answers: FixCheckAnswers = { mechanical: [], match: [] };
    args.fixes.forEach((_, i) => {
      const n = raw[`m${i}`]?.noul;
      answers.mechanical.push(typeof n === 'number' && !Number.isNaN(n) ? n : null);
      const c = raw[`d${i}`];
      answers.match.push(c && typeof c.choice === 'string' && typeof c.confidence === 'number' ? { choice: c.choice, confidence: c.confidence } : null);
    });
    return fixCheckVerdict(answers, args.fixes.map((f) => f.path), { input_tokens: r.usage.input_tokens, usd: jevCostUsd(r.usage.input_tokens) });
  } catch {
    return null;
  }
}
