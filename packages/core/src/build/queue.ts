// The project's build queue (FDR-BUI-002): the approved tasks that can be built now, in build order,
// with their size, checks, brief and open build request; the approved tasks that wait, with why; and
// the open requests that went stale. Derived on read from the same readiness as the task board
// (queries/read.ts): nothing is stored here.

import { join } from "node:path";
import {
  DomainError,
  SIZE_POINTS,
  type Suspect,
  type TaskSize,
  orderByDependencies,
  sizeLine,
  suspectReason,
} from "@demiurgo/domain";
import { sql } from "kysely";
import type { Db } from "../db/connection.ts";
import { githubConfig } from "../github/client.ts";
import { suspectRecords } from "../queries/impact.ts";
import { mergedBuildOf, productState } from "../queries/read.ts";
import { taskCoversOf } from "../queries/sizes.ts";
import { type TestabilityFlag, testabilityFlagsOf } from "../queries/testability.ts";
import { loadTaskDependencies, waitedTaskCodes } from "../queries/task-deps.ts";
import { projectsDir } from "../repo/repo.ts";
import type { AutoStatus } from "./auto.ts";
import { stageFailure } from "./failure.ts";
import { isReusableFile, taskFootprints } from "./footprint.ts";
import { type TaskHold, openHolds } from "./holds.ts";

type StateRow = Awaited<ReturnType<typeof productState>>["designs"][number];

export type BuildRequestView = {
  id: string;
  task_version: number | null;
  requested_by: string;
  requested_at: string;
  /** requested, or in_review once the person pasted the pull request. */
  state: string;
  pr_url: string | null;
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
  /** GitHub is connected: a request can be built by an agent. */
  github: boolean;
  /** The latest stage of the open request's latest automatic build attempt, or null. */
  stage: { stage: string; outcome: string; failure?: { kind: string; excerpt: string | null } } | null;
  /** Jev's warnings on criteria the builder cannot satisfy with a CI test (H97); only a warning, the queue never skips for it. */
  testability: TestabilityFlag[];
};

/**
 * `suspect`: its feature (what it is based on) has a newer approved version since the task was written;
 * it waits for the person to review it («Still valid» or a new version) and the queue does not take it.
 */
export type WaitingTask = QueueTask & { reasons: string[]; suspect: Suspect | null };

/** A task a person put on hold with the reason it cannot be built yet: the queue skips it. */
export type HeldTask = QueueTask & { hold: TaskHold };

/** A task whose pull request was merged (its build request is done). */
export type BuiltTask = QueueTask & { pr_url: string | null; done_at: string | null };

export type BuildQueue = {
  ready: QueueTask[];
  /** On hold: not ready, skipped by «Build the queue», until a person releases it. */
  held: HeldTask[];
  waiting: WaitingTask[];
  /** Open requests on tasks no longer in the queue or Waiting (built, for instance): stale. */
  stale: QueueTask[];
  /** Tasks built by a merged pull request, newest first. */
  built: BuiltTask[];
  totals: { tasks: number; points: number; unsized: number };
  repository: { path: string | null; branch: string; merge_rule_by_demiurgo: boolean };
  /** «Build the queue»: the flag and what the queue is doing (filled by the query, not by buildQueue). */
  auto?: AutoStatus;
};

const DEFAULT_BRANCH = "main";

/** Where the project's code and design live, as the brief names it. */
export async function repositoryOf(
  db: Db,
  projectId: string,
): Promise<{ path: string | null; branch: string; merge_rule_by_demiurgo: boolean }> {
  const root = projectsDir();
  const repo = await db
    .selectFrom("project_repos")
    .select("dir")
    .where("project_id", "=", projectId)
    .executeTakeFirst();
  const gh = await db
    .selectFrom("project_github")
    .select("protection")
    .where("project_id", "=", projectId)
    .executeTakeFirst();
  return {
    path: root && repo ? join(root, repo.dir) : null,
    branch: DEFAULT_BRANCH,
    merge_rule_by_demiurgo: gh?.protection === "demiurgo",
  };
}

type Rows = { all: StateRow[]; byCode: Map<string, StateRow> };

function epicOf(
  feature: StateRow | undefined,
  rows: Rows,
): StateRow | undefined {
  if (!feature) return undefined;
  const linked = feature.based_on
    ? rows.byCode.get(feature.based_on)
    : undefined;
  if (linked?.type === "epic") return linked;
  return rows.all.find((r) => r.type === "epic" && r.domain === feature.domain);
}

