// Rules added in pm-6 from the revision against Anthropic's harness: B20 session.insisted and session.last_turn_tokens,
// B25 environment.smoke and environment.start_command, B27 builder.screen_check. Pure, over hand-made steps.

import { describe, expect, it } from 'vitest';
import type { Row } from '../src/db/schema.ts';
import type { PostmortemInputs } from '../src/harness/postmortem.ts';
import { environmentSmoke, environmentStartCommand } from '../src/harness/rules/environment.ts';
import { builderScreenCheck } from '../src/harness/rules/screens.ts';
import { sessionInsisted, sessionLastTurnTokens, sessionMode } from '../src/harness/rules/session.ts';

let clock = 0;
const at = () => new Date(Date.UTC(2026, 9, 1, 12, 0, clock++));
const step = (attempt: number, stage: string, outcome: string, detail: unknown = {}, id = `s${clock}`) => ({ id, project_id: 'p', build_request_id: 'r', attempt, stage, outcome, detail, created_at: at() }) as unknown as Row<'build_steps'>;
const review = (id: string, comments: unknown[], createdAfterSteps = 0) => ({ id, run_id: id, verdict: 'changes_requested', comments, created_at: new Date(Date.UTC(2026, 9, 1, 12, 0, clock + createdAfterSteps)) }) as unknown as Row<'pr_reviews'>;
const inputs = (steps: Row<'build_steps'>[], extra: Record<string, unknown> = {}): PostmortemInputs => ({ request: { id: 'r', state: 'done' }, taskCode: 'TSK-X-001', steps, reviews: [], codeOpinions: [], layersOpinion: null, testRuns: [], ...extra }) as unknown as PostmortemInputs;
const builder = (attempt: number, mode: 'resumed' | 'fresh', reason_code: string, extra: Record<string, unknown> = {}) =>
  step(attempt, 'builder', 'ok', { session: { mode, id: 'abc', reason: 'why', reason_code }, duration_ms: 120_000, usage: { inputTokens: 1000, outputTokens: 500 }, ...extra });
const emptyCommit = (attempt: number) => step(attempt, 'commit', 'failed', { error: 'The builder changed nothing: there is nothing to commit.' });

describe('session.insisted (B20)', () => {
  it('tp: the resumed attempt changed nothing and the forced fresh session merged', () => {
    const f = sessionInsisted(inputs([builder(1, 'fresh', 'first'), builder(2, 'resumed', 'cap'), emptyCommit(2), builder(3, 'fresh', 'insisted'), step(3, 'merge', 'ok')]));
    expect(f.map((x) => [x.finding, x.class, x.attempt, x.value, x.unit])).toEqual([
      ['session.insisted', 'tp', 2, 1, 'attempts'],
      ['session.insisted_cost', 'cost', 2, 2, 'min'],
      ['session.insisted_cost_tokens', 'cost', 2, 1500, 'tokens'],
    ]);
  });
  it('fp: the forced fresh session changed nothing either', () => {
    const f = sessionInsisted(inputs([builder(2, 'resumed', 'cap'), emptyCommit(2), builder(3, 'fresh', 'insisted'), emptyCommit(3)]));
    expect(f[0]).toMatchObject({ finding: 'session.insisted', class: 'fp', attempt: 2 });
  });
  it('a repeated blocking comment is the positive; tp when the next attempt changed its path', () => {
    const body = 'The login form does not validate the email before submitting the request.';
    const steps = [
      builder(1, 'fresh', 'first'),
      step(1, 'review', 'changes_requested', { run_id: 'rv1' }),
      builder(2, 'resumed', 'cap'),
      step(2, 'commit', 'ok', { sha: 'a', files: ['src/login.tsx'] }),
      step(2, 'review', 'changes_requested', { run_id: 'rv2' }),
      builder(3, 'fresh', 'insisted'),
      step(3, 'commit', 'ok', { sha: 'b', files: ['src/login.tsx', 'src/validate.ts'], own_files: ['src/validate.ts', 'src/login.tsx'] }),
    ];
    const c = [{ path: 'src/login.tsx', severity: 'blocking', body }];
    const reviews = [
      { id: 'rv1', run_id: 'rv1', verdict: 'changes_requested', comments: c, created_at: steps[1]!.created_at },
      { id: 'rv2', run_id: 'rv2', verdict: 'changes_requested', comments: c, created_at: steps[4]!.created_at },
    ] as unknown as Row<'pr_reviews'>[];
    const f = sessionInsisted(inputs(steps, { reviews }));
    expect(f[0]).toMatchObject({ class: 'tp', subject: 'src/login.tsx', ground_truth: 'G04' });
    expect(f[0]!.evidence).toMatchObject({ forced_fresh: true });
  });
  it('info when no forced fresh session followed, and nothing for a fresh or non-empty attempt', () => {
    const f = sessionInsisted(inputs([builder(2, 'resumed', 'cap'), emptyCommit(2), builder(3, 'resumed', 'cap')]));
    expect(f[0]).toMatchObject({ class: 'info' });
    expect(f[0]!.evidence).toMatchObject({ forced_fresh: false });
    expect(sessionInsisted(inputs([builder(2, 'fresh', 'engine_changed'), emptyCommit(2)]))).toEqual([]);
    expect(sessionInsisted(inputs([builder(2, 'resumed', 'cap'), step(2, 'commit', 'ok', { files: ['a.ts'] })]))).toEqual([]);
  });
});

