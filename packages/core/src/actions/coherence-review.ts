// coherence_review action (FDR-KNO-056): reads a whole epic at once (the definition, its approved
// features and their decisions, then what they link to in other epics) and reports contradictions and
// duplicates the per-approval update cannot see, comparing two records at a time. Every finding quotes
// both records; code checks the quotes and only checked findings reach the person, as ordinary reviews.

import { type ActionOutput, COHERENCE_MAX_FINDINGS, DomainError, quoteIn } from '@demiurgo/domain';
import { sql } from 'kysely';
import { registerBuilder } from '../context/build.ts';
import { ManifestBuilder } from '../context/manifest.ts';
import type { Db, Tx } from '../db/connection.ts';
import { registerApplier, registerChecker } from './appliers.ts';

const BUILDER = 'coherence_review@1';
/** About 120,000 characters of approved text: a whole epic with its neighbours fits a deep model. */
const BUDGET = { records: 120_000 };
const FINAL = ['completed', 'failed', 'cancelled', 'interrupted'];

type Current = { recordId: string; versionId: string; code: string; type: string; n: number; title: string; sections: unknown };

export type CoherenceRecord = { code: string; type: string; version: number; title: string; text: string };
export type CoherencePack = {
  epic: { code: string; title: string };
  records: CoherenceRecord[];
  omitted: { code: string; title: string }[];
};
type Finding = ActionOutput<'coherence_review'>['findings'][number];

/** The current approved version of every record of the project. */
async function currentVersions(trx: Db, projectId: string): Promise<Current[]> {
  const r = await sql<Current>`
    select distinct on (r.id) r.id as "recordId", v.id as "versionId", r.code, r.type, v.n, v.title, v.sections
    from records r join record_versions v on v.record_id = r.id
    where r.project_id = ${projectId}::uuid and v.state = 'approved'
    order by r.id, v.n desc`.execute(trx);
  return r.rows;
}

/** Every current version's criteria, criteria first in each record's text (where contradictions live). */
async function criteriaOf(trx: Db, versionIds: readonly string[]) {
  if (versionIds.length === 0) return new Map<string, { code: string; title: string; statement: string }[]>();
  const rows = await trx
    .selectFrom('criteria')
    .select(['record_version_id', 'code', 'title', 'statement'])
    .where('record_version_id', 'in', versionIds)
    .orderBy('position')
    .execute();
  const byVersion = new Map<string, { code: string; title: string; statement: string }[]>();
  for (const r of rows) byVersion.set(r.record_version_id, [...(byVersion.get(r.record_version_id) ?? []), r]);
  return byVersion;
}

function recordText(v: Current, criteria: readonly { code: string; title: string; statement: string }[]): string {
  const sections = (v.sections as { title: string; content: string }[]).filter((s) => s.content.trim());
  return [
    ...(criteria.length > 0 ? ['Criteria:', ...criteria.map((c) => `- ${c.code} ${c.title}: ${c.statement}`), ''] : []),
    ...sections.map((s) => `## ${s.title}\n${s.content}`),
  ].join('\n');
}

const STOP = new Set(
  'about above after again against all also and any are because been before being below between both but can cannot does each else every for from has have having here how into its itself just may more most must never not now once only other our out over own same shall should since some such than that the their them then there these they this those through too under until upon very was were what when where which while who whom why will with within without would your'.split(
    ' ',
  ),
);

/** The distinct words of a text that can tell records apart (four letters or more, not common words). */
function terms(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
}

/**
 * How close a candidate is to the closest feature of the epic, by the rare words they share (tf-idf
 * cosine over distinct words): two features about the same thing share its specific words even when
 * nothing links them (the definition's sections, a stage's name).
 */
function closeness(candidate: Set<string>, features: readonly Set<string>[], idf: Map<string, number>): number {
  const norm = (t: Set<string>) => Math.sqrt([...t].reduce((a, w) => a + (idf.get(w) ?? 0) ** 2, 0)) || 1;
  const nc = norm(candidate);
  let best = 0;
  for (const f of features) {
    let shared = 0;
    for (const w of candidate) if (f.has(w)) shared += (idf.get(w) ?? 0) ** 2;
    best = Math.max(best, shared / (nc * norm(f)));
  }
  return best;
}

