// Screen designs (SCR): what the approved design system offers, the screen design of a feature, and the
// checks that need the database (the feature's step count, the components the system lacks).

import {
  DomainError,
  type ScreenDesignSpec,
  behaviorSteps,
  designSystemSpec,
  missingComponents,
  screenDesignProblems,
  screenDesignSpec,
} from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';

/**
 * A design system version's machine-readable spec: its own, or, when that version was made from text
 * alone (an older record_change did not carry it), the most recent earlier version's that has one.
 */
export async function designSystemSpecOf(db: Db, recordId: string, n: number, own: unknown): Promise<unknown> {
  if (own) return own;
  const earlier = await db
    .selectFrom('record_versions')
    .select('spec')
    .where('record_id', '=', recordId)
    .where('n', '<', n)
    .where('state', '<>', 'discarded')
    .where('spec', 'is not', null)
    .orderBy('n', 'desc')
    .executeTakeFirst();
  return earlier?.spec ?? null;
}

/** The project's approved design system: its code, version and component names; null without one. */
export async function approvedDesignSystem(db: Db, projectId: string): Promise<{ code: string; version: number; components: string[] } | null> {
  const row = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.code', 'record_versions.n', 'record_versions.record_id', 'record_versions.spec'])
    .where('records.project_id', '=', projectId)
    .where('records.type', '=', 'design_system')
    .where('record_versions.state', '=', 'approved')
    .orderBy('record_versions.n', 'desc')
    .executeTakeFirst();
  if (!row) return null;
  const parsed = designSystemSpec.safeParse(await designSystemSpecOf(db, row.record_id, row.n, row.spec));
  return { code: row.code, version: row.n, components: parsed.success ? parsed.data.components.map((c) => c.name) : [] };
}

/** The feature version a screen design would rest on: its step count, or the reason it cannot. */
export async function featureStepsOf(db: Db, projectId: string, code: string, version: number): Promise<number> {
  const v = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['record_versions.sections', 'record_versions.state'])
    .where('records.project_id', '=', projectId)
    .where('records.code', '=', code)
    .where('records.type', '=', 'fdr')
    .where('record_versions.n', '=', version)
    .executeTakeFirst();
  if (!v) throw new DomainError('not_found', `There is no feature ${code} v${version}.`);
  const behavior = (v.sections as { title: string; content: string }[]).find((s) => s.title === 'Behavior')?.content ?? '';
  return behaviorSteps(behavior).length;
}

/** Blocking problems of a screen design against the feature version it rests on (empty when it is fine). */
export async function screenDesignChecks(db: Db, projectId: string, spec: ScreenDesignSpec): Promise<string[]> {
  const steps = await featureStepsOf(db, projectId, spec.feature.code, spec.feature.version);
  return screenDesignProblems(spec, steps);
}

export type FeatureScreens = {
  code: string;
  version: number;
  state: string;
  no_ui: boolean;
  screen_count: number;
  spec: ScreenDesignSpec | null;
};

/**
 * The screen design based on a feature version: the newest version of an SCR with a `based_on` link to
 * it. `approvedOnly` keeps to the approved ones (what planning tasks needs).
 */
export async function screensOfFeatureVersion(
  db: Db,
  projectId: string,
  feature: { code: string; version: number },
  approvedOnly = false,
): Promise<FeatureScreens | null> {
  const q = db
    .selectFrom('links')
    .innerJoin('record_versions as sv', 'sv.id', 'links.from_id')
    .innerJoin('records as s', 's.id', 'sv.record_id')
    .innerJoin('record_versions as fv', 'fv.id', 'links.to_id')
    .innerJoin('records as f', 'f.id', 'fv.record_id')
    .select(['s.code', 'sv.n', 'sv.state', 'sv.spec'])
    .where('links.type', '=', 'based_on')
    .where('s.project_id', '=', projectId)
    .where('s.type', '=', 'screen_design')
    .where('f.code', '=', feature.code)
    .where('fv.n', '=', feature.version)
    .where('sv.state', 'in', approvedOnly ? ['approved'] : ['draft', 'approved'])
    .orderBy('sv.n', 'desc');
  const row = await q.executeTakeFirst();
  if (!row) return null;
  const parsed = screenDesignSpec.safeParse(row.spec);
  const spec = parsed.success ? parsed.data : null;
  return { code: row.code, version: row.n, state: row.state, no_ui: !!spec?.no_ui, screen_count: spec?.screens.length ?? 0, spec };
}

/** The components a screen design uses that the approved design system lacks (all of them when there is none). */
export function missingIn(spec: ScreenDesignSpec | null, dsy: { components: string[] } | null): string[] {
  return spec ? missingComponents(spec, dsy?.components ?? []) : [];
}
