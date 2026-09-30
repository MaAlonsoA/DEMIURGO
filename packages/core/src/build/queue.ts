// The project's build queue (FDR-BUI-002): the approved tasks that can be built now, in build order,
// with their size, checks, brief and open build request; the approved tasks that wait, with why; and
// the open requests that went stale. Derived on read from the same readiness as the task board
// (queries/read.ts): nothing is stored here.

import { join } from 'node:path';
import { DomainError, SIZE_POINTS, type TaskSize, sizeLine } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import { productState } from '../queries/read.ts';
import { projectsDir } from '../repo/repo.ts';

type StateRow = Awaited<ReturnType<typeof productState>>['designs'][number];

export type BuildRequestView = {
  id: string;
  task_version: number | null;
  requested_by: string;
  requested_at: string;
  /** The task version, its feature version or its built state changed since it was requested. */
  stale: boolean;
  stale_reasons: string[];
};

export type QueueTask = {
  code: string;
  title: string;
  version: number | null;
  feature: { code: string; title: string } | null;
  epic: { code: string; title: string } | null;
  size: TaskSize | null;
  points: number | null;
  checks: number;
  request: BuildRequestView | null;
};

export type WaitingTask = QueueTask & { reasons: string[] };

export type BuildQueue = {
  ready: QueueTask[];
  waiting: WaitingTask[];
  /** Open requests on tasks no longer in the queue or Waiting (built, for instance): stale. */
  stale: QueueTask[];
  totals: { tasks: number; points: number; unsized: number };
  repository: { path: string | null; branch: string };
};

const DEFAULT_BRANCH = 'main';

/** Where the project's code and design live, as the brief names it. */
export async function repositoryOf(db: Db, projectId: string): Promise<{ path: string | null; branch: string }> {
  const root = projectsDir();
  const repo = await db.selectFrom('project_repos').select('dir').where('project_id', '=', projectId).executeTakeFirst();
  return { path: root && repo ? join(root, repo.dir) : null, branch: DEFAULT_BRANCH };
}

type Rows = { all: StateRow[]; byCode: Map<string, StateRow> };

function epicOf(feature: StateRow | undefined, rows: Rows): StateRow | undefined {
  if (!feature) return undefined;
  const linked = feature.based_on ? rows.byCode.get(feature.based_on) : undefined;
  if (linked?.type === 'epic') return linked;
  return rows.all.find((r) => r.type === 'epic' && r.domain === feature.domain);
}

/**
 * Build order: a feature's tasks follow the tasks of the features it needs; otherwise epic order (by
 * code until the project has an explicit epic order), the epic's feature order, then the order in
 * which the tasks were proposed.
 */
function orderFeatures(features: StateRow[], rows: Rows, position: Map<string, number>): Map<string, number> {
  const key = (f: StateRow): [string, number, string] => [
    epicOf(f, rows)?.code ?? '￿',
    position.get(f.code) ?? Number.MAX_SAFE_INTEGER,
    f.code,
  ];
  const cmp = (a: StateRow, b: StateRow) => {
    const [ea, pa, ca] = key(a);
    const [eb, pb, cb] = key(b);
    return ea !== eb ? (ea < eb ? -1 : 1) : pa !== pb ? pa - pb : ca < cb ? -1 : ca > cb ? 1 : 0;
  };
  const sorted = [...features].sort(cmp);
  const done = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (f: StateRow) => {
    if (done.has(f.code) || visiting.has(f.code)) return;
    visiting.add(f.code);
    for (const need of [...f.needs].map((c) => rows.byCode.get(c)).filter((x): x is StateRow => !!x).sort(cmp)) visit(need);
    visiting.delete(f.code);
    done.set(f.code, done.size);
  };
  for (const f of sorted) visit(f);
  return done;
}

