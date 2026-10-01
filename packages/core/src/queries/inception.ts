// The inception path of a project (domain/inception.ts): the facts it needs, read from the tables.

import {
  COVERED_QUESTION_STATES,
  type InceptionPath,
  type InceptionRecord,
  inceptionPath,
} from "@demiurgo/domain";
import { epicOrderList } from "../commands/epic-order.ts";
import { sql } from "kysely";
import type { Db } from "../db/connection.ts";
import { implementationOf, versionReadiness } from "./read.ts";

type Row = { id: string; code: string; type: string; approved: boolean };

export async function inceptionOf(
  db: Db,
  projectId: string,
): Promise<InceptionPath> {
  // Every record with a live version: approved when any version is approved, else a draft waits.
  const versions = await db
    .selectFrom("records")
    .innerJoin("record_versions as v", "v.record_id", "records.id")
    .select([
      "records.id",
      "records.code",
      "records.type",
      "records.created_at",
      "v.id as versionId",
      "v.state",
    ])
    .where("records.project_id", "=", projectId)
    .where("records.type", "in", [
      "product_definition",
      "design_system",
      "epic",
      "fdr",
      "screen_design",
      "task",
    ])
    .where("v.state", "in", ["draft", "approved", "superseded"])
    .orderBy("records.created_at")
    .orderBy("records.code")
    .execute();
  const byId = new Map<string, Row>();
  const versionToRecord = new Map<string, string>();
  for (const v of versions) {
    const row = byId.get(v.id) ?? {
      id: v.id,
      code: v.code,
      type: v.type,
      approved: false,
    };
    if (v.state !== "draft") row.approved = true;
    byId.set(v.id, row);
    versionToRecord.set(v.versionId, v.id);
  }
  const rows = [...byId.values()];
  const ofType = (type: string): Row[] => rows.filter((r) => r.type === type);
  const rec = (r: Row | undefined | null): InceptionRecord | null =>
    r ? { code: r.code, approved: r.approved } : null;

  // Features in order: those of the first epic first (by the person's order, then their position in
  // the epic), then the rest by age.
  const ordered: Row[] = [];
  const features = ofType("fdr");
  const planned = await db
    .selectFrom("planned_features")
    .select(["epic_id", "record_id", "position"])
    .where("project_id", "=", projectId)
    .where("state", "<>", "dropped")
    .where("record_id", "is not", null)
    .orderBy("position")
    .execute();
  for (const epic of await epicOrderList(db, projectId)) {
    for (const p of planned.filter((x) => x.epic_id === epic.id)) {
      const f = features.find((r) => r.id === p.record_id);
      if (f && !ordered.includes(f)) ordered.push(f);
    }
  }
  for (const f of features) if (!ordered.includes(f)) ordered.push(f);
  const first = ordered.find((f) => f.approved) ?? null;

  // Screens and tasks that rest (based_on) on the first approved feature, on any of its versions.
  let screens: Row | null = null;
  let tasks: Row[] = [];
  if (first) {
    const links = await db
      .selectFrom("links")
      .innerJoin("record_versions as t", "t.id", "links.to_id")
      .select(["links.from_id", "t.record_id as toRecord"])
      .where("links.type", "=", "based_on")
      .where("links.project_id", "=", projectId)
      .execute();
    const resting = new Set<string>();
    for (const l of links)
      if (l.toRecord === first.id)
        resting.add(versionToRecord.get(l.from_id) ?? "");
    const onFirst = (type: string) =>
      ofType(type).filter((r) => resting.has(r.id));
    const s = onFirst("screen_design");
    screens = s.find((r) => r.approved) ?? s[0] ?? null;
    tasks = onFirst("task");
  }

  const stageRows = await db
    .selectFrom("stages")
    .select(["id", "stage", "state", "exploration_id"])
    .where("project_id", "=", projectId)
    .execute();
  const stages = [];
  for (const s of stageRows) {
    const questions = await db
      .selectFrom("questions")
      .select(["state", "shown_at"])
      .where("stage_id", "=", s.id)
      .where("stage_key", "is not", null)
      .execute();
    stages.push({
      key: s.stage,
      id: s.id,
      state: s.state,
      thread: s.exploration_id,
      uncovered: questions.filter(
        (q) =>
          !(COVERED_QUESTION_STATES as readonly string[]).includes(q.state),
      ).length,
      open: questions.filter(
        (q) =>
          q.shown_at !== null &&
          !(COVERED_QUESTION_STATES as readonly string[]).includes(q.state),
      ).length,
    });
  }

  const repository =
    (await db
      .selectFrom("project_github")
      .select("id")
      .where("project_id", "=", projectId)
      .executeTakeFirst()) !== undefined;

  // A task is built when its pull request was merged (its build request is done: VISION.md, «si lo
  // aprueba y todas las comprobaciones pasan, el pull request se fusiona y la tarea queda hecha»), or
  // when every criterion of its current version has evidence (a task built outside).
  const merged = new Set(
    (
      await db
        .selectFrom("build_requests")
        .select("task_id")
        .where("project_id", "=", projectId)
        .where("state", "=", "done")
        .execute()
    ).map((b) => b.task_id),
  );
  let builtTasks = 0;
  let nextTask: string | null = null;
  for (const t of ofType("task").filter((r) => r.approved)) {
    if (merged.has(t.id) || (await implementationOf(db, t.id)) === "implemented") {
      builtTasks++;
      continue;
    }
    if (nextTask === null) {
      const current = await db
        .selectFrom("record_versions")
        .select("id")
        .where("record_id", "=", t.id)
        .where("state", "=", "approved")
        .orderBy("n", "desc")
        .executeTakeFirst();
      if (current && (await versionReadiness(db, projectId, current.id)).ready)
        nextTask = t.code;
    }
  }

  return inceptionPath({
    // To be inferred later from the definition (constraints, first version); for now every product has an interface.
    hasInterface: true,
    stages,
    definition: rec(ofType("product_definition")[0]),
    pending: (
      await db
        .selectFrom("proposals")
        .select(["type", "batch_id", sql<string | null>`payload->>'record_type'`.as("record_type")])
        .where("project_id", "=", projectId)
        .where("state", "=", "pending")
        .orderBy("created_at")
        .execute()
    ).map((p) => ({ type: p.type === "design_record" ? (p.record_type ?? p.type) : p.type, batch: p.batch_id })),
    designSystemThread:
      (
        await db
          .selectFrom("explorations")
          .select("id")
          .where("project_id", "=", projectId)
          .where("state", "=", "active")
          .where("purpose", "like", "Design system:%")
          .orderBy("created_at", "desc")
          .executeTakeFirst()
      )?.id ?? null,
    capabilityThreads: (
      await db
        .selectFrom("explorations as e")
        .innerJoin("stages as s", "s.exploration_id", "e.parent_id")
        .select("e.id")
        .where("e.project_id", "=", projectId)
        .where("s.stage", "=", "requirements")
        .where("e.state", "=", "active")
        .where("e.purpose", "not like", "Design system:%")
        .orderBy("e.created_at")
        .execute()
    ).map((e) => e.id),
    approvedDecisions: Number(
      (
        await db
          .selectFrom("records")
          .innerJoin("record_versions as v", "v.record_id", "records.id")
          .select(sql<string>`count(distinct records.id)`.as("n"))
          .where("records.project_id", "=", projectId)
          .where("records.type", "in", ["adr", "decision"])
          .where("v.state", "=", "approved")
          .executeTakeFirst()
      )?.n ?? 0,
    ),
    definitionProposal: Boolean(
      await db
        .selectFrom("proposals")
        .select("id")
        .where("project_id", "=", projectId)
        .where("type", "=", "product_definition")
        .where("state", "=", "pending")
        .executeTakeFirst(),
    ),
    designSystem: rec(ofType("design_system")[0]),
    epics: ofType("epic").map((r) => rec(r) as InceptionRecord),
    features: ordered.map((r) => rec(r) as InceptionRecord),
    firstFeature: first
      ? {
          code: first.code,
          screens: rec(screens),
          tasks: tasks.map((r) => rec(r) as InceptionRecord),
        }
      : null,
    repository,
    builtTasks,
    nextTask,
  });
}
