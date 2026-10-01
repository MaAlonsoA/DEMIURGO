// Jev's warnings on a task's criteria as the pages read them (H97): the latest opinion of each
// criterion the task covers, turned into a warning by the policy in code. Only while Jev is on:
// without the key there are no warnings, even if some were stored before.

import { jevAllowed } from '../classifier/aspect.ts';
import { type NeedsKind, type TestabilityVerdict, isNeedsKind, testabilityStrength, testabilityVerdict } from '../classifier/testability-policy.ts';
import type { Db } from '../db/connection.ts';
import { loadTaskDependencies } from './task-deps.ts';

/** `needs`: what Jev's Choice says checking it needs (null in opinions stored before the Choice existed). */
export type TestabilityFlag = { code: string; kind: Exclude<TestabilityVerdict, 'ok'>; probability: number; needs: NeedsKind | null };

/** The flagged criteria of each task (by record id); tasks with none are absent from the map. */
export async function testabilityFlagsOf(db: Db, recordIds: readonly string[]): Promise<Map<string, TestabilityFlag[]>> {
  const out = new Map<string, TestabilityFlag[]>();
  if (!jevAllowed() || recordIds.length === 0) return out;
  const rows = await db
    .selectFrom('task_testability_opinions')
    .select(['record_id', 'criterion_code', 'needs_outside_ci', 'needs_unbuilt_feature', 'needs_kind'])
    .where('record_id', 'in', [...recordIds])
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  // A task whose plan already declares what it waits for is ordered by the engine (H87): Jev's "needs an
  // unbuilt feature" adds nothing there. It is only worth a warning when no dependency is declared.
  const owners = await db.selectFrom('records').select(['id', 'code', 'project_id']).where('id', 'in', [...recordIds]).execute();
  const declared = new Set<string>();
  for (const projectId of new Set(owners.map((o) => o.project_id))) {
    const index = await loadTaskDependencies(db, projectId);
    for (const o of owners) {
      if (o.project_id !== projectId) continue;
      if ((index.tasks.get(o.code) ?? []).length > 0 || (index.features.get(o.code) ?? []).length > 0) declared.add(o.id);
    }
  }
  // A criterion since moved to `manual` or `release` is checked by a person or at release, not in CI: no flag,
  // even if Jev judged it while it was automatic. The newest version of the criterion decides.
  const codes = [...new Set(rows.map((r) => r.criterion_code))];
  const kinds = new Map<string, string>();
  if (codes.length > 0) {
    const latest = await db
      .selectFrom('criteria')
      .innerJoin('record_versions', 'record_versions.id', 'criteria.record_version_id')
      .select(['criteria.project_id', 'criteria.code', 'criteria.verification'])
      .where('criteria.code', 'in', codes)
      .orderBy('record_versions.n', 'asc')
      .execute();
    for (const c of latest) kinds.set(`${c.project_id}/${c.code}`, c.verification);
  }
  const projectOf = new Map(owners.map((o) => [o.id, o.project_id]));
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.record_id}/${r.criterion_code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const verification = kinds.get(`${projectOf.get(r.record_id)}/${r.criterion_code}`);
    if (verification === 'manual' || verification === 'release') continue;
    const p = { needs_outside_ci: r.needs_outside_ci, needs_unbuilt_feature: r.needs_unbuilt_feature };
    const kind = testabilityVerdict(p);
    if (kind === 'ok' || (kind === 'waits_for_feature' && declared.has(r.record_id))) continue;
    // «Needs an unbuilt feature» holds the task only when Jev's Choice agrees on what it needs (an unbuilt part):
    // the Noul alone, or an opinion stored before the Choice existed, gave false holds (TSK-PRO-013: the goal
    // history, the workouts and the fixed clock all existed). Our convention: two independent judgments must agree.
    if (kind === 'waits_for_feature' && r.needs_kind !== 'needs_unbuilt_part') continue;
    const list = out.get(r.record_id) ?? [];
    list.push({ code: r.criterion_code, kind, probability: Math.round(testabilityStrength(p, kind) * 100) / 100, needs: isNeedsKind(r.needs_kind) ? r.needs_kind : null });
    out.set(r.record_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.code.localeCompare(b.code));
  return out;
}

/**
 * Jev's warnings on the automatic criteria of a feature version, judged while it was drafted. Same policy and
 * thresholds as for tasks (including «unbuilt feature» needing the Choice to agree); there is no declared-dependency
 * filter because a feature's needs are not a plan yet. Information for the person approving; nothing is blocked.
 */
export async function featureVersionFlags(db: Db, versionId: string): Promise<TestabilityFlag[]> {
  if (!jevAllowed()) return [];
  const rows = await db
    .selectFrom('task_testability_opinions')
    .select(['criterion_code', 'needs_outside_ci', 'needs_unbuilt_feature', 'needs_kind'])
    .where('record_version_id', '=', versionId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  if (rows.length === 0) return [];
  // Only criteria that are still automatic in this version are in CI's scope.
  const automatic = new Set(
    (await db.selectFrom('criteria').select(['code', 'verification']).where('record_version_id', '=', versionId).execute())
      .filter((c) => c.verification === 'automatic')
      .map((c) => c.code),
  );
  const out: TestabilityFlag[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.criterion_code)) continue;
    seen.add(r.criterion_code);
    if (!automatic.has(r.criterion_code)) continue;
    const p = { needs_outside_ci: r.needs_outside_ci, needs_unbuilt_feature: r.needs_unbuilt_feature };
    const kind = testabilityVerdict(p);
    if (kind === 'ok' || (kind === 'waits_for_feature' && r.needs_kind !== 'needs_unbuilt_part')) continue;
    out.push({ code: r.criterion_code, kind, probability: Math.round(testabilityStrength(p, kind) * 100) / 100, needs: isNeedsKind(r.needs_kind) ? r.needs_kind : null });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}
