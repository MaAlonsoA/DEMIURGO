import { describe, expect, it } from 'vitest';
import type { ProductRow, RunListItem } from '../../src/api/types.ts';
import {
  draftingRuns,
  featureStatus,
  productProgress,
  recentlyDecided,
  workingRuns,
} from '../../src/screens/overview/progress.ts';

const at = (m: number) => new Date(Date.UTC(2026, 8, 24, 10, m)).toISOString();

function row(code: string, extra: Partial<ProductRow> = {}): ProductRow {
  return {
    code,
    type: 'fdr',
    domain: 'catalog',
    title: `Title ${code}`,
    current: null,
    latest: { n: 1, state: 'draft' },
    epistemic_status: 'proposed',
    readiness: { ready: false, reasons: ['Version 1 is not approved.'], warnings: [] },
    implementation: 'not implemented',
    summary: '',
    checks: 3,
    latest_id: `${code}-v1`,
    current_id: null,
    updated_at: at(0),
    updated_by: 'human:ana',
    origin_exploration: null,
    ...extra,
  };
}

function run(id: string, state: string, extra: Partial<RunListItem> = {}): RunListItem {
  return {
    id,
    state,
    action: 'exploration_chat',
    scope: { type: 'exploration', id: 't' },
    provider: 'simulated',
    model: 'simulated',
    retry_of: null,
    failure_kind: null,
    error: null,
    requested_by: 'human:ana',
    created_at: at(1),
    started_at: at(1),
    finished_at: null,
    context_pack_hash: null,
    exploration_id: 't',
    batch_id: null,
    ...extra,
  };
}

const ready = { ready: true, reasons: [], warnings: [] };
const waiting = (code: string) => (code === 'B' ? 1 : 0);

describe('the overview, closer to the product blueprint', () => {
  it('gives each feature one status: working in its thread first, then ready to build, then needs you', () => {
    const runs = [run('r1', 'running', { exploration_id: 'busy' }), run('r2', 'completed', { exploration_id: 'done' })];
    expect(featureStatus(row('A', { origin_exploration: 'busy', readiness: ready }), 0, runs)).toMatchObject({
      kind: 'working',
      run: { id: 'r1' },
    });
    expect(featureStatus(row('B', { origin_exploration: 'done', readiness: ready }), 2, runs)).toEqual({ kind: 'ready' });
    expect(featureStatus(row('C'), 1, runs)).toEqual({ kind: 'needs' });
    expect(featureStatus(row('D'), 0, runs)).toBeNull();
    // A draft run makes a new feature (its own card): it is not work on this one.
    const drafting = [run('r3', 'queued', { action: 'design_proposal', exploration_id: 'busy' })];
    expect(featureStatus(row('E', { origin_exploration: 'busy' }), 0, drafting)).toBeNull();
  });

  it('counts the features of the progress line under the title', () => {
    const rows = [
      row('A', { readiness: ready }),
      row('B'),
      row('C', { origin_exploration: 'busy' }),
      row('D'),
      row('DEC', { type: 'decision' }),
    ];
    expect(productProgress(rows, waiting, [run('r1', 'running', { exploration_id: 'busy' })], 0)).toEqual({
      total: 4,
      ready: 1,
      needs: 1,
      working: 1,
    });
    // A feature DEMIURGO is drafting from a decision counts as in progress too.
    expect(productProgress(rows, waiting, [], 2)).toMatchObject({ total: 4, working: 2 });
  });

  it('lists what was decided most recently: the records whose latest version a person approved', () => {
    const rows = [
      row('OLD', { current: 1, latest: { n: 1, state: 'approved' }, updated_at: at(1) }),
      row('NEW', { current: 1, latest: { n: 1, state: 'approved' }, updated_at: at(9) }),
      row('DRAFT'),
      row('NEWER', { current: 1, latest: { n: 2, state: 'draft' }, updated_at: at(20) }),
    ];
    expect(recentlyDecided(rows).map((r) => r.code)).toEqual(['NEW', 'OLD']);
    expect(recentlyDecided(rows, 1).map((r) => r.code)).toEqual(['NEW']);
  });

  it('knows which runs are working and which are drafting a new feature', () => {
    const runs = [
      run('chat', 'running'),
      run('draft', 'queued', { action: 'design_proposal', scope: { type: 'record_version', id: 'dec-v1' } }),
      run('old', 'completed', { action: 'design_proposal' }),
    ];
    expect(workingRuns(runs).map((r) => r.id)).toEqual(['chat', 'draft']);
    expect(draftingRuns(runs).map((r) => r.id)).toEqual(['draft']);
  });
});
