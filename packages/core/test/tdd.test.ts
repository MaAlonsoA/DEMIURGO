import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DockerExec } from '../src/runner/environment.ts';
import type { BuilderResult } from '../src/runner/builder.ts';
import {
  type Parsed,
  type TddTest,
  codePattern,
  e2eSelection,
  greenResult,
  mergeBuilderResults,
  parsePlaywright,
  parseVitest,
  planTddTests,
  playwrightCommand,
  redEntries,
  redReason,
  shellQuote,
  tddFeedback,
  tddSummary,
  testCommandsFromCi,
  verdictOf,
  verifyTdd,
  vitestCommand,
} from '../src/build/tdd.ts';

const CI = `
jobs:
  ci:
    steps:
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test:unit
      - run: pnpm exec playwright test --trace=off $E2E_ARGS
      - run: pnpm exec playwright test --config=playwright.workouts.config.ts --trace=off $E2E_ARGS
`;
const PKG = JSON.stringify({ scripts: { 'test:unit': 'vitest run', build: 'next build' } });

describe('testCommandsFromCi', () => {
  it('finds Vitest through the package script and every Playwright config', () => {
    const r = testCommandsFromCi(CI, PKG);
    expect(r).toEqual({ exec: 'pnpm exec', build: 'pnpm build', vitest: true, playwright: [null, 'playwright.workouts.config.ts'] });
  });
  it('follows a chained script and uses npx for npm', () => {
    const ci = 'jobs:\n  ci:\n    steps:\n      - run: npm ci\n      - run: npm test\n';
    const r = testCommandsFromCi(ci, JSON.stringify({ scripts: { test: 'vitest run && playwright test --config=e2e.config.ts' } }));
    expect(r).toMatchObject({ exec: 'npx --no-install', vitest: true, playwright: ['e2e.config.ts'] });
  });
  it('gives null when the CI runs no known runner or is not a workflow', () => {
    expect(testCommandsFromCi('jobs:\n  ci:\n    steps:\n      - run: make test\n', null)).toBeNull();
    expect(testCommandsFromCi('not: [a workflow', null)).toBeNull();
    expect(testCommandsFromCi('jobs:\n  lint:\n    steps: []\n', null)).toBeNull();
  });
});

describe('planTddTests', () => {
  const file = (path: string, content: string, baseContent: string | null = null) => ({ path, content, baseContent });
  it('takes the criterion tests of changed files, marks the ones that were on main and the criteria already green', () => {
    const files = [
      file('e2e/a.spec.ts', "import { test } from '@playwright/test';\ntest('AC-X-001-01 shows it', async () => {});\n", null),
      file('src/b.test.ts', "it('AC-X-001-02 sums', () => {});\nit('AC-Z-009-09 other', () => {});\n", "it('AC-X-001-02 sums', () => {});\n"),
    ];
    const base = new Map([['AC-X-001-03', [{ criterion: 'AC-X-001-03', path: 'src/c.test.ts', title: 'AC-X-001-03 old', level: 'unit' as const }]]]);
    const plan = planTddTests(files, ['AC-X-001-01', 'AC-X-001-02', 'AC-X-001-03', 'AC-X-001-04'], base);
    expect(plan.run.map((t) => [t.criterion, t.level, t.existedOnMain])).toEqual([
      ['AC-X-001-01', 'e2e', false],
      ['AC-X-001-02', 'unit', true],
    ]);
    expect(plan.alreadyGreen).toMatchObject([{ criterion: 'AC-X-001-03', outcome: 'already_green_on_main' }]);
    expect(plan.uncovered).toEqual(['AC-X-001-04']);
  });
});

describe('command lines', () => {
  const runner = { exec: 'pnpm exec', vitest: true, playwright: [null] };
  it('quotes values for sh', () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });
  it('matches codes as whole words', () => {
    const re = new RegExp(codePattern(['AC-X-001-01']));
    expect(re.test('AC-X-001-01 does it')).toBe(true);
    expect(re.test('AC-X-001-010 does it')).toBe(false);
  });
  it('runs Vitest on the files with -t', () => {
    expect(vitestCommand(runner, { output: '.demiurgo/tdd/r.json', files: ['src/a.test.ts'], codes: ['AC-X-001-01'] })).toBe(
      `pnpm exec vitest run --reporter=json --outputFile='.demiurgo/tdd/r.json' --passWithNoTests 'src/a.test.ts' -t '${codePattern(['AC-X-001-01'])}'`,
    );
  });
  it('runs Playwright with the JSON report, the config, --grep and the files', () => {
    const cmd = playwrightCommand(runner, { output: 'o.json', config: 'p.config.ts', files: ['e2e/a.spec.ts'], codes: ['AC-X-001-01'] });
    expect(cmd).toBe(
      `PLAYWRIGHT_JSON_OUTPUT_NAME='o.json' pnpm exec playwright test --trace=off --reporter=json --config='p.config.ts' --grep='${codePattern(['AC-X-001-01'])}' --pass-with-no-tests 'e2e/a.spec.ts'`,
    );
    expect(playwrightCommand(runner, { output: 'o.json', config: null, args: ['--grep=a b', '--pass-with-no-tests'] })).toContain(`'--grep=a b'`);
  });
});

