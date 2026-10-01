import { describe, expect, it } from 'vitest';
import { suspectLinks, suspectOf } from '../src/impact.ts';

const link = (over: Partial<Parameters<typeof suspectOf>[0]> = {}) => ({
  type: 'based_on',
  from: { code: 'SCR-PRO-012', n: 1 },
  to: { code: 'FDR-PRO-011', n: 1 },
  ...over,
});
const current = (o: Record<string, number>) => new Map(Object.entries(o));

describe('suspect links (deterministic impact)', () => {
  it('flags a record whose current version rests on an older version of its basis', () => {
    expect(suspectOf(link(), current({ 'SCR-PRO-012': 1, 'FDR-PRO-011': 2 }))).toEqual({ upstream: 'FDR-PRO-011', from: 1, to: 2 });
  });
  it('is not suspect while the basis has not changed', () => {
    expect(suspectOf(link(), current({ 'SCR-PRO-012': 1, 'FDR-PRO-011': 1 }))).toBeNull();
  });
  it('is not suspect when the downstream version is no longer the current one', () => {
    expect(suspectOf(link(), current({ 'SCR-PRO-012': 2, 'FDR-PRO-011': 2 }))).toBeNull();
    expect(suspectOf(link(), current({ 'FDR-PRO-011': 2 }))).toBeNull();
  });
  it('is not suspect when the upstream has no approved version', () => {
    expect(suspectOf(link(), current({ 'SCR-PRO-012': 1 }))).toBeNull();
  });
  it('ignores links that do not say «rests on»', () => {
    expect(suspectOf(link({ type: 'covers' }), current({ 'SCR-PRO-012': 1, 'FDR-PRO-011': 2 }))).toBeNull();
  });
  it('«Still valid» clears it until a newer version', () => {
    const l = link({ checkedAgainst: 2 });
    expect(suspectOf(l, current({ 'SCR-PRO-012': 1, 'FDR-PRO-011': 2 }))).toBeNull();
    expect(suspectOf(l, current({ 'SCR-PRO-012': 1, 'FDR-PRO-011': 3 }))).toEqual({ upstream: 'FDR-PRO-011', from: 1, to: 3 });
  });
  it('lists only the suspect ones', () => {
    const ok = link({ from: { code: 'TSK-A', n: 1 }, to: { code: 'FDR-X', n: 3 } });
    const out = suspectLinks([link(), ok], current({ 'SCR-PRO-012': 1, 'TSK-A': 1, 'FDR-PRO-011': 2, 'FDR-X': 3 }));
    expect(out.map((l) => l.from.code)).toEqual(['SCR-PRO-012']);
  });
});
