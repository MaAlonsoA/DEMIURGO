// "LGTM with comments" (Google eng-practices, "Speed of Code Reviews": the reviewer approves while leaving comments when
// the remaining suggestions are minor and trusts the author to address them, with no new review round). Here a `fix`
// comment is such a suggestion: the reviewer approves, the builder applies exactly the fixes in a cheap next attempt
// and that attempt does not ask for a new review. Pure decisions only; the orchestrator does the I/O.
// Waiving the new review only when the fix attempt touches files the fixes name is «convención nuestra».

export type LgtmComment = { path: string; severity: string };

/** The comments of the `fix` severity. */
export function fixCommentsOf<T extends { severity: string }>(comments: readonly T[]): T[] {
  return comments.filter((c) => c.severity === 'fix');
}

export const countFixes = (comments: readonly { severity: string }[]): number => fixCommentsOf(comments).length;

/** An approval with at least one fix: the attempt ends for the fixes instead of merging. */
export function approvedWithFixes(verdict: string, comments: readonly { severity: string }[]): boolean {
  return verdict === 'approve' && countFixes(comments) > 0;
}

const norm = (p: string): string => p.replace(/^\.\//, '').replace(/\\/g, '/');

/**
 * Whether the fix attempt may skip a new review: every file it changed (between the approved head and the new head)
 * is named by some fix comment. A fix comment on a directory-less path such as `tests` names nothing in particular, so it
 * allows only that exact path. No changed file waives (the builder changed nothing: nothing new to review).
 */
export function waiveReview(input: { fixPaths: readonly string[]; changedFiles: readonly string[] }): { waive: boolean; outside: string[] } {
  const allowed = new Set(input.fixPaths.map(norm));
  const outside = input.changedFiles.map(norm).filter((f) => !allowed.has(f));
  return { waive: outside.length === 0, outside };
}

// ---- «Is this a minor change?»: deterministic checks on the fix attempt's diff (approved head → new head) ----
// Waiving the review is a bet that the change is small and local. Each rule below is pure over already-parsed git data.
// Every threshold is «convención nuestra» (no published standard gives these numbers); the rule ids are what the
// orchestrator records as `waiver_refused`.

/** Changed lines (added + deleted) allowed per fix comment. Convención nuestra. */
export const MINOR_MAX_LINES_PER_FIX = 20;
/** A hunk must start within this many lines of a commented line (when the comment has a line). Convención nuestra. */
export const MINOR_HUNK_DISTANCE = 15;
/** Dependency manifests and lockfiles: changing them is never a minor fix unless a fix comment names that very file. Convención nuestra. */
export const MANIFEST_FILES = ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'];

export type NumstatRow = { path: string; added: number; deleted: number; binary: boolean };
export type NameStatusRow = { status: string; path: string };
/** A `-U0` hunk, old-side coordinates: `oldStart` and `oldCount` (a pure insertion has count 0 and sits after `oldStart`). */
export type Hunk = { oldStart: number; oldCount: number };
export type TestCounts = { cases: number; asserts: number };

/** `git diff --numstat` lines: `added<TAB>deleted<TAB>path`; binary files show `-`. */
export function parseNumstat(out: string): NumstatRow[] {
  const rows: NumstatRow[] = [];
  for (const line of out.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    const binary = m[1] === '-' || m[2] === '-';
    rows.push({ path: m[3] as string, added: binary ? 0 : Number(m[1]), deleted: binary ? 0 : Number(m[2]), binary });
  }
  return rows;
}

/** `git diff --name-status` lines: `M<TAB>path` (renames and copies carry two paths: the new one is kept). */
export function parseNameStatus(out: string): NameStatusRow[] {
  const rows: NameStatusRow[] = [];
  for (const line of out.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 2 || !parts[0]) continue;
    rows.push({ status: parts[0].charAt(0), path: parts[parts.length - 1] as string });
  }
  return rows;
}

