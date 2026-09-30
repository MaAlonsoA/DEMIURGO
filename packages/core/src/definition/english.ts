// Records are kept in English, and the product definition is composed word for word from the answers
// to its stage's questions. So an answer a person writes in another language is put into English
// before it is saved, by the translator agent, and their own words stay next to it in the event
// (`own_words`). It happens before the command's transaction: a model call never holds one open. If
// it can't be translated, the command fails with the reason and nothing is saved.

import { DEFINITION_STAGE, DomainError, looksEnglish } from '@demiurgo/domain';
import { registerPreparers } from '../bus/handlers.ts';
import type { Request } from '../bus/types.ts';
import type { Services } from '../services.ts';
import { translateFields } from '../translation/index.ts';

/** The free text each command takes from the person, which may end up in the definition. */
const FIELD = { 'question.confirm': 'conclusion', 'question.discard': 'reason', 'question.reopen': 'reason' } as const;

type Field = (typeof FIELD)[keyof typeof FIELD];

/** The request with the person's text in English and their own words kept, when it wasn't in English. */
export async function answerInEnglish(services: Services, request: Request): Promise<Request> {
  const field: Field | undefined = FIELD[request.command as keyof typeof FIELD];
  if (!field || typeof request.data !== 'object' || request.data === null) return request;
  // Only the server writes `own_words`: whatever a client sends in it is dropped.
  const { own_words: _ignored, ...data } = request.data as Record<string, unknown>;
  const clean = { ...request, data };
  const value = data[field];
  const text = typeof value === 'string' ? value.trim() : '';
  if (request.actor.type !== 'human' || !request.projectId || !request.entityId || !text || looksEnglish(text)) return clean;
  // Every answer ends up in a record (the definition, an NFR, an ADR, a feature), and records are kept
  // in English, so every question's answer is put into English, not only the definition's.
  const question = await services.db
    .selectFrom('questions')
    .leftJoin('stages', 'stages.id', 'questions.stage_id')
    .select(['questions.id', 'stages.stage'])
    .where('questions.id', '=', request.entityId)
    .where('questions.project_id', '=', request.projectId)
    .executeTakeFirst();
  if (!question) return clean;
  // The definition is composed word for word from its answers, so there a failed translation stops the
  // command; elsewhere translating never blocks saving (VISION.md): the answer is kept as written.
  const strict = question.stage === DEFINITION_STAGE;
  let english: string | undefined;
  try {
    const t = await translateFields(services, {
      projectId: request.projectId,
      subject: 'question',
      id: question.id,
      lang: 'en',
      source: { [field]: text },
    });
    english = t.fields[field]?.trim();
  } catch (e) {
    if (!strict) return clean;
    const reason = e instanceof Error ? e.message : String(e);
    throw new DomainError(
      e instanceof DomainError ? e.type : 'conflict',
      `The product definition is kept in English, and DEMIURGO couldn't put your answer into English: ${reason}`,
    );
  }
  if (!english) {
    if (!strict) return clean;
    throw new DomainError('conflict', 'The product definition is kept in English, and the translation came back empty.');
  }
  return { ...request, data: { ...data, [field]: english, own_words: text } };
}

registerPreparers({
  'question.confirm': answerInEnglish,
  'question.discard': answerInEnglish,
  'question.reopen': answerInEnglish,
});
