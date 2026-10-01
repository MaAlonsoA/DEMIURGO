// The basis of a build request: the current approved task version, the feature version it is based
// on and the brief composed from them. Shared by «request the build» and by a new attempt, which
// adopts a newer approved version of the task (the ticket was updated) without losing branch or PR.

import { DomainError } from "@demiurgo/domain";
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
