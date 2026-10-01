// Test-driven gate of a build attempt: DEMIURGO itself checks, before the commit and the push, that the tests of
// the task's criteria fail without the change (RED) and that the suite passes with it (GREEN), in the builder's
// prepared environment. Practices: Kent Beck, «Test-Driven Development by Example» (red, green, refactor: do not
// move on while red); Freeman and Pryce, «Growing Object-Oriented Software, Guided by Tests» («watch the test
// fail»: a test never seen failing may not check what it claims); Martin Fowler, «Continuous Integration» (build
// and test locally before integrating, so a red does not cost a CI run). The loop cap of 15 is a decisión de la
// persona (01-10); the list of 5 failures shown to the builder, the output caps and the test timeouts are our convention.
//
// Pure parts (which tests, the command lines, reading the runners' JSON, the verdict and the builder's feedback)
// are exported for tests; `verifyTdd` runs them. Best effort: when the project's CI or the environment give
// nothing to run, the result says `skipped` and the attempt goes on as before. Nothing here adds, removes or
// reorders workflow steps: it runs inside the builder stage and only adds a `tdd` object to that step's detail.

import { execFile } from 'node:child_process';
import { copyFile, chmod, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Usage } from '@demiurgo/domain';
import { parse } from 'yaml';
import { type BuilderResult, setupArguments } from '../runner/builder.ts';
import { type DockerExec, type DockerResult, dockerExec } from '../runner/environment.ts';
import { environmentFromCi } from './environment.ts';
import { type TestEntry, mergeBaseWithMain, readRepoTests, testsFromSources } from './test-guard.ts';
import { changedWithPending, hostPathOf, readWorktreeFile, showAt } from './workspace.ts';

const run = promisify(execFile);
const git = (dir: string, args: string[]) => run('git', ['-c', 'safe.directory=*', '-C', dir, ...args], { maxBuffer: 64 * 1024 * 1024 });

/** How many times the builder is sent back (resumed) while RED or GREEN fails: decisión de la persona (01-10), a safety cap. */
export const TDD_MAX_LOOPS = 15;
/** Failures shown to the builder per loop, and characters of output per failure (our convention). */
export const FEEDBACK_FAILURES = 5;
export const FEEDBACK_OUTPUT = 700;
/** Tests listed in the step's detail (the person can expand them); counts always cover all (our convention). */
const DETAIL_TESTS = 60;
const TIMEOUTS = { install: 900_000, build: 900_000, tests: 1_500_000, migrate: 300_000 } as const;
const LIMITS = { cpus: 2, memoryMb: 4096, pids: 512 };

// ── types ────────────────────────────────────────────────────────────────────────────────────────────────────

export type TddRunner = {
  /** Prefix that runs a local binary: `pnpm exec`, `npx --no-install` or `yarn`. */
  exec: string;
  /** The CI's build command, when it has one (the e2e tests run against a build). */
  build?: string;
  vitest: boolean;
  /** One entry per `playwright test` of the CI: its `--config`, or null for the default. */
  playwright: (string | null)[];
};

export type TddTest = TestEntry & { existedOnMain: boolean };
export type TddFile = { path: string; content: string; baseContent: string | null };

export type RedOutcome = 'failed' | 'passed' | 'already_green_on_main' | 'not_run';
export type RedEntry = { criterion: string; test: string; path: string; outcome: RedOutcome; reason?: string };
export type GreenOutcome = 'passed' | 'failed' | 'failing_on_main';
export type GreenTest = { test: string; path: string | null; criterion: string | null; outcome: GreenOutcome; reason?: string };
export type Green = {
  passed: number;
  failed: number;
  failing_on_main: number;
  /** The criterion tests of the task and the rest (the selected e2e tests and the unit suite). */
  criterion: { passed: number; failed: number };
  selected: { passed: number; failed: number };
  /** Failures first, then the criterion tests; at most `DETAIL_TESTS`. */
  tests: GreenTest[];
  scope?: string;
};
/** What one loop (the builder sent back by the gate) took: kept per loop so the harness can price the gate. */
export type LoopRun = { loop: number; duration_ms: number; usage?: Usage; failure_class: FailureClass | null };
/**
 * Whose failure sent the builder back in a loop: `own` (a criterion test of the task is red on main or fails with the
 * change, or a failure with no criterion), `foreign` (every failing test belongs to a criterion the task does not
 * cover, e.g. a flaky performance test of another feature) or `environment` (the failure is the environment: a
 * missing database, a refused connection, a missing browser). Null when nothing failed. Convención nuestra.
 */
export type FailureClass = 'own' | 'foreign' | 'environment';
export type TddDetail = {
  status: 'passed' | 'red' | 'skipped';
  red: RedEntry[];
  green: Green | null;
  loops: number;
  skipped?: string;
  /** Why it ended red: the cap, a builder run that failed, or a session that cannot be resumed. */
  stopped?: 'cap' | 'builder_failed' | 'no_session';
  /** Criteria with no test at all (neither changed nor on main). */
  uncovered?: string[];
  /** Criteria the task covers that are `manual` or `release`: no test is expected (information only). */
  not_automated?: string[];
  notes?: string[];
  /** One entry per loop, in order (`loops` stays the count). Added by the orchestrator from `verifyTdd`'s `runs`. */
  loop_runs?: LoopRun[];
};

export type ParsedTest = { title: string; file: string | null; status: 'passed' | 'failed' | 'skipped'; message?: string };
export type Parsed = { ran: boolean; crash?: string; tests: ParsedTest[]; fileErrors: { file: string; message: string }[] };

// ── CI commands ──────────────────────────────────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const SCRIPT_CALL = /^(?:pnpm|npm|yarn)(?:\s+run)?\s+([\w:-]+)$/;
const BUILD_CALL = /^(?:pnpm|npm|yarn)(?:\s+run)?\s+build$/;

