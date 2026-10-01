// Jev's insisting signals with a fake client: no real Jev call is ever made.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insistedSignalBefore } from '../src/build/insisted.ts';
import { MAX_PAIRS, SESSION_SIGNAL_THRESHOLD, blockingPairs, sameRequestNoul, stuckNoul } from '../src/classifier/session-signals.ts';
import { sessionInsisted } from '../src/harness/rules/session.ts';
import type { PostmortemInputs } from '../src/harness/postmortem.ts';
import type { Row } from '../src/db/schema.ts';

const logger = { info: () => undefined, error: () => undefined };
const noDb = { insertInto: () => ({ values: () => ({ onConflict: () => ({ execute: async () => undefined }), execute: async () => undefined, returning: () => ({ executeTakeFirst: async () => undefined }) }) }) };
const services = { db: noDb, logger } as never;

/** A fake client answering p for every question, and counting the questions it was asked. */
const fake = (p: number | ((key: string) => number)) => {
  const asked: string[][] = [];
  return {
    asked,
    client: {
      systemOne: async (req: { questions: Record<string, unknown> }) => {
        asked.push(Object.keys(req.questions));
        return { answers: Object.fromEntries(Object.keys(req.questions).map((k) => [k, { noul: typeof p === 'function' ? p(k) : p }])), usage: { input_tokens: 10 } };
      },
    } as never,
  };
};

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'test-key-not-real';
});
afterEach(() => {
  if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved;
});

describe('sameRequestNoul', () => {
  it('returns the highest p over the pairs', async () => {
    const f = fake((k) => (k === 'same_1' ? 0.9 : 0.2));
    expect(await sameRequestNoul(services, 'p', ['a', 'b'], ['c'], { client: f.client })).toBe(0.9);
    expect(f.asked[0]).toEqual(['same_0', 'same_1']);
  });
  it('the threshold is 0.8: p >= 0.8 counts, 0.79 does not', async () => {
    expect(SESSION_SIGNAL_THRESHOLD).toBe(0.8);
    const p = await sameRequestNoul(services, 'p', ['a'], ['b'], { client: fake(0.79).client });
    expect(p !== null && p >= SESSION_SIGNAL_THRESHOLD).toBe(false);
    const q = await sameRequestNoul(services, 'p', ['a'], ['b'], { client: fake(0.8).client });
    expect(q !== null && q >= SESSION_SIGNAL_THRESHOLD).toBe(true);
  });
  it('caps the pairs at 20', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `comment ${i}`);
    expect(blockingPairs(many, many)).toHaveLength(MAX_PAIRS);
    const f = fake(0.1);
    await sameRequestNoul(services, 'p', many, many, { client: f.client });
    expect(f.asked[0]).toHaveLength(MAX_PAIRS);
  });
  it('is null without a key, without blocking comments and on a client error', async () => {
    const f = fake(0.99);
    delete process.env.TYPESAFE_API_KEY;
    expect(await sameRequestNoul(services, 'p', ['a'], ['b'], { client: f.client })).toBeNull();
    expect(f.asked).toHaveLength(0);
    process.env.TYPESAFE_API_KEY = 'test-key-not-real';
    expect(await sameRequestNoul(services, 'p', [], ['b'], { client: f.client })).toBeNull();
    const broken = { systemOne: async () => { throw new Error('down'); } } as never;
    expect(await sameRequestNoul(services, 'p', ['a'], ['b'], { client: broken })).toBeNull();
  });
});

describe('stuckNoul', () => {
  it('returns p, and null without a key, without notes or on error', async () => {
    expect(await stuckNoul(services, 'p', '## Attempt 1\nsame fix again', { client: fake(0.85).client })).toBe(0.85);
    expect(await stuckNoul(services, 'p', '   ', { client: fake(0.85).client })).toBeNull();
    const broken = { systemOne: async () => { throw new Error('down'); } } as never;
    expect(await stuckNoul(services, 'p', 'notes', { client: broken })).toBeNull();
    delete process.env.TYPESAFE_API_KEY;
    expect(await stuckNoul(services, 'p', 'notes', { client: fake(0.99).client })).toBeNull();
  });
});

/** A db stub answering by table: enough for insistedSignalBefore. */
function stubDb(tables: Record<string, unknown[]>) {
  return {
    ...noDb,
    selectFrom: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'where', 'orderBy', 'limit']) q[m] = () => q;
      q.execute = async () => tables[table] ?? [];
      q.executeTakeFirst = async () => (tables[table] ?? [])[0];
      return q;
    },
  };
}
const block = (body: string, path = 'a.ts') => [{ path, severity: 'blocking', body }];
const changes = (comments: unknown[]) => ({ verdict: 'request_changes', comments });

