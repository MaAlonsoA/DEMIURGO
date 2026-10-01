// Reads of the stored forensics and playbooks (append-only tables: the latest row wins) and the pure aggregation the
// playbooks and the observability page are built from.

import { FORENSIC_DIMENSIONS, FORENSIC_VERDICTS, type ActionOutput } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';

export type ForensicAnalysis = ActionOutput<'task_forensics'> & { catalog_marks?: Record<string, string> };

export type ForensicRow = {
  id: string;
  task_id: string;
  code: string;
  task_version_id: string;
  request_ids: string[];
  trigger_request_id: string | null;
  ai_run_id: string;
  evidence_hash: string;
  catalog_version: string;
  agent_version: string;
  engine: unknown;
  created_at: Date;
  analysis: ForensicAnalysis;
};

export type PlaybookEntry = ActionOutput<'playbook_write'>;
export type PlaybookRow = { id: string; class_key: string; version: number; entry: PlaybookEntry; based_on: string[]; ai_run_id: string; created_at: Date };

// Timestamps come out of pg as Date; the schema types them as column types.
function asRow<R extends { request_ids: unknown; analysis: unknown; created_at: unknown }>(r: R): ForensicRow {
  return { ...(r as unknown as ForensicRow), request_ids: r.request_ids as string[], analysis: r.analysis as ForensicAnalysis, created_at: new Date(r.created_at as Date) };
}

/** The latest forensic of every task of the project (or of one task), newest analysis per task. */
export async function latestForensics(db: Db, projectId: string, taskId?: string): Promise<ForensicRow[]> {
  let q = db
    .selectFrom('task_forensics as f')
    .innerJoin('records as r', 'r.id', 'f.task_id')
    .selectAll('f')
    .select('r.code')
    .where('f.project_id', '=', projectId);
  if (taskId) q = q.where('f.task_id', '=', taskId);
  const rows = await q.orderBy('f.created_at', 'desc').orderBy('f.id', 'desc').execute();
  const seen = new Set<string>();
  const out: ForensicRow[] = [];
  for (const r of rows) {
    if (seen.has(r.task_id)) continue;
    seen.add(r.task_id);
    out.push(asRow(r));
  }
  return out.toSorted((a, b) => a.code.localeCompare(b.code));
}

/** Every forensic of one task, newest first. */
export async function forensicsOfTask(db: Db, projectId: string, taskId: string): Promise<ForensicRow[]> {
  const rows = await db
    .selectFrom('task_forensics as f')
    .innerJoin('records as r', 'r.id', 'f.task_id')
    .selectAll('f')
    .select('r.code')
    .where('f.project_id', '=', projectId)
    .where('f.task_id', '=', taskId)
    .orderBy('f.created_at', 'desc')
    .orderBy('f.id', 'desc')
    .execute();
  return rows.map(asRow);
}

/** The latest version of the playbook of each class (the project's own, else the global one). */
export async function latestPlaybooks(db: Db, projectId: string): Promise<PlaybookRow[]> {
  const rows = await db
    .selectFrom('forensic_playbooks')
    .selectAll()
    .where((eb) => eb.or([eb('project_id', '=', projectId), eb('project_id', 'is', null)]))
    .orderBy('version', 'desc')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const seen = new Set<string>();
  const out: PlaybookRow[] = [];
  for (const r of rows) {
    if (seen.has(r.class_key)) continue;
    seen.add(r.class_key);
    out.push({ id: r.id, class_key: r.class_key, version: r.version, entry: r.entry as PlaybookEntry, based_on: r.based_on as string[], ai_run_id: r.ai_run_id, created_at: new Date(r.created_at as unknown as Date) });
  }
  return out.toSorted((a, b) => a.class_key.localeCompare(b.class_key));
}

/** The error classes a forensic names: in what went wrong and in its improvements. */
export function classesOf(a: ForensicAnalysis): string[] {
  return [...new Set([...a.went_wrong.map((w) => w.error_class), ...a.improvements.map((i) => i.playbook_class)])].toSorted();
}