function expand(line: string, scripts: Record<string, string>, depth = 0): string[] {
  const out: string[] = [];
  for (const raw of line.split(/&&|;|\|\|/)) {
    const seg = raw.trim();
    if (!seg) continue;
    const name = SCRIPT_CALL.exec(seg)?.[1];
    if (name !== undefined && typeof scripts[name] === 'string' && depth < 3) out.push(...expand(scripts[name] as string, scripts, depth + 1));
    else out.push(seg);
  }
  return out;
}

const execPrefix = (install: string | undefined): string => (/^\s*pnpm\b/.test(install ?? '') ? 'pnpm exec' : /^\s*yarn\b/.test(install ?? '') ? 'yarn' : 'npx --no-install');

/**
 * The test runners the project's CI runs: Vitest and the `playwright test` commands (with their config), found in
 * the `run` lines of the `ci` job, following `pnpm <script>` into package.json. Null when it finds none. Pure.
 */
export function testCommandsFromCi(ciText: string, packageJson?: string | null): TddRunner | null {
  let doc: unknown;
  try {
    doc = parse(ciText);
  } catch {
    return null;
  }
  if (!isRecord(doc) || !isRecord(doc.jobs)) return null;
  const jobs = doc.jobs;
  const job = isRecord(jobs.ci) ? jobs.ci : Object.values(jobs).find((j): j is Record<string, unknown> => isRecord(j) && j.name === 'ci');
  if (!job || !Array.isArray(job.steps)) return null;
  let scripts: Record<string, string> = {};
  try {
    const pkg: unknown = packageJson ? JSON.parse(packageJson) : null;
    if (isRecord(pkg) && isRecord(pkg.scripts)) scripts = Object.fromEntries(Object.entries(pkg.scripts).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    // no scripts to follow
  }
  const runner: TddRunner = { exec: 'npx --no-install', vitest: false, playwright: [] };
  let install: string | undefined;
  for (const step of job.steps) {
    if (!isRecord(step) || typeof step.run !== 'string') continue;
    for (const line of step.run.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (install === undefined && /^\s*(pnpm|npm|yarn)\s+(install|i|ci)\b/.test(trimmed)) install = trimmed;
      for (const seg of trimmed.split(/&&|;/).map((s) => s.trim())) if (BUILD_CALL.test(seg) && runner.build === undefined) runner.build = seg;
      for (const seg of expand(trimmed, scripts)) {
        if (/\bvitest\b/.test(seg)) runner.vitest = true;
        if (/\bplaywright\s+test\b/.test(seg)) {
          const config = /--config[=\s]+([^\s'"]+)/.exec(seg)?.[1] ?? null;
          if (!runner.playwright.includes(config)) runner.playwright.push(config);
        }
      }
    }
  }
  runner.exec = execPrefix(install);
  return runner.vitest || runner.playwright.length > 0 ? runner : null;
}

// ── which tests ──────────────────────────────────────────────────────────────────────────────────────────────

const PW_MARK = '@playwright/test';

/** A path that is a test or its support code (helpers, fixtures): it goes onto main's tree for RED. */
export const isTestSupport = (path: string): boolean =>
  /\.(spec|test|e2e)\.[cm]?[jt]sx?$/.test(path) || /(^|\/)(e2e|tests?|__tests__|playwright|fixtures?|test-utils)\//.test(path);

/**
 * The criterion tests the branch carries in the files it adds or changes, and the criteria whose test is already on main.
 * `baseTests` are the criterion tests of main (so a criterion with no changed test but one on main is `already green`).
 * Pure.
 */
export function planTddTests(
  files: readonly TddFile[],
  criteria: readonly string[],
  baseTests: ReadonlyMap<string, readonly TestEntry[]> = new Map(),
): { run: TddTest[]; alreadyGreen: RedEntry[]; uncovered: string[] } {
  const want = new Set(criteria);
  const e2ePaths = new Set(files.filter((f) => f.content.includes(PW_MARK) || (f.baseContent ?? '').includes(PW_MARK)).map((f) => f.path));
  const before = new Set(testsFromSources(files.filter((f) => f.baseContent !== null).map((f) => ({ path: f.path, content: f.baseContent as string })), e2ePaths).map((t) => `${t.path}\0${t.title}`));
  const run = testsFromSources(files.map((f) => ({ path: f.path, content: f.content })), e2ePaths)
    .filter((t) => want.has(t.criterion))
    .map((t) => ({ ...t, existedOnMain: before.has(`${t.path}\0${t.title}`) }));
  const covered = new Set(run.map((t) => t.criterion));
  const alreadyGreen: RedEntry[] = [];
  const uncovered: string[] = [];
  for (const c of criteria) {
    if (covered.has(c)) continue;
    const onMain = baseTests.get(c)?.[0];
    if (onMain) alreadyGreen.push({ criterion: c, test: onMain.title, path: onMain.path, outcome: 'already_green_on_main', reason: 'The criterion has its test on main and this branch does not change it.' });
    else uncovered.push(c);
  }
  return { run, alreadyGreen, uncovered };
}

// ── command lines ────────────────────────────────────────────────────────────────────────────────────────────

/** A value in single quotes for `sh -c`. */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** A pattern that matches any of the codes as a whole word (the same one the CI selector uses). */
export const codePattern = (codes: readonly string[]): string => `(?<![\\w-])(?:${[...new Set(codes)].join('|')})(?![\\w-])`;

/** `vitest run` with the JSON report in `output`; `files` and `codes` narrow it (`-t` matches test names by pattern). */
export function vitestCommand(runner: TddRunner, o: { output: string; files?: readonly string[]; codes?: readonly string[] }): string {
  return [
    runner.exec, 'vitest', 'run', '--reporter=json', `--outputFile=${shellQuote(o.output)}`, '--passWithNoTests',
    ...(o.files ?? []).map(shellQuote),
    ...(o.codes && o.codes.length > 0 ? ['-t', shellQuote(codePattern(o.codes))] : []),
  ].join(' ');
}

/** `playwright test` with the JSON report in `output`; the selector's `args` (already split) are passed quoted. */
export function playwrightCommand(runner: TddRunner, o: { output: string; config: string | null; files?: readonly string[]; codes?: readonly string[]; args?: readonly string[] }): string {
  return [
    `PLAYWRIGHT_JSON_OUTPUT_NAME=${shellQuote(o.output)}`, runner.exec, 'playwright', 'test', '--trace=off', '--reporter=json',
    ...(o.config ? [`--config=${shellQuote(o.config)}`] : []),
    ...(o.args ?? []).map(shellQuote),
    ...(o.codes && o.codes.length > 0 ? [`--grep=${shellQuote(codePattern(o.codes))}`] : []),
    '--pass-with-no-tests',
    ...(o.files ?? []).map(shellQuote),
  ].join(' ');
}

/** `pnpm install` reads from the store first, as the environment's own install does. */
const preferOffline = (command: string): string =>
  /^pnpm\s+install\b/.test(command) && !command.includes('\n') && !command.includes('--prefer-offline') ? `${command} --prefer-offline` : command;

// ── reading the runners' reports ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
export const plain = (text: string): string => text.replace(ANSI, '');
const relative = (file: string): string => file.replace(/^\/workspace\//, '');
export const firstLine = (text: string, max = 240): string => {
  const line = plain(text).split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
};
const capped = (text: string, max: number): string => {
  const t = plain(text).trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/** Reads Playwright's JSON report (`--reporter=json`). `crash`: what to say when there is no usable report. Pure. */
export function parsePlaywright(json: string | null, crash = 'no report'): Parsed {
  if (json === null) return { ran: false, crash, tests: [], fileErrors: [] };
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return { ran: false, crash, tests: [], fileErrors: [] };
  }
  if (!isRecord(doc)) return { ran: false, crash, tests: [], fileErrors: [] };
  const tests: ParsedTest[] = [];
  const walk = (suite: unknown): void => {
    if (!isRecord(suite)) return;
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      if (!isRecord(spec) || typeof spec.title !== 'string') continue;
      const list = (Array.isArray(spec.tests) ? spec.tests : []).filter(isRecord);
      const skipped = list.length > 0 && list.every((t) => t.status === 'skipped');
      const results = list.flatMap((t) => (Array.isArray(t.results) ? t.results : [])).filter(isRecord);
      const failing = [...results].reverse().find((r) => r.status === 'failed' || r.status === 'timedOut');
      const err = failing && isRecord(failing.error) && typeof failing.error.message === 'string' ? failing.error.message : undefined;
      tests.push({
        title: spec.title,
        file: typeof spec.file === 'string' ? spec.file : null,
        status: skipped ? 'skipped' : spec.ok === true ? 'passed' : 'failed',
        ...(spec.ok !== true && !skipped ? { message: err ?? 'The test failed.' } : {}),
      });
    }
    for (const child of Array.isArray(suite.suites) ? suite.suites : []) walk(child);
  };
  for (const s of Array.isArray(doc.suites) ? doc.suites : []) walk(s);
  const errors = (Array.isArray(doc.errors) ? doc.errors : []).filter(isRecord).map((e) => (typeof e.message === 'string' ? e.message : '')).filter(Boolean);
  const fileErrors = errors.map((message) => ({ file: '', message }));
  return { ran: true, tests, fileErrors };
}

/** Reads Vitest's JSON report (`--reporter=json`). A test file that fails as a whole (an import or compile error) is a file error. Pure. */
export function parseVitest(json: string | null, crash = 'no report'): Parsed {
  if (json === null) return { ran: false, crash, tests: [], fileErrors: [] };
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return { ran: false, crash, tests: [], fileErrors: [] };
  }
  if (!isRecord(doc) || !Array.isArray(doc.testResults)) return { ran: false, crash, tests: [], fileErrors: [] };
  const tests: ParsedTest[] = [];
  const fileErrors: { file: string; message: string }[] = [];
  for (const file of doc.testResults.filter(isRecord)) {
    const name = typeof file.name === 'string' ? relative(file.name) : null;
    const results = (Array.isArray(file.assertionResults) ? file.assertionResults : []).filter(isRecord);
    for (const a of results) {
      const status = a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped';
      const messages = Array.isArray(a.failureMessages) ? a.failureMessages.filter((m): m is string => typeof m === 'string') : [];
      tests.push({
        title: typeof a.title === 'string' ? a.title : String(a.fullName ?? ''),
        file: name,
        status,
        ...(status === 'failed' ? { message: messages.join('\n') || 'The test failed.' } : {}),
      });
    }
    if (file.status === 'failed' && results.length === 0) fileErrors.push({ file: name ?? '', message: typeof file.message === 'string' && file.message.trim() ? file.message : 'The test file failed to run.' });
  }
  return { ran: true, tests, fileErrors };
}

// ── RED and GREEN verdicts ───────────────────────────────────────────────────────────────────────────────────

const CANNOT_LOAD = /Cannot find (?:module|package)|Failed to (?:resolve|load) (?:import|url)|ERR_MODULE_NOT_FOUND|does not provide an export|is not exported|SyntaxError|error TS\d+|Transform failed|ReferenceError|is not defined/i;

/** The reason a RED test failed: a missing module or a compile error is how a test written before its code fails. */
export function redReason(message: string): string {
  const line = firstLine(message);
  return CANNOT_LOAD.test(message) ? `cannot load without the change: ${line}` : line || 'failed';
}

const sameFile = (a: string | null, b: string): boolean => a === null || a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);

/** What one run says about a test: matched by title (and file when the report has one). */
export function statusOf(parsed: Parsed, test: { title: string; path: string }): { status: 'passed' | 'failed' | 'not_run'; message?: string } {
  const hits = parsed.tests.filter((t) => (t.title === test.title || t.title.endsWith(test.title)) && sameFile(t.file, test.path));
  const bad = hits.find((t) => t.status === 'failed');
  if (bad) return { status: 'failed', message: bad.message ?? '' };
  if (hits.some((t) => t.status === 'passed')) return { status: 'passed' };
  const file = parsed.fileErrors.find((f) => f.file !== '' && sameFile(f.file, test.path));
  if (file) return { status: 'failed', message: file.message };
  if (!parsed.ran) return { status: 'failed', message: parsed.crash ?? 'The runner produced no report.' };
  const global = parsed.fileErrors.find((f) => f.file === '');
  if (global) return { status: 'failed', message: global.message };
  return { status: 'not_run' };
}

/** RED: the criterion tests against main. `parsed` are the reports of every run that covered them. Pure. */
export function redEntries(tests: readonly TddTest[], parsed: readonly Parsed[]): RedEntry[] {
  return tests.map((t) => {
    let best: { status: 'passed' | 'failed' | 'not_run'; message?: string } = { status: 'not_run' };
    for (const p of parsed) {
      const s = statusOf(p, t);
      if (s.status === 'failed') best = s;
      else if (s.status === 'passed' && best.status !== 'failed') best = s;
    }
    const base = { criterion: t.criterion, test: t.title, path: t.path };
    if (best.status === 'failed') return { ...base, outcome: 'failed' as const, reason: redReason(best.message ?? '') };
    if (best.status === 'passed') {
      return t.existedOnMain
        ? { ...base, outcome: 'already_green_on_main' as const, reason: 'The test already existed on main and passes there.' }
        : { ...base, outcome: 'passed' as const, reason: 'It passes on main without the change, so it does not check its criterion.' };
    }
    return { ...base, outcome: 'not_run' as const, reason: 'The runner did not run it.' };
  });
}

/** GREEN: every test of the runs with the change. `onMain`: titles that also fail on main (pre-existing red). Pure. */
export function greenResult(
  runs: readonly Parsed[],
  criterionTests: readonly TddTest[],
  extraFailures: readonly { test: string; reason: string }[] = [],
  onMain: ReadonlySet<string> = new Set(),
): Green {
  const isCriterion = (t: ParsedTest) => criterionTests.some((c) => c.title === t.title && sameFile(t.file, c.path));
  const all: GreenTest[] = [];
  const counts = { criterion: { passed: 0, failed: 0 }, selected: { passed: 0, failed: 0 } };
  let failingOnMain = 0;
  for (const p of runs) {
    for (const t of p.tests) {
      if (t.status === 'skipped') continue;
      const own = isCriterion(t);
      const code = /^(AC-[A-Z]+-\d+-\d+)\b/.exec(t.title)?.[1] ?? null;
      if (t.status === 'passed') {
        (own ? counts.criterion : counts.selected).passed++;
        if (own) all.push({ test: t.title, path: t.file, criterion: code, outcome: 'passed' });
        continue;
      }
      const pre = !own && onMain.has(t.title);
      if (pre) failingOnMain++;
      else (own ? counts.criterion : counts.selected).failed++;
      all.push({ test: t.title, path: t.file, criterion: code, outcome: pre ? 'failing_on_main' : 'failed', reason: firstLine(t.message ?? '') });
    }
    for (const f of p.fileErrors) {
      counts.selected.failed++;
      all.push({ test: f.file || 'test run', path: f.file || null, criterion: null, outcome: 'failed', reason: firstLine(f.message) });
    }
    if (!p.ran) {
      counts.selected.failed++;
      all.push({ test: 'test run', path: null, criterion: null, outcome: 'failed', reason: `The tests could not run: ${p.crash ?? 'no report'}` });
    }
  }
  for (const f of extraFailures) {
    counts.selected.failed++;
    all.push({ test: f.test, path: null, criterion: null, outcome: 'failed', reason: f.reason });
  }
  const order = (t: GreenTest) => (t.outcome === 'failed' ? 0 : t.outcome === 'failing_on_main' ? 1 : 2);
  return {
    passed: counts.criterion.passed + counts.selected.passed,
    failed: counts.criterion.failed + counts.selected.failed,
    failing_on_main: failingOnMain,
    criterion: counts.criterion,
    selected: counts.selected,
    tests: [...all].sort((a, b) => order(a) - order(b)).slice(0, DETAIL_TESTS),
  };
}

export type Verdict = { ok: boolean; red: RedEntry[]; green: GreenTest[] };

/** Both phases must pass: no criterion test green on main without having been there, no failing test with the change. Pure. */
export function verdictOf(red: readonly RedEntry[], green: Green | null): Verdict {
  const badRed = red.filter((r) => r.outcome === 'passed');
  const badGreen = (green?.tests ?? []).filter((t) => t.outcome === 'failed');
  return { ok: badRed.length === 0 && badGreen.length === 0 && (green?.failed ?? 0) === 0, red: badRed, green: badGreen };
}

/** The message that sends the builder back (resumed session): which test, which phase and the capped output. Pure. */
export function tddFeedback(v: Verdict, loop: number, max = TDD_MAX_LOOPS): string {
  const lines = [
    `DEMIURGO ran your tests before pushing (loop ${loop} of at most ${max}) and they are not test-driven yet. The push waits until both checks pass.`,
    '',
  ];
  if (v.red.length > 0) {
    lines.push(
      'RED: these tests PASS on main without your change. A test that never failed does not check its criterion (Beck, Test-Driven Development by Example; Freeman and Pryce, GOOS: watch the test fail). Rewrite each one so that it fails for the right reason on main, asserting the new behaviour, and keep it passing with your change:',
    );
    for (const r of v.red.slice(0, FEEDBACK_FAILURES)) lines.push(`- ${r.criterion}: \`${r.test}\` in ${r.path}`);
    if (v.red.length > FEEDBACK_FAILURES) lines.push(`- … and ${v.red.length - FEEDBACK_FAILURES} more.`);
    lines.push('');
  }
  if (v.green.length > 0) {
    lines.push('GREEN: these tests FAIL with your change. Fix the code, or the test if it is wrong:');
    for (const t of v.green.slice(0, FEEDBACK_FAILURES)) lines.push(`- \`${t.test}\`${t.path ? ` in ${t.path}` : ''}: ${capped(t.reason ?? '', FEEDBACK_OUTPUT)}`);
    if (v.green.length > FEEDBACK_FAILURES) lines.push(`- … and ${v.green.length - FEEDBACK_FAILURES} more.`);
    lines.push('');
  }
  lines.push('Run the tests yourself, fix what is listed, and write .demiurgo/build-report.json again when you finish. Do not commit.');
  return lines.join('\n');
}

/** One line for the failed step: why the attempt ended red. Pure. */
export function tddSummary(detail: TddDetail): string {
  const bad = detail.red.filter((r) => r.outcome === 'passed').length;
  const failed = detail.green?.failed ?? 0;
  const why = detail.stopped === 'cap' ? `after ${detail.loops} loops` : detail.stopped === 'no_session' ? 'and the builder session could not be resumed' : 'and the builder stopped';
  return `Test-driven check failed ${why}: ${bad} criterion test${bad === 1 ? '' : 's'} pass on main without the change; ${failed} test${failed === 1 ? '' : 's'} fail with it. Nothing was committed or pushed.`;
}

/** The failure is the environment's, not the code's (a missing database, a refused connection, a missing browser or tool). */
const ENVIRONMENT_FAILURE = /database "[^"]*" does not exist|ECONNREFUSED|connection refused|ENOTFOUND|Executable doesn't exist|npx playwright install|browserType\.launch|command not found|ENOSPC/i;
const criterionOf = (test: string): string | null => /^(AC-[A-Z]+-\d+-\d+)\b/.exec(test)?.[1] ?? null;