describe('session reason_code and last turn tokens', () => {
  it('session.mode carries the reason_code in its evidence', () => {
    const f = sessionMode(inputs([builder(1, 'fresh', 'first'), builder(2, 'fresh', 'files_missing')]));
    expect(f[0]!.evidence).toMatchObject({ reason_code: 'files_missing' });
  });
  it('session.last_turn_tokens is an info row per attempt that stored it', () => {
    const f = sessionLastTurnTokens(inputs([builder(1, 'fresh', 'first', { usage: { inputTokens: 10, outputTokens: 1, last_turn_input_tokens: 45_000 } }), builder(2, 'resumed', 'cap')]));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ piece: 'B20', finding: 'session.last_turn_tokens', class: 'info', attempt: 1, value: 45_000, unit: 'tokens' });
  });
});

const env = (attempt: number, outcome: string, smoke: unknown, extra: Record<string, unknown> = {}) => step(attempt, 'environment', outcome, { smoke, ...extra });
const withGreen = (attempt: number, failing_on_main: number) => step(attempt, 'builder', 'ok', { duration_ms: 600_000, tdd: { status: 'passed', green: { passed: 3, failed: 0, failing_on_main } } });

describe('environment.smoke (B25)', () => {
  it('tp: red and a later GREEN found failing_on_main; the cost and the saved builder minutes are rows', () => {
    const f = environmentSmoke(inputs([env(1, 'failed', { ok: false, commands: ['pnpm build'], failed: ['AC-X-001-01 login'], duration_ms: 90_000 }), withGreen(2, 2), env(2, 'ok', { ok: true, commands: [], failed: [], duration_ms: 30_000 })]));
    expect(f.find((x) => x.finding === 'environment.smoke' && x.attempt === 1)).toMatchObject({ class: 'tp' });
    expect(f.find((x) => x.finding === 'environment.smoke_cost' && x.attempt === 1)).toMatchObject({ class: 'cost', value: 1.5, unit: 'min' });
    expect(f.find((x) => x.finding === 'environment.smoke_saved')).toMatchObject({ class: 'benefit', value: 10, unit: 'min' });
  });
  it('fp: red by environment', () => {
    const f = environmentSmoke(inputs([env(1, 'failed', { ok: false, commands: [], failed: ['browserType.launch: Executable doesn\'t exist'], duration_ms: 1000 })]));
    expect(f.find((x) => x.finding === 'environment.smoke')).toMatchObject({ class: 'fp' });
  });
  it('red with nothing deciding it stays info', () => {
    const f = environmentSmoke(inputs([env(1, 'failed', { ok: false, commands: [], failed: ['a test'], duration_ms: 1000 })]));
    expect(f.find((x) => x.finding === 'environment.smoke')).toMatchObject({ class: 'info' });
  });
  it('fn: green but the GREEN of the same attempt found failing_on_main; tn when it did not', () => {
    const green = { ok: true, commands: [], failed: [], duration_ms: 1000 };
    expect(environmentSmoke(inputs([env(1, 'ok', green), withGreen(1, 1)])).find((x) => x.finding === 'environment.smoke')).toMatchObject({ class: 'fn', value: 1 });
    expect(environmentSmoke(inputs([env(1, 'ok', green), withGreen(1, 0)])).find((x) => x.finding === 'environment.smoke')).toMatchObject({ class: 'tn' });
  });
  it('a skipped smoke or a step without one gives nothing', () => {
    expect(environmentSmoke(inputs([env(1, 'ok', { skipped: 'no ci' }), step(1, 'environment', 'ok', {})]))).toEqual([]);
  });
  it('environment.start_command is info with the command or zero', () => {
    const f = environmentStartCommand(inputs([env(1, 'ok', null, { start_command: 'pnpm dev' }), env(2, 'ok', null), env(3, 'ok', null, { start_command: { command: 'node e2e/fake-identity-provider.ts' } })]));
    expect(f.map((x) => [x.value, x.subject])).toEqual([[1, 'pnpm dev'], [0, null], [1, 'node e2e/fake-identity-provider.ts']]); // pm-8: the step stores an object {command}
    expect(f.every((x) => x.class === 'info')).toBe(true);
  });
});