describe('insistedSignalBefore with Jev', () => {
  const base = (over: Record<string, unknown[]> = {}) =>
    ({
      db: stubDb({ build_requests: [{ project_id: 'p' }], pr_reviews: [changes(block('Confirm before deleting the meal.', 'b.ts')), changes(block('Ask the user to confirm the removal of a meal', 'a.ts'))], build_steps: [{ attempt: 1, detail: { progress: 'tried the same fix again' } }], ...over }),
      logger,
    }) as never;

  it('attempt 1 never asks', async () => {
    const f = fake(0.99);
    expect(await insistedSignalBefore(base(), 'r', 1, { client: f.client })).toEqual({ signal: null });
    expect(f.asked).toHaveLength(0);
  });
  it('deterministic signals win and Jev is not asked', async () => {
    const f = fake(0.99);
    const nothing = base({ build_steps: [{ outcome: 'failed', detail: { error: 'The builder changed nothing' } }] });
    expect(await insistedSignalBefore(nothing, 'r', 2, { client: f.client })).toEqual({ signal: 'changed_nothing' });
    const same = base({ build_steps: [], pr_reviews: [changes(block('The delete button needs a confirmation dialog.')), changes(block('The delete button needs a confirmation dialog.'))] });
    expect(await insistedSignalBefore(same, 'r', 2, { client: f.client })).toEqual({ signal: 'repeated_finding' });
    expect(f.asked).toHaveLength(0);
  });
  it('jev_repeated_finding comes before jev_stuck, and stuck is not asked then', async () => {
    const f = fake(0.95);
    const d = await insistedSignalBefore(base(), 'r', 2, { client: f.client });
    expect(d).toEqual({ signal: 'jev_repeated_finding', jev: { same_request_p: 0.95 } });
    expect(f.asked).toHaveLength(1);
  });
  it('jev_stuck when the request is not repeated but the notes say stuck; both p are kept', async () => {
    const f = fake((k) => (k.startsWith('same') ? 0.1 : 0.9));
    expect(await insistedSignalBefore(base(), 'r', 2, { client: f.client })).toEqual({ signal: 'jev_stuck', jev: { same_request_p: 0.1, stuck_p: 0.9 } });
  });
  it('no signal below the threshold, still reporting what Jev said', async () => {
    expect(await insistedSignalBefore(base(), 'r', 2, { client: fake(0.5).client })).toEqual({ signal: null, jev: { same_request_p: 0.5, stuck_p: 0.5 } });
  });
  it('without a key nothing changes', async () => {
    delete process.env.TYPESAFE_API_KEY;
    const f = fake(0.99);
    expect(await insistedSignalBefore(base(), 'r', 2, { client: f.client })).toEqual({ signal: null });
    expect(f.asked).toHaveLength(0);
  });
});

describe('session.insisted counts Jev signals (B20)', () => {
  let clock = 0;
  const at = () => new Date(Date.UTC(2026, 9, 1, 12, 0, clock++));
  const step = (attempt: number, stage: string, outcome: string, detail: unknown = {}) => ({ id: `s${clock}`, project_id: 'p', build_request_id: 'r', attempt, stage, outcome, detail, created_at: at() }) as unknown as Row<'build_steps'>;
  const builder = (attempt: number, mode: string, reason_code: string, extra: Record<string, unknown> = {}) => step(attempt, 'builder', 'ok', { session: { mode, id: 'abc', reason: 'why', reason_code, ...extra }, duration_ms: 60_000 });
  const inputs = (steps: Row<'build_steps'>[]) => ({ request: { id: 'r', state: 'done' }, taskCode: 'T', steps, reviews: [], codeOpinions: [], layersOpinion: null, testRuns: [] }) as unknown as PostmortemInputs;

  it('a resumed attempt followed by a fresh one forced by Jev is a tp, split by signal with the probabilities', () => {
    const f = sessionInsisted(inputs([builder(2, 'resumed', 'resumed'), builder(3, 'fresh', 'insisted', { insisted_signal: 'jev_stuck', jev: { same_request_p: 0.2, stuck_p: 0.9 } }), step(3, 'merge', 'ok')]));
    expect(f[0]).toMatchObject({ finding: 'session.insisted', class: 'tp', attempt: 2, subject: 'jev_stuck', evidence: { signal: 'jev_stuck', jev: { stuck_p: 0.9 } } });
  });
  it('a fresh session forced by a deterministic signal without evidence of it is not counted', () => {
    expect(sessionInsisted(inputs([builder(2, 'resumed', 'resumed'), builder(3, 'fresh', 'insisted', { insisted_signal: 'repeated_finding' })]))).toEqual([]);
  });
});
