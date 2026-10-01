import { describe, expect, it } from 'vitest';
import { STARTING_MAX_MS, buildTimeline, stillStarting } from '../../src/screens/thread/timeline.ts';
import { findingWord } from '../../src/screens/batch/model.ts';

const since = Date.parse('2026-10-01T10:00:00Z');
const base = { since, now: since + 1000, runs: [], queued: [], messages: [] };

describe('stillStarting', () => {
  it('shows right after asking, until a run, a queued request or a reply appears', () => {
    expect(stillStarting(base)).toBe(true);
    expect(stillStarting({ ...base, since: null })).toBe(false);
    expect(stillStarting({ ...base, queued: [{}] })).toBe(false);
    expect(stillStarting({ ...base, runs: [{ created_at: '2026-10-01T10:00:02Z' }] })).toBe(false);
    expect(stillStarting({ ...base, runs: [{ created_at: '2026-10-01T09:00:00Z' }] })).toBe(true);
    expect(stillStarting({ ...base, messages: [{ author: 'agent:run:1', created_at: '2026-10-01T10:00:05Z' }] })).toBe(false);
  });
  it('gives up after a while rather than lying', () => {
    expect(stillStarting({ ...base, now: since + STARTING_MAX_MS + 1 })).toBe(false);
  });
  it('adds a placeholder item to the timeline', () => {
    const items = buildTimeline([], [], [], [], since);
    expect(items.map((i) => i.type)).toEqual(['starting']);
  });
});

describe('findingWord', () => {
  it('a quality requirement refines the definition instead of duplicating it', () => {
    expect(findingWord('duplicates', 'DEF-PRO-001@2', 'quality_requirement')).toBe('Refines');
    expect(findingWord('duplicates', 'NFR-PER-001@1', 'quality_requirement')).toBe('Duplicates');
    expect(findingWord('duplicates', 'DEF-PRO-001@2', 'decision')).toBe('Duplicates');
    expect(findingWord('conflicts', 'DEF-PRO-001@2', 'quality_requirement')).toBe('Contradicts');
  });
});
