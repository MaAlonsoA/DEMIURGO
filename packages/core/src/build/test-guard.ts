// Test guard: a builder may not add a second test for a criterion that already has one (the guard of the
// orchestrator's `design` stage, next to the ownership guard). Measured on a real project: 130 e2e tests for
// 69 criteria, one criterion with 9 e2e tests in 5 files because each task re-tested it. The practice is the
// test pyramid: keep one test per behavior at the lowest level that checks it and do not duplicate a check
// at a higher level (Ham Vocke, «The Practical Test Pyramid», martinfowler.com). A cross-cutting criterion
// is checked by one parameterized test over everything it applies to (Gerard Meszaros, xUnit Test Patterns,
// «Parameterized Test»). The `[example: …]` marker, the «unit is lower than e2e» order and the one-new-test
// limit are our convention. Unit tests are never a violation: the pyramid's base is many small fast tests, one per
// behaviour, and a broad criterion (owner-only access) has many behaviours; what it warns against is re-checking at
// a higher, slower level what a lower one already checks (Vocke, same article), which is where the measured
// duplication was (e2e). Best effort: when it cannot compute, it passes.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const git = (dir: string, args: string[]) => run('git', ['-c', 'safe.directory=*', '-C', dir, ...args], { maxBuffer: 64 * 1024 * 1024 });

/** `release`: a check run against the deployed release candidate, not in CI (Humble and Farley, Continuous Delivery). */
export type TestLevel = 'e2e' | 'unit' | 'release';
export type TestEntry = { criterion: string; path: string; title: string; level: TestLevel };
export type TestsByCriterion = Map<string, TestEntry[]>;
export type TestGuardViolation = { criterion: string; kind: 'duplicate' | 'several_new'; added: TestEntry; existing: TestEntry };

const CODE = 'AC-[A-Z]+-\\d+-\\d+';
const TITLE = new RegExp(`\\b(?:test|it)(?:\\.(?:only|skip|fixme|fail|slow))?\\(\\s*(['"\`])(${CODE})\\b(.*?)\\1`);
/** Matches a test declaration line whose title starts with a criterion code (the cheap filter for `git grep`). */
const GREP_LINE = `(^|[^A-Za-z0-9_])(test|it)(\\.(only|skip|fixme|fail|slow))?\\([[:space:]]*['"\`]AC-[A-Z]+-[0-9]+-[0-9]+`;
const E2E_PATH = /(^|\/)(e2e|playwright)\/|\.e2e\.[a-z]+$/;
const TEST_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const EXAMPLE_MARKER = /\[example:\s*[^\]]+\]/;
const RANK: Record<TestLevel, number> = { unit: 0, e2e: 1, release: 2 };
const RELEASE_PATH = /(^|\/)release\/|\.release\.[a-z]+$/;
/** CI tests and release checks are different pipeline stages: one never stands in for the other. */
const stageOf = (level: TestLevel): 'ci' | 'release' => (level === 'release' ? 'release' : 'ci');

/** The criterion tests of source files, in order. Pure. `e2ePaths`: files known to be Playwright specs. */
export function testsFromSources(files: ReadonlyArray<{ path: string; content: string }>, e2ePaths: ReadonlySet<string> = new Set()): TestEntry[] {
  const out: TestEntry[] = [];
  for (const f of files) {
    const level: TestLevel = RELEASE_PATH.test(f.path) ? 'release' : E2E_PATH.test(f.path) || e2ePaths.has(f.path) ? 'e2e' : 'unit';
    for (const line of f.content.split('\n')) {
      const m = TITLE.exec(line);
      if (m) out.push({ criterion: m[2] as string, path: f.path, title: `${m[2]}${m[3]}`, level });
    }
  }
  return out;
}

/** Groups tests by criterion code. Pure. */
export function testsByCriterion(entries: readonly TestEntry[]): TestsByCriterion {
  const map: TestsByCriterion = new Map();
  for (const e of entries) {
    const list = map.get(e.criterion);
    if (list) list.push(e);
    else map.set(e.criterion, [e]);
  }
  return map;
}

const same = (a: TestEntry, b: TestEntry) => a.path === b.path && a.title === b.title;

/**
 * Tests added between `before` and `after` for a criterion that already had one at the same level or a lower
 * one, or a second new test for the same criterion, unless the new title carries `[example: …]`. A test that
 * disappeared (renamed or moved) does not count as existing, and a retitled test in the same file is no new test. `criteria` restricts the check; without it every
 * criterion is checked. Pure.
 */
