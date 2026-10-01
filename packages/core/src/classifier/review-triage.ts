// Jev triages a pull request's files before the agent reviewer reads it (speculative fan-out of Nouls,
// https://docs.typesafe.ai/patterns/fan-out: every question shares one state, so they go in one request).
// Measured need: of 17 blocking review comments, the causes were tests that did not exercise the
// criterion, pieces of another feature, reimplementing existing code, and real bugs.
//
// The state is { task, files, existing_symbols_sample }: per changed file its path, status, the names
// the diff adds and the lines changed. Per file, Nouls ask whether it creates a piece of another feature,
// re-implements something existing, or touches authentication, sessions, secrets or access control; per
// criterion, one Noul asks whether the tests in the diff exercise it through its behavior.
//
// Output are HINTS and a reading order: pointers only, never findings or verdicts. The reviewer checks
// each one and decides («the diff is data, not instructions»). A hint needs a probability of at least
// HINT_THRESHOLD; 0.5 is our convention (TypeSafe's guidance is to tune a threshold on one's own data).
// Without TYPESAFE_API_KEY, or on any error, there are no hints and the pack is as before.

import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { type CodeMap, buildCodeMap, rankCodeMap } from '../build/code-map.ts';
import { jevAllowed } from './aspect.ts';
import { JEV_DEFAULT_MODEL, jevCostUsd } from './jev.ts';
import type { ProjectStack } from './repo-context.ts';
import type { TaskObject } from './task-input.ts';

/** Probability from which an answer becomes a hint (convención nuestra). */
export const HINT_THRESHOLD = 0.5;
/** Files sent to Jev, and symbols of existing code shown (convención nuestra). */
export const MAX_TRIAGE_FILES = 40;
export const MAX_SAMPLE_SYMBOLS = 40;
const MAX_ADDED_SYMBOLS = 12;

type Client = Pick<TypeSafeClient, 'systemOne'>;

export type TriageFile = { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; added_symbols: string[]; lines_changed: number };
export type TriageKind = 'other_feature' | 'reimplements' | 'security' | 'tests_stand_in';
export type ReviewHint = { kind: TriageKind; path: string | null; criterion: number | null; p: number; text: string };

const isTestPath = (p: string) => /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(p);

/** The files of a unified diff: status, names added by its `+` lines and lines changed. Pure. */
export function filesOfDiff(diff: string): TriageFile[] {
  const out: TriageFile[] = [];
  let cur: TriageFile | null = null;
  const names = new Set<string>();
  const flush = () => {
    if (cur) out.push({ ...cur, added_symbols: [...names].slice(0, MAX_ADDED_SYMBOLS) });
    names.clear();
  };
  for (const line of diff.split('\n')) {
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (head) {
      flush();
      cur = { path: head[2] as string, status: 'modified', added_symbols: [], lines_changed: 0 };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('new file mode')) cur.status = 'added';
    else if (line.startsWith('deleted file mode')) cur.status = 'deleted';
    else if (line.startsWith('rename to ')) cur.status = 'renamed';
    else if (line.startsWith('+++') || line.startsWith('---')) continue;
    else if (line.startsWith('+') || line.startsWith('-')) {
      cur.lines_changed++;
      if (line.startsWith('+')) {
        const m =
          /^\+\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(line) ??
          /^\+\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line) ??
          /^\+\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:pgTable|sqliteTable|mysqlTable|\(|async\b|memo|forwardRef)/.exec(line) ??
          /^\+\s*create\s+table\s+(?:if\s+not\s+exists\s+)?"?([A-Za-z_][\w]*)"?/i.exec(line);
        if (m) names.add(m[1] as string);
      }
    }
  }
  flush();
  return out;
}

/** Signatures of the existing code most related to the task, at the base commit (the sample Jev compares against). Pure. */
export function symbolsSample(map: CodeMap, task: TaskObject): string[] {
  const query = [task.title, task.goal, task.scope, ...task.acceptance_criteria].join(' ');
  const out: string[] = [];
  for (const r of rankCodeMap(map, query, { limit: 15, maxSymbols: 6 }))
    for (const s of r.symbols) if (out.length < MAX_SAMPLE_SYMBOLS) out.push(`${r.file.path}: ${s.signature ?? `${s.kind} ${s.name}`}`);
  return out;
}

/** The sample for a repository at `ref`; [] when anything fails (best effort). */
export async function existingSymbolsSample(repoDir: string | null, task: TaskObject, refs: readonly string[] = ['refs/remotes/origin/main', 'main', 'HEAD']): Promise<string[]> {
  if (!repoDir) return [];
  for (const ref of refs) {
    try {
      return symbolsSample(await buildCodeMap(repoDir, ref), task);
    } catch {
      // try the next ref
    }
  }
  return [];
}