/** Record-to-record links among current versions: based_on (what a record rests on or needs) and knowledge's related. */
async function recordLinks(trx: Db, projectId: string): Promise<{ a: string; b: string; kind: 'based_on' | 'related' }[]> {
  const based = await sql<{ a: string; b: string }>`
    select fa.record_id as a, fb.record_id as b
    from links l
    join record_versions fa on fa.id = l.from_id
    join record_versions fb on fb.id = l.to_id
    where l.project_id = ${projectId}::uuid and l.type = 'based_on' and l.state = 'current'`.execute(trx);
  const related = await sql<{ a: string; b: string }>`
    select ra.id as a, rb.id as b
    from knowledge_edges e
    join knowledge_nodes na on na.id = e.from_node and na.valid_to is null
    join knowledge_nodes nb on nb.id = e.to_node and nb.valid_to is null
    join records ra on ra.project_id = e.project_id and ra.code = split_part(na.ref, '@', 1)
    join records rb on rb.project_id = e.project_id and rb.code = split_part(nb.ref, '@', 1)
    where e.project_id = ${projectId}::uuid and e.kind = 'related' and e.valid_to is null`.execute(trx);
  return [
    ...based.rows.map((r) => ({ ...r, kind: 'based_on' as const })),
    ...related.rows.map((r) => ({ ...r, kind: 'related' as const })),
  ];
}

registerBuilder('coherence_review', async ({ trx, projectId, scope, graphVersion }) => {
  const manifest = new ManifestBuilder(BUILDER, graphVersion, BUDGET);
  const all = await currentVersions(trx, projectId);
  const epic = all.find((v) => v.recordId === scope.id && v.type === 'epic');
  if (!epic) throw new DomainError('validation', 'A coherence review reads an approved epic.');
  const running = await trx
    .selectFrom('ai_runs')
    .select('id')
    .where('project_id', '=', projectId)
    .where('action', '=', 'coherence_review')
    .where(sql<boolean>`scope->>'id' = ${epic.recordId}`)
    .where('state', 'not in', FINAL)
    .executeTakeFirst();
  if (running) throw new DomainError('guard', `A coherence review of ${epic.code} is already running.`);
  const links = await recordLinks(trx, projectId);
  const out = (id: string) => links.filter((l) => l.kind === 'based_on' && l.a === id).map((l) => l.b);
  // Its features rest on the epic; its decisions rest on one of them.
  const features = all.filter((v) => v.type === 'fdr' && out(v.recordId).includes(epic.recordId));
  const featureIds = new Set(features.map((f) => f.recordId));
  const decisions = all.filter((v) => v.type === 'adr' && out(v.recordId).some((t) => featureIds.has(t)));
  const own = new Set([epic.recordId, ...featureIds, ...decisions.map((d) => d.recordId)]);
  const criteria = await criteriaOf(
    trx,
    all.map((v) => v.versionId),
  );
  const texts = new Map(all.map((v) => [v.recordId, recordText(v, criteria.get(v.versionId) ?? [])]));
  // Features and decisions of other epics: the closest in words to one of the epic's features first,
  // then those linked to them (based on counts more than knowledge's related).
  const pool = all.filter((v) => ['fdr', 'adr'].includes(v.type) && !own.has(v.recordId));
  const termsOf = new Map([...features, ...pool].map((v) => [v.recordId, terms(texts.get(v.recordId) ?? '')]));
  const df = new Map<string, number>();
  for (const t of termsOf.values()) for (const w of t) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = new Map([...df].map(([w, n]) => [w, Math.log((termsOf.size + 1) / n)]));
  const featureTerms = features.map((f) => termsOf.get(f.recordId) ?? new Set<string>());
  const linked = new Map<string, number>();
  for (const l of links) {
    const other = featureIds.has(l.a) ? l.b : featureIds.has(l.b) ? l.a : null;
    if (other && !own.has(other)) linked.set(other, (linked.get(other) ?? 0) + (l.kind === 'based_on' ? 0.15 : 0.02));
  }
  const score = new Map(
    pool.map((v) => [v.recordId, closeness(termsOf.get(v.recordId) ?? new Set(), featureTerms, idf) + (linked.get(v.recordId) ?? 0)]),
  );
  const neighbours = [...pool].sort((a, b) => (score.get(b.recordId) ?? 0) - (score.get(a.recordId) ?? 0) || (a.code < b.code ? -1 : 1));
  const definition = all.filter((v) => v.type === 'product_definition');
  const byCode = (a: Current, b: Current) => (a.code < b.code ? -1 : 1);
  const ordered: [Current, string][] = [
    ...definition.map((v): [Current, string] => [v, 'definition']),
    [epic, 'epic'],
    ...features.sort(byCode).map((v): [Current, string] => [v, 'feature of the epic']),
    ...decisions.sort(byCode).map((v): [Current, string] => [v, 'decision on a feature of the epic']),
    ...neighbours.map((v): [Current, string] => [v, `another epic, closeness ${(score.get(v.recordId) ?? 0).toFixed(3)}`]),
  ];
  const records: CoherenceRecord[] = [];
  const omitted: { code: string; title: string }[] = [];
  let left = BUDGET.records;
  for (const [v, reason] of ordered) {
    const text = texts.get(v.recordId) ?? '';
    const source = { type: 'record' as const, id: v.recordId, version: v.n, eventSeq: null };
    // A record enters whole or not at all: a cut record would hide the passage a finding needs.
    if (text.length > left) {
      omitted.push({ code: v.code, title: v.title });
      manifest.dropped({ section: 'records', source, text, reason: 'budget:records' });
      continue;
    }
    left -= text.length;
    records.push({ code: v.code, type: v.type, version: v.n, title: v.title, text });
    manifest.entered({ section: 'records', source, text, reason });
  }
  const content: CoherencePack = { epic: { code: epic.code, title: epic.title }, records, omitted };
  return {
    pack: {
      role: 'coherence',
      constructor: BUILDER,
      budget: BUDGET,
      graph_version: graphVersion,
      dependencies: records.map((r) => ({ type: 'record', id: byCodeId(all, r.code), version: r.version })),
      content,
    },
    manifest: manifest.build(),
  };
});