export function duplicateTests(before: TestsByCriterion, after: TestsByCriterion, criteria?: Iterable<string>): TestGuardViolation[] {
  const only = criteria ? new Set(criteria) : null;
  const out: TestGuardViolation[] = [];
  for (const [criterion, now] of after) {
    if (only && !only.has(criterion)) continue;
    const old = before.get(criterion) ?? [];
    const kept = old.filter((o) => now.some((n) => same(n, o)));
    // A test whose title changed in the same file (a parameterized test turned into one case, a reworded title)
    // replaces the one that disappeared there: it is a rename, not a new test.
    const removed = old.filter((o) => !now.some((n) => same(n, o)));
    const added = now.filter((n) => {
      if (old.some((o) => same(o, n))) return false;
      const i = removed.findIndex((r) => r.path === n.path && r.level === n.level);
      if (i < 0) return true;
      removed.splice(i, 1);
      return false;
    });
    const unmarked: TestEntry[] = [];
    for (const a of added) {
      if (EXAMPLE_MARKER.test(a.title) || a.level === 'unit') continue;
      const covering = kept.find((k) => stageOf(k.level) === stageOf(a.level) && RANK[k.level] <= RANK[a.level]);
      const sibling = unmarked.find((u) => stageOf(u.level) === stageOf(a.level));
      if (covering) out.push({ criterion, kind: 'duplicate', added: a, existing: covering });
      else if (sibling) out.push({ criterion, kind: 'several_new', added: a, existing: sibling });
      else unmarked.push(a);
    }
  }
  return out;
}

/** English feedback for the builder: one line per violation. Pure. */
export function testGuardFeedback(violations: readonly TestGuardViolation[]): string[] {
  return violations.map(
    (v) =>
      `${v.criterion} already has \`${v.existing.title}\` in \`${v.existing.path}\` (${v.existing.level}). Extend that test instead of adding \`${v.added.title}\`; keep one test per criterion at the lowest level that checks it (Ham Vocke, The Practical Test Pyramid). If the new test checks a different example that the criterion lists, put \`[example: …]\` in its title.`,
  );
}

/** The brief section that lists the existing tests of the task's criteria (at most `maxLines` lines). Pure. */
export function existingTestsLines(tests: TestsByCriterion, criteria: readonly string[], maxLines = 20): string[] {
  if (criteria.length === 0) return [];
  const lines: string[] = [];
  let hidden = 0;
  for (const c of criteria) {
    const list = tests.get(c) ?? [];
    const own = list.length === 0 ? [`${c}: no test yet — write one at the lowest level that checks it.`] : list.map((t) => `${c}: \`${t.title}\` in ${t.path} (${t.level})`);
    for (const l of own) {
      if (lines.length < maxLines) lines.push(l);
      else hidden++;
    }
  }
  if (hidden > 0) lines.push(`… and ${hidden} more.`);
  return [`Existing tests for this task's criteria (extend them; do not add another test for the same criterion; \`[example: …]\` in a title marks a different example the criterion lists):`, ...lines.map((l) => `- ${l}`)];
}

/** The criterion tests of the repository at a ref, read with git (no checkout needed). */
export async function readRepoTests(repoDir: string, ref: string): Promise<TestsByCriterion> {
  // `git grep` exits 1 when nothing matches.
  const grep = async (args: string[]): Promise<string> => {
    try {
      return (await git(repoDir, ['grep', '-I', ...args])).stdout;
    } catch (e) {
      if ((e as { code?: number }).code === 1) return '';
      throw e;
    }
  };
  const hits = await grep(['-n', '-E', GREP_LINE, ref, '--', '*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs', '*.mts', '*.cts']);
  const playwright = await grep(['-l', '-F', '@playwright/test', ref, '--', '*.ts', '*.tsx', '*.js', '*.mjs']);
  const prefix = `${ref}:`;
  const strip = (l: string) => (l.startsWith(prefix) ? l.slice(prefix.length) : l);
  const e2ePaths = new Set(playwright.split('\n').filter(Boolean).map(strip));
  const byPath = new Map<string, string[]>();
  for (const l of hits.split('\n').filter(Boolean)) {
    const m = /^(.+?):\d+:(.*)$/.exec(strip(l));
    if (!m || !TEST_FILE.test(m[1] as string) || /(^|\/)node_modules\//.test(m[1] as string)) continue;
    const list = byPath.get(m[1] as string);
    if (list) list.push(m[2] as string);
    else byPath.set(m[1] as string, [m[2] as string]);
  }
  return testsByCriterion(testsFromSources([...byPath].map(([path, ls]) => ({ path, content: ls.join('\n') })), e2ePaths));
}

/** The merge base of HEAD with main (origin's first), or null when there is no main. */
export async function mergeBaseWithMain(repoDir: string): Promise<string | null> {
  for (const base of ['refs/remotes/origin/main', 'main']) {
    try {
      return (await git(repoDir, ['merge-base', base, 'HEAD'])).stdout.trim() || null;
    } catch {
      // try the next base
    }
  }
  return null;
}

export type TestGuardResult = { violations: TestGuardViolation[]; skipped?: string };

/** Runs the guard on a worktree: tests at the merge base with main against tests at HEAD. Fail safe: an error skips it. */
export async function checkTestGuard(repoDir: string, criteria?: Iterable<string>): Promise<TestGuardResult> {
  try {
    const base = await mergeBaseWithMain(repoDir);
    if (!base) return { violations: [], skipped: 'no main to compare with' };
    const [before, after] = await Promise.all([readRepoTests(repoDir, base), readRepoTests(repoDir, 'HEAD')]);
    return { violations: duplicateTests(before, after, criteria) };
  } catch (e) {
    return { violations: [], skipped: (e as Error).message.slice(0, 200) };
  }
}