/**
 * Why the verdict is red, for the harness (a loop caused by the environment or by another feature's test is not the
 * gate catching the task's own mistake). `own` when a criterion test passes on main (RED) or any failure with the
 * change is the task's (its criterion test, or no criterion at all); `environment` when every failure is an
 * environment error; `foreign` when the rest belong to criteria the task does not cover. Null when green. Pure.
 */
export function classifyLoopFailure(v: Verdict, ownCriteria: readonly string[]): FailureClass | null {
  if (v.red.length > 0) return 'own';
  if (v.green.length === 0) return null;
  const own = new Set(ownCriteria);
  let foreign = 0;
  for (const t of v.green) {
    if (ENVIRONMENT_FAILURE.test(`${t.reason ?? ''}`)) {
      continue;
    }
    const code = t.criterion ?? criterionOf(t.test);
    if (code !== null && !own.has(code)) foreign++;
    else return 'own';
  }
  // Every failure is the environment's or another feature's: any foreign test makes it foreign, otherwise it is the environment.
  return foreign > 0 ? 'foreign' : 'environment';
}

/** Duration, usage and failure class of each loop's builder run, numbered from 1. Pure. */
export function loopRunsOf(runs: readonly BuilderResult[], failureClasses: readonly (FailureClass | null)[] = []): LoopRun[] {
  return runs.map((r, i) => ({ loop: i + 1, duration_ms: r.durationMs, ...(r.usage ? { usage: r.usage } : {}), failure_class: failureClasses[i] ?? null }));
}

