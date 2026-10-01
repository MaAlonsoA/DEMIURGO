// Jev judges whether an existing test already checks, or could be extended to check, the behaviour of a
// new criterion. The test guard (build/test-guard.ts) only knows tests whose title starts with the task's own
// criterion codes; this covers the gap: a criterion whose behaviour a test of ANOTHER criterion already checks.
// Same pattern as classifier/code-rerank.ts: a deterministic preselection, then one Noul per (criterion,
// candidate) pair, all in one request that shares the state (speculative fan-out,
// https://docs.typesafe.ai/patterns/fan-out). Never throws; without TYPESAFE_API_KEY, or on any error, it
// returns nothing. Jev only suggests what the builder is shown: it never blocks anything.

import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { tokenize } from '../build/code-map.ts';
import { jevAllowed } from './aspect.ts';
import { JEV_DEFAULT_MODEL, jevCostUsd } from './jev.ts';

/** Existing tests preselected as a whole (our convention). */
export const REUSE_CANDIDATES = 40;
/** Candidates asked about per criterion, so the request has criteria × 8 pairs at most (our convention). */
export const REUSE_PER_CRITERION = 8;
/** Probability from which a pair is reported (our convention, not a measured threshold). */
export const REUSE_MIN_P = 0.6;

type Client = Pick<TypeSafeClient, 'systemOne'>;

export type ReuseCriterion = { code: string; statement: string };
export type ReuseCandidate = { path: string; title: string; level: string };
export type ReusePair = { criterion: string; path: string; title: string; level: string; p: number };

const K1 = 1.2;
const B = 0.75;

/** BM25-style overlap between a criterion statement and each test (title and path words), best first. Pure. */
export function preselect(statement: string, candidates: readonly ReuseCandidate[], limit: number): ReuseCandidate[] {
  const query = [...new Set(tokenize(statement))];
  if (query.length === 0 || candidates.length === 0) return [];
  const docs = candidates.map((c) => tokenize(`${c.title.replace(/^AC-[A-Z]+-\d+-\d+/, '')} ${c.path}`));
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const scores = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1);
    let s = 0;
    for (const q of query) {
      const f = tf.get(q) ?? 0;
      if (f === 0) continue;
      const n = df.get(q) ?? 0;
      s += Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / avg)));
    }
    return s;
  });
  return candidates
    .map((c, i) => ({ c, s: scores[i] as number, i }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}

/** The request: criteria and candidate tests as the state, one Noul per (criterion, candidate) pair. */
export function buildReuseRequest(criteria: readonly ReuseCriterion[], candidates: readonly ReuseCandidate[]) {
  const shown = candidates.slice(0, REUSE_CANDIDATES);
  const pool = shown.map((c, id) => ({ id, path: c.path, title: c.title, level: c.level }));
  const pairs: { qid: string; criterion: string; candidate: number }[] = [];
  const questions: Record<string, ReturnType<typeof noul>> = {};
  criteria.forEach((c, ci) => {
    for (const p of preselect(c.statement, shown, REUSE_PER_CRITERION)) {
      const id = shown.indexOf(p);
      const qid = `q${ci}_${id}`;
      pairs.push({ qid, criterion: c.code, candidate: id });
      questions[qid] = noul(
        `Does the existing test \`tests[${id}]\` already check, or could it be extended with one more assertion or example to check, the behaviour in \`criteria[${ci}].statement\`?`,
        {
          true: 'Same behaviour, screen or rule: the test already checks it, or one more assertion or example in it would.',
          false: 'The test is on the same screen or area but checks a different behaviour, or is about something unrelated.',
        },
      );
    }
  });
  return { state: { criteria: criteria.map((c) => ({ code: c.code, statement: c.statement })), tests: pool }, questions, pairs, pool: shown };
}

export type ReuseDeps = { client?: Client; onUsage?: (inputTokens: number, usd: number) => void };

/** The pairs Jev rates at `REUSE_MIN_P` or more, best first. Empty without a key or on any failure. */
export async function judgeTestReuse(
  client: Client | null | undefined,
  args: { criteria: readonly ReuseCriterion[]; candidates: readonly ReuseCandidate[] },
  deps: Pick<ReuseDeps, 'onUsage'> = {},
): Promise<ReusePair[]> {
  try {
    if (args.criteria.length === 0 || args.candidates.length === 0 || (!client && !jevAllowed())) return [];
    const { state, questions, pairs, pool } = buildReuseRequest(args.criteria, args.candidates);
    if (pairs.length === 0) return [];
    const model = JEV_DEFAULT_MODEL;
    const c = client ?? new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, defaultModel: model, timeout: 30_000 });
    const r = await c.systemOne({ state, questions, model });
    deps.onUsage?.(r.usage.input_tokens, jevCostUsd(r.usage.input_tokens));
    const answers = r.answers as Record<string, { noul?: number } | undefined>;
    const out: ReusePair[] = [];
    for (const pair of pairs) {
      const p = answers[pair.qid]?.noul;
      if (typeof p !== 'number' || Number.isNaN(p) || p < REUSE_MIN_P) continue;
      const t = pool[pair.candidate] as ReuseCandidate;
      out.push({ criterion: pair.criterion, path: t.path, title: t.title, level: t.level, p: Math.min(1, p) });
    }
    return out.sort((a, b) => b.p - a.p);
  } catch {
    return [];
  }
}

/** The brief section for the builder: up to `max` lines. Pure. */
export function reuseLines(pairs: readonly ReusePair[], max = 8): string[] {
  if (pairs.length === 0) return [];
  return [
    'Tests that already check something close (extend one of them instead of writing a new test; keep its title\'s criterion code and add yours with `[example: …]` only if it is a different example):',
    ...pairs.slice(0, max).map((x) => `- ${x.criterion} ↔ ${x.path} › ${x.title} (p ${x.p.toFixed(2)})`),
  ];
}