describe('reading the reports', () => {
  it('reads Playwright specs, their errors and global errors', () => {
    const json = JSON.stringify({
      suites: [
        {
          file: 'e2e/a.spec.ts',
          specs: [],
          suites: [
            {
              specs: [
                { title: 'AC-X-001-01 ok', ok: true, file: 'e2e/a.spec.ts', tests: [{ status: 'expected', results: [{ status: 'passed' }] }] },
                { title: 'AC-X-001-02 bad', ok: false, file: 'e2e/a.spec.ts', tests: [{ status: 'unexpected', results: [{ status: 'failed', error: { message: 'expect(received).toBe(expected)\nmore' } }] }] },
                { title: 'AC-X-001-03 skipped', ok: true, file: 'e2e/a.spec.ts', tests: [{ status: 'skipped', results: [] }] },
              ],
            },
          ],
        },
      ],
      errors: [{ message: 'global setup failed' }],
    });
    const p = parsePlaywright(json);
    expect(p.ran).toBe(true);
    expect(p.tests.map((t) => [t.title, t.status])).toEqual([
      ['AC-X-001-01 ok', 'passed'],
      ['AC-X-001-02 bad', 'failed'],
      ['AC-X-001-03 skipped', 'skipped'],
    ]);
    expect(p.tests[1]?.message).toContain('expect(received)');
    expect(p.fileErrors).toEqual([{ file: '', message: 'global setup failed' }]);
  });
  it('reads Vitest results and a file that fails to import', () => {
    const json = JSON.stringify({
      testResults: [
        { name: '/workspace/src/a.test.ts', status: 'failed', assertionResults: [{ title: 'AC-X-001-01 x', status: 'failed', failureMessages: ['AssertionError: nope'] }, { title: 'AC-X-001-02 y', status: 'passed', failureMessages: [] }] },
        { name: '/workspace/src/b.test.ts', status: 'failed', message: 'Failed to resolve import "./missing"', assertionResults: [] },
      ],
    });
    const p = parseVitest(json);
    expect(p.tests).toMatchObject([
      { title: 'AC-X-001-01 x', file: 'src/a.test.ts', status: 'failed' },
      { title: 'AC-X-001-02 y', status: 'passed' },
    ]);
    expect(p.fileErrors).toEqual([{ file: 'src/b.test.ts', message: 'Failed to resolve import "./missing"' }]);
  });
  it('says it did not run when there is no usable report', () => {
    expect(parseVitest(null, 'boom')).toMatchObject({ ran: false, crash: 'boom' });
    expect(parsePlaywright('not json', 'boom')).toMatchObject({ ran: false, crash: 'boom' });
  });
});

