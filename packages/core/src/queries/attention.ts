// Attention and cost per stage, and «¿merece la pena?» (salud-del-harness §5, §5.1, §6.7, §10). Derived on read from
// the tables that already exist (`questions`, `events`, `proposals`, `proposal_batches`, `ai_runs`, `record_versions`,
// `version_answers`, `build_requests`, `build_steps`, `evidence`); nothing is stored and nothing calls a model.
//
// Conventions (all «convención nuestra»: no standard fixes them):
// - Stages map as far as the data allows. A question belongs to the stage that raised it (`stages.stage`); a proposal to
//   the kind of record it creates (`record_type`), a definition proposal to `definition` (it folds the principles and
//   quality answers in), a knowledge batch to `knowledge`; an ADR counts as `architecture`. What does not map is `other`.
// - A batch is a «whole-batch acceptance» when it has at least 5 items, all accepted and none edited (§5).
// - Seconds per item are `(resolved_at − shown_at) / items` over resolved batches with at least 2 items; when the batch
//   was never shown (`batch.show`, §6.7) the clock starts at its creation and the row says so.
// - Person-minutes proxy: 5-minute buckets with at least one `human:*` event, times 5; sessions split at a gap over 15
//   minutes. It is a lower bound, not a measure of attention.
// - Cost per artefact: a run's declared usage is shared among the versions its batches produced; a run whose batches
//   produced nothing still counts against its stage (that is the point of «earns its tokens», §5.1).

import type { Db } from '../db/connection.ts';

export const STAGES = ['definition', 'quality', 'principles', 'design_system', 'epics_features', 'screens', 'tasks', 'architecture', 'security', 'knowledge', 'other'] as const;
export type AttentionStage = (typeof STAGES)[number];

/** Items a batch needs to count as «accepted whole» (convención nuestra, from §5). */
export const WHOLE_BATCH_MIN_ITEMS = 5;
/** Minutes per bucket and the gap that closes a session (convención nuestra, §5). */
export const BUCKET_MINUTES = 5;
export const SESSION_GAP_MINUTES = 15;

export const CONVENTION = 'convención nuestra';

export type Stat = { n: number; median: number | null; p90: number | null; max: number | null };

export type StageAttention = {
  stage: AttentionStage;
  questions: {
    raised: number;
    answered: number;
    discarded: number;
    pending: number;
    /** Answered and cited by an accepted version: `version_answers`, or the question named in an accepted proposal's sources. */
    led_to_version: number;
    /** Answered and followed, in its exploration, by a run whose batch ended in an accepted version (the §5 proxy). */
    led_to_version_proxy: number;
    seconds_to_answer: Stat;
  };
  proposals: { accepted: number; rejected: number; edited: number; pending: number; superseded: number; seconds_to_decide: Stat };
  batches: {
    resolved: number;
    whole_accepted: number;
    /** Resolved batches with at least 2 items, and how many of those were timed from `shown_at`. */
    timed: number;
    timed_from_shown: number;
    seconds_per_item: Stat;
  };
  cost: {
    runs: number;
    runs_without_usage: number;
    input_tokens: number;
    output_tokens: number;
    usd: number;
    artefacts: number;
    tokens_per_artefact: number | null;
    usd_per_artefact: number | null;
  };
  /** Buckets of 5 minutes with a human event in this stage, times 5. Stages overlap, so they do not add up to the total. */
  person_minutes_proxy: number;
};

export type PersonMinutes = {
  basis: string;
  bucket_minutes: number;
  session_gap_minutes: number;
  buckets_minutes: number;
  session_minutes: number;
  sessions: number;
};

export type Attention = { stages: StageAttention[]; person: PersonMinutes; conventions: Record<string, string> };

