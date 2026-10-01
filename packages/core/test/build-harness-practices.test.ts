import { describe, expect, it } from 'vitest';
import { startCommandOf, startLine, environmentFromCi } from '../src/build/environment.ts';
import { repeatsBlocking, changedNothing } from '../src/build/insisted.ts';
import { accumulateProgress, commitMessageOf, ownProgress, sameFileList, screensOf } from '../src/build/progress.ts';
import { type PreviousBuilderAttempt, builderSessionPlan } from '../src/build/session.ts';
import { type TddRunner, smokeCommands } from '../src/build/tdd.ts';
import { claudeTurnInputOf, codexTurnInputOf, usageCollector } from '../src/runner/builder-usage.ts';

const engine = { provider: 'claude', model: 'sonnet' };
const attempt = (o: Partial<PreviousBuilderAttempt> = {}): PreviousBuilderAttempt => ({ provider: 'claude', model: 'sonnet', session: { mode: 'fresh', id: 'abcdef12-0000' }, filesExist: true, ...o });

describe('session plan when the previous attempt insisted', () => {
  it('starts fresh with the reason «insisted» even below the cap', () => {
    const plan = builderSessionPlan([attempt()], engine, true);
    expect(plan).toMatchObject({ mode: 'fresh', reason: 'insisted', reason_code: 'insisted' });
  });
  it('still resumes when it did not insist', () => {
    expect(builderSessionPlan([attempt()], engine, false)).toMatchObject({ mode: 'resumed', reason_code: 'resumed' });
  });
  it('reports the other reasons by code', () => {
    expect(builderSessionPlan([], engine).reason_code).toBe('first');
    expect(builderSessionPlan([attempt({ model: 'opus' })], engine, true).reason_code).toBe('engine_changed');
    expect(builderSessionPlan([attempt({ filesExist: false })], engine, true).reason_code).toBe('files_missing');
    const resumed = { mode: 'resumed' as const, id: 'abcdef12-0000' };
    expect(builderSessionPlan([attempt(), attempt({ session: resumed }), attempt({ session: resumed })], engine).reason_code).toBe('cap');
  });
});

describe('insisting signals', () => {
  const finding = (path: string, body: string, severity = 'blocking') => ({ path, severity, body });
  it('sees the same blocking finding on the same path', () => {
    const before = [finding('src/a.ts', 'The share endpoint does not check that the recipe belongs to the current user.')];
    expect(repeatsBlocking(before, [finding('src/a.ts', 'The share endpoint does not check that the recipe belongs to the current user, please fix.')])).toBe(true);
  });
  it('does not count another path, another text or a non-blocking comment', () => {
    const before = [finding('src/a.ts', 'The share endpoint does not check that the recipe belongs to the current user.')];
    expect(repeatsBlocking(before, [finding('src/b.ts', 'The share endpoint does not check that the recipe belongs to the current user.')])).toBe(false);
    expect(repeatsBlocking(before, [finding('src/a.ts', 'The button label is hard-coded in English and breaks the translated page.')])).toBe(false);
    expect(repeatsBlocking(before, [finding('src/a.ts', 'The share endpoint does not check that the recipe belongs to the current user.', 'suggestion')])).toBe(false);
  });
  it('reads «changed nothing» from a failed commit', () => {
    expect(changedNothing({ error: 'The builder changed nothing: there is nothing to commit.' })).toBe(true);
    expect(changedNothing({ error: 'git hook failed' })).toBe(false);
    expect(changedNothing(null)).toBe(false);
  });
});

describe('progress file', () => {
  it('accumulates the attempts oldest first under their headers and caps each one', () => {
    const text = accumulateProgress(
      [
        { attempt: 2, text: 'second' },
        { attempt: 1, text: 'x'.repeat(50) },
        { attempt: 3, text: '   ' },
      ],
      10,
    );
    expect(text).toBe(`## Attempt 1\n${'x'.repeat(10)}\n… (truncated)\n\n## Attempt 2\nsecond`);
  });
  it('keeps only what the attempt added to the restored file', () => {
    const restored = '## Attempt 1\nfirst';
    expect(ownProgress(`${restored}\n\n## Attempt 2\nsecond`, restored)).toBe('## Attempt 2\nsecond');
    expect(ownProgress('rewritten from scratch', restored)).toBe('rewritten from scratch');
    expect(ownProgress('only mine', '')).toBe('only mine');
    expect(ownProgress(restored, restored)).toBe('');
  });
});

describe('commit message', () => {
  it('puts the report summary in the body after the title', () => {
    expect(commitMessageOf('TSK-1: Share recipes', 'Recipes can be shared.')).toBe('TSK-1: Share recipes\n\nRecipes can be shared.');
    expect(commitMessageOf('TSK-1: Share recipes', 'No report from the builder.')).toBe('TSK-1: Share recipes');
    expect(commitMessageOf('TSK-1: Share recipes', undefined)).toBe('TSK-1: Share recipes');
  });
});