describe('RED', () => {
  const test = (criterion: string, path: string, existedOnMain = false): TddTest => ({ criterion, path, title: `${criterion} t`, level: 'unit', existedOnMain });
  const parsed = (tests: Parsed['tests'], fileErrors: Parsed['fileErrors'] = []): Parsed => ({ ran: true, tests, fileErrors });
  it('a test that fails on main is red; one that passes does not check its criterion', () => {
    const tests = [test('AC-X-001-01', 'a.test.ts'), test('AC-X-001-02', 'a.test.ts')];
    const red = redEntries(tests, [
      parsed([
        { title: 'AC-X-001-01 t', file: 'a.test.ts', status: 'failed', message: 'expected 1 to be 2' },
        { title: 'AC-X-001-02 t', file: 'a.test.ts', status: 'passed' },
      ]),
    ]);
    expect(red.map((r) => [r.criterion, r.outcome])).toEqual([
      ['AC-X-001-01', 'failed'],
      ['AC-X-001-02', 'passed'],
    ]);
    expect(verdictOf(red, null).ok).toBe(false);
    expect(verdictOf(red, null).red).toHaveLength(1);
  });
  it('a test that passes but already existed on main is already green, not a failure of RED', () => {
    const red = redEntries([test('AC-X-001-01', 'a.test.ts', true)], [parsed([{ title: 'AC-X-001-01 t', file: 'a.test.ts', status: 'passed' }])]);
    expect(red[0]?.outcome).toBe('already_green_on_main');
    expect(verdictOf(red, null).ok).toBe(true);
  });
  it('a missing module or compile error counts as red and the reason says so', () => {
    const red = redEntries([test('AC-X-001-01', 'src/a.test.ts')], [parsed([], [{ file: 'src/a.test.ts', message: 'Failed to resolve import "./share" from "src/a.test.ts"' }])]);
    expect(red[0]).toMatchObject({ outcome: 'failed' });
    expect(red[0]?.reason).toMatch(/^cannot load without the change/);
    expect(redReason('AssertionError: expected 1 to be 2')).toBe('AssertionError: expected 1 to be 2');
  });
  it('a runner that produced no report is red with its reason; a test no one ran is not_run', () => {
    expect(redEntries([test('AC-X-001-01', 'a.test.ts')], [{ ran: false, crash: 'vitest produced no report', tests: [], fileErrors: [] }])[0]).toMatchObject({ outcome: 'failed' });
    expect(redEntries([test('AC-X-001-01', 'a.test.ts')], [parsed([])])[0]).toMatchObject({ outcome: 'not_run' });
  });
});

describe('GREEN', () => {
  const own: TddTest[] = [{ criterion: 'AC-X-001-01', path: 'a.test.ts', title: 'AC-X-001-01 t', level: 'unit', existedOnMain: false }];
  const run: Parsed = {
    ran: true,
    fileErrors: [],
    tests: [
      { title: 'AC-X-001-01 t', file: 'a.test.ts', status: 'passed' },
      { title: 'other passes', file: 'b.test.ts', status: 'passed' },
      { title: 'other fails', file: 'b.test.ts', status: 'failed', message: 'boom\nstack' },
      { title: 'broken on main', file: 'c.test.ts', status: 'failed', message: 'also boom' },
    ],
  };
  it('counts the criterion tests and the selected ones apart and lists failures first', () => {
    const g = greenResult([run], own);
    expect(g).toMatchObject({ passed: 2, failed: 2, failing_on_main: 0, criterion: { passed: 1, failed: 0 }, selected: { passed: 1, failed: 2 } });
    expect(g.tests.map((t) => t.outcome)).toEqual(['failed', 'failed', 'passed']);
    expect(verdictOf([], g).ok).toBe(false);
  });
  it('a failure that also fails on main does not block', () => {
    const g = greenResult([run], own, [], new Set(['other fails', 'broken on main']));
    expect(g).toMatchObject({ failed: 0, failing_on_main: 2 });
    expect(g.tests.filter((t) => t.outcome === 'failing_on_main')).toHaveLength(2);
    expect(verdictOf([], g).ok).toBe(true);
  });
  it('a failing build or a file error is a failure', () => {
    const g = greenResult([{ ran: true, tests: [], fileErrors: [{ file: 'x.test.ts', message: 'SyntaxError' }] }], own, [{ test: 'pnpm build', reason: 'The build fails' }]);
    expect(g.failed).toBe(2);
  });
});

describe('feedback to the builder', () => {
  it('lists each test, its phase and a capped output', () => {
    const red = redEntries(
      [{ criterion: 'AC-X-001-02', path: 'a.test.ts', title: 'AC-X-001-02 t', level: 'unit', existedOnMain: false }],
      [{ ran: true, fileErrors: [], tests: [{ title: 'AC-X-001-02 t', file: 'a.test.ts', status: 'passed' }] }],
    );
    const green = greenResult([{ ran: true, fileErrors: [], tests: [{ title: 'x', file: 'b.test.ts', status: 'failed', message: 'y'.repeat(5000) }] }], []);
    const text = tddFeedback(verdictOf(red, green), 2, 15);
    expect(text).toContain('loop 2 of at most 15');
    expect(text).toContain('RED');
    expect(text).toContain('AC-X-001-02: `AC-X-001-02 t` in a.test.ts');
    expect(text).toContain('GREEN');
    expect(text).toContain('`x` in b.test.ts');
    expect(text.length).toBeLessThan(2500);
  });
  it('summarises a red end in one line', () => {
    const detail = { status: 'red' as const, loops: 15, stopped: 'cap' as const, red: [{ criterion: 'AC-X-001-01', test: 't', path: 'p', outcome: 'passed' as const }], green: { passed: 1, failed: 2, failing_on_main: 0, criterion: { passed: 1, failed: 0 }, selected: { passed: 0, failed: 2 }, tests: [] } };
    expect(tddSummary(detail)).toBe('Test-driven check failed after 15 loops: 1 criterion test pass on main without the change; 2 tests fail with it. Nothing was committed or pushed.');
  });
});

