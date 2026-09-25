// Product views (FDR-INT-002): the map (records by area with their typed relations, the open
// questions that wait on the person, the parked ideas) and the journeys (one per feature, from its
// Behavior and its criteria, with the open questions of its thread as gaps). Everything comes from
// what the records say; nothing is inferred.

import { type Relation, areaOrder, behaviorSteps, criterionPath, relationOf } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import { productState } from './read.ts';

const OPEN = ['pending', 'postponed', 'inferred'];

type Row = Awaited<ReturnType<typeof productState>>['designs'][number];

async function openQuestions(db: Db, projectId: string, explorations: string[]) {
  if (explorations.length === 0) return [];
  return db
    .selectFrom('questions')
    .select(['id', 'exploration_id', 'question', 'state', 'impact', 'conclusion'])
    .where('project_id', '=', projectId)
    .where('exploration_id', 'in', explorations)
    .where('state', 'in', OPEN)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
}

/** The version a view shows of a record: the current one, or the latest if none is approved yet. */
const shownId = (r: Row): string => r.current_id ?? r.latest_id;

export async function productMap(db: Db, projectId: string) {
  const state = await productState(db, projectId);
  const rows: Row[] = [...state.designs, ...state.decisions];
  const byVersion = new Map(rows.map((r) => [shownId(r), r]));
  const links =
    byVersion.size === 0
      ? []
      : await db
          .selectFrom('links')
          .innerJoin('record_versions as target', 'target.id', 'links.to_id')
          .innerJoin('records as rd', 'rd.id', 'target.record_id')
          .select(['links.type', 'links.from_id', 'links.state', 'rd.code as to_code', 'rd.type as to_type'])
          .where('links.project_id', '=', projectId)
          .where('links.from_id', 'in', [...byVersion.keys()])
          .orderBy('links.id')
          .execute();
  const relations: { from: string; to: string; kind: Relation; link: string; under_review: boolean }[] = [];
  for (const l of links) {
    const from = byVersion.get(l.from_id);
    if (!from || from.code === l.to_code) continue;
    const kind = relationOf(l.type, from.type, l.to_type);
    if (kind) relations.push({ from: from.code, to: l.to_code, kind, link: l.type, under_review: l.state === 'needs_review' });
  }
  const threads = [...new Set(rows.map((r) => r.origin_exploration).filter((x): x is string => !!x))];
  const questions = (await openQuestions(db, projectId, threads)).map((q) => ({
    ...q,
    affects: rows.filter((r) => r.origin_exploration === q.exploration_id).map((r) => r.code),
  }));
  const ideas = state.explorations.filter((e) => e.state === 'set_aside').map((e) => ({ id: e.id, purpose: e.purpose }));
  // The domain always exists; the taxonomy may not.
  return { project: state.project, areas: areaOrder(rows), records: rows, relations, questions, ideas };
}

export async function productJourneys(db: Db, projectId: string) {
  const state = await productState(db, projectId);
  const features = state.designs.filter((r) => r.type === 'fdr');
  const threads = [...new Set(features.map((r) => r.origin_exploration).filter((x): x is string => !!x))];
  const questions = await openQuestions(db, projectId, threads);
  const journeys = [];
  for (const f of features) {
    const version = await db
      .selectFrom('record_versions')
      .select(['id', 'n', 'sections'])
      .where('id', '=', shownId(f))
      .executeTakeFirstOrThrow();
    const behavior = (version.sections as { title: string; content: string }[]).find((s) => s.title === 'Behavior');
    const steps = behavior ? behaviorSteps(behavior.content) : [];
    if (steps.length === 0) continue;
    const criteria = await db
      .selectFrom('criteria')
      .select(['code', 'title', 'statement', 'verification'])
      .where('record_version_id', '=', version.id)
      .orderBy('position')
      .execute();
    const gaps = questions.filter((q) => q.exploration_id === f.origin_exploration);
    journeys.push({
      code: f.code,
      title: f.title,
      version: version.n,
      epistemic_status: f.epistemic_status,
      readiness: f.readiness,
      origin_exploration: f.origin_exploration,
      steps,
      paths: criteria.map((c) => ({ code: c.code, title: c.title, verification: c.verification, ...criterionPath(c.statement) })),
      gaps: gaps.map((q) => ({
        id: q.id,
        question: q.question,
        state: q.state,
        impact: q.impact,
        exploration_id: q.exploration_id,
      })),
    });
  }
  return { project: state.project, journeys };
}
