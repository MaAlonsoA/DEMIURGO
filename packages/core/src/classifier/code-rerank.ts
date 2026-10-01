// Jev reranks the candidate files of the code map for a task (build/code-map.ts). One Noul per candidate
// file: «will building this task edit this file?», with the task as JSON (classifier/task-input.ts) and
// the candidates' paths and symbols as the state (speculative fan-out, https://docs.typesafe.ai/patterns/fan-out:
// the questions share one state, so they go in one request). Measured on the merged tasks of «Comidas y
// entrenos» against the files their pull requests changed (packages/core/scripts/eval-code-map.ts):
// the deterministic order alone had recall@5 0.57 and MRR 0.58, with Jev 0.78 and 0.86 (research run,
// 14 tasks); a second run on 15 tasks gave deterministic 0.46 / 0.60, Jev alone 0.61 / 0.78 and an even
// 0.5/0.5 mix 0.60 / 0.69, so Jev leads.
//
// Policy (our convention, not a standard): the final order is Jev's probability with a small share of the
// deterministic score divided by the best one (0.9 / 0.1), which breaks ties between files Jev rates
// alike; the brief then keeps the top files that fit its character
// budget. Without TYPESAFE_API_KEY, or on any error, the deterministic order stands. Jev never decides
// anything here: it only orders what the builder is shown.

import { createHash } from 'node:crypto';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import type { RankedFile } from '../build/code-map.ts';
import type { Db } from '../db/connection.ts';
import { jevAllowed } from './aspect.ts';
import { JEV_DEFAULT_MODEL, jevCostUsd } from './jev.ts';
import type { TaskObject } from './task-input.ts';

/** Candidates sent to Jev: the top of the deterministic ranking (our convention; the measure used 30). */
export const RERANK_CANDIDATES = 30;
/** Weight of each side in the hybrid order (our convention). */
export const W_DETERMINISTIC = 0.1;
export const W_JEV = 0.9;
/** The id stored with an order that no model took part in. */
export const DETERMINISTIC_ID = 'deterministic@code-map';

type Client = Pick<TypeSafeClient, 'systemOne'>;

/** What was predicted for one candidate file, as stored in `task_code_opinions`. */
export type CodeOpinion = { path: string; deterministic_score: number; jev_p: number | null; rank: number };

export type Reranked = {
  /** The candidates in their final order. */
  ranked: RankedFile[];
  /** One opinion per candidate, `rank` being its 1-based place in `ranked`. */
  opinions: CodeOpinion[];
  /** `jev@<model>`, or `deterministic@code-map` when Jev did not take part. */
  classifier_id: string;
  /** Hash of the request Jev answered; null without Jev. */
  input_hash: string | null;
};

/** The request of a task: the task and the candidates as the state, one Noul per candidate. */
export function buildRerankRequest(ranked: readonly RankedFile[], task: TaskObject) {
  const candidates = ranked.map((r, id) => ({
    id,
    path: r.file.path,
    kind: r.file.kind,
    ...(r.file.route ? { route: r.file.route } : {}),
    symbols: r.symbols.slice(0, 8).map((s) => s.signature ?? `${s.kind} ${s.name}`),
  }));
  const questions: Record<string, ReturnType<typeof noul>> = {};
  for (const c of candidates) {
    questions[`c${c.id}`] = noul(`Will a developer building \`task\` have to edit the existing file \`candidates[${c.id}].path\` (its symbols are in \`candidates[${c.id}].symbols\`)?`, {
      true: 'Building the task changes this file: its component, query, action, styles or test gains or changes behaviour the task asks for.',
      false: 'This file stays as it is: the task is implemented elsewhere or in new files.',
    });
  }
  return { state: { task, candidates }, questions };
}

/** Pure: the hybrid order. Without probabilities (or with none for a file) the deterministic order is kept. */
export function hybridOrder(ranked: readonly RankedFile[], probs: ReadonlyMap<string, number> | null): Reranked['ranked'] {
  if (!probs) return [...ranked];
  const best = Math.max(...ranked.map((r) => r.score), 0) || 1;
  const mixed = (r: RankedFile) => W_DETERMINISTIC * (r.score / best) + W_JEV * (probs.get(r.file.path) ?? 0);
  return ranked.map((r, i) => ({ r, i })).sort((a, b) => mixed(b.r) - mixed(a.r) || a.i - b.i).map((x) => x.r);
}

export type RerankDeps = {
  /** Tests pass a fake client; by default it is the TypeSafe API with the key. */
  client?: Client;
  onUsage?: (inputTokens: number, usd: number) => void;
};

/** The candidates reordered by Jev and the deterministic score; the deterministic order on any failure. */
export async function rerankCodeMap(candidates: readonly RankedFile[], task: TaskObject | null, deps: RerankDeps = {}): Promise<Reranked> {
  const top = candidates.slice(0, RERANK_CANDIDATES);
  const best = Math.max(...top.map((r) => r.score), 0) || 1;
  const deterministic = (): Reranked => ({
    ranked: top,
    opinions: top.map((r, i) => ({ path: r.file.path, deterministic_score: r.score / best, jev_p: null, rank: i + 1 })),
    classifier_id: DETERMINISTIC_ID,
    input_hash: null,
  });
  if (top.length === 0 || !task || (!deps.client && !jevAllowed())) return deterministic();
  try {
    const model = JEV_DEFAULT_MODEL;
    const client = deps.client ?? new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, defaultModel: model, timeout: 30_000 });
    const { state, questions } = buildRerankRequest(top, task);
    const r = await client.systemOne({ state, questions, model });
    deps.onUsage?.(r.usage.input_tokens, jevCostUsd(r.usage.input_tokens));
    const answers = r.answers as Record<string, { noul?: number } | undefined>;
    const probs = new Map<string, number>();
    top.forEach((c, i) => {
      const p = answers[`c${i}`]?.noul;
      if (typeof p === 'number' && !Number.isNaN(p)) probs.set(c.file.path, Math.min(1, Math.max(0, p)));
    });
    // Jev answered nothing usable: the deterministic order, not a half-filled one.
    if (probs.size === 0) return deterministic();
    const ranked = hybridOrder(top, probs);
    return {
      ranked,
      opinions: ranked.map((c, i) => ({ path: c.file.path, deterministic_score: c.score / best, jev_p: probs.get(c.file.path) ?? null, rank: i + 1 })),
      classifier_id: `jev@${model}`,
      input_hash: createHash('sha256')
        .update(JSON.stringify({ state, model: r.model || model }))
        .digest('hex'),
    };
  } catch {
    return deterministic();
  }
}

/** Stores what was shown for a task attempt (append-only; see migration 0049). */
export async function storeCodeOpinions(
  db: Db,
  ids: { projectId: string; buildRequestId: string; attempt: number; versionId: string },
  result: Pick<Reranked, 'opinions' | 'classifier_id' | 'input_hash'>,
): Promise<void> {
  if (result.opinions.length === 0) return;
  await db
    .insertInto('task_code_opinions')
    .values(
      result.opinions.map((o) => ({
        project_id: ids.projectId,
        build_request_id: ids.buildRequestId,
        attempt: ids.attempt,
        record_version_id: ids.versionId,
        path: o.path,
        deterministic_score: o.deterministic_score,
        jev_p: o.jev_p,
        rank: o.rank,
        classifier_id: result.classifier_id,
        input_hash: result.input_hash,
      })),
    )
    .execute();
}
