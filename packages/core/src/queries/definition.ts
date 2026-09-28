// The product definition as the Product page reads it: every version (newest first) with, per
// section, the question it comes from and how the person settled it (confirmed as DEMIURGO assumed
// it, corrected, answered, or left open), the person's words it rests on, why each changed section
// changed, the proposal waiting for the person, if any, and the changes proposed in threads.
// Read-only; everything comes from authority and the event log.

import { DEFINITION_SECTIONS, DEFINITION_STAGE, PAYLOADS, changeReasons } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';

type Payload = ReturnType<typeof PAYLOADS.product_definition.parse>;
type Change = ReturnType<typeof PAYLOADS.definition_change.parse>;
type Source = Payload['sources'][number];

export type SectionSource = {
  section: string;
  key: string;
  state: 'confirmed' | 'discarded' | 'missing';
  question: {
    id: string;
    question: string;
    /** How it was settled: `assumed` (confirmed as DEMIURGO inferred it), `corrected`, `answered` or `left_open`. */
    settled: 'assumed' | 'corrected' | 'answered' | 'left_open' | null;
    settled_by: string | null;
    settled_at: string | null;
    /** What DEMIURGO had inferred, when it did. */
    inferred: string | null;
    evidence: { message_id: string; quote: string }[];
    /** The answer as the person wrote it, when it was put into English. */
    own_words: string | null;
  } | null;
};

/** Why a section changed in a version, and the person's own words for it when they wrote it in another language. */
export type SectionReason = { section: string; why: string; own_words: string | null };

const toDate = (d: unknown) => (d instanceof Date ? d : new Date(String(d)));

type QuestionEvent = { entity_id: string; command: string; actor: string; at: Date; seq: number; after: unknown };

const afterOf = (e: QuestionEvent | undefined) => (e?.after ?? {}) as Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

/** How each source question stood when the version (or proposal) was composed: its events up to `until`. */
function sourcesOf(
  sources: readonly Source[],
  until: Date,
  questions: Map<string, { question: string }>,
  events: QuestionEvent[],
): SectionSource[] {
  return sources.map((s) => {
    const q = s.question_id ? questions.get(s.question_id) : undefined;
    if (!s.question_id || !q) return { section: s.section, key: s.key, state: s.state, question: null };
    const own = events.filter((e) => e.entity_id === s.question_id && e.at.getTime() <= until.getTime());
    const settledEvent = own.findLast((e) => e.command === 'question.confirm' || e.command === 'question.discard');
    const before = own.filter((e) => !settledEvent || e.seq < settledEvent.seq);
    const lastReopen = before.findLast((e) => e.command === 'question.reopen');
    const infer = before.findLast((e) => e.command === 'question.infer' && (!lastReopen || e.seq > lastReopen.seq));
    const inferred = str(afterOf(infer).conclusion);
    const evidence = (afterOf(infer).evidence as { message_id: string; quote: string }[] | undefined) ?? [];
    const conclusion = str(afterOf(settledEvent).conclusion);
    const settled = !settledEvent
      ? null
      : settledEvent.command === 'question.discard'
        ? 'left_open'
        : inferred === null
          ? 'answered'
          : conclusion?.trim() === inferred.trim()
            ? 'assumed'
            : 'corrected';
    return {
      section: s.section,
      key: s.key,
      state: s.state,
      question: {
        id: s.question_id,
        question: q.question,
        settled,
        settled_by: settledEvent?.actor ?? null,
        settled_at: settledEvent?.at.toISOString() ?? null,
        inferred,
        evidence,
        own_words: str(afterOf(settledEvent).own_words),
      },
    };
  });
}

/** The reasons of a change note, each with the words the person reopened its question with, up to `until`. */
function reasonsOf(note: string | null, sources: readonly Source[], until: Date, events: QuestionEvent[]): SectionReason[] {
  return changeReasons(note).map((r) => {
    const questionId = sources.find((s) => s.section === r.section)?.question_id;
    const reopen = events.findLast(
      (e) => e.entity_id === questionId && e.command === 'question.reopen' && e.at.getTime() <= until.getTime(),
    );
    return { ...r, own_words: str(afterOf(reopen).own_words) };
  });
}

/** The sources of a version made by a change from a thread: the ones before it, with that section's answer. */
function changedSources(previous: readonly Source[], c: Change, questionIdOf: Map<string, string>): Source[] {
  const key = DEFINITION_SECTIONS.find((s) => s.title === c.section)?.key ?? c.section;
  const own: Source = { section: c.section, key, question_id: questionIdOf.get(key) ?? null, state: 'confirmed' };
  return previous.some((s) => s.section === c.section)
    ? previous.map((s) => (s.section === c.section ? own : s))
    : [...previous, own];
}

/** The thread a run worked in, from its scope. */
function threadOf(scope: unknown): string | null {
  const s = scope as { type?: string; id?: string } | null;
  return s?.type === 'exploration' && s.id ? s.id : null;
}

