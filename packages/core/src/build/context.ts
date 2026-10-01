// What the builder is told from everything that was tried before: earlier attempts of the same build request (when
// the session restarts fresh and loses its own history), earlier build requests of the same task, and what the
// reviewer asked on sibling tasks of the same feature. Pure: the loaders in `context-data.ts` read the journal, this
// only shapes and words it. The caps are our convention, not a standard.

/** Characters of the «Earlier attempts on this branch» section (convención nuestra). */
export const HISTORY_MAX_CHARS = 4000;
/** Characters of one attempt's progress notes in the history and in an earlier build (convención nuestra). */
export const HISTORY_PROGRESS_CHARS = 600;
/** Earlier build requests of the task shown, newest first (convención nuestra). */
export const EARLIER_BUILDS_MAX = 3;
/** Lines of sibling-task review comments (convención nuestra). */
export const SIBLING_REVIEWS_MAX = 8;
/** Characters of one comment line (convención nuestra). */
const LINE_MAX_CHARS = 240;
/** Characters of the whole «Earlier builds of this task» section (convención nuestra). */
export const EARLIER_BUILDS_MAX_CHARS = 5000;

export type ContextSection = 'attempt_history' | 'earlier_builds' | 'sibling_reviews';

export type StepRow = { attempt: number; stage: string; outcome: string; detail: unknown };
export type ReviewRow = { run_id: string; verdict?: string; comments: unknown };