/** The builder results of the first run and its loops as one (usage and time added, the last run's outcome and report). Pure. */
export function mergeBuilderResults(first: BuilderResult, loops: readonly BuilderResult[]): BuilderResult {
  const last = loops.at(-1);
  if (!last) return first;
  const all = [first, ...loops];
  const sum = (pick: (u: Usage) => number | undefined): number | undefined => {
    const values = all.map((r) => (r.usage ? pick(r.usage) : undefined)).filter((v): v is number => v !== undefined);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : undefined;
  };
  const withUsage = all.filter((r) => r.usage);
  const usage: Usage | undefined =
    withUsage.length === 0
      ? undefined
      : {
          inputTokens: sum((u) => u.inputTokens) ?? 0,
          outputTokens: sum((u) => u.outputTokens) ?? 0,
          durationMs: sum((u) => u.durationMs) ?? 0,
          ...(sum((u) => u.declaredCostUsd) !== undefined ? { declaredCostUsd: sum((u) => u.declaredCostUsd) as number } : {}),
          ...(sum((u) => u.cachedInputTokens) !== undefined ? { cachedInputTokens: sum((u) => u.cachedInputTokens) as number } : {}),
          ...(sum((u) => u.reasoningTokens) !== undefined ? { reasoningTokens: sum((u) => u.reasoningTokens) as number } : {}),
          ...(sum((u) => u.turns) !== undefined ? { turns: sum((u) => u.turns) as number } : {}),
        };
  return {
    ...last,
    durationMs: all.reduce((a, r) => a + r.durationMs, 0),
    sessionId: last.sessionId ?? first.sessionId,
    ...(usage ? { usage } : {}),
    report: last.report ?? first.report,
  };
}

