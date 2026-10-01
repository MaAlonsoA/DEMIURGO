import { describe, expect, it } from 'vitest';
import { touchesOf } from '../src/build/touches.ts';

const map = {
  byPath: new Map<string, { kind: string; modules: string[] }>([
    ['migrations/0002_meals.sql', { kind: 'table', modules: ['table:meals'] }],
    ['app/day/page.tsx', { kind: 'page', modules: ['page:/day'] }],
    ['components/food-sheet.tsx', { kind: 'component', modules: ['component:components'] }],
    ['app/day/page.test.tsx', { kind: 'test', modules: ['test:app/day/page.test.tsx'] }],
  ]),
} as never;

describe('touchesOf', () => {
  it('lists tables and pages, hotspots and the schema evidence; skips tests and components', () => {
    const t = touchesOf(
      'predicted',
      ['migrations/0002_meals.sql', 'app/day/page.tsx', 'components/food-sheet.tsx', 'app/day/page.test.tsx'],
      map,
      [{ path: 'components/food-sheet.tsx', tasks: 4, of: 10 }, { path: 'app/other.tsx', tasks: 1, of: 10 }],
      { by: 'jev', p: 0.78 },
    );
    expect(t).toEqual({ source: 'predicted', modules: ['table:meals', 'page:/day'], hotspots: ['components/food-sheet.tsx'], schema: { by: 'jev', p: 0.78 } });
  });
  it('caps the modules and works without a map', () => {
    expect(touchesOf('footprint', ['a.ts'], null, [], null)).toEqual({ source: 'footprint', modules: [], hotspots: [], schema: null });
  });
});
