// The basis of a build request: the current approved task version, the feature version it is based
// on and the brief composed from them. Shared by «request the build» and by a new attempt, which
// adopts a newer approved version of the task (the ticket was updated) without losing branch or PR.

import { DomainError } from "@demiurgo/domain";
import { type RawBuilder, sql } from "kysely";
import type { Db, Tx } from "../db/connection.ts";
import { composeBrief } from "./queue.ts";

export type RequestBasis = {
  taskVersionId: string;
  taskVersionN: number;
  feature: { id: string; n: number; code: string } | null;
  brief: string;
};

/** The latest approved version of a task, or null. */
export async function currentTaskVersion(db: Db | Tx, taskId: string) {
  const row = await db
    .selectFrom("record_versions")
    .select(["id", "n"])
    .where("record_id", "=", taskId)
    .where("state", "=", "approved")
    .orderBy("n", "desc")
    .executeTakeFirst();
  return row ?? null;
}

/** The feature version a task version is based on (its `based_on` link to an FDR). */
export async function featureOfTaskVersion(db: Db | Tx, taskVersionId: string) {
  const row = await db
    .selectFrom("links")
    .innerJoin("record_versions as t", "t.id", "links.to_id")
    .innerJoin("records as rd", "rd.id", "t.record_id")
    .select(["t.id", "t.n", "rd.code"])
    .where("links.from_id", "=", taskVersionId)
    .where("links.type", "=", "based_on")
    .where("rd.type", "=", "fdr")
    .executeTakeFirst();
  return row ?? null;
}

/** Throws when the task is not approved or not ready (the brief refuses it with its reasons). */
export async function computeRequestBasis(
  trx: Tx,
  projectId: string,
  task: { id: string; code: string },
): Promise<RequestBasis> {
  const current = await currentTaskVersion(trx, task.id);
  if (!current) throw new DomainError("guard", `${task.code} is not approved.`);
  const brief = await composeBrief(trx, projectId, task.code, { forBuild: true, codeMap: false });
  const feature = await featureOfTaskVersion(trx, current.id);
  return { taskVersionId: current.id, taskVersionN: current.n, feature, brief };
}

export type EffectiveBasis = { task_version_id: string; feature_version_id: string | null; brief: string };

/**
 * The basis an open request is built on: the latest adopted one (build_request_bases, append-only), else
 * the snapshot taken when it was requested.
 */
export async function effectiveBasis(db: Db | Tx, requestId: string): Promise<EffectiveBasis> {
  const adopted = await db
    .selectFrom("build_request_bases")
    .select(["task_version_id", "feature_version_id", "brief"])
    .where("build_request_id", "=", requestId)
    .orderBy("adopted_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
  if (adopted) return adopted;
  return db
    .selectFrom("build_requests")
    .select(["task_version_id", "feature_version_id", "brief"])
    .where("id", "=", requestId)
    .executeTakeFirstOrThrow();
}

/** The same rows with their basis replaced by the effective one (one query for all of them). */
export async function withEffectiveBasis<T extends { id: string } & EffectiveBasis>(
  db: Db | Tx,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const adopted = await db
    .selectFrom("build_request_bases")
    .select(["build_request_id", "task_version_id", "feature_version_id", "brief"])
    .where("build_request_id", "in", rows.map((r) => r.id))
    .orderBy("adopted_at", "asc")
    .orderBy("id", "asc")
    .execute();
  const latest = new Map(adopted.map((a) => [a.build_request_id, a]));
  return rows.map((r) => {
    const a = latest.get(r.id);
    return a ? { ...r, task_version_id: a.task_version_id, feature_version_id: a.feature_version_id, brief: a.brief } : r;
  });
}

/**
 * SQL for the task version a request is effectively built on (latest adopted, else the snapshot), for
 * joins over `build_requests` (aliased `alias`, default `build_requests`).
 */
export function effectiveTaskVersionSql(alias = "build_requests"): RawBuilder<string> {
  const a = sql.ref(`${alias}.id`);
  const v = sql.ref(`${alias}.task_version_id`);
  return sql<string>`coalesce((select b.task_version_id from build_request_bases b where b.build_request_id = ${a} order by b.adopted_at desc, b.id desc limit 1), ${v})`;
}