type Json = Record<string, unknown>;
const asObject = (v: unknown): Json => {
  if (typeof v === 'string') {
    try {
      return asObject(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
};
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const ms = (d: unknown): number => (d === null || d === undefined ? NaN : new Date(d as Date | string).getTime());

export function statOf(values: readonly number[]): Stat {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return { n: 0, median: null, p90: null, max: null };
  const at = (p: number): number => {
    const i = (v.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return v[lo]! + (v[hi]! - v[lo]!) * (i - lo);
  };
  return { n: v.length, median: at(0.5), p90: at(0.9), max: v[v.length - 1]! };
}

/** The stage a stored `stages.stage` belongs to. */
const STAGE_OF_STAGE: Record<string, AttentionStage> = { requirements: 'definition', quality: 'quality', principles: 'principles', architecture: 'architecture', security: 'security' };
/** The stage a record type belongs to. */
const STAGE_OF_RECORD_TYPE: Record<string, AttentionStage> = {
  product_definition: 'definition',
  quality_requirement: 'quality',
  design_system: 'design_system',
  epic: 'epics_features',
  fdr: 'epics_features',
  screen_design: 'screens',
  task: 'tasks',
  adr: 'architecture',
  threat_model: 'security',
};
/** The stage of a proposal type that carries no record type of its own. */
const STAGE_OF_PROPOSAL_TYPE: Record<string, AttentionStage> = {
  product_definition: 'definition',
  definition_change: 'definition',
  design_system: 'design_system',
  screen_design: 'screens',
  feature_plan: 'epics_features',
  review: 'knowledge',
};

export const stageOfRecordType = (type: string | null | undefined): AttentionStage => (type ? STAGE_OF_RECORD_TYPE[type] : undefined) ?? 'other';

/** Bucketed minutes and sessions of a list of timestamps (ms). Pure. */
export function personMinutesOf(times: readonly number[]): { buckets_minutes: number; session_minutes: number; sessions: number } {
  const t = times.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const bucketMs = BUCKET_MINUTES * 60_000;
  const buckets = new Set(t.map((x) => Math.floor(x / bucketMs)));
  let sessions = 0;
  let minutes = 0;
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    const last = i === t.length - 1;
    if (last || t[i + 1]! - t[i]! > SESSION_GAP_MINUTES * 60_000) {
      sessions += 1;
      minutes += (t[i]! - t[start]!) / 60_000;
      start = i + 1;
    }
  }
  return { buckets_minutes: buckets.size * BUCKET_MINUTES, session_minutes: Math.round(minutes), sessions };
}

type Usage = { input: number; output: number; usd: number; declared: boolean };
export function usageOf(raw: unknown): Usage {
  const u = asObject(raw);
  const has = u.inputTokens !== undefined || u.outputTokens !== undefined || u.declaredCostUsd !== undefined;
  return { input: num(u.inputTokens), output: num(u.outputTokens), usd: num(u.declaredCostUsd), declared: has };
}

export type AttentionFacts = {
  stages: { id: string; stage: string; exploration_id: string }[];
  questions: { id: string; exploration_id: string; state: string; stage_id: string | null; shown_at: Date | null }[];
  confirms: { entity_id: string; at: Date }[];
  proposals: { id: string; batch_id: string; type: string; state: string; position: number; record_type: string | null; code: string | null; sources: unknown; version_id: string | null; created_at: Date; resolved_at: Date | null }[];
  batches: { id: string; kind: string; run_id: string | null; created_at: Date; shown_at: Date | null; resolved_at: Date | null }[];
  runs: { id: string; action: string; scope: unknown; usage: unknown }[];
  versions: { id: string; record_id: string; proposal_id: string | null }[];
  records: { id: string; code: string; type: string }[];
  answers: { record_version_id: string; question_id: string }[];
  humanEvents: { at: Date; entity_id: string }[];
};

async function loadFacts(db: Db, projectId: string): Promise<AttentionFacts> {
  const [stages, questions, confirms, proposals, batches, runs, versions, records, answers, humanEvents] = await Promise.all([
    db.selectFrom('stages').select(['id', 'stage', 'exploration_id']).where('project_id', '=', projectId).execute(),
    db.selectFrom('questions').select(['id', 'exploration_id', 'state', 'stage_id', 'shown_at']).where('project_id', '=', projectId).execute(),
    db.selectFrom('events').select(['entity_id', 'at']).where('project_id', '=', projectId).where('command', '=', 'question.confirm').orderBy('seq').execute(),
    db
      .selectFrom('proposals')
      .select((eb) => [
        'id',
        'batch_id',
        'type',
        'state',
        'position',
        'created_at',
        'resolved_at',
        eb.fn<string | null>('jsonb_extract_path_text', ['payload', eb.val('record_type')]).as('record_type'),
        eb.fn<string | null>('jsonb_extract_path_text', ['payload', eb.val('record'), eb.val('code')]).as('code'),
        eb.fn<unknown>('jsonb_extract_path', ['payload', eb.val('sources')]).as('sources'),
        eb.fn<string | null>('jsonb_extract_path_text', ['resolution', eb.val('effect'), eb.val('versionId')]).as('version_id'),
      ])
      .where('project_id', '=', projectId)
      .execute(),
    db.selectFrom('proposal_batches').select(['id', 'kind', 'run_id', 'created_at', 'shown_at', 'resolved_at']).where('project_id', '=', projectId).execute(),
    db.selectFrom('ai_runs').select(['id', 'action', 'scope', 'usage']).where('project_id', '=', projectId).execute(),
    db
      .selectFrom('record_versions')
      .select((eb) => ['id', 'record_id', eb.fn<string | null>('jsonb_extract_path_text', ['origin', eb.val('id')]).as('proposal_id')])
      .where('project_id', '=', projectId)
      .execute(),
    db.selectFrom('records').select(['id', 'code', 'type']).where('project_id', '=', projectId).execute(),
    db.selectFrom('version_answers').select(['record_version_id', 'question_id']).where('project_id', '=', projectId).execute(),
    db.selectFrom('events').select(['at', 'entity_id']).where('project_id', '=', projectId).where('actor', 'like', 'human:%').execute(),
  ]);
  return { stages, questions, confirms, proposals, batches, runs, versions, records, answers, humanEvents } as unknown as AttentionFacts;
}

/** Every question id named by a proposal's `sources` (the definition cites the answers it folds in). */
function citedQuestions(sources: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Json;
      if (typeof o.question_id === 'string') out.push(o.question_id);
      Object.values(o).forEach((x) => (typeof x === 'object' ? walk(x) : undefined));
    }
  };
  walk(typeof sources === 'string' ? asObject(sources) : sources);
  return out;
}

/** Pure core: attention and cost per stage from the loaded facts. */
export function attentionOf(f: AttentionFacts): Attention {
  const stageById = new Map(f.stages.map((s) => [s.id, STAGE_OF_STAGE[s.stage] ?? ('other' as AttentionStage)]));
  const stageByExploration = new Map(f.stages.map((s) => [s.exploration_id, STAGE_OF_STAGE[s.stage] ?? ('other' as AttentionStage)]));
  const recordById = new Map(f.records.map((r) => [r.id, r]));
  const typeByCode = new Map(f.records.map((r) => [r.code, r.type]));
  const batchById = new Map(f.batches.map((b) => [b.id, b]));

  const proposalStage = (p: AttentionFacts['proposals'][number]): AttentionStage => {
    if (batchById.get(p.batch_id)?.kind === 'knowledge') return 'knowledge';
    if (p.type === 'design_record') return stageOfRecordType(p.record_type);
    if (p.type === 'record_change') return stageOfRecordType(p.code ? typeByCode.get(p.code) : null);
    return STAGE_OF_PROPOSAL_TYPE[p.type] ?? 'other';
  };
  const stageOfProposal = new Map(f.proposals.map((p) => [p.id, proposalStage(p)]));
  const itemsOfBatch = new Map<string, AttentionFacts['proposals']>();
  for (const p of f.proposals) itemsOfBatch.set(p.batch_id, [...(itemsOfBatch.get(p.batch_id) ?? []), p]);
  const stageOfBatch = new Map<string, AttentionStage>();
  for (const [id, items] of itemsOfBatch) stageOfBatch.set(id, stageOfProposal.get([...items].sort((a, b) => a.position - b.position)[0]!.id)!);

  // Versions: the proposal that created each, hence its batch, hence its run (the provenance chain, §5).
  const proposalById = new Map(f.proposals.map((p) => [p.id, p]));
  const stageOfVersion = new Map<string, AttentionStage>();
  const versionsOfRun = new Map<string, string[]>();
  for (const v of f.versions) {
    const rec = recordById.get(v.record_id);
    const p = v.proposal_id ? proposalById.get(v.proposal_id) : undefined;
    stageOfVersion.set(v.id, rec ? stageOfRecordType(rec.type) : p ? stageOfProposal.get(p.id)! : 'other');
    const runId = p ? batchById.get(p.batch_id)?.run_id : null;
    if (runId) versionsOfRun.set(runId, [...(versionsOfRun.get(runId) ?? []), v.id]);
  }

  // Per stage accumulators.
  const acc = new Map<AttentionStage, { answer: number[]; decide: number[]; perItem: number[]; shown: number; own: StageAttention }>();
  for (const s of STAGES) {
    acc.set(s, {
      answer: [],
      decide: [],
      perItem: [],
      shown: 0,
      own: {
        stage: s,
        questions: { raised: 0, answered: 0, discarded: 0, pending: 0, led_to_version: 0, led_to_version_proxy: 0, seconds_to_answer: statOf([]) },
        proposals: { accepted: 0, rejected: 0, edited: 0, pending: 0, superseded: 0, seconds_to_decide: statOf([]) },
        batches: { resolved: 0, whole_accepted: 0, timed: 0, timed_from_shown: 0, seconds_per_item: statOf([]) },
        cost: { runs: 0, runs_without_usage: 0, input_tokens: 0, output_tokens: 0, usd: 0, artefacts: 0, tokens_per_artefact: null, usd_per_artefact: null },
        person_minutes_proxy: 0,
      },
    });
  }
  const of = (s: AttentionStage) => acc.get(s)!;

  // Questions.
  const confirmAt = new Map<string, number>();
  for (const c of f.confirms) if (!confirmAt.has(c.entity_id)) confirmAt.set(c.entity_id, ms(c.at));
  const citedByAccepted = new Set<string>();
  for (const p of f.proposals) if (p.state === 'accepted' || p.state === 'accepted_edited') citedQuestions(p.sources).forEach((q) => citedByAccepted.add(q));
  const answeredByVersion = new Set(f.answers.map((a) => a.question_id));
  // The §5 proxy: runs of an exploration whose batch produced an accepted version.
  const productiveRunAt = new Map<string, number[]>();
  const runById = new Map(f.runs.map((r) => [r.id, r]));
  for (const b of f.batches) {
    if (!b.run_id) continue;
    const productive = (itemsOfBatch.get(b.id) ?? []).some((p) => (p.state === 'accepted' || p.state === 'accepted_edited') && p.version_id);
    const run = runById.get(b.run_id);
    const explorationId = run ? (asObject(run.scope).id as string | undefined) : undefined;
    if (productive && explorationId) productiveRunAt.set(explorationId, [...(productiveRunAt.get(explorationId) ?? []), ms(b.created_at)]);
  }
  const stageOfQuestion = new Map<string, AttentionStage>();
  for (const q of f.questions) {
    const stage = (q.stage_id ? stageById.get(q.stage_id) : undefined) ?? stageByExploration.get(q.exploration_id) ?? 'other';
    stageOfQuestion.set(q.id, stage);
    const a = of(stage);
    a.own.questions.raised += 1;
    if (q.state === 'confirmed') {
      a.own.questions.answered += 1;
      if (answeredByVersion.has(q.id) || citedByAccepted.has(q.id)) a.own.questions.led_to_version += 1;
      const at = confirmAt.get(q.id);
      if (at !== undefined && (productiveRunAt.get(q.exploration_id) ?? []).some((t) => t >= at)) a.own.questions.led_to_version_proxy += 1;
      if (at !== undefined && q.shown_at) a.answer.push((at - ms(q.shown_at)) / 1000);
    } else if (q.state === 'discarded') a.own.questions.discarded += 1;
    else a.own.questions.pending += 1;
  }

  // Proposals and batches.
  for (const p of f.proposals) {
    const a = of(stageOfProposal.get(p.id)!);
    if (p.state === 'accepted') a.own.proposals.accepted += 1;
    else if (p.state === 'accepted_edited') {
      a.own.proposals.accepted += 1;
      a.own.proposals.edited += 1;
    } else if (p.state === 'rejected') a.own.proposals.rejected += 1;
    else if (p.state === 'superseded') a.own.proposals.superseded += 1;
    else a.own.proposals.pending += 1;
    if (p.resolved_at && (p.state === 'accepted' || p.state === 'accepted_edited' || p.state === 'rejected')) a.decide.push((ms(p.resolved_at) - ms(p.created_at)) / 1000);
  }
  for (const b of f.batches) {
    const items = itemsOfBatch.get(b.id) ?? [];
    if (items.length === 0 || !b.resolved_at) continue;
    const a = of(stageOfBatch.get(b.id)!);
    a.own.batches.resolved += 1;
    if (items.length >= WHOLE_BATCH_MIN_ITEMS && items.every((p) => p.state === 'accepted')) a.own.batches.whole_accepted += 1;
    if (items.length >= 2) {
      const from = b.shown_at ? ms(b.shown_at) : ms(b.created_at);
      a.own.batches.timed += 1;
      if (b.shown_at) a.own.batches.timed_from_shown += 1;
      a.perItem.push((ms(b.resolved_at) - from) / 1000 / items.length);
    }
  }

  // Cost: a run belongs to the stage of its batch, else of the stage whose thread it answered in, else `other`.
  const batchStageOfRun = new Map<string, AttentionStage>();
  for (const b of f.batches) if (b.run_id && stageOfBatch.has(b.id) && !batchStageOfRun.has(b.run_id)) batchStageOfRun.set(b.run_id, stageOfBatch.get(b.id)!);
  for (const r of f.runs) {
    const stage = batchStageOfRun.get(r.id) ?? stageByExploration.get(asObject(r.scope).id as string) ?? 'other';
    const a = of(stage).own.cost;
    const u = usageOf(r.usage);
    a.runs += 1;
    if (!u.declared) a.runs_without_usage += 1;
    a.input_tokens += u.input;
    a.output_tokens += u.output;
    a.usd += u.usd;
  }
  for (const v of stageOfVersion) of(v[1]).own.cost.artefacts += 1;

  // Person minutes per stage: the stage of the entity an event touched.
  const stageOfEntity = new Map<string, AttentionStage>([...stageOfQuestion, ...stageOfProposal, ...stageOfBatch, ...stageOfVersion]);
  const byStage = new Map<AttentionStage, number[]>();
  for (const e of f.humanEvents) {
    const s = stageOfEntity.get(e.entity_id) ?? 'other';
    byStage.set(s, [...(byStage.get(s) ?? []), ms(e.at)]);
  }

  const stages = STAGES.map((s) => {
    const a = of(s);
    const own = a.own;
    own.questions.seconds_to_answer = statOf(a.answer);
    own.proposals.seconds_to_decide = statOf(a.decide);
    own.batches.seconds_per_item = statOf(a.perItem);
    const tokens = own.cost.input_tokens + own.cost.output_tokens;
    own.cost.tokens_per_artefact = own.cost.artefacts > 0 ? Math.round(tokens / own.cost.artefacts) : null;
    own.cost.usd_per_artefact = own.cost.artefacts > 0 ? Math.round((own.cost.usd / own.cost.artefacts) * 1e4) / 1e4 : null;
    own.cost.usd = Math.round(own.cost.usd * 1e4) / 1e4;
    own.person_minutes_proxy = personMinutesOf(byStage.get(s) ?? []).buckets_minutes;
    return own;
  });
  const total = personMinutesOf(f.humanEvents.map((e) => ms(e.at)));
  return {
    stages,
    person: { basis: CONVENTION, bucket_minutes: BUCKET_MINUTES, session_gap_minutes: SESSION_GAP_MINUTES, ...total },
    conventions: {
      stage_mapping: `${CONVENTION}: questions by the stage that raised them; proposals by the record type they create (ADR counts as architecture); definition proposals fold principles and quality`,
      whole_batch: `${CONVENTION}: at least ${WHOLE_BATCH_MIN_ITEMS} items, all accepted, none edited`,
      seconds_per_item: `${CONVENTION}: resolved batches with at least 2 items; from shown_at when the batch was shown, else from creation`,
      person_minutes: `${CONVENTION}: ${BUCKET_MINUTES}-minute buckets with a human event, times ${BUCKET_MINUTES}; a lower bound`,
      cost_per_artefact: `${CONVENTION}: the whole cost of the stage's runs (rejected batches included) over the versions its proposals produced`,
    },
  };
}

/** Attention and cost per stage for a project. */
export async function attentionByStage(db: Db, projectId: string): Promise<Attention> {
  return attentionOf(await loadFacts(db, projectId));
}

// ---- «¿merece la pena?» (§10) ----

export type WorthIt = {
  value: {
    merged_tasks: number;
    criteria_verified: number;
    records_approved: Record<string, number>;
    records_approved_total: number;
  };
  cost: {
    design: { tokens: number; usd: number; runs: number; runs_without_usage: number };
    reviewer: { tokens: number; usd: number; runs: number; runs_without_usage: number };
    builder: { tokens: number; usd: number; steps: number; steps_without_usage: number };
    tokens: number;
    usd: number;
    ci: { runs: number; minutes: number };
    person_minutes: PersonMinutes;
    /** The count of DEMIURGO patches cannot be derived per project (it is `git log v2.2..v2.3`): pass it in. */
    patches: { count: number | null; source: 'parameter' | 'not_derivable' };
  };
  /** Cost over value; null when the denominator is 0 or the cost side is not known (patches without a count). */
  units: {
    tokens_per_merged_task: number | null;
    usd_per_merged_task: number | null;
    usd_per_verified_criterion: number | null;
    person_minutes_per_merged_task: number | null;
    patches_per_merged_task: number | null;
  };
  conventions: Record<string, string>;
};

const ratio = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 100) / 100 : null);