export async function buildQueue(db: Db, projectId: string): Promise<BuildQueue> {
  const state = await productState(db, projectId);
  const all = [...state.designs, ...state.decisions];
  const rows: Rows = { all, byCode: new Map(all.map((r) => [r.code, r])) };
  const tasks = state.designs.filter((r) => r.type === 'task');
  const features = state.designs.filter((r) => r.type === 'fdr');
  const planned = await db
    .selectFrom('planned_features')
    .innerJoin('records', 'records.id', 'planned_features.record_id')
    .select(['records.code', 'planned_features.position'])
    .where('planned_features.project_id', '=', projectId)
    .where('planned_features.state', '<>', 'dropped')
    .execute();
  const featureOrder = orderFeatures(features, rows, new Map(planned.map((p) => [p.code, p.position])));
  const records = await db
    .selectFrom('records')
    .select(['id', 'code', 'created_at'])
    .where('project_id', '=', projectId)
    .where('type', '=', 'task')
    .execute();
  const created = new Map(records.map((r) => [r.code, new Date(r.created_at as unknown as Date).getTime()]));
  const ids = new Map(records.map((r) => [r.code, r.id]));
  const open = await db
    .selectFrom('build_requests')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('state', '=', 'requested')
    .execute();
  const versionIds = open.flatMap((o) => [o.task_version_id, o.feature_version_id]).filter((x): x is string => !!x);
  const versions = versionIds.length
    ? await db.selectFrom('record_versions').select(['id', 'n']).where('id', 'in', versionIds).execute()
    : [];
  const vn = new Map(versions.map((v) => [v.id, v.n]));

  const requestOf = (task: StateRow, feature: StateRow | undefined): BuildRequestView | null => {
    const o = open.find((x) => x.task_id === ids.get(task.code));
    if (!o) return null;
    const reasons: string[] = [];
    if (task.implementation === 'implemented') reasons.push('The task is built.');
    if (o.task_version_id !== task.current_id)
      reasons.push(`Requested on v${vn.get(o.task_version_id) ?? '?'}, the current task version is v${task.current ?? '—'}.`);
    if (feature && o.feature_version_id !== feature.current_id)
      reasons.push(
        `Requested on ${feature.code} v${o.feature_version_id ? (vn.get(o.feature_version_id) ?? '?') : '—'}, the current one is v${feature.current ?? '—'}.`,
      );
    return {
      id: o.id,
      task_version: vn.get(o.task_version_id) ?? null,
      requested_by: o.requested_by,
      requested_at: new Date(o.requested_at as unknown as Date).toISOString(),
      stale: reasons.length > 0,
      stale_reasons: reasons,
    };
  };

  const lineOf = (task: StateRow): QueueTask => {
    const feature = task.based_on ? rows.byCode.get(task.based_on) : undefined;
    const epic = epicOf(feature, rows);
    const size = task.effort?.size ?? null;
    return {
      code: task.code,
      title: task.title,
      version: task.current,
      feature: feature ? { code: feature.code, title: feature.title } : null,
      epic: epic ? { code: epic.code, title: epic.title } : null,
      size,
      points: size ? SIZE_POINTS[size] : null,
      checks: task.checks,
      request: requestOf(task, feature),
    };
  };

  const order = (a: StateRow, b: StateRow) => {
    const fa = featureOrder.get(a.based_on ?? '') ?? Number.MAX_SAFE_INTEGER;
    const fb = featureOrder.get(b.based_on ?? '') ?? Number.MAX_SAFE_INTEGER;
    if (fa !== fb) return fa - fb;
    return (created.get(a.code) ?? 0) - (created.get(b.code) ?? 0);
  };

  const approved = tasks.filter((t) => t.current !== null && t.implementation !== 'implemented').sort(order);
  const ready = approved.filter((t) => t.readiness?.ready).map(lineOf);
  const waiting = approved
    .filter((t) => !t.readiness?.ready)
    .map((t) => ({ ...lineOf(t), reasons: t.readiness?.reasons ?? [] }));
  const listed = new Set(approved.map((t) => t.code));
  const stale = tasks
    .filter((t) => !listed.has(t.code) && open.some((o) => o.task_id === ids.get(t.code)))
    .sort(order)
    .map(lineOf);
  return {
    ready,
    waiting,
    stale,
    totals: {
      tasks: ready.length,
      points: ready.reduce((n, t) => n + (t.points ?? 0), 0),
      unsized: ready.filter((t) => t.points === null).length,
    },
    repository: await repositoryOf(db, projectId),
  };
}