/** What one attempt left behind, from the journal. */
export type AttemptFacts = {
  attempt: number;
  ended: { stage: string; outcome: string } | null;
  blocking: string[];
  ciTests: string[];
  progress?: string;
};

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** One line: collapsed whitespace, cut with an ellipsis. */
export function oneLine(text: string, max: number = LINE_MAX_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** The blocking comments of a stored review as one line each (`path:line: body`). */
export function blockingLines(comments: unknown): string[] {
  const list = Array.isArray(comments) ? comments : [];
  const out: string[] = [];
  for (const c of list) {
    const x = obj(c);
    if (x.severity !== 'blocking' || typeof x.body !== 'string' || typeof x.path !== 'string') continue;
    out.push(oneLine(`${x.path}${typeof x.line === 'number' ? `:${x.line}` : ''}: ${x.body}`));
  }
  return out;
}

/** The failing tests of an evidence step as `CODE: title` (no failure messages). */
export function failingTitles(detail: unknown): string[] {
  const d = obj(detail);
  const failures = Array.isArray(d.failures) ? d.failures : [];
  const titles = failures
    .map((f) => obj(f))
    .filter((f) => typeof f.test === 'string')
    .map((f) => oneLine(`${typeof f.code === 'string' && f.code ? `${f.code}: ` : ''}${f.test as string}`, 160));
  if (titles.length > 0) return titles;
  const recorded = Array.isArray(d.recorded) ? d.recorded : [];
  return recorded.map((t) => obj(t)).filter((t) => t.result === 'fail' && typeof t.code === 'string').map((t) => t.code as string);
}

/**
 * The facts of every attempt of one request. `steps` are in journal order (oldest first); a review is tied to its
 * attempt by the run id its `review` step recorded, since `pr_reviews` has no attempt column.
 */
export function attemptFacts(steps: StepRow[], reviews: ReviewRow[]): AttemptFacts[] {
  const attempts = [...new Set(steps.map((s) => s.attempt))].sort((a, b) => a - b);
  const reviewByRun = new Map(reviews.map((r) => [r.run_id, r]));
  return attempts.map((n) => {
    const rows = steps.filter((s) => s.attempt === n);
    const done = rows.filter((r) => r.outcome !== 'started');
    const last = done.at(-1);
    let blocking: string[] = [];
    for (const r of rows) {
      if (r.stage !== 'review') continue;
      const runId = obj(r.detail).run_id;
      const review = typeof runId === 'string' ? reviewByRun.get(runId) : undefined;
      if (review) blocking = blockingLines(review.comments);
    }
    let ciTests: string[] = [];
    for (const r of rows) if (r.stage === 'evidence') {
      const t = failingTitles(r.detail);
      if (t.length > 0) ciTests = t;
    }
    let progress: string | undefined;
    for (const r of rows) {
      if (r.stage !== 'builder' || (r.outcome !== 'ok' && r.outcome !== 'failed')) continue;
      const p = obj(r.detail).progress;
      if (typeof p === 'string' && p.trim()) progress = p.trim();
    }
    return { attempt: n, ended: last ? { stage: last.stage, outcome: last.outcome } : null, blocking, ciTests, ...(progress ? { progress } : {}) };
  });
}

const endedText = (e: AttemptFacts['ended']): string => (e ? `${e.stage} ${e.outcome}` : 'no step recorded');

function attemptBlock(f: AttemptFacts): string[] {
  const lines = [`Attempt ${f.attempt}: ended at ${endedText(f.ended)}.`];
  if (f.blocking.length > 0) lines.push('  Reviewer asked for:', ...f.blocking.map((b) => `  - ${b}`));
  if (f.ciTests.length > 0) lines.push(`  CI failed: ${f.ciTests.join('; ')}`);
  if (f.progress) lines.push(`  Progress notes: ${oneLine(f.progress, HISTORY_PROGRESS_CHARS)}`);
  return lines;
}

/**
 * «Earlier attempts on this branch»: every attempt before the previous one (which keeps its full feedback), oldest
 * first. Only for a fresh session after attempt 2; a resumed session has its own history. Over the cap, the oldest
 * attempts are left out with a note. Empty when there is nothing to say.
 */
export function attemptHistoryLines(facts: AttemptFacts[], attempt: number, resumed: boolean, max: number = HISTORY_MAX_CHARS): string[] {
  if (resumed || attempt <= 2) return [];
  const before = facts.filter((f) => f.attempt < attempt - 1).sort((a, b) => a.attempt - b.attempt);
  if (before.length === 0) return [];
  const head = ['Earlier attempts on this branch (before the previous one; your session was restarted, so this is what you would otherwise not know):'];
  const blocks = before.map(attemptBlock);
  const size = (from: number) => head.join('\n').length + blocks.slice(from).reduce((n, b) => n + b.join('\n').length + 1, 0);
  let from = 0;
  while (from < blocks.length - 1 && size(from) > max) from += 1;
  const note = from > 0 ? [`(Attempts ${before[0]!.attempt}-${before[from - 1]!.attempt} are left out to keep this short.)`] : [];
  return [...head, ...note, ...blocks.slice(from).flat()];
}

/** An earlier build request of the same task, summarised. */
export type EarlierBuild = {
  taskVersion: number | null;
  state: string;
  prUrl: string | null;
  mergeCommit: string | null;
  /** Why it was withdrawn, or where it stopped. */
  why: string | null;
  blocking: string[];
  ciTests: string[];
  progress?: string;
};

const stateText = (b: EarlierBuild): string => {
  if (b.state === 'done') return `merged${b.prUrl ? `, pull request ${b.prUrl}` : ''}${b.mergeCommit ? `, merge commit ${b.mergeCommit.slice(0, 12)}` : ''}`;
  if (b.state === 'withdrawn') return `withdrawn${b.why ? `: ${oneLine(b.why, 200)}` : ''}${b.prUrl ? ` (pull request ${b.prUrl} closed)` : ''}`;
  return `not merged${b.why ? `: ${oneLine(b.why, 200)}` : ''}${b.prUrl ? ` (pull request ${b.prUrl})` : ''}`;
};

/** «Earlier builds of this task», newest first, at most `EARLIER_BUILDS_MAX`; empty when there are none. */
export function earlierBuildsLines(builds: EarlierBuild[], max: number = EARLIER_BUILDS_MAX_CHARS): string[] {
  const shown = builds.slice(0, EARLIER_BUILDS_MAX);
  if (shown.length === 0) return [];
  const lines = ['# Earlier builds of this task', 'This task was requested before, newest first. The code of a merged earlier build is already on main: extend it, do not rewrite it.'];
  for (const b of shown) {
    lines.push('', `- Build of task version ${b.taskVersion != null ? `v${b.taskVersion}` : '?'}: ${stateText(b)}.`);
    if (b.blocking.length > 0) lines.push('  The reviewer last asked for:', ...b.blocking.map((x) => `  - ${x}`));
    if (b.ciTests.length > 0) lines.push(`  CI had failed: ${b.ciTests.join('; ')}`);
    if (b.progress) lines.push(`  Its final progress notes: ${oneLine(b.progress, HISTORY_PROGRESS_CHARS)}`);
  }
  const text = lines.join('\n');
  return text.length > max ? text.slice(0, max - 1).split('\n').concat('(cut to keep this short)') : lines;
}

/** One comment raised on a sibling task, with the task it came from. */
export type SiblingComment = { task: string; line: string };

/**
 * «Review comments on earlier tasks of this feature»: blocking comments the reviewer raised on any attempt of a
 * merged sibling task, deduplicated by text, at most `SIBLING_REVIEWS_MAX`. Input is newest first.
 */
export function siblingReviewLines(comments: SiblingComment[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of comments) {
    const key = c.line.toLowerCase().replace(/^[^:]*:\d*:?\s*/, '').slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`- ${c.task}: ${c.line}`);
    if (out.length >= SIBLING_REVIEWS_MAX) break;
  }
  return out.length === 0 ? [] : ['# Review comments on earlier tasks of this feature (avoid repeating them)', 'The reviewer asked for these on sibling tasks of the same feature that merged afterwards:', ...out];
}
