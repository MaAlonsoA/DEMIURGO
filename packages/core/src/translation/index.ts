// Reading translations: records are always in English and a person reads them in their own
// language. The server loads the source itself (a subject of the project, never text sent by the
// client), translates it once per source fingerprint with the translator agent and keeps it in
// `translations`. A translation is never authority and leaves no event in the journal.

import {
  DomainError,
  type Locale,
  type Provider,
  type TranslationFields,
  type TranslationSubject,
  composeSystem,
  delimitedJson,
  detectLanguage,
  readTranslation,
  tooManyFields,
  translationJsonSchema,
  translationOutput,
  translationSourceHash,
  proseFields,
  questionFields,
  versionFields,
  LOCALE_NAMES,
} from '@demiurgo/domain';
import { TRANSLATION_ACTION, loadAgentCatalog } from '../agents/catalog.ts';
import { projectGlossary } from '../commands/glossary.ts';
import { callProvider, noCallSession } from '../assignments/calls.ts';
import {
  type AssignmentSource,
  type Engine,
  fallbackAfter,
  resolveEngine,
  resolutionProblem,
} from '../assignments/assignments.ts';
import type { Db } from '../db/connection.ts';
import type { Observer } from '../observe/index.ts';
import type { ProviderRegistry } from '../providers/registry.ts';

export const TRANSLATOR_AGENT = 'translator';

export type TranslationDeps = { db: Db; providers: ProviderRegistry; observer: Observer };

export type ReadingTranslation = {
  subject: TranslationSubject;
  id: string;
  lang: Locale;
  /** The English source, as stored. */
  source: TranslationFields;
  /** What to show: the translation, or the source when nothing needed translating. */
  fields: TranslationFields;
  translated: boolean;
  /** Who translated it (`opencode/qwen-local/…`), when it was translated. */
  by: string | null;
};

/** The prose of a subject of the project, or null if it doesn't exist there. */
export async function sourceFields(
  db: Db,
  projectId: string,
  subject: TranslationSubject,
  id: string,
): Promise<TranslationFields | null> {
  switch (subject) {
    case 'question': {
      const q = await db
        .selectFrom('questions')
        .select(['question', 'reason', 'conclusion', 'reasoning', 'options'])
        .where('id', '=', id)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      return q ? questionFields(q) : null;
    }
    case 'message': {
      const m = await db
        .selectFrom('messages')
        .select('body')
        .where('id', '=', id)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      return m ? proseFields({ body: m.body }) : null;
    }
    case 'exploration': {
      const e = await db
        .selectFrom('explorations')
        .select('purpose')
        .where('id', '=', id)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      return e ? proseFields({ purpose: e.purpose }) : null;
    }
    case 'proposal': {
      const p = await db
        .selectFrom('proposals')
        .select('payload')
        .where('id', '=', id)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      return p ? proseFields(p.payload) : null;
    }
    case 'record_version': {
      const v = await db
        .selectFrom('record_versions')
        .select(['title', 'sections'])
        .where('id', '=', id)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!v) return null;
      const criteria = await db
        .selectFrom('criteria')
        .select(['code', 'title', 'statement', 'check_text'])
        .where('record_version_id', '=', id)
        .orderBy('position')
        .execute();
      return versionFields({ title: v.title, sections: v.sections as { title: string; content: string }[], criteria });
    }
  }
}

// A screen asks for many translations at once and a local model has a short queue: a few at a time,
// and a busy engine (HTTP 429, queue full) is asked again after a pause.
const AT_ONCE = 2;
const BUSY_RETRIES = 4;
let running = 0;
const queue: (() => void)[] = [];

async function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= AT_ONCE) await new Promise<void>((resolve) => queue.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    queue.shift()?.();
  }
}

const busy = (r: { state: string; message?: string }) =>
  r.state === 'error' && /\b429\b|overloaded|queue is full|rate.?limit/i.test(r.message ?? '');

async function patiently<T extends { state: string; message?: string }>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    const r = await inTurn(fn);
    if (!busy(r) || i >= BUSY_RETRIES) return r;
    await new Promise((resolve) => setTimeout(resolve, 1500 * 2 ** i));
  }
}

/** Whether every text already reads as the target language (a reply, or an older record). */
function alreadyIn(lang: Locale, fields: TranslationFields): boolean {
  const texts = Object.values(fields);
  return texts.length > 0 && texts.every((t) => detectLanguage(t) === lang);
}

/** The subject in the person's language: from the cache, or translated now and cached. */
export async function readingTranslation(
  deps: TranslationDeps,
  p: { projectId: string; subject: TranslationSubject; id: string; lang: Locale },
): Promise<ReadingTranslation> {
  const source = await sourceFields(deps.db, p.projectId, p.subject, p.id);
  if (!source) throw new DomainError('not_found', `There is no ${p.subject.replace('_', ' ')} ${p.id} in this project.`);
  const base = { subject: p.subject, id: p.id, lang: p.lang, source };
  const nothingToDo = { ...base, fields: source, translated: false, by: null };
  if (p.lang === 'en' || Object.keys(source).length === 0 || alreadyIn(p.lang, source)) return nothingToDo;
  const t = await translateFields(deps, { projectId: p.projectId, subject: p.subject, id: p.id, lang: p.lang, source });
  return { ...base, fields: t.fields, translated: true, by: t.by };
}

