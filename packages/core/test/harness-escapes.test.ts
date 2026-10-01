// Harness escapes (salud-del-harness §4): one case per deterministic rule over synthetic inputs, plus the storage
// (idempotent per rules version, append-only) over a real database.

import { human } from "@demiurgo/domain";
import { describe, expect, it } from "vitest";
import { executeCommand } from "../src/bus/bus.ts";
import { detectEscapes, escapesOf } from "../src/harness/escapes.ts";
import {
  ESCAPE_RULES,
  type EscapeInputs,
} from "../src/harness/rules/escapes/index.ts";
import { harnessEscapes } from "../src/queries/harness-health.ts";
import { useEnvironment } from "./support/env.ts";

const environment = useEnvironment();
const ana = human("ana");

const T0 = "2026-09-30T10:00:00.000Z";
const T1 = "2026-09-30T11:00:00.000Z";
const T2 = "2026-09-30T12:00:00.000Z";

const empty = (): EscapeInputs => ({
  projectId: "p",
  records: [],
  versions: [],
  criteria: [],
  requests: [],
  steps: [],
  reviews: [],
  findingKinds: [],
  holds: [],
  covers: [],
  taskBases: [],
  reviewProposals: [],
  ideaConflicts: [],
  events: [],
  bases: [],
});
const rec = (id: string, code: string, type: string, created_at = T0) => ({
  id,
  code,
  type,
  created_at,
});
const ver = (
  id: string,
  record_id: string,
  n: number,
  created_at = T0,
  approved_at: string | null = null,
  change_note: string | null = null,
) => ({
  id,
  record_id,
  n,
  state: "approved",
  created_at,
  approved_at,
  change_note,
});
const req = (
  id: string,
  task_id: string,
  state = "done",
  requested_at = T1,
  withdrawn_at: string | null = null,
) => ({ id, task_id, requested_at, state, withdrawn_at });
const step = (
  id: string,
  build_request_id: string,
  stage: string,
  outcome: string,
  detail: Record<string, unknown>,
  attempt = 1,
) => ({
  id,
  build_request_id,
  attempt,
  stage,
  outcome,
  created_at: T1,
  detail,
});
const run = (rule: string, i: EscapeInputs) =>
  (
    ESCAPE_RULES[rule] as (
      x: EscapeInputs,
    ) => ReturnType<(typeof ESCAPE_RULES)[string]>
  )(i);

