import { describe, expect, it } from 'vitest';
import { type RunProgress, progressOf, recordProgress } from '../../src/api/progress.ts';

const p = (over: Partial<RunProgress>): RunProgress => ({
  run_id: 'r1',
  call_id: 'c1',
  provider: 'claude',
  model: 'opus',
  started_at: '2026-09-25T10:00:00Z',
  events: 1,
  tokens: null,
  last_kind: 'started',
  ...over,
});

describe('the live progress of a run', () => {
  it('never goes back within a call: a late or smaller message keeps what was already shown', () => {
    recordProgress(p({ events: 5, tokens: 1200, last_kind: 'thinking' }));
    recordProgress(p({ events: 3, tokens: 400, last_kind: 'started' }));
    expect(progressOf('r1')).toMatchObject({ events: 5, tokens: 1200, last_kind: 'thinking' });
    recordProgress(p({ events: 6, tokens: null, last_kind: 'message' }));
    expect(progressOf('r1')).toMatchObject({ events: 6, tokens: 1200, last_kind: 'message' });
  });

  it('starts again with a new call of the same run', () => {
    recordProgress(p({ run_id: 'r2', events: 9, tokens: 900 }));
    recordProgress(p({ run_id: 'r2', call_id: 'c2', events: 1, tokens: 10 }));
    expect(progressOf('r2')).toMatchObject({ call_id: 'c2', events: 1, tokens: 10 });
  });
});