/** The hunks of a `git diff -U0` output by file (the new path), from its `@@ -a,b +c,d @@` headers. */
export function parseHunks(out: string): Record<string, Hunk[]> {
  const byFile: Record<string, Hunk[]> = {};
  let file: string | null = null;
  for (const line of out.split('\n')) {
    const f = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (f) {
      file = f[1] as string;
      byFile[file] = byFile[file] ?? [];
      continue;
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (h && file) (byFile[file] as Hunk[]).push({ oldStart: Number(h[1]), oldCount: h[2] === undefined ? 1 : Number(h[2]) });
  }
  return byFile;
}

/** Test cases (`test(`, `it(`, with `.only`/`.skip`…) and assertions (`expect(`) in a test file's text. */
export function countTestMarkers(content: string | null): TestCounts {
  const text = content ?? '';
  return {
    cases: (text.match(/\b(?:test|it)(?:\.(?:only|skip|fixme|todo|each))?\s*\(/g) ?? []).length,
    asserts: (text.match(/\bexpect\s*\(/g) ?? []).length,
  };
}

export const isTestFile = (p: string): boolean => /(^|\/)e2e\//.test(p) || /\.(test|spec)\.[^/]+$/.test(p);
const isMigration = (p: string): boolean => /(^|\/)migrations\//.test(p) || /\.sql$/i.test(p);
const isManifest = (p: string): boolean => MANIFEST_FILES.includes(p.split('/').pop() ?? '');

export type MinorChangeInput = {
  /** The `fix` comments of the approving review. */
  fixes: readonly { path: string; line: number | null }[];
  numstat: readonly NumstatRow[];
  nameStatus: readonly NameStatusRow[];
  /** Hunks by file (see parseHunks). */
  hunks: Readonly<Record<string, readonly Hunk[]>>;
  /** Test-case and assertion counts of each changed test file, before and after. */
  testCounts: Readonly<Record<string, { before: TestCounts; after: TestCounts }>>;
};

/** Rule ids, in the order they are checked. */
export const MINOR_RULES = ['files_outside_fixes', 'too_many_lines', 'binary_change', 'files_added_or_deleted', 'migration_changed', 'manifest_changed', 'tests_lost_coverage', 'hunk_far_from_comment'] as const;

/**
 * Whether the change between the approved head and the fix attempt's head is minor: every rule holds. `failed` lists the
 * rules that did not. An empty change is minor (nothing new to review).
 */
export function minorChange(input: MinorChangeInput): { minor: boolean; failed: string[] } {
  const failed = new Set<string>();
  const fixPaths = input.fixes.map((f) => norm(f.path));
  const files = [...new Set([...input.numstat.map((r) => norm(r.path)), ...input.nameStatus.map((r) => norm(r.path))])];

  if (!waiveReview({ fixPaths, changedFiles: files }).waive) failed.add('files_outside_fixes');
  const lines = input.numstat.reduce((n, r) => n + r.added + r.deleted, 0);
  if (lines > MINOR_MAX_LINES_PER_FIX * input.fixes.length) failed.add('too_many_lines');
  if (input.numstat.some((r) => r.binary)) failed.add('binary_change');
  if (input.nameStatus.some((r) => r.status !== 'M')) failed.add('files_added_or_deleted');
  if (files.some(isMigration)) failed.add('migration_changed');
  if (files.some((f) => isManifest(f) && !fixPaths.includes(f))) failed.add('manifest_changed');
  for (const c of Object.values(input.testCounts)) {
    if (c.after.cases < c.before.cases || c.after.asserts < c.before.asserts) failed.add('tests_lost_coverage');
  }
  for (const [path, hunks] of Object.entries(input.hunks)) {
    const mine = input.fixes.filter((f) => norm(f.path) === norm(path));
    // A comment without a line is about the whole file: nothing to measure the hunks against.
    if (mine.length === 0 || mine.some((f) => f.line === null)) continue;
    const lines = mine.map((f) => f.line as number);
    const near = (h: Hunk): boolean => {
      const start = h.oldStart;
      const end = h.oldStart + Math.max(h.oldCount, 1) - 1;
      return lines.some((l) => l >= start - MINOR_HUNK_DISTANCE && l <= end + MINOR_HUNK_DISTANCE);
    };
    if (!hunks.every(near)) failed.add('hunk_far_from_comment');
  }
  const ordered = MINOR_RULES.filter((r) => failed.has(r));
  return { minor: ordered.length === 0, failed: ordered };
}