function byCodeId(all: readonly Current[], code: string): string {
  return all.find((v) => v.code === code)?.recordId ?? '';
}

/** Why a finding can't stand on the records the review read; null when both quotes are there. */
export function findingProblem(pack: CoherencePack, f: Finding): string | null {
  const record = pack.records.find((r) => r.code === f.record);
  const other = pack.records.find((r) => r.code === f.other);
  if (!record || !other) return `${!record ? f.record : f.other} is not one of the records you read.`;
  if (f.record === f.other) return `A finding joins two different records, not ${f.record} with itself.`;
  if (!quoteIn(f.quote, record.text)) return `"${f.quote}" is not in ${f.record}'s text.`;
  if (!quoteIn(f.other_quote, other.text)) return `"${f.other_quote}" is not in ${f.other}'s text.`;
  return null;
}

async function packOf(db: Db, packId: string | null): Promise<CoherencePack> {
  const pack = await db.selectFrom('context_packs').select('content').where('id', '=', packId ?? '').executeTakeFirstOrThrow();
  return pack.content as CoherencePack;
}

// A finding whose quote is not verbatim goes back to the agent once, to copy it exactly or drop it.
registerChecker('coherence_review', async ({ db, run, output }) => {
  const pack = await packOf(db, run.context_pack_id);
  return output.findings.flatMap((f, i) => {
    const problem = findingProblem(pack, f);
    return problem ? [`Finding ${i + 1}: ${problem} Copy both passages verbatim from the records' text, or drop the finding.`] : [];
  });
});

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const findingKey = (a: string, qa: string, b: string, qb: string) =>
  [`${a}|${norm(qa)}`, `${b}|${norm(qb)}`].sort().join('||');

/** Findings already pending from an earlier review (same two records, same quotes): not proposed again. */
async function pendingFindings(trx: Tx, projectId: string): Promise<Set<string>> {
  const rows = await trx
    .selectFrom('proposals')
    .select('payload')
    .where('project_id', '=', projectId)
    .where('type', '=', 'review')
    .where('state', '=', 'pending')
    .where(sql<boolean>`payload->>'verdict' in ('contradiction', 'duplicate')`)
    .execute();
  return new Set(
    rows.flatMap((r) => {
      const p = r.payload as { record?: { code?: string }; other?: { code?: string }; quotes?: { record?: string; other?: string } };
      return p.record?.code && p.other?.code && p.quotes?.record && p.quotes.other
        ? [findingKey(p.record.code, p.quotes.record, p.other.code, p.quotes.other)]
        : [];
    }),
  );
}