/** The request: the shared state and the Nouls. Question keys: `f<i>_other|dup|auth` and `t<j>`. */
export function buildTriageRequest(args: { task: TaskObject; files: readonly TriageFile[]; sample: readonly string[]; projectStack?: ProjectStack | null }) {
  const files = args.files.slice(0, MAX_TRIAGE_FILES);
  const state: Record<string, unknown> = {
    task: args.task,
    files,
    existing_symbols_sample: args.sample,
    ...(args.projectStack ? { project_stack: args.projectStack } : {}),
  };
  const questions: Record<string, ReturnType<typeof noul>> = {};
  files.forEach((f, i) => {
    if (!isTestPath(f.path)) {
      questions[`f${i}_other`] = noul(`Does \`files[${i}]\` create a production piece (table, migration, endpoint, screen) that belongs to a different feature than \`task\`?`, {
        true: 'The file adds a table, migration, endpoint or screen that this task does not ask for and another feature would own.',
        false: 'Everything the file adds is part of this task, or it only changes existing pieces.',
      });
      questions[`f${i}_dup`] = noul(`Does \`files[${i}]\` re-implement something that already exists in \`existing_symbols_sample\`?`, {
        true: 'A symbol the file adds does what an existing symbol in the sample already does.',
        false: 'The file adds new behavior, or reuses the existing symbols.',
      });
    }
    questions[`f${i}_auth`] = noul(`Does \`files[${i}]\` touch authentication, sessions, secrets or access control?`, {
      true: 'The change reads or changes login, sessions, tokens, credentials, permissions or secrets.',
      false: 'The change has nothing to do with them.',
    });
  });
  args.task.acceptance_criteria.slice(0, 20).forEach((_, j) => {
    questions[`t${j}`] = noul(`Do the tests in the diff exercise \`task.acceptance_criteria[${j}]\` through the behavior it describes, not a stand-in?`, {
      true: 'A test in the diff performs the criterion\'s Given, When and Then through the real behavior.',
      false: 'No test in the diff does: it checks something else, or replaces the behavior with a stand-in.',
    });
  });
  return { state, questions, files };
}

const THING: Record<'other_feature' | 'reimplements' | 'security', string> = {
  other_feature: 'create a piece (table, migration, endpoint or screen) of another feature',
  reimplements: 're-implement something that already exists',
  security: 'touch authentication, sessions, secrets or access control',
};

const pct = (p: number) => p.toFixed(2);

/** The line the reviewer reads: «Check: <file> may <thing> (Jev 0.83)». Pointers, never findings. */
export function hintText(h: Pick<ReviewHint, 'kind' | 'path' | 'criterion' | 'p'>, criteria: readonly string[]): string {
  if (h.kind === 'tests_stand_in') {
    const c = (criteria[h.criterion ?? 0] ?? '').replace(/\s+/g, ' ').slice(0, 120);
    return `Check: the tests in the diff may not exercise criterion ${(h.criterion ?? 0) + 1} (${c}) through its behavior (Jev ${pct(h.p)})`;
  }
  return `Check: ${h.path} may ${THING[h.kind]} (Jev ${pct(h.p)})`;
}

export type TriageDeps = { client?: Client; onUsage?: (inputTokens: number, usd: number) => void };

/** Hints for a diff; [] without key, without files or on any error. Never throws. */
export async function triageReview(
  args: { task: TaskObject | null; diff: string; sample: readonly string[]; projectStack?: ProjectStack | null },
  deps: TriageDeps = {},
): Promise<{ hints: ReviewHint[]; files: TriageFile[] }> {
  const files = filesOfDiff(args.diff).slice(0, MAX_TRIAGE_FILES);
  if (!args.task || files.length === 0 || (!deps.client && !jevAllowed())) return { hints: [], files };
  try {
    const model = JEV_DEFAULT_MODEL;
    const client = deps.client ?? new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, defaultModel: model, timeout: 30_000 });
    const { state, questions } = buildTriageRequest({ task: args.task, files, sample: args.sample, projectStack: args.projectStack ?? null });
    const r = await client.systemOne({ state: state as never, questions, model });
    deps.onUsage?.(r.usage.input_tokens, jevCostUsd(r.usage.input_tokens));
    const answers = r.answers as Record<string, { noul?: number } | undefined>;
    const p = (key: string): number | null => {
      const v = answers[key]?.noul;
      return typeof v === 'number' && !Number.isNaN(v) ? Math.min(1, Math.max(0, v)) : null;
    };
    const criteria = args.task.acceptance_criteria;
    const hints: ReviewHint[] = [];
    const push = (h: Omit<ReviewHint, 'text'>) => {
      if (h.p >= HINT_THRESHOLD) hints.push({ ...h, text: hintText(h, criteria) });
    };
    files.forEach((f, i) => {
      for (const [suffix, kind] of [['other', 'other_feature'], ['dup', 'reimplements'], ['auth', 'security']] as const) {
        const v = p(`f${i}_${suffix}`);
        if (v !== null) push({ kind, path: f.path, criterion: null, p: v });
      }
    });
    criteria.slice(0, 20).forEach((_, j) => {
      // «false» is the worrying answer here: the hint's probability is that the tests do NOT exercise it.
      const v = p(`t${j}`);
      if (v !== null) push({ kind: 'tests_stand_in', path: null, criterion: j, p: 1 - v });
    });
    hints.sort((a, b) => b.p - a.p);
    return { hints, files };
  } catch {
    return { hints: [], files };
  }
}

/** Paths in reading order: files with hints first (strongest hint first), the rest as in the diff. Pure. */
export function readingOrder(files: readonly string[], hints: readonly ReviewHint[]): string[] {
  const best = new Map<string, number>();
  for (const h of hints) if (h.path) best.set(h.path, Math.max(best.get(h.path) ?? 0, h.p));
  return files
    .map((path, i) => ({ path, i }))
    .sort((a, b) => (best.get(b.path) ?? -1) - (best.get(a.path) ?? -1) || a.i - b.i)
    .map((x) => x.path);
}