const WEIGHT = { high: 3, medium: 2, low: 1 } as const;

type Count = Record<string, number>;
const bump = (c: Count, k: string, n = 1) => {
  c[k] = (c[k] ?? 0) + n;
};

export type TaskSummary = {
  code: string;
  task_id: string;
  forensic_id: string;
  analyzed_at: string;
  outcome: string;
  summary: string;
  catalog_version: string;
  counts: { went_wrong: number; root_causes: number; improvements: number; by_dimension: Count; by_class: Count };
};

export type ClassSummary = { class: string; occurrences: number; tasks: number; attempts: number; minutes: number; usd: number; improvements: number; playbook_version: number | null };
export type DimensionSummary = { dimension: string; root_causes: number; improvements: number; tasks: number };
export type RankedImprovement = {
  target: string;
  dimension: string;
  playbook_class: string;
  change: string;
  expected_effect: string;
  source: string;
  priority: 'high' | 'medium' | 'low';
  frequency: number;
  score: number;
  tasks: string[];
};
export type PieceSummary = { piece_id: string; involved: number; worked: number; contributed_to_error: number; could_have_prevented: number; missing: number; not_applicable: number; tasks: number };

export type ForensicsOverview = {
  catalog_version: string | null;
  /** Tasks whose latest forensic used another checklist: left out of `by_piece` so verdicts are never mixed. */
  catalog_excluded_tasks: string[];
  tasks: TaskSummary[];
  by_class: ClassSummary[];
  by_dimension: DimensionSummary[];
  improvements: RankedImprovement[];
  by_piece: PieceSummary[];
  playbooks: { class_key: string; version: number; title: string; created_at: string; entry: PlaybookEntry; based_on: string[] }[];
};

/**
 * What the latest forensics say all together. Pure. `by_piece` counts the checklist verdicts only across forensics of the
 * newest checklist (`catalog_version`); improvements rank by frequency (tasks that raise them) times priority
 * (high 3, medium 2, low 1; convención nuestra).
 */