/**
 * The fields of a subject translated into `lang` by the translator agent, from the cache when the
 * same source (and glossary) was already translated. Also into English: the English version of an
 * older record written in another language.
 */
export async function translateFields(
  deps: TranslationDeps,
  p: { projectId: string; subject: TranslationSubject; id: string; lang: Locale; source: TranslationFields },
): Promise<{ fields: Record<string, string>; by: string }> {
  const { source } = p;
  if (tooManyFields(source)) throw new DomainError('validation', 'This is too long to translate at once.');

  // The project's fixed terms travel with the texts, and a change of term translates again.
  const glossary = (await projectGlossary(deps.db, p.projectId)).map((g) => ({ term: g.term, english: g.english }));
  const sourceHash = translationSourceHash(
    p.subject,
    glossary.length > 0 ? { ...source, '#glossary': JSON.stringify(glossary) } : source,
  );
  const cached = await deps.db
    .selectFrom('translations')
    .select(['fields', 'provider', 'model'])
    .where('subject_kind', '=', p.subject)
    .where('subject_id', '=', p.id)
    .where('lang', '=', p.lang)
    .where('source_hash', '=', sourceHash)
    .executeTakeFirst();
  if (cached) return { fields: cached.fields, by: `${cached.provider}/${cached.model}` };

  const agent = (await loadAgentCatalog()).get(TRANSLATOR_AGENT);
  if (!agent || agent.action !== TRANSLATION_ACTION) throw new Error('The catalog has no translator agent.');
  const resolved = await resolveEngine(deps.db, deps.providers, { agent: agent.id });
  const problem = resolutionProblem(agent.id, resolved);
  if (problem || resolved.status !== 'ok') throw new DomainError('conflict', problem ?? `Choose a model for ${agent.id}.`);
  const provider = deps.providers.get(resolved.provider);
  if (!provider) throw new DomainError('conflict', `Choose another model for ${agent.id}.`);

  const content = {
    target_language: p.lang,
    target_language_name: LOCALE_NAMES[p.lang],
    fields: Object.entries(source).map(([key, text]) => ({ key, text })),
    ...(glossary.length > 0 ? { glossary } : {}),
  };
  const composed = composeSystem(agent, agent.skillDefinitions, []);
  const call = (on: Provider, engine: Engine, engineSource: AssignmentSource, attempt: 1 | 2) =>
    patiently(() => callOnce(on, engine, engineSource, attempt));
  const callOnce = (on: Provider, engine: Engine, engineSource: AssignmentSource, attempt: 1 | 2) =>
    callProvider(
      { db: deps.db, observer: deps.observer },
      on,
      {
        projectId: p.projectId,
        runId: null,
        updateId: null,
        agent: agent.id,
        agentVersion: agent.version,
        promptHash: composed.promptHash,
        engineSource,
        session: noCallSession(),
        attempt,
        inputHash: null,
        schemaHash: null,
        schemaVersion: null,
        packHash: null,
        retryOf: null,
      },
      {
        system: composed.system,
        input: `<untrusted_input>\n${delimitedJson(content)}\n</untrusted_input>`,
        schema: translationJsonSchema(),
        model: engine.model,
        effort: engine.effort,
        session: { mode: 'none' },
        timeMs: agent.timeLimitSeconds * 1000,
        task: { action: TRANSLATION_ACTION, context: { hash: sourceHash, content } },
      },
    );
  let engine: Engine = { provider: resolved.provider, model: resolved.model, effort: resolved.effort };
  let result = await call(provider, engine, resolved.source, 1);
  // The engine couldn't answer at all: once more on the backup, when the agent has one.
  const backup = fallbackAfter(resolved, result);
  const backupProvider = backup ? deps.providers.get(backup.provider) : undefined;
  if (backup && backupProvider) {
    const first = result.state === 'error' ? result.message : '';
    engine = { provider: backup.provider, model: backup.model, effort: backup.effort };
    result = await call(backupProvider, engine, 'fallback', 2);
    if (result.state !== 'ok') {
      throw new DomainError('conflict', `The translation failed: ${first} Its backup failed too: ${result.message}`);
    }
  }
  if (result.state !== 'ok') throw new DomainError('conflict', `The translation failed: ${result.message}`);
  const parsed = translationOutput.safeParse(result.rawOutput);
  if (!parsed.success) throw new DomainError('conflict', 'The translation came back in the wrong shape.');
  const read = readTranslation(source, parsed.data);
  if (!read.ok) throw new DomainError('conflict', read.problem);

  await deps.db
    .insertInto('translations')
    .values({
      project_id: p.projectId,
      subject_kind: p.subject,
      subject_id: p.id,
      lang: p.lang,
      source_hash: sourceHash,
      fields: JSON.stringify(read.fields),
      provider: engine.provider,
      model: engine.model,
    })
    .onConflict((oc) => oc.columns(['subject_kind', 'subject_id', 'lang', 'source_hash']).doNothing())
    .execute();
  return { fields: read.fields, by: `${engine.provider}/${engine.model}` };
}
