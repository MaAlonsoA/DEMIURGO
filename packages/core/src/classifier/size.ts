// Jev's second opinion on a task's effort size (FDR-DEL-006): one Score over the ordered sizes XS–XL.
// The state is the task as JSON (title, Goal, Scope and the criteria it covers) plus, when the project's
// repository is there, what its CI runs and what the repository holds before the task; the levels are
// structured `{ size, summary, signals }` and the question says that what already exists is reused,
// not rebuilt. From the A/B audit of 01-10-2026 on 29 built tasks: the expected score correlates with
// build effort better than the most probable level, so the stored size is the level nearest the expected
// score. It runs after the commit that creates the task or writes a new content version, never blocks
// it, and a failure only leaves no opinion. The result is derived data (size, confidence, classifier id),
// recomputable by calling it again; it never changes the task's size. Without TYPESAFE_API_KEY it does nothing.

import { TASK_SIZES, type TaskSize } from '@demiurgo/domain';
import { TypeSafeClient, score } from '@typesafe-ai/sdk';
import type { Services } from '../services.ts';
import { jevAllowed } from './aspect.ts';
import { JEV_DEFAULT_MODEL, jevCostUsd } from './jev.ts';
import { loadRepoContext, type RepoContext } from './repo-context.ts';
import { type TaskObject, loadTaskObject } from './task-input.ts';

/** The ordered levels as Jev reads them: what each is and the signals that place a task there (convención nuestra). */
export const SIZE_LEVELS = [
  { size: 'XS', summary: 'A one-line or configuration change.', signals: ['No new behaviour', 'One file'] },
  { size: 'S', summary: 'One small change in one place, reusing what exists.', signals: ['One screen or one function changes', 'No new table, no new server module', 'One or two acceptance criteria'] },
  { size: 'M', summary: 'One behaviour across one screen and its server action, or a few files.', signals: ['A screen change plus a server action or query', 'Existing tables are enough', 'Three to five acceptance criteria'] },
  { size: 'L', summary: 'A new slice through several layers.', signals: ['A new table or migration, a new server module and a new screen or form', 'Or a new external integration or deployment set-up', 'Many acceptance criteria'] },
  { size: 'XL', summary: 'Many modules and layers at once; it should be split.', signals: ['Several new screens and tables', 'Work that several independent tasks could each deliver'] },
] as const satisfies readonly { size: TaskSize; summary: string; signals: readonly string[] }[];

export type SizeInput = { task: TaskObject; repo?: RepoContext | null };

type Client = Pick<TypeSafeClient, 'systemOne'>;

const SIZE_FOCUS = 'Judge the new code needed. What already exists in the repository is reused, not rebuilt.';

/** The request: the task (and the repository before it) as the state, and the Score over the levels. */
export function buildSizeRequest(input: SizeInput) {
  const repo = input.repo ?? null;
  const state = {
    task: input.task,
    ...(repo?.project_stack ? { project_stack: repo.project_stack } : {}),
    ...(repo ? { repository_before_task: repo.repository } : {}),
  };
  const question: Record<string, string> = repo
    ? { question: 'How much work is it for a developer to build `task` in `repository_before_task`, from code change to passing tests?', focus: SIZE_FOCUS }
    : { question: 'How much work is it for a developer to build `task`, from code change to passing tests?' };
  return { state, questions: { size: score(question, [...SIZE_LEVELS] as unknown as [never, never, ...never[]]) } };
}

/** The size nearest the expected score (levels are numbered 0..4 in order). */
export const sizeOfScore = (value: number): TaskSize =>
  TASK_SIZES[Math.min(TASK_SIZES.length - 1, Math.max(0, Math.round(value)))] as TaskSize;

export type SizeJudgment = { size: TaskSize; score: number; confidence: number; input_tokens: number };

/** Asks Jev for a task's size. */
export async function judgeSize(client: Client, input: SizeInput, model: string = JEV_DEFAULT_MODEL): Promise<SizeJudgment & { model: string }> {
  const { state, questions } = buildSizeRequest(input);
  const r = await client.systemOne({ state, questions, model });
  const a = r.answers.size as { score?: number; confidence?: number } | undefined;
  if (!a || typeof a.score !== 'number' || Number.isNaN(a.score)) throw new Error('Jev: the task came back without a size score.');
  return { size: sizeOfScore(a.score), score: a.score, confidence: typeof a.confidence === 'number' ? a.confidence : 0, input_tokens: r.usage.input_tokens, model: r.model || model };
}

export type SizeDeps = {
  /** Tests pass a fake client; by default it is the TypeSafe API with the key. */
  client?: Client;
  load?: (services: Services, projectId: string, recordId: string, versionId: string) => Promise<SizeInput | null>;
};

async function loadSizeInput(services: Services, projectId: string, recordId: string, versionId: string): Promise<SizeInput | null> {
  const task = await loadTaskObject(services.db, recordId, versionId);
  if (!task) return null;
  return { task, repo: await loadRepoContext(services.db, projectId).catch(() => null) };
}

/** Scores a task version's size with Jev and stores the opinion. After the commit; never throws. */
export async function classifyTaskSize(services: Services, projectId: string, recordId: string, versionId: string, deps: SizeDeps = {}): Promise<void> {
  if (!jevAllowed()) return;
  try {
    const input = await (deps.load ?? loadSizeInput)(services, projectId, recordId, versionId);
    if (!input) return;
    const model = JEV_DEFAULT_MODEL;
    const client = deps.client ?? new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, defaultModel: model, timeout: 30_000 });
    const j = await judgeSize(client, input, model);
    await services.db
      .insertInto('task_size_opinions')
      .values({
        project_id: projectId,
        record_id: recordId,
        record_version_id: versionId,
        size: j.size,
        confidence: j.confidence,
        classifier_id: `jev@${model}`,
      })
      .execute();
    services.logger.info('Jev sized a task', { projectId, recordId, size: j.size, score: j.score, input_tokens: j.input_tokens, usd: jevCostUsd(j.input_tokens) });
  } catch (err) {
    services.logger.error('Jev could not size a task', { recordId, versionId, error: String(err) });
  }
}