export function overviewOf(rows: readonly ForensicRow[], playbooks: readonly PlaybookRow[]): ForensicsOverview {
  const newest = [...rows].toSorted((a, b) => b.created_at.getTime() - a.created_at.getTime())[0]?.catalog_version ?? null;
  const tasks: TaskSummary[] = [];
  const classes = new Map<string, ClassSummary & { _tasks: Set<string> }>();
  const dimensions = new Map<string, { root_causes: number; improvements: number; _tasks: Set<string> }>();
  const improvements = new Map<string, RankedImprovement & { _tasks: Set<string> }>();
  const pieces = new Map<string, PieceSummary>();
  const excluded: string[] = [];

  for (const f of rows) {
    const a = f.analysis;
    const by_dimension: Count = {};
    const by_class: Count = {};
    for (const c of a.root_causes) bump(by_dimension, c.dimension);
    for (const w of a.went_wrong) bump(by_class, w.error_class);
    tasks.push({
      code: f.code,
      task_id: f.task_id,
      forensic_id: f.id,
      analyzed_at: f.created_at.toISOString(),
      outcome: a.outcome,
      summary: a.summary,
      catalog_version: f.catalog_version,
      counts: { went_wrong: a.went_wrong.length, root_causes: a.root_causes.length, improvements: a.improvements.length, by_dimension, by_class },
    });
    for (const w of a.went_wrong) {
      const c = classes.get(w.error_class) ?? { class: w.error_class, occurrences: 0, tasks: 0, attempts: 0, minutes: 0, usd: 0, improvements: 0, playbook_version: null, _tasks: new Set<string>() };
      c.occurrences++;
      c._tasks.add(f.code);
      c.attempts += w.cost.attempts ?? 0;
      c.minutes += w.cost.minutes ?? 0;
      c.usd += w.cost.usd ?? 0;
      classes.set(w.error_class, c);
    }
    for (const i of a.improvements) {
      const c = classes.get(i.playbook_class) ?? { class: i.playbook_class, occurrences: 0, tasks: 0, attempts: 0, minutes: 0, usd: 0, improvements: 0, playbook_version: null, _tasks: new Set<string>() };
      c.improvements++;
      classes.set(i.playbook_class, c);
      const d = dimensions.get(i.dimension) ?? { root_causes: 0, improvements: 0, _tasks: new Set<string>() };
      d.improvements++;
      d._tasks.add(f.code);
      dimensions.set(i.dimension, d);
      const key = `${i.dimension}|${i.target.trim().toLowerCase()}|${i.playbook_class}`;
      const r = improvements.get(key) ?? { target: i.target, dimension: i.dimension, playbook_class: i.playbook_class, change: i.change, expected_effect: i.expected_effect, source: i.source, priority: i.priority, frequency: 0, score: 0, tasks: [], _tasks: new Set<string>() };
      if (WEIGHT[i.priority] > WEIGHT[r.priority]) Object.assign(r, { priority: i.priority, change: i.change, expected_effect: i.expected_effect, source: i.source });
      if (!r._tasks.has(f.code)) r.frequency++;
      r._tasks.add(f.code);
      r.score += WEIGHT[i.priority];
      improvements.set(key, r);
    }
    for (const c of a.root_causes) {
      const d = dimensions.get(c.dimension) ?? { root_causes: 0, improvements: 0, _tasks: new Set<string>() };
      d.root_causes++;
      d._tasks.add(f.code);
      dimensions.set(c.dimension, d);
    }
    if (f.catalog_version !== newest) {
      excluded.push(f.code);
      continue;
    }
    for (const item of a.checklist) {
      const p = pieces.get(item.piece_id) ?? { piece_id: item.piece_id, involved: 0, worked: 0, contributed_to_error: 0, could_have_prevented: 0, missing: 0, not_applicable: 0, tasks: 0 };
      p.tasks++;
      if (item.involved === 'yes') p.involved++;
      p[item.verdict]++;
      pieces.set(item.piece_id, p);
    }
  }
  const playbookOf = new Map(playbooks.map((p) => [p.class_key, p]));
  return {
    catalog_version: newest,
    catalog_excluded_tasks: excluded.toSorted(),
    tasks,
    by_class: [...classes.values()]
      .map(({ _tasks, ...c }) => ({ ...c, tasks: _tasks.size, usd: Math.round(c.usd * 100) / 100, playbook_version: playbookOf.get(c.class)?.version ?? null }))
      .toSorted((a, b) => b.occurrences - a.occurrences || a.class.localeCompare(b.class)),
    by_dimension: FORENSIC_DIMENSIONS.filter((d) => dimensions.has(d)).map((d) => {
      const x = dimensions.get(d)!;
      return { dimension: d, root_causes: x.root_causes, improvements: x.improvements, tasks: x._tasks.size };
    }),
    improvements: [...improvements.values()]
      .map(({ _tasks, ...i }) => ({ ...i, tasks: [..._tasks].toSorted() }))
      .toSorted((a, b) => b.score - a.score || b.frequency - a.frequency || a.target.localeCompare(b.target)),
    by_piece: [...pieces.values()].toSorted((a, b) => b.contributed_to_error + b.could_have_prevented + b.missing - (a.contributed_to_error + a.could_have_prevented + a.missing) || a.piece_id.localeCompare(b.piece_id)),
    playbooks: playbooks.map((p) => ({ class_key: p.class_key, version: p.version, title: p.entry.title, created_at: p.created_at.toISOString(), entry: p.entry, based_on: p.based_on })),
  };
}

/** The verdict names, for readers of `by_piece`. */
export const PIECE_VERDICTS = FORENSIC_VERDICTS;
