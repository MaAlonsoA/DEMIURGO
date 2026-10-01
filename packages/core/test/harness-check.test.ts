// The periodic check of the harness (salud-del-harness §8): regressions against the previous check (a verdict that
// worsens, a containment drop, a cost per merged task up by more than 25 %), no repeat with the same inputs, the
// cadence (24 hours or 5 merged tasks) and one issue per regression, never a second while one is open.

import { human } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { containmentOf, dueCheck, regressionsOf, runCheck, type CheckSnapshot } from '../src/harness/check.ts';
import { PIECE_NAMES, pieceLabel } from '../src/harness/pieces.ts';
import type { FindingClass } from '../src/queries/harness-health.ts';
import { useEnvironment } from './support/env.ts';

const snap = (over: Partial<CheckSnapshot> = {}): CheckSnapshot => ({ verdicts: {}, pce: {}, units: { usd_per_merged_task: null, tokens_per_merged_task: null }, ...over });

describe('regressions (pure)', () => {
  it('has none without a previous check', () => {
    expect(regressionsOf(null, snap({ verdicts: { B01: 'hurts' } }))).toEqual([]);
  });

  it('flags a verdict that worsens and ignores improvements and «no data»', () => {
    const before = snap({ verdicts: { B01: 'helps', B02: 'neutral', B03: 'hurts', B04: 'helps', B05: 'no_data' } });
    const after = snap({ verdicts: { B01: 'neutral', B02: 'hurts', B03: 'helps', B04: 'no_data', B05: 'hurts' } });
    expect(regressionsOf(before, after)).toEqual([
      { kind: 'verdict_worse', piece: 'B01', before: 'helps', after: 'neutral', threshold: null },
      { kind: 'verdict_worse', piece: 'B02', before: 'neutral', after: 'hurts', threshold: null },
    ]);
  });

  it('flags a containment drop of more than 0.2 from at least 5 items, not smaller or thinner ones', () => {
    const before = snap({ pce: { P5: { pce: 0.8, items: 10 }, P7: { pce: 0.8, items: 10 }, P9: { pce: 0.8, items: 10 } } });
    const after = snap({ pce: { P5: { pce: 0.5, items: 10 }, P7: { pce: 0.7, items: 10 }, P9: { pce: 0.1, items: 4 } } });
    expect(regressionsOf(before, after)).toEqual([{ kind: 'containment_drop', phase: 'P5', before: 0.8, after: 0.5, threshold: 0.2 }]);
  });

  it('flags a cost per merged task up by more than 25 %, and exactly 25 % does not count', () => {
    const before = snap({ units: { usd_per_merged_task: 1, tokens_per_merged_task: 1000 } });
    expect(regressionsOf(before, snap({ units: { usd_per_merged_task: 1.26, tokens_per_merged_task: 1250 } }))).toEqual([
      { kind: 'cost_per_task_up', unit: 'usd_per_merged_task', before: 1, after: 1.26, threshold: 0.25 },
    ]);
    expect(regressionsOf(snap({ units: { usd_per_merged_task: null, tokens_per_merged_task: null } }), snap({ units: { usd_per_merged_task: 9, tokens_per_merged_task: 9 } }))).toEqual([]);
  });

  it('counts a phase as contained when the error was found in the phase that introduced it', () => {
    expect(
      containmentOf([
        { introduced_phase: 'P5', found_phase: 'P5' },
        { introduced_phase: 'P5', found_phase: 'P10' },
        { introduced_phase: 'P7', found_phase: 'P9' },
      ]),
    ).toEqual([
      { phase: 'P5', contained: 1, escaped: 1, pce: 0.5 },
      { phase: 'P7', contained: 0, escaped: 1, pce: 0 },
    ]);
  });
});

describe('piece names', () => {
  it('names every piece of the inventory', () => {
    const codes = [...Array.from({ length: 27 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 12 }, (_, i) => `D${String(i + 1).padStart(2, '0')}`)];
    expect(Object.keys(PIECE_NAMES).sort()).toEqual(codes.sort());
    expect(pieceLabel('B03')).toBe('B03 · Queue: hotspots and modules');
    expect(pieceLabel('B99')).toBe('B99');
  });
});

