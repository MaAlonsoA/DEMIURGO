import { describe, expect, it } from 'vitest';
import { reattachPlan } from '../src/runner/builder.ts';

describe('reattachPlan', () => {
  it('runs when no container has the name', () => {
    expect(reattachPlan({ found: false })).toBe('run');
  });
  it('reattaches to a container that is still working', () => {
    expect(reattachPlan({ found: true, status: 'running' })).toBe('reattach');
    expect(reattachPlan({ found: true, status: 'restarting' })).toBe('reattach');
  });
  it('collects and removes a container that has stopped', () => {
    for (const status of ['exited', 'dead', 'created', 'paused']) expect(reattachPlan({ found: true, status })).toBe('collect_and_remove');
  });
});