// ── the e2e selection of the CI ──────────────────────────────────────────────────────────────────────────────

const SELECT_E2E = new URL('../../templates/ci/select-e2e.mjs', import.meta.url).href;
type Selector = { selectEndToEnd: (input: { event: string; changedFiles: string[]; trailerValues: string }) => { args: string[]; reason: string } };

/**
 * The arguments the managed CI selector gives the pull request (`.demiurgo/select-e2e.mjs`, the template itself),
 * for the affected criteria plus the task's own. `--only-changed` needs git history that the container has not:
 * it is dropped (the task's own e2e tests still run).
 */
export async function e2eSelection(input: { affected: readonly string[] | 'all' | null; criteria: readonly string[]; changedFiles: readonly string[] }): Promise<{ args: string[]; codes?: string[]; reason: string }> {
  const mod = (await import(SELECT_E2E)) as Selector;
  const codes = input.affected === 'all' || input.affected === null ? [...input.criteria] : [...new Set([...input.affected, ...input.criteria])];
  const picked = mod.selectEndToEnd({ event: 'pull_request', changedFiles: [...input.changedFiles], trailerValues: codes.join(' ') });
  if (picked.args.some((a) => a.startsWith('--only-changed'))) return { args: [], codes: [...input.criteria], reason: `${picked.reason} (the task's own e2e tests only: no git history in the container)` };
  return picked;
}

// ── running it ───────────────────────────────────────────────────────────────────────────────────────────────