/**
 * Build order: a feature's tasks follow the tasks of the features it needs; otherwise epic order (by
 * the person's backlog order, then by code), the epic's feature order, then the order in
 * which the tasks were proposed.
 */
function orderFeatures(
  features: StateRow[],
  rows: Rows,
  position: Map<string, number>,
): Map<string, number> {
  // The epic's place in the person's backlog order; epics without a place (and features of no epic) last, by code.
  const epicKey = (f: StateRow): string => {
    const epic = epicOf(f, rows);
    if (!epic) return "￿";
    const place = epic.epic_position;
    return place == null ? `~${epic.code}` : String(place).padStart(6, "0");
  };
  const key = (f: StateRow): [string, number, string] => [
    epicKey(f),
    position.get(f.code) ?? Number.MAX_SAFE_INTEGER,
    f.code,
  ];
  const cmp = (a: StateRow, b: StateRow) => {
    const [ea, pa, ca] = key(a);
    const [eb, pb, cb] = key(b);
    return ea !== eb
      ? ea < eb
        ? -1
        : 1
      : pa !== pb
        ? pa - pb
        : ca < cb
          ? -1
          : ca > cb
            ? 1
            : 0;
  };
  const sorted = [...features].sort(cmp);
  const done = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (f: StateRow) => {
    if (done.has(f.code) || visiting.has(f.code)) return;
    visiting.add(f.code);
    for (const need of [...f.needs]
      .map((c) => rows.byCode.get(c))
      .filter((x): x is StateRow => !!x)
      .sort(cmp))
      visit(need);
    visiting.delete(f.code);
    done.set(f.code, done.size);
  };
  for (const f of sorted) visit(f);
  return done;
}