describe('mergeBuilderResults', () => {
  const run = (over: Partial<BuilderResult>): BuilderResult => ({ state: 'ok', exitCode: 0, durationMs: 10, transcriptTail: '', report: null, container: 'c', ...over });
  it('adds time and usage and keeps the last run', () => {
    const first = run({ usage: { inputTokens: 1, outputTokens: 2, durationMs: 3, declaredCostUsd: 0.5 }, sessionId: 's1' });
    const loop = run({ durationMs: 20, usage: { inputTokens: 10, outputTokens: 20, durationMs: 30 }, report: { summary: 'x', tests: [], notes: '' } });
    const merged = mergeBuilderResults(first, [loop]);
    expect(merged).toMatchObject({ durationMs: 30, sessionId: 's1', usage: { inputTokens: 11, outputTokens: 22, durationMs: 33, declaredCostUsd: 0.5 }, report: { summary: 'x' } });
    expect(mergeBuilderResults(first, [])).toBe(first);
  });
});

describe('e2e selection of the CI selector', () => {
  it('selects by the affected criteria and the task own', async () => {
    const s = await e2eSelection({ affected: ['AC-X-001-02'], criteria: ['AC-X-001-01'], changedFiles: ['src/a.ts'] });
    expect(s.args[0]).toContain('AC-X-001-02');
    expect(s.args[0]).toContain('AC-X-001-01');
  });
  it('never uses --only-changed (no git history in the container): only the task own criteria', async () => {
    const s = await e2eSelection({ affected: null, criteria: [], changedFiles: [] });
    expect(s.args.every((a) => !a.startsWith('--only-changed'))).toBe(true);
  });
});

describe('verifyTdd', () => {
  const input = {
    worktreePath: '/nonexistent/worktree',
    requestId: 'r',
    criteria: ['AC-X-001-01'],
    affected: null,
    prepared: { network: 'n', storeVolume: 'v', env: {} },
    session: undefined,
    rerun: async () => {
      throw new Error('must not run');
    },
  };
  it('records skipped when the project has no CI to take the commands from, and never throws', async () => {
    const out = await verifyTdd(input);
    expect(out.detail).toMatchObject({ status: 'skipped', loops: 0, red: [], green: null });
    expect(out.stopped).toBeNull();
  });
});