export type TddInput = {
  worktreePath: string;
  requestId: string;
  /** The task's criteria (what it covers). */
  criteria: readonly string[];
  /** Covered criteria that are not `automatic` (manual or release): never expected to have a test, shown as information. */
  notAutomated?: readonly string[];
  /** The criteria the pull request affects (the trailer), as the commit stage computes them. */
  affected: readonly string[] | 'all' | null;
  /** The prepared environment of the builder: same network, store and variables. */
  prepared: { network: string; storeVolume: string; env: Record<string, string> };
  exec?: DockerExec;
  signal?: AbortSignal;
  /** The id of the builder's session; without it the loop cannot resume the builder. */
  session: string | undefined;
  /** Runs the builder again in the same session with this message; returns its result. */
  rerun: (prompt: string, loop: number, session: string) => Promise<BuilderResult>;
  maxLoops?: number;
};

export type TddOutcome = {
  detail: TddDetail;
  /** Set when the attempt must end as failed: red after the cap, or the builder failed in a loop. */
  stopped: 'red' | 'builder_failed' | null;
  /** The builder runs of the loops, in order. */
  runs: BuilderResult[];
  /** What sent the builder back in each loop (same order as `runs`). */
  failureClasses?: (FailureClass | null)[];
};

class Skip extends Error {}

type Ctx = Required<Pick<TddInput, 'worktreePath' | 'requestId' | 'prepared'>> & { exec: DockerExec; signal?: AbortSignal; n: number };

async function inContainer(ctx: Ctx, dir: string, command: string, timeoutMs: number): Promise<DockerResult> {
  const name = `demiurgo-tdd-${ctx.requestId}-${++ctx.n}`;
  const args = setupArguments({ worktreeHostPath: hostPathOf(dir), command, network: ctx.prepared.network, storeVolume: ctx.prepared.storeVolume, env: ctx.prepared.env, limits: LIMITS }, name);
  await ctx.exec(['rm', '-f', name], { timeoutMs: 15_000 });
  const r = await ctx.exec(args, { timeoutMs, ...(ctx.signal ? { signal: ctx.signal } : {}) });
  if (r.timedOut || ctx.signal?.aborted) await ctx.exec(['rm', '-f', name], { timeoutMs: 15_000 });
  // Not the tests' failure but the container's: the runner is not there, so there is nothing to conclude.
  if (ctx.signal?.aborted) throw new Skip('The build was cancelled.');
  if (r.timedOut) throw new Skip(`The tests did not finish in ${Math.round(timeoutMs / 60_000)} min.`);
  if (r.code === null || r.code === 125 || r.code === 126 || r.code === 127) throw new Skip(`The test container could not run: ${firstLine(r.stderr || r.stdout)}`);
  return r;
}

const tail = (r: DockerResult): string => capped(`${r.stdout}\n${r.stderr}`.slice(-1500), 600);

async function readReport(dir: string, relativePath: string): Promise<string | null> {
  return readFile(join(dir, relativePath), 'utf8').catch(() => null);
}

type Base = { dir: string; installed: boolean; built: boolean };

/** Everything RED and GREEN need, created on demand and removed at the end. */
async function withBase<T>(ctx: Ctx, baseRef: string, work: (getBase: () => Promise<Base>) => Promise<T>): Promise<T> {
  let base: Base | null = null;
  const root = dirname(dirname(ctx.worktreePath));
  const dir = join(root, '.tdd', ctx.requestId);
  const remove = async () => {
    await git(ctx.worktreePath, ['worktree', 'remove', '--force', dir]).catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    await git(ctx.worktreePath, ['worktree', 'prune']).catch(() => undefined);
  };
  try {
    return await work(async () => {
      if (base) return base;
      await remove();
      await mkdir(dirname(dir), { recursive: true });
      try {
        await git(ctx.worktreePath, ['worktree', 'add', '--detach', dir, baseRef]);
      } catch (e) {
        throw new Skip(`Could not check out main for RED: ${firstLine((e as Error).message)}`);
      }
      base = { dir, installed: false, built: false };
      return base;
    });
  } finally {
    await remove();
  }
}

const OUT = '.demiurgo/tdd';
async function outputDir(dir: string): Promise<void> {
  await mkdir(join(dir, OUT), { recursive: true });
  await chmod(join(dir, OUT), 0o777).catch(() => undefined);
}

type Phase = { red: RedEntry[]; green: Green | null; notes: string[] };

/**
 * One RED and GREEN pass over the current state of the worktree. Throws `Skip` when the environment gives nothing to
 * conclude from. RED is skipped (with a note) when main cannot be prepared; GREEN still runs.
 */
