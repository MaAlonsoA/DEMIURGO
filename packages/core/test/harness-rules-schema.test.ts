// schema.prediction (B02): Jev's schema opinion against a real file under migrations/ (G13).

import { describe, expect, it } from 'vitest';
import { schemaPrediction } from '../src/harness/rules/schema.ts';
import { at, inputs, mergedSteps } from './support/harness-inputs.ts';

const opinion = (schema_p: number) => ({ id: 'op-1', record_id: 't', schema_p, created_at: at(-10) }) as never;

function run(schemaP: number | null, files: string[], extra: Parameters<typeof inputs>[0] = {}) {
  const i = inputs({ id: 'r1', steps: mergedSteps('r1', files, { footprintAsString: false }), layersOpinion: schemaP === null ? null : opinion(schemaP), ...extra });
  return schemaPrediction(i);
}

describe('schema.prediction', () => {
  it('is a tp when Jev says schema and the PR added a migration', () => {
    const [f] = run(0.97, ['src/a.ts', 'migrations/0004_x.sql']);
    expect(f).toMatchObject({ finding: 'schema.prediction', class: 'tp', ground_truth: 'G13', piece: 'B02' });
    expect(f!.evidence).toMatchObject({ layers_opinion: 'op-1', migrations: ['migrations/0004_x.sql'] });
  });
  it('is a fp when Jev says schema and there is no migration', () => {
    expect(run(0.8, ['src/a.ts'])[0]!.class).toBe('fp');
  });
  it('is a fn when Jev says no schema and the PR added a migration (an index counts)', () => {
    expect(run(0.435, ['packages/db/migrations/0005_index.sql'])[0]!.class).toBe('fn');
  });
  it('is a tn when Jev says no schema and there is no migration', () => {
    expect(run(0.02, ['src/a.ts'])[0]!.class).toBe('tn');
  });
  it('reads the footprint stored as a JSON string (old format)', () => {
    const i = inputs({ id: 'r2', steps: mergedSteps('r2', ['migrations/0001_a.sql'], { footprintAsString: true }).filter((s) => s.stage !== 'commit'), layersOpinion: opinion(0.9) });
    expect(schemaPrediction(i)[0]!.class).toBe('tp');
  });
  it('says nothing without an opinion, without files or when the request was not merged', () => {
    expect(run(null, ['migrations/0001_a.sql'])).toEqual([]);
    expect(run(0.9, ['x'], { steps: [] })).toEqual([]);
    expect(run(0.9, ['x'], { request: { ...inputs().request, state: 'withdrawn' } })).toEqual([]);
  });
});