describe('verifyTdd on a real worktree with a fake container runner', () => {
  const saved = { ...process.env };
  let root = '';
  let worktree = '';
  const git = (dir: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-C', dir, ...args], { stdio: 'pipe' });
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'tdd-'));
    process.env.DEMIURGO_PROJECTS_DIR = root;
    process.env.DEMIURGO_PROJECTS_HOST_DIR = root;
    const repo = join(root, 'repo');
    mkdirSync(join(repo, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(repo, '.github', 'workflows', 'ci.yml'), 'jobs:\n  ci:\n    steps:\n      - run: pnpm install --frozen-lockfile\n      - run: pnpm exec vitest run\n');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'base');
    mkdirSync(join(root, '.worktrees'), { recursive: true });
    worktree = join(root, '.worktrees', 'r1');
    git(repo, 'worktree', 'add', '-q', '-b', 'task/x', worktree, 'main');
    // The builder's uncommitted work: a new test for the criterion.
    mkdirSync(join(worktree, 'src'), { recursive: true });
    writeFileSync(join(worktree, 'src', 'a.test.ts'), "import { it } from 'vitest';\nit('AC-X-001-01 shares it', () => {});\n");
  });
  afterAll(() => {
    process.env = saved;
    rmSync(root, { recursive: true, force: true });
  });

  /** A fake docker: `vitest` runs write a report; the test passes on the worktree and, on main's checkout, as `onMain` says. */
  const fakeExec = (onMain: () => 'passed' | 'failed', commands: string[]): DockerExec => async (args) => {
    if (args[0] !== 'run') return { code: 0, stdout: '', stderr: '', timedOut: false };
    const mount = args.find((a) => a.startsWith('type=bind,source='));
    const dir = /source=([^,]+),/.exec(mount ?? '')?.[1] ?? '';
    const command = (args.at(-1) ?? '').replace(/^set -eu; cd \/workspace; /, '');
    commands.push(`${dir.includes('.tdd') ? 'main' : 'branch'}: ${command}`);
    const out = /--outputFile='([^']+)'/.exec(command)?.[1];
    if (out) {
      const status = dir.includes('.tdd') ? onMain() : 'passed';
      mkdirSync(join(dir, '.demiurgo', 'tdd'), { recursive: true });
      writeFileSync(
        join(dir, out),
        JSON.stringify({ testResults: [{ name: '/workspace/src/a.test.ts', status, assertionResults: [{ title: 'AC-X-001-01 shares it', status, failureMessages: status === 'failed' ? ['AssertionError: not shared'] : [] }] }] }),
      );
    }
    return { code: 0, stdout: '', stderr: '', timedOut: false };
  };
  const base = { criteria: ['AC-X-001-01'], affected: null, prepared: { network: 'n', storeVolume: 'v', env: {} } };

  it('RED fails on main and GREEN passes: status passed, no loop, and the exact commands', async () => {
    const commands: string[] = [];
    const out = await verifyTdd({ ...base, worktreePath: worktree, requestId: 'r1', exec: fakeExec(() => 'failed', commands), session: 's', rerun: async () => { throw new Error('no loop expected'); } });
    expect(out.detail).toMatchObject({ status: 'passed', loops: 0, red: [{ criterion: 'AC-X-001-01', outcome: 'failed', reason: 'AssertionError: not shared' }], green: { failed: 0, criterion: { passed: 1, failed: 0 } } });
    expect(commands.some((c) => c.startsWith('main: pnpm install'))).toBe(true);
    expect(commands.find((c) => c.startsWith('main: pnpm exec vitest'))).toContain("'src/a.test.ts' -t");
    expect(commands.find((c) => c.startsWith('branch: pnpm exec vitest'))).not.toContain("'src/a.test.ts'");
    expect(out.stopped).toBeNull();
  });

  it('a new test that passes on main sends the builder back in its session, then passes', async () => {
    let mainStatus: 'passed' | 'failed' = 'passed';
    const prompts: string[] = [];
    const out = await verifyTdd({
      ...base, worktreePath: worktree, requestId: 'r1', exec: fakeExec(() => mainStatus, []), session: 's1',
      rerun: async (prompt, loop, session) => {
        prompts.push(prompt);
        expect([loop, session]).toEqual([1, 's1']);
        mainStatus = 'failed';
        // The builder rewrites the test so that it asserts the new behaviour (a changed file is checked on main again).
        writeFileSync(join(worktree, 'src', 'a.test.ts'), "import { it } from 'vitest';\nit('AC-X-001-01 shares it', () => { /* now asserts */ });\n");
        return { state: 'ok', exitCode: 0, durationMs: 1, transcriptTail: '', report: null, container: 'c' };
      },
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('RED');
    expect(out.detail).toMatchObject({ status: 'passed', loops: 1 });
    expect(out.runs).toHaveLength(1);
  });

  it('still red at the cap: stopped red, nothing to push', async () => {
    const out = await verifyTdd({
      ...base, worktreePath: worktree, requestId: 'r1', exec: fakeExec(() => 'passed', []), session: 's1', maxLoops: 2,
      rerun: async () => ({ state: 'ok', exitCode: 0, durationMs: 1, transcriptTail: '', report: null, container: 'c' }),
    });
    expect(out.stopped).toBe('red');
    expect(out.detail).toMatchObject({ status: 'red', loops: 2, stopped: 'cap' });
    expect(out.runs).toHaveLength(2);
  });

  it('without a session id it cannot loop: stopped red', async () => {
    const out = await verifyTdd({ ...base, worktreePath: worktree, requestId: 'r1', exec: fakeExec(() => 'passed', []), session: undefined, rerun: async () => { throw new Error('no'); } });
    expect(out).toMatchObject({ stopped: 'red', detail: { stopped: 'no_session' } });
  });

  it('a builder that fails while sent back ends the gate with its result', async () => {
    const out = await verifyTdd({
      ...base, worktreePath: worktree, requestId: 'r1', exec: fakeExec(() => 'passed', []), session: 's1',
      rerun: async () => ({ state: 'failure', exitCode: 1, durationMs: 1, transcriptTail: '', report: null, container: 'c', failureKind: 'timeout' }),
    });
    expect(out.stopped).toBe('builder_failed');
  });

  it('a container that cannot run is skipped, not red', async () => {
    const out = await verifyTdd({ ...base, worktreePath: worktree, requestId: 'r1', exec: async () => ({ code: 125, stdout: '', stderr: 'docker: no daemon', timedOut: false }), session: 's', rerun: async () => { throw new Error('no'); } });
    expect(out.detail.status).toBe('skipped');
    expect(out.stopped).toBeNull();
  });
});