export async function buildQueue(
  db: Db,
  projectId: string,
): Promise<BuildQueue> {
  const state = await productState(db, projectId);
  const all = [...state.designs, ...state.decisions];
  const rows: Rows = { all, byCode: new Map(all.map((r) => [r.code, r])) };
  const tasks = state.designs.filter((r) => r.type === "task");
  const features = state.designs.filter((r) => r.type === "fdr");
  const planned = await db
    .selectFrom("planned_features")
    .innerJoin("records", "records.id", "planned_features.record_id")
    .select(["records.code", "planned_features.position"])
    .where("planned_features.project_id", "=", projectId)
    .where("planned_features.state", "<>", "dropped")
    .execute();
  const featureOrder = orderFeatures(
    features,
    rows,
    new Map(planned.map((p) => [p.code, p.position])),
  );
  const records = await db
    .selectFrom("records")
    .select(["id", "code", "created_at"])
    .where("project_id", "=", projectId)
    .where("type", "=", "task")
    .execute();
  const created = new Map(
    records.map((r) => [
      r.code,
      new Date(r.created_at as unknown as Date).getTime(),
    ]),
  );
  const ids = new Map(records.map((r) => [r.code, r.id]));
  const testability = await testabilityFlagsOf(
    db,
    records.map((r) => r.id),
  );
  const open = await db
    .selectFrom("build_requests")
    .selectAll()
    .where("project_id", "=", projectId)
    .where("state", "in", ["requested", "in_review"])
    .execute();
  const versionIds = open
    .flatMap((o) => [o.task_version_id, o.feature_version_id])
    .filter((x): x is string => !!x);
  const versions = versionIds.length
    ? await db
        .selectFrom("record_versions")
        .select(["id", "n"])
        .where("id", "in", versionIds)
        .execute()
    : [];
  const vn = new Map(versions.map((v) => [v.id, v.n]));
  const github = githubConfig() !== null;
  const stepRows = open.length
    ? await db
        .selectFrom("build_steps")
        .select([
          "build_request_id",
          "attempt",
          "stage",
          "outcome",
          sql<string | null>`detail->>'failure_kind'`.as("failure_kind"),
          sql<string | null>`detail->>'transcript_excerpt'`.as("excerpt"),
          sql<string | null>`detail->>'error'`.as("error"),
        ])
        .where("build_request_id", "in", open.map((o) => o.id))
        .orderBy("attempt")
        .orderBy("created_at")
        .orderBy("id")
        .execute()
    : [];
  const latestStage = (requestId: string) => {
    const mine = stepRows.filter((x) => x.build_request_id === requestId);
    const last = mine.at(-1);
    if (!last) return null;
    return {
      stage: last.stage,
      outcome: last.outcome,
      ...(last.outcome === "failed"
        ? last.stage === "builder"
          ? last.failure_kind
            ? { failure: { kind: last.failure_kind, excerpt: last.excerpt } }
            : {}
          : { failure: stageFailure(last.stage, last.error) }
        : {}),
    };
  };

  const requestOf = (
    task: StateRow,
    feature: StateRow | undefined,
  ): BuildRequestView | null => {
    const o = open.find((x) => x.task_id === ids.get(task.code));
    if (!o) return null;
    const reasons: string[] = [];
    if (task.implementation === "implemented")
      reasons.push("The task is built.");
    if (o.task_version_id !== task.current_id)
      reasons.push(
        `Requested on v${vn.get(o.task_version_id) ?? "?"}, the current task version is v${task.current ?? "—"}.`,
      );
    if (feature && o.feature_version_id !== feature.current_id)
      reasons.push(
        `Requested on ${feature.code} v${o.feature_version_id ? (vn.get(o.feature_version_id) ?? "?") : "—"}, the current one is v${feature.current ?? "—"}.`,
      );
    return {
      id: o.id,
      task_version: vn.get(o.task_version_id) ?? null,
      requested_by: o.requested_by,
      requested_at: new Date(o.requested_at as unknown as Date).toISOString(),
      state: o.state,
      pr_url: o.pr_url,
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
      // The criteria a task covers (task_covers) are what it checks; without any, its own.
      checks: task.covers && task.covers.length > 0 ? task.covers.length : task.checks,
      request: requestOf(task, feature),
      github,
      stage: (() => {
        const r = requestOf(task, feature);
        return r ? latestStage(r.id) : null;
      })(),
      testability: testability.get(ids.get(task.code) ?? "") ?? [],
    };
  };

  const order = (a: StateRow, b: StateRow) => {
    const fa = featureOrder.get(a.based_on ?? "") ?? Number.MAX_SAFE_INTEGER;
    const fb = featureOrder.get(b.based_on ?? "") ?? Number.MAX_SAFE_INTEGER;
    if (fa !== fb) return fa - fb;
    return (created.get(a.code) ?? 0) - (created.get(b.code) ?? 0);
  };

  const holds = await openHolds(db, projectId);
  // Within the feature order, a task comes after the tasks it depends on and after every task of the
  // features it waits for (stable: ties keep the order above).
  const dependencies = await loadTaskDependencies(db, projectId);
  const approved = orderByDependencies(
    tasks
      .filter((t) => t.current !== null && t.implementation !== "implemented")
      .sort(order),
    (t) => t.code,
    (t) => waitedTaskCodes(dependencies, t.code, t.based_on),
  );
  const held: HeldTask[] = approved
    .filter((t) => holds.has(t.code))
    .map((t) => ({ ...lineOf(t), hold: holds.get(t.code) as TaskHold }));
  const ready = approved.filter((t) => t.readiness?.ready && !holds.has(t.code)).map(lineOf);
  const suspects = new Map((await suspectRecords(db, projectId)).map((x) => [x.from_code, x.suspect]));
  const waiting: WaitingTask[] = approved
    .filter((t) => !t.readiness?.ready && !holds.has(t.code))
    .map((t) => {
      const suspect = suspects.get(t.code) ?? null;
      const reasons = t.readiness?.reasons ?? [];
      return {
        ...lineOf(t),
        suspect,
        // The one reason a changed feature gives, in the words of the Build page.
        reasons: suspect
          ? [
              `Its feature changed: review before building (${suspect.upstream} v${suspect.from} is now v${suspect.to}).`,
              ...reasons.filter((r) => r !== suspectReason(suspect)),
            ]
          : reasons,
      };
    });
  const listed = new Set(approved.map((t) => t.code));
  const stale = tasks
    .filter(
      (t) =>
        !listed.has(t.code) && open.some((o) => o.task_id === ids.get(t.code)),
    )
    .sort(order)
    .map(lineOf);
  const built: BuiltTask[] = [];
  for (const t of tasks) {
    const id = ids.get(t.code);
    const merged = id && t.implementation === "implemented" ? await mergedBuildOf(db, id) : null;
    if (merged)
      built.push({ ...lineOf(t), pr_url: merged.pr_url, done_at: merged.done_at });
  }
  built.sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""));
  return {
    ready,
    held,
    waiting,
    stale,
    built,
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
  decision: "decisions",
  adr: "adr",
  fdr: "fdr",
  task: "tasks",
  bug: "bugs",
  epic: "epics",
  product_definition: "product",
};

