import { describe, expect, it } from 'vitest';
import { VISITS_KEY, createVisits, projectOfPath } from '../../src/screens/overview/lens/visit.ts';

function memory(initial: Record<string, unknown> = {}) {
  const data = new Map<string, string>([[VISITS_KEY, JSON.stringify(initial)]]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe('the last visit in this browser', () => {
  it('AC-INT-001-16 the baseline is the one stored when the app started, even after the stream moves it', () => {
    const storage = memory({ p1: { event: '40', at: '2026-09-21T18:40:00Z' } });
    const visits = createVisits(storage, () => '2026-09-24T09:05:00Z');
    expect(visits.baseline('p1')).toEqual({ event: '40', at: '2026-09-21T18:40:00Z' });
    expect(visits.baseline('p2')).toBeNull();
    visits.remember('p1', '55');
    visits.remember('p2', '7');
    // What is seen now is stored for the next visit; the baseline of this one does not move.
    expect(visits.baseline('p1')?.event).toBe('40');
    expect(JSON.parse(storage.data.get(VISITS_KEY) ?? '{}')).toEqual({
      p1: { event: '55', at: '2026-09-24T09:05:00Z' },
      p2: { event: '7', at: '2026-09-24T09:05:00Z' },
    });
    expect(createVisits(storage).baseline('p1')?.event).toBe('55');
  });

  it('AC-INT-001-16 never goes back to an older event, and ignores what is not an event id', () => {
    const storage = memory({ p1: { event: '100', at: 'x' } });
    const visits = createVisits(storage, () => 'later');
    visits.remember('p1', '99');
    visits.remember('p1', 'abc');
    expect(JSON.parse(storage.data.get(VISITS_KEY) ?? '{}')).toEqual({ p1: { event: '100', at: 'x' } });
    expect(createVisits(memory({ p1: { event: 'nope' } })).baseline('p1')).toBeNull();
    expect(createVisits(null).baseline('p1')).toBeNull();
    expect(projectOfPath('/p/0198-abc/records/FDR-DIS-001')).toBe('0198-abc');
    expect(projectOfPath('/sign-in')).toBeNull();
  });
});