async function checkOnce(
  ctx: Ctx,
  input: TddInput,
  runner: TddRunner,
  ci: { install?: string; migrate?: string },
  baseRef: string,
  getBase: () => Promise<Base>,
  previous: { key: string; red: RedEntry[] } | null,
): Promise<Phase & { key: string; redRun: RedEntry[]; uncovered: string[] }> {
  const notes: string[] = [];
  // The test files the branch adds or changes (committed on the branch and pending), with their content on main.
  const changed = (await changedWithPending(ctx.worktreePath)).filter((f) => /\.[cm]?[jt]sx?$/.test(f));
  const files: TddFile[] = [];
  const support: string[] = [];
  for (const path of changed) {
    const content = await readWorktreeFile(ctx.worktreePath, path);
    if (content === null) continue;
    if (isTestSupport(path)) support.push(path);
    files.push({ path, content, baseContent: await showAt(ctx.worktreePath, baseRef, path) });
  }
  const baseTests = await readRepoTests(ctx.worktreePath, baseRef).catch(() => new Map<string, TestEntry[]>());
  const plan = planTddTests(files.filter((f) => isTestSupport(f.path) || /\bAC-/.test(f.content)), input.criteria, baseTests);
  const key = JSON.stringify(files.filter((f) => support.includes(f.path)).map((f) => [f.path, f.content.length, f.content.slice(0, 200), f.content.slice(-200)]));

  // RED
  let red: RedEntry[] = [];
  if (plan.run.length === 0) {
    notes.push(plan.alreadyGreen.length > 0 ? 'The branch adds or changes no criterion test.' : 'No criterion test was found in the files the branch changes.');
  } else if (previous && previous.key === key) {
    red = previous.red;
  } else {
    try {
      const base = await getBase();
      await git(base.dir, ['checkout', '--', '.']).catch(() => undefined);
      await git(base.dir, ['clean', '-fdq', '-e', 'node_modules', '-e', '.next', '-e', '.pw-browsers']).catch(() => undefined);
      for (const f of support) {
        await mkdir(dirname(join(base.dir, f)), { recursive: true });
        await copyFile(join(ctx.worktreePath, f), join(base.dir, f));
      }
      if (!base.installed) {
        if (ci.install) {
          const r = await inContainer(ctx, base.dir, preferOffline(ci.install), TIMEOUTS.install);
          if (r.code !== 0) throw new Skip(`Could not install main's dependencies for RED: ${tail(r)}`);
        }
        base.installed = true;
      }
      const e2e = plan.run.filter((t) => t.level === 'e2e');
      const unit = plan.run.filter((t) => t.level !== 'e2e');
      if (e2e.length > 0 && runner.build && !base.built) {
        const r = await inContainer(ctx, base.dir, runner.build, TIMEOUTS.build);
        // A build that breaks on main with the new tests is not a verdict on the tests: RED reports it as not run.
        if (r.code !== 0) notes.push(`Main did not build for RED: ${tail(r)}`);
        else base.built = true;
      }
      await outputDir(base.dir);
      const reports: Parsed[] = [];
      let i = 0;
      if (unit.length > 0 && runner.vitest) {
        const out = `${OUT}/red-vitest-${i++}.json`;
        const r = await inContainer(ctx, base.dir, vitestCommand(runner, { output: out, files: [...new Set(unit.map((t) => t.path))], codes: unit.map((t) => t.criterion) }), TIMEOUTS.tests);
        reports.push(parseVitest(await readReport(base.dir, out), `vitest produced no report: ${tail(r)}`));
      }
      if (e2e.length > 0 && (base.built || !runner.build)) {
        for (const config of runner.playwright) {
          const out = `${OUT}/red-pw-${i++}.json`;
          const r = await inContainer(ctx, base.dir, playwrightCommand(runner, { output: out, config, files: [...new Set(e2e.map((t) => t.path))], codes: e2e.map((t) => t.criterion) }), TIMEOUTS.tests);
          reports.push(parsePlaywright(await readReport(base.dir, out), `playwright produced no report: ${tail(r)}`));
        }
      }
      red = redEntries(plan.run, reports);
    } catch (e) {
      if (!(e instanceof Skip)) throw e;
      if (/cancelled|did not finish|test container could not run/.test(e.message)) throw e;
      notes.push(e.message);
    }
  }
  const redRun = red;
  red = [...red, ...plan.alreadyGreen];

  // GREEN
  const reports: Parsed[] = [];
  const extra: { test: string; reason: string }[] = [];
  const wt = ctx.worktreePath;
  if (ci.migrate) {
    const r = await inContainer(ctx, wt, ci.migrate, TIMEOUTS.migrate);
    if (r.code !== 0) notes.push(`The migrations failed before GREEN: ${tail(r)}`);
  }
  await outputDir(wt);
  const wantE2e = runner.playwright.length > 0;
  const selection: { args: string[]; codes?: string[]; reason: string } = wantE2e ? await e2eSelection({ affected: input.affected, criteria: input.criteria, changedFiles: changed }) : { args: [], reason: 'no e2e runner' };
  let built = true;
  if (wantE2e && runner.build) {
    const r = await inContainer(ctx, wt, runner.build, TIMEOUTS.build);
    if (r.code !== 0) {
      built = false;
      extra.push({ test: runner.build, reason: `The build fails with the change: ${tail(r)}` });
    }
  }
  let i = 0;
  if (runner.vitest) {
    const out = `${OUT}/green-vitest-${i++}.json`;
    const r = await inContainer(ctx, wt, vitestCommand(runner, { output: out }), TIMEOUTS.tests);
    reports.push(parseVitest(await readReport(wt, out), `vitest produced no report: ${tail(r)}`));
  }
  if (wantE2e && built) {
    for (const config of runner.playwright) {
      const out = `${OUT}/green-pw-${i++}.json`;
      const r = await inContainer(ctx, wt, playwrightCommand(runner, { output: out, config, args: selection.args, ...(selection.codes ? { codes: selection.codes } : {}) }), TIMEOUTS.tests);
      reports.push(parsePlaywright(await readReport(wt, out), `playwright produced no report: ${tail(r)}`));
    }
  }
  // No report at all is the environment's failure (a runner that did not start), not something the builder can fix: never loop on it.
  const crashed = reports.find((p) => !p.ran);
  if (crashed) throw new Skip(`A test runner produced no report: ${crashed.crash ?? ''}`.trim());
  let green = greenResult(reports, plan.run, extra);

  // A failing test that is not a criterion test and also fails on main is not this branch's: it does not block.
  const own = new Set(plan.run.map((t) => t.title));
  const suspects = green.tests.filter((t) => t.outcome === 'failed' && t.path !== null && !own.has(t.test));
  if (suspects.length > 0) {
    try {
      const base = await getBase();
      await git(base.dir, ['checkout', '--', '.']).catch(() => undefined);
      await git(base.dir, ['clean', '-fdq', '-e', 'node_modules', '-e', '.next', '-e', '.pw-browsers']).catch(() => undefined);
      if (!base.installed && ci.install) {
        const r = await inContainer(ctx, base.dir, preferOffline(ci.install), TIMEOUTS.install);
        if (r.code !== 0) throw new Skip(`Could not install main's dependencies: ${tail(r)}`);
        base.installed = true;
      }
      await outputDir(base.dir);
      const onMain = new Set<string>();
      const suspectFiles = [...new Set(suspects.map((t) => t.path as string))];
      let k = 0;
      if (runner.vitest) {
        const out = `${OUT}/main-vitest-${k++}.json`;
        await inContainer(ctx, base.dir, vitestCommand(runner, { output: out, files: suspectFiles }), TIMEOUTS.tests);
        for (const t of parseVitest(await readReport(base.dir, out)).tests) if (t.status === 'failed') onMain.add(t.title);
      }
      if (runner.build && runner.playwright.length > 0 && !base.built) base.built = (await inContainer(ctx, base.dir, runner.build, TIMEOUTS.build)).code === 0;
      if (runner.playwright.length > 0 && (base.built || !runner.build)) {
        for (const config of runner.playwright) {
          const out = `${OUT}/main-pw-${k++}.json`;
          await inContainer(ctx, base.dir, playwrightCommand(runner, { output: out, config, files: suspectFiles }), TIMEOUTS.tests);
          for (const t of parsePlaywright(await readReport(base.dir, out)).tests) if (t.status === 'failed') onMain.add(t.title);
        }
      }
      if (onMain.size > 0) green = greenResult(reports, plan.run, extra, onMain);
    } catch (e) {
      if (!(e instanceof Skip)) throw e;
      if (/cancelled|did not finish|test container could not run/.test(e.message)) throw e;
      notes.push(e.message);
    }
  }
  green.scope = selection.reason;
  return { red, redRun, green, notes, key, uncovered: plan.uncovered };
}