describe('the check over stored data', () => {
  const environment = useEnvironment();
  const ana = human('ana');

  async function project(name: string) {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name } });
    const made = await executeCommand(s, {
      command: 'record.create',
      actor: ana,
      projectId,
      data: {
        type: 'fdr',
        domain: 'chk',
        title: `Feature ${name}`,
        sections: [
          { title: 'Goal', content: 'A goal.' },
          { title: 'Scope', content: 'Scope.' },
          { title: 'Out of scope', content: 'Nothing.' },
          { title: 'Behavior', content: '1. It works.' },
        ],
        criteria: [{ carry: 'new', title: 'One', statement: 'Given a, when b, then c.', verification: 'automatic', check: 'A test.' }],
      },
    });
    const request = async (state: 'requested' | 'done' = 'requested', doneAt?: Date) =>
      (
        await s.db
          .insertInto('build_requests')
          .values({ project_id: projectId, task_id: made.entityId, task_version_id: (made.result as { versionId: string }).versionId, feature_version_id: null, brief: 'b', requested_by: 'human:ana', ...(state === 'done' ? { state, done_by: 'human:ana', done_at: doneAt ?? new Date() } : {}) })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    return { projectId, request };
  }

  let seq = 0;
  async function postmortem(projectId: string, requestId: string, findings: { piece: string; class: FindingClass; n: number }[]) {
    const s = environment().services;
    const total = findings.reduce((a, f) => a + f.n, 0);
    const pm = await s.db
      .insertInto('harness_postmortems')
      .values({ project_id: projectId, build_request_id: requestId, rules_version: 'pm-1', inputs_hash: `h${++seq}`, attempts: 1, outcome: 'merged', findings: total })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const f of findings) {
      for (let i = 0; i < f.n; i++) {
        await s.db
          .insertInto('harness_findings')
          .values({ project_id: projectId, postmortem_id: pm.id, build_request_id: requestId, attempt: 1, piece: f.piece, finding: `${f.piece}.x`, class: f.class, evidence: JSON.stringify({}) })
          .execute();
      }
    }
    await new Promise((r) => setTimeout(r, 5));
  }

  const issuesOf = (projectId: string) => environment().services.db.selectFrom('issues').selectAll().where('project_id', '=', projectId).execute();
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000);

  it('records a regression once, opens one issue, and never a second while it is open', async () => {
    const s = environment().services;
    const { projectId, request } = await project('Checks');
    const req = await request();
    await postmortem(projectId, req, [
      { piece: 'B01', class: 'tp', n: 10 },
      { piece: 'B02', class: 'tp', n: 10 },
    ]);

    const first = await runCheck(s, projectId, 'manual', at(1));
    expect(first).toMatchObject({ status: 'recorded', regressions: [], issue: null });
    expect(await issuesOf(projectId)).toHaveLength(0);

    // Same inputs: no second check, however many times it runs.
    expect(await runCheck(s, projectId, 'manual', at(2))).toEqual({ status: 'unchanged', id: (first as { id: string }).id });
    expect(await s.db.selectFrom('harness_checks').select('id').where('project_id', '=', projectId).execute()).toHaveLength(1);

    // B01 now hurts (precision 0.4): the verdict worsens from «helps».
    await postmortem(projectId, req, [
      { piece: 'B01', class: 'tp', n: 4 },
      { piece: 'B01', class: 'fp', n: 6 },
      { piece: 'B02', class: 'tp', n: 10 },
    ]);
    const second = await runCheck(s, projectId, 'schedule', at(3));
    expect(second.status).toBe('recorded');
    if (second.status !== 'recorded') return;
    expect(second.regressions).toEqual([{ kind: 'verdict_worse', piece: 'B01', before: 'helps', after: 'hurts', threshold: null }]);
    expect(second.issue).toBe('ISS-001');
    const [issue] = await issuesOf(projectId);
    expect(issue).toMatchObject({ kind: 'harness_regression', state: 'open', source_key: `harness_check:${second.id}`, opened_by: 'system:harness@1' });
    expect(issue!.body).toContain('B01 (Queue: dependencies and same feature): verdict went from helps to hurts.');
    const stored = await s.db.selectFrom('harness_checks').selectAll().where('id', '=', second.id).executeTakeFirstOrThrow();
    expect(stored.previous_check_id).toBe((first as { id: string }).id);
    expect(stored.trigger).toBe('schedule');
    expect((stored.scorecards as { piece: string; previous_verdict: string | null }[]).find((c) => c.piece === 'B01')).toMatchObject({ verdict: 'hurts', previous_verdict: 'helps' });

    // A second regression (B02) while the first issue is still open: recorded, but no second issue.
    await postmortem(projectId, req, [
      { piece: 'B01', class: 'tp', n: 4 },
      { piece: 'B01', class: 'fp', n: 6 },
      { piece: 'B02', class: 'tp', n: 4 },
      { piece: 'B02', class: 'fp', n: 6 },
    ]);
    const third = await runCheck(s, projectId, 'manual', at(4));
    expect(third).toMatchObject({ status: 'recorded', issue: null, regressions: [{ kind: 'verdict_worse', piece: 'B02' }] });
    expect(await issuesOf(projectId)).toHaveLength(1);

    // Append-only.
    await expect(s.db.updateTable('harness_checks').set({ trigger: 'manual' }).where('id', '=', second.id).execute()).rejects.toThrow(/only admits INSERT/);
  });

  it('is due after the first post-mortem, every 24 hours and every 5 merged tasks', async () => {
    const s = environment().services;
    const { projectId, request } = await project('Cadence');
    expect(await dueCheck(s.db, projectId)).toBeNull();
    const req = await request();
    await postmortem(projectId, req, [{ piece: 'B01', class: 'tp', n: 1 }]);
    expect(await dueCheck(s.db, projectId)).toBe('schedule');
    await runCheck(s, projectId, 'schedule', at(1));
    expect(await dueCheck(s.db, projectId, at(2))).toBeNull();
    expect(await dueCheck(s.db, projectId, at(24 * 60 + 5))).toBe('schedule');
    for (let i = 0; i < 4; i++) await request('done', at(10));
    expect(await dueCheck(s.db, projectId, at(11))).toBeNull();
    await request('done', at(10));
    expect(await dueCheck(s.db, projectId, at(11))).toBe('merges');
  });
});
