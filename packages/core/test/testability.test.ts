// Jev's testability check (H97), with a fake Jev client: the policy thresholds, one request per task,
// nothing without the key, and a failure that leaves no data. No database and no real call.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import {
  MAX_CRITERIA_PER_REQUEST,
  type TestabilityInput,
  type TestabilityCriterion,
  type TestabilityJudgment,
  UNTESTABLE_OUTSIDE_MIN,
  WAITS_FOR_FEATURE_MIN,
  classifyTaskTestability,
  buildTestabilityRequest,
  judgeTestability,
  testabilityVerdict,
} from '../src/classifier/testability.ts';
import type { Services } from '../src/services.ts';

const INPUT: TestabilityInput = {
  title: 'Meal plan page',
  goal: 'Show the weekly plan.',
  scope: 'The page and its endpoint.',
  criteria: [
    { code: 'AC-1', statement: 'The plan lists seven days.', verification: 'automatic' },
    { code: 'AC-2', statement: 'A screen reader announces each day.', verification: 'automatic' },
    { code: 'AC-3', statement: 'Reviewed by a person on a device.', verification: 'manual' },
  ],
  decisions: ['ADR-1: Next.js on Vercel'],
  features: [
    { code: 'FDR-2', title: 'Shopping list', built: false },
    { code: 'FDR-3', title: 'Foods', built: true },
  ],
  taskCode: 'TSK-9',
  declaredDependencies: ['TSK-8'],
  featureBeingBuilt: { code: 'FDR-1', title: 'Meal plan', goal: 'Plan the week.', scope: 'Seven days.' },
  projectStack: { ci: 'GitHub Actions: ephemeral Postgres 17, Vitest; no deployed environment, no person.' },
};

type Questions = Record<string, { type: string; instructions?: unknown }>;
/** A fake client: records every request; answers by question prefix and criterion index. */
function fakeClient(answer: (key: string, index: number) => number | string | undefined) {
  const requests: { state: unknown; questions: Questions }[] = [];
  const client = {
    systemOne: async (r: { state: unknown; questions: Questions }) => {
      requests.push(r);
      const answers = Object.fromEntries(
        Object.keys(r.questions).map((name) => {
          const i = Number(name.slice(name.lastIndexOf('_') + 1));
          const v = answer(name.slice(0, name.lastIndexOf('_')), i);
          return [name, v === undefined ? undefined : typeof v === 'string' ? { type: 'choice', choice: v } : { type: 'noul', noul: v }];
        }),
      );
      return { model: 'jev-test', answers, usage: { input_tokens: 10, output_tokens: 0 } };
    },
  } as unknown as Pick<TypeSafeClient, 'systemOne'>;
  return { client, requests };
}

const services = (infos: string[] = []) =>
  ({ db: {}, logger: { info: (m: string) => infos.push(m), error: (m: string) => infos.push(`error: ${m}`) } }) as unknown as Services;

describe('testability policy', () => {
  const p = (outside: number, unbuilt: number) => ({ needs_outside_ci: outside, needs_unbuilt_feature: unbuilt });

  it('flags untestable at outside >= 0.5', () => {
    expect(testabilityVerdict(p(UNTESTABLE_OUTSIDE_MIN, 0))).toBe('untestable');
    expect(testabilityVerdict(p(UNTESTABLE_OUTSIDE_MIN - 0.01, 0))).toBe('ok');
  });

  it('flags waits_for_feature at unbuilt >= 0.5, and untestable wins over it', () => {
    expect(testabilityVerdict(p(0.1, WAITS_FOR_FEATURE_MIN))).toBe('waits_for_feature');
    expect(testabilityVerdict(p(0.1, WAITS_FOR_FEATURE_MIN - 0.01))).toBe('ok');
    expect(testabilityVerdict(p(0.9, 0.95))).toBe('untestable');
  });
});