describe('screens and file lists', () => {
  it('lists only <criterion>.png files', () => {
    expect(screensOf(['AC-REC-001-02.png', 'notes.txt', '../x.png', 'AC-REC-001-01.png'])).toEqual([
      { criterion: 'AC-REC-001-01', file: 'AC-REC-001-01.png' },
      { criterion: 'AC-REC-001-02', file: 'AC-REC-001-02.png' },
    ]);
  });
  it('compares file lists as sets', () => {
    expect(sameFileList(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameFileList(['a'], ['a', 'b'])).toBe(false);
    expect(sameFileList([], [])).toBe(true);
  });
});

describe('start command', () => {
  it('reads the webServer of the Playwright config', () => {
    const config = `export default defineConfig({ use: { baseURL: 'http://localhost:3000' }, webServer: { command: 'pnpm start', url: 'http://localhost:3100', reuseExistingServer: true } });`;
    expect(startCommandOf({ playwrightConfig: config })).toEqual({ command: 'pnpm start', url: 'http://localhost:3100' });
  });
  it('builds the url from a port, else from baseURL', () => {
    expect(startCommandOf({ playwrightConfig: `webServer: { command: "node server.js", port: 4321 }` })).toEqual({ command: 'node server.js', url: 'http://localhost:4321' });
    expect(startCommandOf({ playwrightConfig: `use: { baseURL: 'http://127.0.0.1:5000' }, webServer: { command: 'npm run serve' }` })).toEqual({ command: 'npm run serve', url: 'http://127.0.0.1:5000' });
  });
  it('falls back to package.json start, then dev, with the package manager', () => {
    expect(startCommandOf({ packageJson: JSON.stringify({ scripts: { start: 'next start', dev: 'next dev' } }) }, 'pnpm')).toEqual({ command: 'pnpm start' });
    expect(startCommandOf({ packageJson: JSON.stringify({ scripts: { dev: 'next dev' } }) }, 'pnpm')).toEqual({ command: 'pnpm run dev' });
    expect(startCommandOf({ packageJson: JSON.stringify({ scripts: { dev: 'vite' } }) })).toEqual({ command: 'npm run dev' });
  });
  it('ignores a webServer command that is a template and gives null with nothing', () => {
    expect(startCommandOf({ playwrightConfig: 'webServer: { command: `pnpm start --port ${PORT}` }' })).toBeNull();
    expect(startCommandOf({})).toBeNull();
  });
  it('formats the line of the brief', () => {
    expect(startLine({ command: 'pnpm start', url: 'http://localhost:3100' })).toBe('To run the app: `pnpm start`, at `http://localhost:3100`.');
    expect(startLine({ command: 'pnpm start' })).toBe('To run the app: `pnpm start`.');
  });
  it('environmentFromCi carries it, using the package manager of the install step', () => {
    const ci = `jobs:\n  ci:\n    steps:\n      - run: pnpm install --frozen-lockfile\n`;
    expect(environmentFromCi(ci, { packageJson: JSON.stringify({ scripts: { start: 'next start' } }) })?.start).toEqual({ command: 'pnpm start' });
    expect(environmentFromCi(ci)?.start).toBeUndefined();
  });
});

describe('smoke commands', () => {
  const runner: TddRunner = { exec: 'pnpm exec', build: 'pnpm build', vitest: true, playwright: [null] };
  const test = (criterion: string, path: string, level: 'e2e' | 'unit') => ({ criterion, path, title: `${criterion} works`, level });
  it('builds, then runs the unit and e2e tests of the previous task criteria', () => {
    const tests = new Map([
      ['AC-A-001-01', [test('AC-A-001-01', 'e2e/a.spec.ts', 'e2e')]],
      ['AC-A-001-02', [test('AC-A-001-02', 'src/a.test.ts', 'unit')]],
    ]);
    const commands = smokeCommands(runner, ['AC-A-001-01', 'AC-A-001-02', 'AC-A-001-03'], tests);
    expect(commands.map((c) => c.kind)).toEqual(['build', 'vitest', 'playwright']);
    expect(commands[1]?.command).toContain('src/a.test.ts');
    expect(commands[2]?.command).toContain('e2e/a.spec.ts');
  });
  it('is only the build when the previous task has no tests, and empty with nothing', () => {
    expect(smokeCommands(runner, ['AC-X-001-01'], new Map()).map((c) => c.kind)).toEqual(['build']);
    expect(smokeCommands({ ...runner, build: undefined }, [], new Map())).toEqual([]);
  });
});

describe('per-turn input tokens', () => {
  it('reads the size of the last Claude assistant turn, cache included', () => {
    const turn = (i: number, r: number, c: number) => JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: i, cache_read_input_tokens: r, cache_creation_input_tokens: c, output_tokens: 5 } } });
    expect(claudeTurnInputOf(turn(10, 2000, 300))).toBe(2310);
    expect(claudeTurnInputOf('{"type":"user"}')).toBeUndefined();
    const c = usageCollector('claude');
    c.add(`${turn(1, 100, 0)}\n${turn(2, 900, 50)}\n{"type":"result","usage":{}}`);
    expect(c.lastTurnInputTokens()).toBe(952);
  });
  it('reads the last Codex turn.completed', () => {
    const turn = (i: number) => JSON.stringify({ type: 'turn.completed', usage: { input_tokens: i, cached_input_tokens: 0, output_tokens: 1 } });
    expect(codexTurnInputOf(turn(70))).toBe(70);
    const c = usageCollector('codex');
    c.add(`${turn(100)}\n${turn(250)}\n`);
    expect(c.lastTurnInputTokens()).toBe(250);
    expect(usageCollector('codex').lastTurnInputTokens()).toBeUndefined();
  });
});