describe("escape rules", () => {
  it("E01 a blocking comment of a test gap or manual evidence is an escape; a nit or another category is not", () => {
    const i = {
      ...empty(),
      records: [rec("t", "TSK-X-001", "task")],
      requests: [req("r", "t")],
    };
    i.reviews = [
      {
        id: "rv",
        build_request_id: "r",
        created_at: T1,
        comments: [
          {
            severity: "blocking",
            body: "AC-X-001-02 is not exercised",
            path: "a.spec.ts",
          },
          { severity: "nit", body: "x" },
          { severity: "blocking", body: "y" },
        ],
      },
    ];
    i.findingKinds = [
      { pr_review_id: "rv", comment_index: 0, category: "test_gap" },
      { pr_review_id: "rv", comment_index: 1, category: "manual_evidence" },
      { pr_review_id: "rv", comment_index: 2, category: "defect" },
    ];
    const e = run("E01", i);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      introduced_phase: "P7",
      found_phase: "P10",
      record_code: "TSK-X-001",
      criterion_code: "AC-X-001-02",
      comment_index: 0,
    });
  });

  it("E02 a merge that escalated to the person is an escape; an ordinary changes_requested is not", () => {
    const i = {
      ...empty(),
      records: [rec("t", "TSK-X-001", "task")],
      requests: [req("r", "t")],
    };
    i.steps = [
      step("s1", "r", "merge", "changes_requested", {
        needs_you: true,
        tried: 3,
      }),
      step("s2", "r", "merge", "changes_requested", { blocking: 1 }),
      step("s3", "r", "merge", "changes_requested", {
        escalated: "needs_person",
      }),
    ];
    expect(run("E02", i).map((e) => e.key)).toEqual(["s1", "s3"]);
  });

  it("E03 a task version created after the first build request is an escape; the first version is not", () => {
    const i = {
      ...empty(),
      records: [rec("t", "TSK-X-001", "task")],
      requests: [req("r", "t", "done", T1)],
    };
    i.versions = [
      ver("v1", "t", 1, T0),
      ver("v2", "t", 2, T2),
      ver("v0", "t", 2, T0),
    ];
    const e = run("E03", i);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      record_version_id: "v2",
      record_code: "TSK-X-001",
      subject: "v2",
    });
  });

  it("E04 a task created in a later batch than the feature plan is an escape", () => {
    const i = {
      ...empty(),
      records: [
        rec("f", "FDR-X-001", "fdr"),
        rec("a", "TSK-X-001", "task", T0),
        rec("b", "TSK-X-002", "task", T0),
        rec("c", "TSK-X-003", "task", T2),
      ],
    };
    i.taskBases = [
      { task_id: "a", fdr_id: "f", batch_id: "plan" },
      { task_id: "b", fdr_id: "f", batch_id: "plan" },
      { task_id: "c", fdr_id: "f", batch_id: "late" },
    ];
    const e = run("E04", i);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      record_code: "TSK-X-003",
      subject: "FDR-X-001",
    });
  });

  it("E05 a criterion new or modified in a version after an approved one is an escape; a kept one and a first version are not", () => {
    const i = { ...empty(), records: [rec("f", "FDR-X-001", "fdr")] };
    i.versions = [ver("v1", "f", 1, T0, T0), ver("v2", "f", 2, T2)];
    i.criteria = [
      {
        record_version_id: "v1",
        code: "AC-X-001-01",
        carry: "new",
        verification: "automatic",
      },
      {
        record_version_id: "v2",
        code: "AC-X-001-01",
        carry: "kept",
        verification: "automatic",
      },
      {
        record_version_id: "v2",
        code: "AC-X-001-02",
        carry: "new",
        verification: "automatic",
      },
      {
        record_version_id: "v2",
        code: "AC-X-001-03",
        carry: "modified",
        verification: "automatic",
      },
    ];
    expect(run("E05", i).map((e) => e.criterion_code)).toEqual([
      "AC-X-001-02",
      "AC-X-001-03",
    ]);
  });

  it("E06 an accepted knowledge review, an accepted idea conflict and a change note citing another record are escapes", () => {
    const i = { ...empty(), records: [rec("f", "FDR-X-001", "fdr")] };
    i.reviewProposals = [
      {
        id: "p1",
        batch_id: "b",
        state: "accepted",
        resolved_at: T1,
        verdict: "update",
        record_code: "FDR-X-002",
      },
      {
        id: "p2",
        batch_id: "b",
        state: "rejected",
        resolved_at: T1,
        verdict: "update",
        record_code: "FDR-X-003",
      },
      {
        id: "p3",
        batch_id: "b",
        state: "accepted",
        resolved_at: T1,
        verdict: "keep",
        record_code: "FDR-X-004",
      },
    ];
    i.ideaConflicts = [
      {
        assessment_id: "a1",
        proposal_id: "p1",
        citation: "FDR-X-005@1",
        created_at: T1,
      },
      {
        assessment_id: "a2",
        proposal_id: "p2",
        citation: "FDR-X-006@1",
        created_at: T1,
      },
    ];
    i.versions = [
      ver(
        "v2",
        "f",
        2,
        T1,
        null,
        "Resolves the contradiction with FDR-XYZ-009",
      ),
      ver("v3", "f", 3, T1, null, "Reworded."),
    ];
    expect(run("E06", i).map((e) => e.subject)).toEqual([
      "review_accepted",
      "idea_conflict",
      "FDR-XYZ-009",
    ]);
  });

  it("E07 a task hold is an escape, released or not", () => {
    const i = { ...empty(), records: [rec("t", "TSK-X-001", "task")] };
    i.holds = [
      {
        id: "h1",
        task_id: "t",
        reason: "Needs the real deployment",
        held_at: T1,
        released_at: null,
      },
      {
        id: "h2",
        task_id: "t",
        reason: "Needs a key",
        held_at: T1,
        released_at: T2,
      },
    ];
    const e = run("E07", i);
    expect(e.map((x) => x.subject)).toEqual([
      "Needs the real deployment",
      "Needs a key",
    ]);
    expect(e[0]).toMatchObject({
      introduced_phase: "P7",
      found_phase: "P9",
      record_code: "TSK-X-001",
    });
  });

  it("E08 uncovered, not_run and an automatic -> release change are escapes, once per request and criterion", () => {
    const i = {
      ...empty(),
      records: [rec("t", "TSK-X-001", "task"), rec("f", "FDR-X-001", "fdr")],
      requests: [req("r", "t")],
    };
    i.steps = [
      step("s1", "r", "builder", "ok", { uncovered: ["AC-X-001-01"] }, 1),
      step("s2", "r", "builder", "ok", { uncovered: ["AC-X-001-01"] }, 2),
      step("s3", "r", "evidence", "ok", { not_run: ["AC-X-001-02"] }),
    ];
    i.versions = [ver("v1", "f", 1), ver("v2", "f", 2)];
    i.criteria = [
      {
        record_version_id: "v1",
        code: "AC-X-001-05",
        carry: "new",
        verification: "automatic",
      },
      {
        record_version_id: "v2",
        code: "AC-X-001-05",
        carry: "modified",
        verification: "release",
      },
    ];
    const e = run("E08", i);
    expect(e.map((x) => `${x.subject}:${x.criterion_code}`)).toEqual([
      "uncovered:AC-X-001-01",
      "not_run:AC-X-001-02",
      "automatic -> release:AC-X-001-05",
    ]);
  });

  it("E09 an ownership violation found by the design step is an escape, once per request and piece", () => {
    const i = {
      ...empty(),
      records: [rec("t", "TSK-X-001", "task")],
      requests: [req("r", "t")],
    };
    const owner = {
      kind: "table",
      name: "cardio_sessions",
      owner: { code: "FDR-X-002" },
      reason: "recreated",
    };
    i.steps = [
      step("s1", "r", "design", "ok", { ownership: [owner] }, 1),
      step("s2", "r", "design", "ok", { ownership: [owner] }, 2),
      step("s3", "r", "design", "ok", { ownership: [] }),
    ];
    const e = run("E09", i);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      subject: "table cardio_sessions",
      record_code: "TSK-X-001",
    });
  });

  it("E10 a task with no covers and no feature base is an escape; covered or based tasks are not", () => {
    const i = {
      ...empty(),
      records: [
        rec("a", "TSK-X-001", "task"),
        rec("b", "TSK-X-002", "task"),
        rec("c", "TSK-X-003", "task"),
      ],
    };
    i.covers = [
      { record_id: "a", codes: ["AC-X-001-01"] },
      { record_id: "b", codes: [] },
    ];
    i.taskBases = [{ task_id: "c", fdr_id: "f", batch_id: null }];
    expect(run("E10", i).map((e) => e.record_code)).toEqual(["TSK-X-002"]);
  });

  it("E11 corrections by the person are escapes; a first size and a rejected knowledge review are not", () => {
    const ev = (
      id: string,
      command: string,
      after: Record<string, unknown> = {},
      proposal_type: string | null = null,
    ) => ({
      id,
      command,
      at: T1,
      entity_id: null,
      after,
      cause: {},
      proposal_type,
    });
    const i = { ...empty() };
    i.events = [
      ev("e1", "record.set_size", {
        code: "TSK-X-001",
        size: "L",
        previous: "M",
      }),
      ev("e2", "record.set_size", {
        code: "TSK-X-002",
        size: "M",
        previous: null,
      }),
      ev("e3", "question.reopen"),
      ev("e4", "run.retry"),
      ev("e5", "link.revalidate"),
      ev("e6", "proposal.reject", {}, "design_record"),
      ev("e7", "proposal.reject", {}, "review"),
    ];
    expect(run("E11", i).map((e) => e.key)).toEqual([
      "e1",
      "e3",
      "e4",
      "e5",
      "e6",
    ]);
  });

  it("E12 a withdrawn request is an escape with the reason the journal kept", () => {
    const i = {
      ...empty(),
      records: [rec("t", "TSK-X-001", "task")],
      requests: [req("r", "t", "withdrawn", T1, T2), req("r2", "t", "done")],
    };
    i.steps = [
      step("s", "r", "withdraw", "cancelled", { reason: "Duplicate request" }),
    ];
    const e = run("E12", i);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      build_request_id: "r",
      subject: "Duplicate request",
      record_code: "TSK-X-001",
    });
  });

  it("E13 a base adopted after the first attempt is an escape", () => {
    const i = {
      ...empty(),
      records: [rec("t", "TSK-X-001", "task")],
      requests: [req("r", "t")],
    };
    i.bases = [
      { id: "b1", build_request_id: "r", attempt: 1, adopted_at: T1 },
      { id: "b2", build_request_id: "r", attempt: 8, adopted_at: T2 },
    ];
    expect(run("E13", i).map((e) => e.key)).toEqual(["b2"]);
  });

  it("a window keeps only the escapes whose fact happened inside it", () => {
    const i = {
      ...empty(),
      records: [rec("t", "TSK-X-001", "task")],
      requests: [
        req("r", "t", "withdrawn", T0, T0),
        req("r2", "t", "withdrawn", T0, T2),
      ],
      covers: [{ record_id: "t", codes: ["AC-X-001-01"] }],
    };
    expect(escapesOf(i)).toHaveLength(2);
    expect(escapesOf(i, { from: T1 })).toHaveLength(1);
  });
});

