// Jev's second opinion on a task's effort size (FDR-DEL-006): one Score over the ordered sizes XS–XL
// on the task's title, Goal, Scope and criteria. It runs after the commit that creates the task or
// writes a new content version, never blocks it, and a failure only leaves no opinion. The result is
// derived data (size, confidence, classifier id), recomputable by calling it again; it never changes
// the task's size. Without TYPESAFE_API_KEY it does nothing.

import { SIZE_DESCRIPTIONS, TASK_SIZES } from '@demiurgo/domain';
import type { Services } from '../services.ts';
import { jevAllowed } from './aspect.ts';
import { createJevClassifier, jevCostUsd } from './jev.ts';

const QUESTION = 'How much relative effort does building this software task take, compared with other tasks?';
const MAX_TEXT = 8000;
const SIZED_SECTIONS = new Set(['goal', 'scope']);

/** The text Jev scores: title, Goal, Scope and each criterion. */
export async function taskSizeText(services: Pick<Services, 'db'>, versionId: string): Promise<string | null> {
  const v = await services.db
    .selectFrom('record_versions')
    .select(['title', 'sections'])
    .where('id', '=', versionId)
    .executeTakeFirst();
  if (!v) return null;
  const sections = (v.sections as { title: string; content: string }[]).filter((s) => SIZED_SECTIONS.has(s.title.trim().toLowerCase()));
  const criteria = await services.db
    .selectFrom('criteria')
    .select(['code', 'title', 'statement'])
    .where('record_version_id', '=', versionId)
    .orderBy('position')
    .execute();
  return [
    `Task: ${v.title}`,
    ...sections.map((s) => `${s.title}:\n${s.content}`),
    criteria.length > 0 ? `Acceptance criteria:\n${criteria.map((c) => `- ${c.title}: ${c.statement}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_TEXT);
}

/** Scores a task version's size with Jev and stores the opinion. After the commit; never throws. */
export async function classifyTaskSize(services: Services, projectId: string, recordId: string, versionId: string): Promise<void> {
  if (!jevAllowed()) return;
  try {
    const text = await taskSizeText(services, versionId);
    if (!text) return;
    let tokens = 0;
    const jev = createJevClassifier({ apiKey: process.env.TYPESAFE_API_KEY, onUsage: (u) => (tokens += u.input_tokens) });
    const [answer] = await jev.score([
      { id: versionId, state: text, question: QUESTION, levels: TASK_SIZES.map((s) => `${s}: ${SIZE_DESCRIPTIONS[s]}`) },
    ]);
    const size = answer ? TASK_SIZES[answer.level] : undefined;
    if (!answer || !size) return;
    await services.db
      .insertInto('task_size_opinions')
      .values({
        project_id: projectId,
        record_id: recordId,
        record_version_id: versionId,
        size,
        confidence: answer.confidence,
        classifier_id: jev.id,
      })
      .execute();
    services.logger.info('Jev sized a task', { projectId, recordId, size, input_tokens: tokens, usd: jevCostUsd(tokens) });
  } catch (err) {
    services.logger.error('Jev could not size a task', { recordId, versionId, error: String(err) });
  }
}
