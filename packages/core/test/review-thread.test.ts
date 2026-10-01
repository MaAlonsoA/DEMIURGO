// A review thread opened by a person (from a conflict, or «Review in a thread») never opens empty:
// DEMIURGO's first turn is requested once, and the record under review is what the thread is about.

import { human } from "@demiurgo/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { executeCommand } from "../src/bus/bus.ts";
import { buildContext } from "../src/context/build.ts";
import { newDecision } from "./support/recipes.ts";
import { useEnvironment } from "./support/env.ts";

const environment = useEnvironment();
const ana = human("ana");
let projectId = "";

const open = (data: unknown) =>
  executeCommand(environment().services, {
    command: "exploration.open",
    actor: ana,
    projectId,
    data,
  });
const deferred = () =>
  (environment().engine as unknown as { deferred: string[] }).deferred;

beforeAll(async () => {
  projectId = (
    await executeCommand(environment().services, {
      command: "project.create",
      actor: ana,
      data: { name: "Review" },
    })
  ).projectId;
});

describe("a review thread", () => {
  it("requests the first turn once, keyed by the thread, and is about the record under review", async () => {
    const s = environment().services;
    const record = await newDecision(s, projectId, true);
    const r = await open({
      purpose: `Review ${record.code} v1: may lack something`,
      origin: { type: "record_version", id: record.versionId, version: 1 },
    });
    expect(
      deferred().filter((k) => k === `thread_opened:${r.entityId}`),
    ).toHaveLength(1);

    const pack = await s.db
      .transaction()
      .execute((trx) =>
        buildContext(
          trx,
          projectId,
          "exploration_chat",
          { type: "exploration", id: r.entityId },
          {},
          0,
        ),
      );
    const about = (
      pack.pack.content as {
        about_record?: {
          code: string;
          change_with: string;
          approved_version: number | null;
        };
      }
    ).about_record;
    expect(about).toMatchObject({
      code: record.code,
      change_with: "record_change",
      approved_version: 1,
    });
  });

  it("is not requested for a thread with another origin or none", async () => {
    const parent = await open({ purpose: "A side thread" });
    const child = await open({
      purpose: "Inside",
      parent_id: parent.entityId,
      origin: { type: "exploration", id: parent.entityId },
    });
    expect(deferred()).not.toContain(`thread_opened:${parent.entityId}`);
    expect(deferred()).not.toContain(`thread_opened:${child.entityId}`);
  });
});