/**
 * The gate. Runs RED and GREEN; while either fails and the cap allows, sends the builder back in its session with the
 * exact list and checks again. Never throws: anything unexpected is `skipped`.
 */
export async function verifyTdd(input: TddInput): Promise<TddOutcome> {
  const skipped = (reason: string, runs: BuilderResult[] = [], loops = 0): TddOutcome => ({ detail: { status: 'skipped', red: [], green: null, loops, skipped: reason }, stopped: null, runs });
  try {
    const ciText = await readWorktreeFile(input.worktreePath, '.github/workflows/ci.yml');
    if (ciText === null) return skipped('The project has no CI workflow to take the test commands from.');
    const runner = testCommandsFromCi(ciText, await readWorktreeFile(input.worktreePath, 'package.json'));
    if (!runner) return skipped('The CI workflow has no Vitest or Playwright command DEMIURGO understands.');
    const notAutomated = input.notAutomated && input.notAutomated.length > 0 ? [...input.notAutomated] : undefined;
    if (input.criteria.length === 0) {
      const none = skipped(notAutomated ? 'The task covers no automatic criterion: its criteria are checked by a person or at release.' : 'The task covers no criterion.');
      return notAutomated ? { ...none, detail: { ...none.detail, not_automated: notAutomated } } : none;
    }
    const baseRef = await mergeBaseWithMain(input.worktreePath);
    if (!baseRef) return skipped('There is no main to compare with.');
    const ci = environmentFromCi(ciText) ?? {};
    const ctx: Ctx = { worktreePath: input.worktreePath, requestId: input.requestId, prepared: input.prepared, exec: input.exec ?? dockerExec, ...(input.signal ? { signal: input.signal } : {}), n: 0 };
    const max = input.maxLoops ?? TDD_MAX_LOOPS;
    const runs: BuilderResult[] = [];
    const failureClasses: (FailureClass | null)[] = [];
    let session = input.session;
    let loops = 0;
    let previous: { key: string; red: RedEntry[] } | null = null;
    return await withBase(ctx, baseRef, async (getBase) => {
      for (;;) {
        const phase = await checkOnce(ctx, input, runner, ci, baseRef, getBase, previous);
        previous = { key: phase.key, red: phase.redRun };
        const verdict = verdictOf(phase.red, phase.green);
        const uncovered = phase.uncovered.length > 0 ? phase.uncovered : undefined;
        const detail: TddDetail = {
          status: verdict.ok ? 'passed' : 'red',
          red: phase.red,
          green: phase.green,
          loops,
          ...(uncovered ? { uncovered } : {}),
          ...(notAutomated ? { not_automated: notAutomated } : {}),
          ...(phase.notes.length > 0 ? { notes: phase.notes } : {}),
        };
        if (verdict.ok) return { detail, stopped: null, runs, failureClasses };
        if (loops >= max) return { detail: { ...detail, stopped: 'cap' as const }, stopped: 'red' as const, runs, failureClasses };
        if (!session) return { detail: { ...detail, stopped: 'no_session' as const }, stopped: 'red' as const, runs, failureClasses };
        loops++;
        failureClasses.push(classifyLoopFailure(verdict, input.criteria));
        const result = await input.rerun(tddFeedback(verdict, loops, max), loops, session);
        runs.push(result);
        session = result.sessionId ?? session;
        if (result.state !== 'ok') return { detail: { ...detail, loops, stopped: 'builder_failed' as const }, stopped: 'builder_failed' as const, runs, failureClasses };
      }
    });
  } catch (e) {
    return skipped(e instanceof Skip ? e.message : `The check could not run: ${firstLine((e as Error).message)}`);
  }
}

/** What the next attempt reads after an attempt that ended red (`tdd_red`): the tests that passed on main and those that failed with the change. Pure. */
export function tddFeedbackLines(detail: TddDetail): string[] {
  const onMain = detail.red.filter((r) => r.outcome === 'passed');
  const failing = (detail.green?.tests ?? []).filter((t) => t.outcome === 'failed');
  if (onMain.length === 0 && failing.length === 0) return [];
  return [
    `The previous attempt stopped with the test-driven check red (${tddSummary(detail)}). Fix exactly these:`,
    ...onMain.slice(0, FEEDBACK_FAILURES).map((r) => `- RED: ${r.criterion} «${r.test}» (${r.path}) passes on main without the change: make it check the criterion's behaviour.`),
    ...failing.slice(0, FEEDBACK_FAILURES).map((t) => `- GREEN: «${t.test}»${t.path ? ` (${t.path})` : ''} fails with the change${t.reason ? `: ${t.reason.slice(0, FEEDBACK_OUTPUT)}` : ''}.`),
  ];
}