const designPath = (type: string, code: string) =>
  `design/${FOLDERS[type] ?? "records"}/${code}.md`;

function goalOf(
  sections: readonly { title: string; content: string }[],
): string {
  const text = sections.find((s) => s.content.trim() !== "")?.content ?? "";
  const paragraph = text.split(/\n\s*\n/).find((x) => x.trim() !== "") ?? "";
  return paragraph
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const sentence = (s: string) => s.trim().replace(/[.\s]+$/, "");

const MAX_RELATED = 8;

/**
 * What knowledge found describes the same behavior, data or component as the record being built
 * (its `related` edges): built first, with the commit of its latest evidence.
 * The brief names them so the coding agent reuses that code instead of writing a second version.
 */
async function relatedWork(
  db: Db,
  projectId: string,
  codes: readonly string[],
  rows: Rows,
): Promise<string[]> {
  const related = await relatedRows(db, projectId, codes, rows);
  const lines: string[] = [];
  for (const r of related) {
    select distinct split_part(other.ref, '@', 1) as code
    from knowledge_edges e
    join knowledge_nodes a on a.id = e.from_node and a.valid_to is null
    join knowledge_nodes b on b.id = e.to_node and b.valid_to is null
    join knowledge_nodes other on other.id = case when split_part(a.ref, '@', 1) = any(${[...codes]}::text[]) then b.id else a.id end
    where e.project_id = ${projectId}::uuid and e.kind = 'related' and e.valid_to is null
      and (split_part(a.ref, '@', 1) = any(${[...codes]}::text[]) or split_part(b.ref, '@', 1) = any(${[...codes]}::text[]))`.execute(
    db,
  );
  const related = found.rows
    .map((r) => rows.byCode.get(r.code))
    .filter(
      (r): r is StateRow =>
        r !== undefined &&
        !codes.includes(r.code) &&
        ["fdr", "task", "adr"].includes(r.type),
    )
    .sort(
      (a, b) =>
        Number(b.implementation === "implemented") -
          Number(a.implementation === "implemented") ||
        (a.code < b.code ? -1 : 1),
    )
    .slice(0, MAX_RELATED);
  const lines: string[] = [];
  for (const r of related) {
    const evidence = r.current_id
      ? await db
          .selectFrom("evidence")
          .select("reference")
          .where("record_version_id", "=", r.current_id)
          .where("reference", "is not", null)
          .orderBy("created_at", "desc")
          .executeTakeFirst()
      : undefined;
    const built = r.implementation === "implemented";
    lines.push(
      `- ${r.code} "${r.title}" (${built ? `built${evidence?.reference ? `, ${evidence.reference}` : ""}` : "not built yet"})`,
    );
  }
  return lines;
}

/** How the work is delivered: the person opens the pull request, with the agent DEMIURGO does after it exits. */
export function deliveryLine(forBuild: boolean, code: string, title: string, branch: string): string {
  return forBuild
    ? "DEMIURGO commits, pushes and opens the pull request after you exit; do not use git to commit or push."
    : `Work on a branch named ${code.toLowerCase()}-<short-slug-of-the-title>, not on ${branch}. Open a pull request titled "${code}: ${title}" whose body lists the criteria it covers; do not merge it, I review and merge it.`;
}

/** What to report at the end: the agent has no pull request to report. */
export function reportLine(forBuild: boolean): string {
  return forBuild
    ? "When done, report for each criterion the name of the test that checks it (or the steps, if it is checked by hand)."
    : "When done, report the pull request URL and, for each criterion, the name of the test that checks it (or the steps, if it is checked by hand).";
}

/**
 * The build brief of a ready record (FDR-DEL-008, FDR-BUI-002): English plain text that starts with
 * "Build <code>", from its current approved version, with its size (a task), its criteria and checks,
 * what it depends on, its design paths and the repository with its default branch. Refused with the
 * readiness reasons when it is not ready. The Copy brief button and a build request use this text;
 * with `forBuild` (the agent) the branch and pull request lines are replaced by one saying DEMIURGO
 * commits, pushes and opens the pull request.
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
  if (!row)
    throw new DomainError("not_found", `Record ${code} does not exist.`);
  if (!row.current_id || !row.readiness?.ready) {
    throw new DomainError(
      "guard",
      `${code} is not ready to build.`,
      row.readiness?.reasons ?? ["It has no approved version."],
    );
  }
  if (options.forBuild && row.implementation === "implemented") {
    throw new DomainError("guard", `${code} is not ready to build.`, [
      "It is built already.",
    ]);
  }
  const version = await db
    .selectFrom("record_versions")
    .select(["n", "title", "sections"])
    .where("id", "=", row.current_id)
    .executeTakeFirstOrThrow();
  const criteria = await db
    .selectFrom("criteria")
    .select(["code", "title", "statement", "verification", "check_text"])
    .where("record_version_id", "=", row.current_id)
    .orderBy("position")
    .execute();
  const feature =
    row.type === "task" && row.based_on
      ? rows.byCode.get(row.based_on)
      : undefined;
  const framed = feature ?? row;
  const epic = epicOf(framed, rows);
  const kind = row.type === "adr" ? "decision" : "feature";
  const of = feature
    ? `, a task of feature ${feature.code} "${feature.title}"${epic ? ` in epic ${epic.code} "${epic.title}"` : ""}`
    : epic && epic.code !== row.code
      ? `, a ${kind} of epic ${epic.code} "${epic.title}"`
      : "";
  const paths = [
    designPath(row.type, row.code),
    ...(feature ? [designPath("fdr", feature.code)] : []),
    ...(epic && epic.code !== row.code ? [designPath("epic", epic.code)] : []),
  ];
  const repo = await repositoryOf(db, projectId);
  // A task may cover criteria of its feature (task_covers); then those are listed. Without any, the
  // record's own criteria are.
  let shown = criteria;
  let covered = false;
  if (row.type === "task" && feature?.current_id) {
    const rec = await db
      .selectFrom("records")
      .select("id")
      .where("project_id", "=", projectId)
      .where("code", "=", row.code)
      .executeTakeFirst();
    const codes = rec ? await taskCoversOf(db, rec.id) : [];
    if (codes.length > 0) {
      const fromFeature = await db
        .selectFrom("criteria")
        .select(["code", "title", "statement", "verification", "check_text"])
        .where("record_version_id", "=", feature.current_id)
        .where("code", "in", codes)
        .orderBy("position")
        .execute();
      if (fromFeature.length > 0) {
        shown = fromFeature;
        covered = true;
      }
    }
  }
  const lines = [
    `Build ${row.code} "${version.title}" (v${version.n})${of}.`,
    `Repository: ${repo.path ?? "not configured (DEMIURGO_PROJECTS_DIR)"}, default branch ${repo.branch}.`,
    deliveryLine(options.forBuild === true, row.code, version.title, repo.branch),
    `Design in this repository: ${paths.join(" and ")}.`,
    `Goal: ${goalOf(version.sections as { title: string; content: string }[])}`,
    ...(row.type === "task" ? [sizeLine(row.effort?.size ?? null)] : []),
    covered
      ? "Acceptance criteria this task covers (from its feature):"
      : "Acceptance criteria:",
    ...shown.map(
      (c) =>
        `- ${c.code} · ${c.title}: ${sentence(c.statement)}. Check (${c.verification}): ${sentence(c.check_text)}.`,
    ),
  ];
  const needs = (feature ?? row).needs;
  if (needs.length > 0) {
    const built = (c: string) =>
      rows.byCode.get(c)?.implementation === "implemented";
    lines.push(
      `Depends on: ${needs.map((c) => `${c} (${built(c) ? "built" : "not built yet"})`).join(", ")}.`,
    );
  }
  // Only the record's own edges: its feature's are too broad to point at the code to reuse.
  const related = await relatedWork(db, projectId, [row.code], rows);
  if (related.length > 0) {
    lines.push(
      "Related work: it covers the same behavior; reuse or extend its code, do not write a second version:",
      ...related,
    );
  }
  lines.push(
    'Every criterion whose check is automatic needs a test whose title starts with the criterion code (for example "AC-XXX-001-01 ..."), so it can be traced.',
    reportLine(options.forBuild === true),
    "I will record the evidence in DEMIURGO.",
  );
  return lines.join("\n");
}