describe("stored escapes", () => {
  it("are written once per rules version and the table only admits INSERT", async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, {
      command: "project.create",
      actor: ana,
      data: { name: "Escapes" },
    });
    const made = await executeCommand(s, {
      command: "record.create",
      actor: ana,
      projectId,
      data: {
        type: "fdr",
        domain: "esc",
        title: "Feature",
        sections: [
          { title: "Goal", content: "A goal." },
          { title: "Scope", content: "Scope." },
          { title: "Out of scope", content: "Nothing." },
          { title: "Behavior", content: "1. It works." },
        ],
        criteria: [
          {
            carry: "new",
            title: "One",
            statement: "Given a, when b, then c.",
            verification: "automatic",
            check: "A test.",
          },
        ],
      },
    });
    const versionId = (made.result as { versionId: string }).versionId;
    const row = await s.db
      .insertInto("build_requests")
      .values({
        project_id: projectId,
        task_id: made.entityId,
        task_version_id: versionId,
        feature_version_id: null,
        brief: "b",
        requested_by: "human:ana",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await s.db
      .updateTable("build_requests")
      .set({
        state: "withdrawn",
        withdrawn_by: "human:ana",
        withdrawn_at: new Date(),
      })
      .where("id", "=", row.id)
      .execute();

    const first = await detectEscapes(s.db, projectId);
    expect(first.by_rule.E12).toBe(1);
    const again = await detectEscapes(s.db, projectId);
    expect(again.recorded).toBe(0);
    expect(again.found).toBe(first.found);

    const read = await harnessEscapes(s.db, projectId);
    expect(read.by_rule.find((r) => r.rule === "E12")?.n).toBe(1);
    expect(read.pending_rules).toEqual(["E14", "E15"]);

    await expect(
      s.db
        .updateTable("harness_escapes")
        .set({ subject: "x" })
        .where("project_id", "=", projectId)
        .execute(),
    ).rejects.toThrow(/only admits INSERT/);
    await expect(
      s.db
        .deleteFrom("harness_escapes")
        .where("project_id", "=", projectId)
        .execute(),
    ).rejects.toThrow(/only admits INSERT/);
  });
});