registerApplier('coherence_review', async ({ trx, execute, run, output }) => {
  const pack = await packOf(trx, run.context_pack_id);
  const seen = await pendingFindings(trx, run.project_id);
  const fresh: Finding[] = [];
  for (const f of output.findings.slice(0, COHERENCE_MAX_FINDINGS)) {
    if (findingProblem(pack, f)) continue;
    const key = findingKey(f.record, f.quote, f.other, f.other_quote);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(f);
  }
  if (fresh.length === 0) return;
  const versions = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'record_versions.id', 'record_versions.n'])
    .where('records.project_id', '=', run.project_id)
    .where(
      'records.code',
      'in',
      fresh.flatMap((f) => [f.record, f.other]),
    )
    .execute();
  const at = (code: string) => {
    const version = pack.records.find((r) => r.code === code)?.version;
    const v = versions.find((x) => x.code === code && x.n === version);
    if (!v) throw new DomainError('conflict', `${code} v${version ?? '?'} is no longer there.`);
    return v;
  };
  await execute({
    projectId: run.project_id,
    command: 'batch.submit',
    actor: { type: 'agent_run', run: run.id },
    data: {
      summary: `Coherence review of ${pack.epic.code} found ${fresh.length} issue(s).`,
      batch_type: 'knowledge',
      resolution: 'item',
      run_id: run.id,
      context_pack_id: run.context_pack_id ?? undefined,
      proposals: fresh.map((f) => {
        const record = at(f.record);
        const other = at(f.other);
        return {
          type: 'review',
          payload: {
            record: { code: record.code, version: record.n },
            verdict: f.kind,
            reason: `${f.explanation} Suggestion: ${f.suggestion}`.slice(0, 2000),
            change: { type: 'record_version', id: other.id, version: other.n },
            confidence: 1,
            other: { code: other.code, version: other.n },
            quotes: { record: f.quote, other: f.other_quote },
            suggestion: f.suggestion,
            epic: pack.epic.code,
          },
          // Either quoted record getting a new version makes the finding out of date.
          dependencies: [
            { type: 'record', id: record.recordId, code: record.code, version: record.n },
            { type: 'record', id: other.recordId, code: other.code, version: other.n },
          ],
        };
      }),
    },
  });
});

/**
 * The last coherence review of an epic, for its page: when it ran, what it read and left out, and the
 * issues it found, dropped (quotes not in the records), already pending and still pending now.
 */
export async function coherenceStatus(db: Db, projectId: string, code: string) {
  const epic = await db
    .selectFrom('records')
    .select(['id', 'code'])
    .where('project_id', '=', projectId)
    .where('code', '=', code)
    .where('type', '=', 'epic')
    .executeTakeFirst();
  if (!epic) throw new DomainError('not_found', `There is no epic ${code}.`);
  const run = await db
    .selectFrom('ai_runs')
    .select(['id', 'state', 'created_at', 'finished_at', 'failure_kind', 'error', 'output', 'context_pack_id'])
    .where('project_id', '=', projectId)
    .where('action', '=', 'coherence_review')
    .where(sql<boolean>`scope->>'id' = ${epic.id}`)
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  if (!run) return { epic: epic.code, run: null };
  const pack = run.context_pack_id ? await packOf(db, run.context_pack_id) : null;
  const findings = ((run.output as { findings?: Finding[] } | null)?.findings ?? []).slice(0, COHERENCE_MAX_FINDINGS);
  const dropped = pack ? findings.filter((f) => findingProblem(pack, f) !== null).length : 0;
  const proposals = await db
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .select(['proposals.state', 'proposal_batches.id as batchId'])
    .where('proposal_batches.run_id', '=', run.id)
    .execute();
  return {
    epic: epic.code,
    run: {
      id: run.id,
      state: run.state,
      running: !FINAL.includes(run.state),
      created_at: run.created_at,
      finished_at: run.finished_at,
      failure_kind: run.failure_kind,
      error: run.error,
    },
    read: pack?.records.map((r) => r.code) ?? [],
    omitted: pack?.omitted.map((r) => r.code) ?? [],
    found: findings.length - dropped,
    dropped,
    proposed: proposals.length,
    pending: proposals.filter((p) => p.state === 'pending').length,
    batch: proposals[0]?.batchId ?? null,
  };
}