/** Minutes of CI from the build steps: each `started` to the next decisive `ok`/`failed` of the same attempt. */
export function ciOf(steps: readonly { build_request_id: string; attempt: number; outcome: string; created_at: unknown }[]): { runs: number; minutes: number } {
  const byAttempt = new Map<string, typeof steps[number][]>();
  for (const s of steps) byAttempt.set(`${s.build_request_id}:${s.attempt}`, [...(byAttempt.get(`${s.build_request_id}:${s.attempt}`) ?? []), s]);
  let runs = 0;
  let totalMs = 0;
  for (const list of byAttempt.values()) {
    list.sort((a, b) => ms(a.created_at) - ms(b.created_at));
    let startedAt: number | null = null;
    for (const s of list) {
      if (s.outcome === 'started') startedAt ??= ms(s.created_at);
      else if (s.outcome === 'ok' || s.outcome === 'failed') {
        runs += 1;
        if (startedAt !== null) totalMs += Math.max(0, ms(s.created_at) - startedAt);
        startedAt = null;
      }
    }
  }
  return { runs, minutes: Math.round(totalMs / 60_000) };
}

/** Value delivered against total cost for a project. `opts.patches` is the DEMIURGO patch count, given by the caller. */
export async function worthIt(db: Db, projectId: string, opts: { patches?: number | null } = {}): Promise<WorthIt> {
  const [merged, evidence, versions, runs, builderSteps, ciSteps, humanEvents] = await Promise.all([
    db.selectFrom('build_requests').select('task_id').where('project_id', '=', projectId).where('state', '=', 'done').execute(),
    db
      .selectFrom('evidence')
      .select(['criterion_id', 'kind', 'result', 'created_at', 'id'])
      .where('project_id', '=', projectId)
      .orderBy('created_at')
      .orderBy('id')
      .execute(),
    db
      .selectFrom('record_versions as v')
      .innerJoin('records as r', 'r.id', 'v.record_id')
      .select(['v.record_id', 'r.type'])
      .where('v.project_id', '=', projectId)
      .where('v.state', 'in', ['approved', 'superseded'])
      .execute(),
    db.selectFrom('ai_runs').select(['action', 'usage']).where('project_id', '=', projectId).execute(),
    db.selectFrom('build_steps').select(['detail']).where('project_id', '=', projectId).where('stage', '=', 'builder').where('outcome', 'in', ['ok', 'failed']).execute(),
    db.selectFrom('build_steps').select(['build_request_id', 'attempt', 'outcome', 'created_at']).where('project_id', '=', projectId).where('stage', '=', 'ci').execute(),
    db.selectFrom('events').select('at').where('project_id', '=', projectId).where('actor', 'like', 'human:%').execute(),
  ]);

  const mergedTasks = new Set(merged.map((m) => m.task_id)).size;
  const latest = new Map<string, { kind: string; result: string | null }>();
  for (const e of evidence) latest.set(e.criterion_id, { kind: e.kind, result: e.result });
  const criteriaVerified = [...latest.values()].filter((e) => e.kind === 'manual' || e.result === 'pass').length;
  const approvedRecords = new Map<string, Set<string>>();
  for (const v of versions) approvedRecords.set(v.type, (approvedRecords.get(v.type) ?? new Set()).add(v.record_id));
  const recordsApproved: Record<string, number> = {};
  for (const [type, ids] of approvedRecords) recordsApproved[type] = ids.size;
  const recordsTotal = Object.values(recordsApproved).reduce((a, b) => a + b, 0);

  const side = { tokens: 0, usd: 0, runs: 0, runs_without_usage: 0 };
  const design = { ...side };
  const reviewer = { ...side };
  for (const r of runs) {
    const u = usageOf(r.usage);
    const s = r.action === 'pr_review' ? reviewer : design;
    s.runs += 1;
    if (!u.declared) s.runs_without_usage += 1;
    s.tokens += u.input + u.output;
    s.usd += u.usd;
  }
  const builder = { tokens: 0, usd: 0, steps: 0, steps_without_usage: 0 };
  for (const b of builderSteps) {
    const u = usageOf(asObject(b.detail).usage);
    builder.steps += 1;
    if (!u.declared) builder.steps_without_usage += 1;
    builder.tokens += u.input + u.output;
    builder.usd += u.usd;
  }
  const round = (n: number) => Math.round(n * 1e4) / 1e4;
  design.usd = round(design.usd);
  reviewer.usd = round(reviewer.usd);
  builder.usd = round(builder.usd);
  const tokens = design.tokens + reviewer.tokens + builder.tokens;
  const usd = round(design.usd + reviewer.usd + builder.usd);
  const person = { basis: CONVENTION, bucket_minutes: BUCKET_MINUTES, session_gap_minutes: SESSION_GAP_MINUTES, ...personMinutesOf(humanEvents.map((e) => ms(e.at))) };
  const patches = opts.patches ?? null;

  return {
    value: { merged_tasks: mergedTasks, criteria_verified: criteriaVerified, records_approved: recordsApproved, records_approved_total: recordsTotal },
    cost: {
      design,
      reviewer,
      builder,
      tokens,
      usd,
      ci: ciOf(ciSteps),
      person_minutes: person,
      patches: { count: patches, source: patches === null ? 'not_derivable' : 'parameter' },
    },
    units: {
      tokens_per_merged_task: ratio(tokens, mergedTasks),
      usd_per_merged_task: ratio(usd, mergedTasks),
      usd_per_verified_criterion: ratio(usd, criteriaVerified),
      person_minutes_per_merged_task: ratio(person.buckets_minutes, mergedTasks),
      patches_per_merged_task: patches === null ? null : ratio(patches, mergedTasks),
    },
    conventions: {
      units: `${CONVENTION}: unit economics (FinOps: total attributed cost over units delivered); the unit «verified criterion» is ours`,
      person_minutes: `${CONVENTION}: ${BUCKET_MINUTES}-minute buckets with a human event, times ${BUCKET_MINUTES}; a lower bound`,
      ci_minutes: 'from the timestamps of the ci steps (a 5 s poll), queue and run together',
      patches: 'git log v2.2..v2.3 counts patches to DEMIURGO itself; it has no project id, so the caller supplies it',
    },
  };
}