describe('builder.screen_check (B27)', () => {
  const page = step(1, 'commit', 'ok', { files: ['app/login/page.tsx', 'app/login/Form.tsx'] });
  const screens = (attempt: number) => step(attempt, 'builder', 'ok', { duration_ms: 60_000, screens: [{ criterion: 'AC-X-001-01', path: '.demiurgo/screens/AC-X-001-01.png' }], tdd: { red: [{ criterion: 'AC-X-001-02', outcome: 'failed' }] } });
  const comment = (path: string) => [{ path, severity: 'blocking', body: 'The error message overlaps the submit button.' }];
  const rv = (comments: unknown[]) => [{ id: 'rv', run_id: 'rv', verdict: 'changes_requested', comments, created_at: new Date() }] as unknown as Row<'pr_reviews'>[];

  it('nothing for a task that touches no page', () => {
    expect(builderScreenCheck(inputs([step(1, 'commit', 'ok', { files: ['src/lib/x.ts'] }), screens(1)]))).toEqual([]);
  });
  it('tp for a criterion with a screenshot that merged without a blocking UI comment; fn-less info for the other; cost once', () => {
    const f = builderScreenCheck(inputs([page, screens(1), step(1, 'merge', 'ok')]));
    const rows = f.filter((x) => x.finding === 'builder.screen_check');
    expect(rows.map((x) => [x.subject, x.class])).toEqual([['AC-X-001-01', 'tp'], ['AC-X-001-02', 'info']]);
    expect(f.filter((x) => x.finding === 'builder.screen_check_cost')).toEqual([expect.objectContaining({ class: 'cost', value: 1, unit: 'min' })]);
  });
  it('fn for a criterion without a screenshot when a blocking comment hit a UI file', () => {
    const f = builderScreenCheck(inputs([page, screens(1), step(1, 'merge', 'ok')], { reviews: rv(comment('app/login/Form.tsx')) }));
    const rows = f.filter((x) => x.finding === 'builder.screen_check');
    expect(rows.map((x) => [x.subject, x.class])).toEqual([['AC-X-001-01', 'info'], ['AC-X-001-02', 'fn']]);
  });
  it('with loaded categories only a defect (p >= 0.5) counts', () => {
    const kinds = [{ pr_review_id: 'rv', comment_index: 0, category: 'style', p: 0.9 }];
    const f = builderScreenCheck(inputs([page, screens(1), step(1, 'merge', 'ok')], { reviews: rv(comment('app/login/Form.tsx')), reviewKinds: kinds }));
    expect(f.filter((x) => x.finding === 'builder.screen_check').map((x) => x.class)).toEqual(['tp', 'info']);
    const defect = [{ pr_review_id: 'rv', comment_index: 0, category: 'defect', p: 0.9 }];
    const g = builderScreenCheck(inputs([page, screens(1), step(1, 'merge', 'ok')], { reviews: rv(comment('app/login/Form.tsx')), reviewKinds: defect }));
    expect(g.filter((x) => x.finding === 'builder.screen_check').map((x) => x.class)).toEqual(['info', 'fn']);
  });
});
