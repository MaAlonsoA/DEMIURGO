// The product definition as the Product page reads it: every version (newest first) with, per
// section, the question it comes from and how the person settled it (confirmed as DEMIURGO assumed
// it, corrected, answered, or left open), the person's words it rests on, and the proposal waiting
// for the person, if any. Read-only; everything comes from authority and the event log.

import { PAYLOADS } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';

type Payload = ReturnType<typeof PAYLOADS.product_definition.parse>;

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
  } | null;
};

const toDate = (d: unknown) => (d instanceof Date ? d : new Date(String(d)));

type QuestionEvent = { entity_id: string; command: string; actor: string; at: Date; seq: number; after: unknown };

/** How each source question stood when the version (or proposal) was composed: its events up to `until`. */
function sourcesOf(
  sources: Payload['sources'],
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
    const inferred = (infer?.after as { conclusion?: string } | undefined)?.conclusion ?? null;
    const evidence = (infer?.after as { evidence?: { message_id: string; quote: string }[] } | undefined)?.evidence ?? [];
    const conclusion = (settledEvent?.after as { conclusion?: string } | undefined)?.conclusion ?? null;
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
      },
    };
  });
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
    .select(['id', 'batch_id', 'state', 'payload', 'created_at'])
    .where('project_id', '=', projectId)
    .where('type', '=', 'product_definition')
    .execute();
  const payloadOf = new Map(proposals.map((p) => [p.id, PAYLOADS.product_definition.parse(p.payload)]));
  const questionIds = [...payloadOf.values()].flatMap((p) => p.sources.flatMap((s) => (s.question_id ? [s.question_id] : [])));
  const questions = new Map(
    (questionIds.length
      ? await db
          .selectFrom('questions')
          .select(['id', 'question'])
          .where('id', 'in', [...new Set(questionIds)])
          .execute()
      : []
    ).map((q) => [q.id, q]),
  );
  const events: QuestionEvent[] = questionIds.length
    ? (
        await db
          .selectFrom('events')
          .select(['entity_id', 'command', 'actor', 'at', 'seq', 'after'])
          .where('project_id', '=', projectId)
          .where('entity_id', 'in', [...new Set(questionIds)])
          .where('command', 'in', ['question.infer', 'question.confirm', 'question.discard', 'question.reopen'])
          .orderBy('seq')
          .execute()
      ).map((e) => ({ ...e, at: toDate(e.at), seq: Number(e.seq) }))
    : [];
  const pending = proposals.find((p) => p.state === 'pending');
  const pendingPayload = pending ? payloadOf.get(pending.id) : undefined;
  return {
    record: record ?? null,
    versions: versions.map((v) => {
      const origin = v.origin as { type?: string; id?: string } | null;
      const from = origin?.type === 'proposal' && origin.id ? proposals.find((p) => p.id === origin.id) : undefined;
      const payload = from ? payloadOf.get(from.id) : undefined;
      return {
        ...v,
        proposal_id: from?.id ?? null,
        sources: payload && from ? sourcesOf(payload.sources, toDate(from.created_at), questions, events) : [],
      };
    }),
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
          }
        : null,
  };
}

export type ProductDefinition = Awaited<ReturnType<typeof productDefinition>>;