describe('judgeTestability', () => {
  it('asks one request for the whole task, two Nouls and a Choice per automatic criterion only', async () => {
    const { client, requests } = fakeClient((key, i) =>
      key === 'needs_kind' ? (i === 1 ? 'needs_person' : 'ci_automated') : key === 'needs_outside_ci' ? (i === 1 ? 0.91 : 0.05) : 0.1,
    );
    const out = await judgeTestability(client, INPUT);
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0]?.questions ?? {})).toEqual([
      'needs_outside_ci_0',
      'needs_unbuilt_feature_0',
      'needs_kind_0',
      'needs_outside_ci_1',
      'needs_unbuilt_feature_1',
      'needs_kind_1',
    ]);
    expect(out.map((j) => j.code)).toEqual(['AC-1', 'AC-2']);
    expect(out[1]).toMatchObject({ needs_outside_ci: 0.91, needs: 'needs_person' });
    expect(out[0]?.needs).toBe('ci_automated');
    expect(testabilityVerdict(out[1] as TestabilityJudgment)).toBe('untestable');
    expect(testabilityVerdict(out[0] as TestabilityJudgment)).toBe('ok');
    expect(out[0]?.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(out[0]?.input_hash).not.toBe(out[1]?.input_hash);
    // The shared state carries the task, its criteria, the feature being built, what CI runs and the features split by built state.
    expect(requests[0]?.state).toMatchObject({
      task: { code: 'TSK-9', declared_dependencies: ['TSK-8'] },
      feature_being_built: { code: 'FDR-1', goal: 'Plan the week.' },
      project_stack: { ci: expect.stringContaining('GitHub Actions') },
      features_built: ['FDR-3: Foods'],
      features_not_built: ['FDR-2: Shopping list'],
    });
  });

  it('points the questions at criteria_covered[i] by the criterion place, and leaves out project_stack when unknown', () => {
    const { questions, state } = buildTestabilityRequest({ ...INPUT, projectStack: null }, [INPUT.criteria[1] as TestabilityCriterion]);
    expect(JSON.stringify(questions.needs_outside_ci_0)).toContain('criteria_covered[1]');
    expect(JSON.stringify(questions.needs_kind_0)).not.toContain('project_stack');
    expect('project_stack' in state).toBe(false);
  });

  it('splits only past the per-request limit', async () => {
    const many: TestabilityInput = {
      ...INPUT,
      criteria: Array.from({ length: MAX_CRITERIA_PER_REQUEST + 1 }, (_, i) => ({ code: `AC-${i}`, statement: `s${i}`, verification: 'automatic' })),
    };
    const { client, requests } = fakeClient((key) => (key === 'needs_kind' ? 'ci_automated' : 0.5));
    const out = await judgeTestability(client, many);
    expect(requests).toHaveLength(2);
    expect(out).toHaveLength(MAX_CRITERIA_PER_REQUEST + 1);
  });

  it('fails when an answer is missing', async () => {
    const { client } = fakeClient((key) => (key === 'needs_unbuilt_feature' ? undefined : key === 'needs_kind' ? 'ci_automated' : 0.5));
    await expect(judgeTestability(client, INPUT)).rejects.toThrow(/without an answer/);
  });
});

describe('classifyTaskTestability', () => {
  const saved = process.env.TYPESAFE_API_KEY;
  beforeEach(() => {
    process.env.TYPESAFE_API_KEY = 'test-key';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  });

  it('does nothing without TYPESAFE_API_KEY: no read, no request, no data', async () => {
    delete process.env.TYPESAFE_API_KEY;
    const { client, requests } = fakeClient(() => 0.5);
    let touched = 0;
    await classifyTaskTestability(services(), 'p', 'r', 'v', {
      client,
      load: async () => (touched++, INPUT),
      store: async () => void touched++,
    });
    expect(requests).toHaveLength(0);
    expect(touched).toBe(0);
  });

  it('makes one request and stores one judgment per automatic criterion', async () => {
    const { client, requests } = fakeClient((key) => (key === 'needs_kind' ? 'ci_automated' : 0.3));
    const stored: TestabilityJudgment[][] = [];
    await classifyTaskTestability(services(), 'p', 'r', 'v', {
      client,
      load: async () => INPUT,
      store: async (_s, _ids, id, judgments) => {
        expect(id).toMatch(/^jev@/);
        stored.push(judgments);
      },
    });
    expect(requests).toHaveLength(1);
    expect(stored[0]?.map((j) => j.code)).toEqual(['AC-1', 'AC-2']);
  });

  it('a Jev failure leaves no data and does not throw', async () => {
    const failing = {
      systemOne: async () => {
        throw new Error('boom');
      },
    } as unknown as Pick<TypeSafeClient, 'systemOne'>;
    const infos: string[] = [];
    let stored = 0;
    await classifyTaskTestability(services(infos), 'p', 'r', 'v', {
      client: failing,
      load: async () => INPUT,
      store: async () => void stored++,
    });
    expect(stored).toBe(0);
    expect(infos.some((m) => m.startsWith('error:'))).toBe(true);
  });

  it.each(['manual', 'release'])('skips a task with only %s criteria', async (verification) => {
    const { client, requests } = fakeClient(() => 0.5);
    await classifyTaskTestability(services(), 'p', 'r', 'v', {
      client,
      load: async () => ({ ...INPUT, criteria: [{ code: 'AC-3', statement: 'x', verification }] }),
      store: async () => {
        throw new Error('nothing to store');
      },
    });
    expect(requests).toHaveLength(0);
  });
});