/** Folder of each record type in the project's `design/` (design/export.ts). */
const FOLDERS: Record<string, string> = {
  decision: 'decisions',
  adr: 'adr',
  fdr: 'fdr',
  task: 'tasks',
  bug: 'bugs',
  epic: 'epics',
  product_definition: 'product',
};

const designPath = (type: string, code: string) => `design/${FOLDERS[type] ?? 'records'}/${code}.md`;

function goalOf(sections: readonly { title: string; content: string }[]): string {
  const text = sections.find((s) => s.content.trim() !== '')?.content ?? '';
  const paragraph = text.split(/\n\s*\n/).find((x) => x.trim() !== '') ?? '';
  return paragraph
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const sentence = (s: string) => s.trim().replace(/[.\s]+$/, '');

/**
 * The build brief of a ready record (FDR-DEL-008, FDR-BUI-002): English plain text that starts with
 * "Build <code>", from its current approved version, with its size (a task), its criteria and checks,
 * what it depends on, its design paths and the repository with its default branch. Refused with the
 * readiness reasons when it is not ready. The Copy brief button and a build request use this text.
 */
export async function composeBrief(
  db: Db,
  projectId: string,
  code: string,
  options: { forBuild?: boolean } = {},
): Promise<string> {
  const state = await productState(db, projectId);
  const all = [...state.designs, ...state.decisions];
  const rows: Rows = { all, byCode: new Map(all.map((r) => [r.code, r])) };
  const row = rows.byCode.get(code);
  if (!row) throw new DomainError('not_found', `Record ${code} does not exist.`);
  if (!row.current_id || !row.readiness?.ready) {
    throw new DomainError('guard', `${code} is not ready to build.`, row.readiness?.reasons ?? ['It has no approved version.']);
  }
  if (options.forBuild && row.implementation === 'implemented') {
    throw new DomainError('guard', `${code} is not ready to build.`, ['It is built already.']);
  }
  const version = await db
    .selectFrom('record_versions')
    .select(['n', 'title', 'sections'])
    .where('id', '=', row.current_id)
    .executeTakeFirstOrThrow();
  const criteria = await db
    .selectFrom('criteria')
    .select(['code', 'title', 'statement', 'verification', 'check_text'])
    .where('record_version_id', '=', row.current_id)
    .orderBy('position')
    .execute();
  const feature = row.type === 'task' && row.based_on ? rows.byCode.get(row.based_on) : undefined;
  const framed = feature ?? row;
  const epic = epicOf(framed, rows);
  const kind = row.type === 'adr' ? 'decision' : 'feature';
  const of = feature
    ? `, a task of feature ${feature.code} "${feature.title}"${epic ? ` in epic ${epic.code} "${epic.title}"` : ''}`
    : epic && epic.code !== row.code
      ? `, a ${kind} of epic ${epic.code} "${epic.title}"`
      : '';
  const paths = [
    designPath(row.type, row.code),
    ...(feature ? [designPath('fdr', feature.code)] : []),
    ...(epic && epic.code !== row.code ? [designPath('epic', epic.code)] : []),
  ];
  const repo = await repositoryOf(db, projectId);
  const lines = [
    `Build ${row.code} "${version.title}" (v${version.n})${of}.`,
    `Repository: ${repo.path ?? 'not configured (DEMIURGO_PROJECTS_DIR)'}, default branch ${repo.branch}.`,
    `Design in this repository: ${paths.join(' and ')}.`,
    `Goal: ${goalOf(version.sections as { title: string; content: string }[])}`,
    ...(row.type === 'task' ? [sizeLine(row.effort?.size ?? null)] : []),
    'Acceptance criteria:',
    ...criteria.map(
      (c) => `- ${c.code} · ${c.title}: ${sentence(c.statement)}. Check (${c.verification}): ${sentence(c.check_text)}.`,
    ),
  ];
  const needs = (feature ?? row).needs;
  if (needs.length > 0) {
    const built = (c: string) => rows.byCode.get(c)?.implementation === 'implemented';
    lines.push(`Depends on: ${needs.map((c) => `${c} (${built(c) ? 'built' : 'not built yet'})`).join(', ')}.`);
  }
  lines.push(
    'When done, list each criterion with how it was checked (test name or steps) and the commit.',
    'I will record the evidence in DEMIURGO.',
  );
  return lines.join('\n');
}
