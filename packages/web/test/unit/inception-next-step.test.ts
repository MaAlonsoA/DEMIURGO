import { describe, expect, it } from 'vitest';
import type { InceptionPath, InceptionStep } from '../../src/api/types.ts';
import { inceptionStep } from '../../src/screens/overview/nextStep.ts';

const step = (key: string, state: InceptionStep['state'], action: InceptionStep['action'] = null): InceptionStep => ({
  key,
  title: key,
  state,
  why: 'why',
  blocks: null,
  source: 'source',
  action,
});
const path = (steps: InceptionStep[], current: string | null): InceptionPath => ({
  steps,
  current,
  done: steps.filter((s) => s.state === 'done').length,
  total: steps.length,
});

describe('inception step in NEXT STEP', () => {
  it('uses the current step', () => {
    const p = path([step('definition', 'done'), step('goals', 'current', { kind: 'open_stage', stage: 'goals' }), step('x', 'todo')], 'goals');
    expect(inceptionStep(p)?.key).toBe('goals');
  });
  it('leaves NEXT STEP to the existing logic with an older server, at the end, and at the build', () => {
    expect(inceptionStep(undefined)).toBeNull();
    expect(inceptionStep(path([step('a', 'done')], null))).toBeNull();
    expect(inceptionStep(path([step('build', 'current', { kind: 'build', code: null })], 'build'))).toBeNull();
  });
});