export async function productDefinition(db: Db, projectId: string) {
  const record = await db
    .selectFrom('records')
    .select(['id', 'code'])
    .where('project_id', '=', projectId)
    .where('type', '=', 'product_definition')
    .executeTakeFirst();
  const versions = record
    ? await db
        .selectFrom('record_versions')
        .select([
          'id',
          'n',
          'state',
          'title',
          'sections',
          'change_note',
          'origin',
          'author',
          'created_at',
          'approved_at',
          'approved_by',
        ])
        .where('record_id', '=', record.id)
        .orderBy('n', 'desc')
        .execute()
    : [];
  const proposals = await db
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .leftJoin('ai_runs', 'ai_runs.id', 'proposal_batches.run_id')
    .select([
      'proposals.id',
      'proposals.batch_id',
      'proposals.type',
      'proposals.state',
      'proposals.payload',
      'proposals.created_at',
      'ai_runs.scope',
    ])
    .where('proposals.project_id', '=', projectId)
    .where('proposals.type', 'in', ['product_definition', 'definition_change'])
    .orderBy('proposals.created_at')
    .execute();
  const drafted = new Map(
    proposals.flatMap((p) =>
      p.type === 'product_definition' ? [[p.id, PAYLOADS.product_definition.parse(p.payload)] as const] : [],
    ),
  );
  const changes = new Map(
    proposals.flatMap((p) =>
      p.type === 'definition_change' ? [[p.id, PAYLOADS.definition_change.parse(p.payload)] as const] : [],
    ),
  );
  // The definition stage's questions, by key: where a section changed from a thread comes from.
  const stageQuestions = await db
    .selectFrom('questions')
    .innerJoin('stages', 'stages.id', 'questions.stage_id')
    .select(['questions.id', 'questions.question', 'questions.stage_key'])
    .where('questions.project_id', '=', projectId)
    .where('stages.stage', '=', DEFINITION_STAGE)
    .execute();
  const questionIdOf = new Map(stageQuestions.flatMap((q) => (q.stage_key ? [[q.stage_key, q.id] as const] : [])));
  const questions = new Map(stageQuestions.map((q) => [q.id, q]));
  const events: QuestionEvent[] = questions.size
    ? (
        await db
          .selectFrom('events')
          .select(['entity_id', 'command', 'actor', 'at', 'seq', 'after'])
          .where('project_id', '=', projectId)
          .where('entity_id', 'in', [...questions.keys()])
          .where('command', 'in', ['question.infer', 'question.confirm', 'question.discard', 'question.reopen'])
          .orderBy('seq')
          .execute()
      ).map((e) => ({ ...e, at: toDate(e.at), seq: Number(e.seq) }))
    : [];

  // Each version's sources, oldest first: a version the system composed carries them in its
  // proposal; one changed from a thread takes the previous ones with that section's answer; any other
  // (e.g. its English version) keeps the previous ones.
  let previous: Source[] = [];
  const shaped = versions.toReversed().map((v) => {
    const origin = v.origin as { type?: string; id?: string } | null;
    const from = origin?.type === 'proposal' && origin.id ? proposals.find((p) => p.id === origin.id) : undefined;
    const composed = from ? drafted.get(from.id) : undefined;
    const change = from ? changes.get(from.id) : undefined;
    const sources = composed ? composed.sources : change ? changedSources(previous, change, questionIdOf) : previous;
    previous = sources;
    // The answers as they stood when it was composed (changed from a thread: when it was accepted).
    const until = composed && from ? toDate(from.created_at) : toDate(v.created_at);
    return {
      ...v,
      proposal_id: from?.id ?? null,
      from_thread:
        change && from ? { proposal_id: from.id, exploration_id: threadOf(from.scope), evidence: change.evidence } : null,
      sources: sourcesOf(sources, until, questions, events),
      reasons: reasonsOf(v.change_note, sources, until, events),
    };
  });

  const pending = proposals.find((p) => p.type === 'product_definition' && p.state === 'pending');
  const pendingPayload = pending ? drafted.get(pending.id) : undefined;
  return {
    record: record ?? null,
    versions: shaped.toReversed(),
    proposal:
      pending && pendingPayload
        ? {
            id: pending.id,
            batch_id: pending.batch_id,
            created_at: pending.created_at,
            base: pendingPayload.record ?? null,
            title: pendingPayload.title,
            sections: pendingPayload.sections,
            change_note: pendingPayload.change_note ?? null,
            sources: sourcesOf(pendingPayload.sources, toDate(pending.created_at), questions, events),
            reasons: reasonsOf(pendingPayload.change_note ?? null, pendingPayload.sources, toDate(pending.created_at), events),
          }
        : null,
    // Changes to a section proposed in threads, waiting for the person.
    changes: proposals.flatMap((p) => {
      const c = changes.get(p.id);
      return p.state === 'pending' && c
        ? [
            {
              id: p.id,
              batch_id: p.batch_id,
              created_at: p.created_at,
              exploration_id: threadOf(p.scope),
              base: c.record,
              section: c.section,
              content: c.content,
              reason: c.reason,
              evidence: c.evidence,
            },
          ]
        : [];
    }),
  };
}

export type ProductDefinition = Awaited<ReturnType<typeof productDefinition>>;
