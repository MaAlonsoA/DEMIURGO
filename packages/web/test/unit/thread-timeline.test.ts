import { describe, expect, it } from 'vitest';
import type { Message, ProductRow, RunListItem } from '../../src/api/types.ts';
import { buildTimeline, draftableDecisions, runDisplay } from '../../src/screens/thread/timeline.ts';

const at = (s: number) => new Date(Date.UTC(2026, 8, 24, 10, 0, s)).toISOString();

function message(id: string, author: string, s: number, extra: Partial<Message> = {}): Message {
  return {
    id,
    exploration_id: 'e1',
    question_id: null,
    author,
    run_id: null,
    kind: null,
    body: `text of ${id}`,
    state: 'recorded',
    created_at: at(s),
    epistemic_status: null,
    response: null,
    response_run: null,
    ...extra,
  };
}

function run(id: string, state: string, s: number, extra: Partial<RunListItem> = {}): RunListItem {
  return {
    id,
    state,
    action: 'exploration_chat',
    scope: { type: 'exploration', id: 'e1' },
    provider: 'simulated',
    model: null,
    retry_of: null,
    failure_kind: null,
    error: null,
    requested_by: 'system:exploration@1',
    created_at: at(s),
    started_at: at(s),
    finished_at: ['queued', 'running'].includes(state) ? null : at(s + 5),
    context_pack_hash: 'h1',
    exploration_id: 'e1',
    batch_id: null,
    ...extra,
  };
}

describe('the timeline of a thread', () => {
  it("AC-INT-001-04 groups DEMIURGO's reply with its observations and keeps people's messages apart", () => {
    const items = buildTimeline(
      [
        message('m1', 'human:ana', 1),
        message('m2', 'agent:run:r1', 10, { run_id: 'r1' }),
        message('m3', 'agent:run:r1', 10, { run_id: 'r1', kind: 'hypothesis' }),
        message('m4', 'agent:run:r1', 10, { run_id: 'r1', kind: 'unknown' }),
        message('m5', 'agent:claude-code:t1', 20),
      ],
      [run('r1', 'completed', 2)],
    );
    expect(items.map((i) => i.type)).toEqual(['message', 'demiurgo', 'message']);
    const d = items[1];
    expect(d?.type === 'demiurgo' && d.reply?.id).toBe('m2');
    expect(d?.type === 'demiurgo' && d.observations.map((o) => o.kind)).toEqual(['hypothesis', 'unknown']);
    expect(items[2]?.type === 'message' && items[2].by).toBe('agent');
  });

  it('AC-INT-001-10 shows a run while it works, when it failed, when it was cancelled and when it left a draft', () => {
    const runs = [
      run('working', 'running', 30),
      run('failed', 'failed', 1, { failure_kind: 'agent_error' }),
      run('cancelled', 'cancelled', 2),
      run('draft', 'completed', 3, { action: 'design_proposal', batch_id: 'b1' }),
      run('talk', 'completed', 4),
    ];
    expect(runs.map((r) => runDisplay(r, runs))).toEqual(['working', 'failed', 'cancelled', 'draft', null]);
    expect(runDisplay(run('i', 'interrupted', 1), [])).toBe('failed');
  });

  it('AC-INT-001-10 a failed run that was retried stays as retried, without its Retry', () => {
    const failed = run('r1', 'failed', 1);
    const runs = [failed, run('r2', 'completed', 20, { retry_of: 'r1' })];
    expect(runDisplay(failed, runs)).toBe('retried');
    const items = buildTimeline([message('m1', 'human:ana', 0)], runs);
    expect(items.map((i) => i.key)).toEqual(['m:m1', 'r:r1']);
  });

  it('AC-INT-001-10 orders messages and runs by time: a run in progress goes after what asked for it', () => {
    const items = buildTimeline(
      [message('m1', 'human:ana', 1), message('m2', 'human:ana', 40)],
      [run('r1', 'running', 6), run('r0', 'failed', 0)],
    );
    // r0 finished at 5 s and r1 started at 6 s: both after m1 and before m2, in the order they happened.
    expect(items.map((i) => i.key)).toEqual(['m:m1', 'r:r0', 'r:r1', 'm:m2']);
  });
});

describe('Draft it', () => {
  const row = (code: string, extra: Partial<ProductRow>): ProductRow => ({
    code,
    type: 'decision',
    domain: 'plan',
    title: `Title of ${code}`,
    current: 1,
    latest: { n: 1, state: 'approved' },
    epistemic_status: 'confirmed',
    readiness: null,
    implementation: 'not_built',
    summary: '',
    checks: 0,
    latest_id: `${code}-v1`,
    current_id: `${code}-v1`,
    updated_at: at(0),
    updated_by: 'human:ana',
    origin_exploration: null,
    ...extra,
  });

  it('AC-INT-001-10 offers only approved decisions, the ones born in the thread first', () => {
    const list = draftableDecisions(
      [
        row('DEC-A', {}),
        row('DEC-B', { origin_exploration: 'e1' }),
        row('DEC-C', { current: null, current_id: null, latest: { n: 1, state: 'draft' } }),
        row('FDR-A', { type: 'fdr' }),
      ],
      'e1',
    );
    expect(list.map((d) => [d.code, d.bornHere])).toEqual([
      ['DEC-B', true],
      ['DEC-A', false],
    ]);
    expect(list[0]?.versionId).toBe('DEC-B-v1');
  });
});
