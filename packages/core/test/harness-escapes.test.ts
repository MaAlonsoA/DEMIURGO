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
  links: [],
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
const link = (
  type: string,
  from_record_id: string,
  to_record_id: string,
  to_type: string,
  from_type = "task",
) => ({
  type,
  state: "current",
  from_record_id,
  from_version_id: `${from_record_id}v`,
  from_n: 1,
  from_type,
  to_record_id,
  to_type,
});
const run = (rule: string, i: EscapeInputs) =>
  (
    ESCAPE_RULES[rule] as (
      x: EscapeInputs,
    ) => ReturnType<(typeof ESCAPE_RULES)[string]>
  )(i);

describe("escape rules", () => {
  it("E01 one escape per task and criterion; manual criteria, tasks without covers and other categories are not", () => {
    const i = {
      ...empty(),
      records: [rec("t", "TSK-X-001", "task"), rec("u", "TSK-X-002", "task")],
      requests: [req("r", "t"), req("r2", "u")],
      covers: [
        { record_id: "t", codes: ["AC-X-001-02", "AC-X-001-03"] },
        { record_id: "u", codes: [] },
      ],
    };
    i.criteria = [
      { record_version_id: "v", code: "AC-X-001-02", carry: "new", verification: "automatic" },
      { record_version_id: "v", code: "AC-X-001-03", carry: "new", verification: "manual" },
    ];
    i.versions = [ver("v", "f", 1)];
    const c = (body: string, extra = {}) => ({ severity: "blocking", body, path: "a.spec.ts", ...extra });
    i.reviews = [
      { id: "rv", build_request_id: "r", created_at: T1, comments: [c("AC-X-001-02 is not exercised"), { severity: "nit", body: "x" }, c("y"), c("AC-X-001-03 needs a person")] },
      { id: "rv2", build_request_id: "r", created_at: T2, comments: [c("AC-X-001-02 still not exercised", { needs_person: true })] },
      { id: "rv3", build_request_id: "r2", created_at: T1, comments: [c("AC-X-009-01 not exercised")] },
    ];
    i.findingKinds = [
      { pr_review_id: "rv", comment_index: 0, category: "test_gap" },
      { pr_review_id: "rv", comment_index: 1, category: "manual_evidence" },
      { pr_review_id: "rv", comment_index: 2, category: "defect" },
      { pr_review_id: "rv", comment_index: 3, category: "manual_evidence" },
      { pr_review_id: "rv2", comment_index: 0, category: "test_gap" },
      { pr_review_id: "rv3", comment_index: 0, category: "test_gap" },
    ];
    const e = run("E01", i);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      introduced_phase: "P7",
      found_phase: "P10",
      record_code: "TSK-X-001",
      criterion_code: "AC-X-001-02",
      comment_index: 0,
      evidence: { rounds: 2 },
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
    i.reviewProposals = [
      { id: "pr", batch_id: "b", state: "accepted", resolved_at: T1, verdict: "update", record_code: "TSK-X-001" },
    ];
    i.versions.push({ ...ver("v3", "t", 3, T2), origin_type: "proposal", origin_id: "pr" } as never);
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
    i.covers = [
      { record_id: "a", codes: ["AC-X-001-01"] },
      { record_id: "b", codes: ["AC-X-001-01"] },
      { record_id: "c", codes: ["AC-X-001-01"] },
    ];
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

  it("E05 one escape per version with its real found phase; a first version, kept criteria and reviewed versions are not", () => {
    const i = {
      ...empty(),
      records: [rec("f", "FDR-X-001", "fdr"), rec("t", "TSK-X-001", "task")],
    };
    i.versions = [
      ver("v1", "f", 1, T0, T0),
      ver("v2", "f", 2, T1, T1),
      ver("v3", "f", 3, T2),
      { ...ver("v4", "f", 4, T2), origin_type: "proposal", origin_id: "rp" } as never,
    ];
    i.reviewProposals = [
      { id: "rp", batch_id: "b", state: "accepted", resolved_at: T2, verdict: "update", record_code: "FDR-X-001" },
    ];
    i.taskBases = [{ task_id: "t", fdr_id: "f", batch_id: null }];
    i.requests = [{ ...req("r", "t", "done", T0), in_review_at: T0, done_at: T1 }];
    const c = (record_version_id: string, code: string, carry: string) => ({
      record_version_id,
      code,
      carry,
      verification: "automatic",
    });
    i.criteria = [
      c("v1", "AC-X-001-01", "new"),
      c("v2", "AC-X-001-01", "kept"),
      c("v3", "AC-X-001-02", "new"),
      c("v3", "AC-X-001-03", "modified"),
      c("v4", "AC-X-001-04", "new"),
    ];
    const e = run("E05", i);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      record_version_id: "v3",
      introduced_phase: "P5",
      found_phase: "P13",
      subject: "v3 defect",
      evidence: { approved_version_id: "v2" },
    });
    expect((e[0]?.evidence as { criteria: unknown[] }).criteria).toHaveLength(2);
  });

  it("E06 counts versions that resulted from a review or idea conflict, once each and marked contained; propagation, criteria codes and unknown records do not", () => {
    const i = {
      ...empty(),
      records: [
        rec("f", "FDR-X-001", "fdr"),
        rec("g", "FDR-XYZ-002", "fdr"),
        rec("t", "TSK-X-001", "task"),
        rec("h", "FDR-XYZ-009", "fdr"),
      ],
    };
    const orig = (id: string, rid: string, n: number, proposal: string, note: string | null = null) =>
      ({ ...ver(id, rid, n, T1, null, note), origin_type: "proposal", origin_id: proposal }) as never;
    i.versions = [
      ver("f1", "f", 1),
      orig("f2", "f", 2, "p1"),
      orig("g2", "g", 2, "p3"),
      orig("t2", "t", 2, "p4"),
      ver("h2", "h", 2, T1, null, "Resolves the contradiction with FDR-XYZ-002 and AC-KNO-003 and FDR-ZZZ-001"),
      ver("g3", "g", 3, T1, null, "Reworded."),
    ];
    i.links = [link("based_on", "t", "g", "fdr")];
    i.reviewProposals = [
      { id: "p1", batch_id: "b", state: "accepted", resolved_at: T1, verdict: "update", record_code: "FDR-X-001" },
      { id: "p2", batch_id: "b", state: "rejected", resolved_at: T1, verdict: "update", record_code: "FDR-X-003" },
      { id: "p3", batch_id: "b", state: "accepted", resolved_at: T1, verdict: "keep", record_code: "FDR-X-004" },
      { id: "p4", batch_id: "b", state: "accepted", resolved_at: T1, verdict: "update", record_code: "TSK-X-001", change_version_id: "g3" },
    ];
    i.ideaConflicts = [
      { assessment_id: "a1", proposal_id: "p1", citation: "FDR-X-005@1", created_at: T1 },
      { assessment_id: "a2", proposal_id: "p2", citation: "FDR-X-006@1", created_at: T1 },
    ];
    const e = run("E06", i);
    expect(e.map((x) => [x.record_version_id, x.subject])).toEqual([
      ["f2", "review_accepted"],
      ["h2", "FDR-XYZ-002"],
    ]);
    expect(e.every((x) => x.evidence.contained === true)).toBe(true);
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

  it("E08 uncovered, not_run (not for manual criteria) and an automatic -> release change are escapes, once per request and criterion", () => {
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
      { record_version_id: "v1", code: "AC-X-001-02", carry: "new", verification: "manual" },
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

  it("E10 a feature-based task with no covers is an escape; an enabler based on a definition, a covered task and a task with no basis are not", () => {
    const i = {
      ...empty(),
      records: [
        rec("a", "TSK-X-001", "task"),
        rec("b", "TSK-X-002", "task"),
        rec("c", "TSK-X-003", "task"),
        rec("d", "TSK-X-004", "task"),
        rec("f", "FDR-X-001", "fdr"),
        rec("def", "DEF-X-001", "def"),
      ],
    };
    i.requests = [req("r1", "a"), req("r2", "b"), req("r3", "c")];
    i.covers = [{ record_id: "a", codes: ["AC-X-001-01"] }];
    i.links = [
      link("based_on", "a", "f", "fdr"),
      link("based_on", "b", "f", "fdr"),
      link("based_on", "c", "def", "def"),
    ];
    expect(run("E10", i).map((e) => e.record_code)).toEqual(["TSK-X-002"]);
  });

  it("E11 corrections by the person are escapes; a first size, revalidations, retries, nested commands and rejected knowledge reviews are not", () => {
    const ev = (
      id: string,
      command: string,
      after: Record<string, unknown> = {},
      proposal_type: string | null = null,
      cause: Record<string, unknown> = {},
    ) => ({
      id,
      command,
      at: T1,
      entity_id: null,
      after,
      cause,
      proposal_type,
    });
    const i = { ...empty() };
    i.events = [
      ev("e1", "record.set_size", { code: "TSK-X-001", size: "L", previous: "M" }),
      ev("e2", "record.set_size", { code: "TSK-X-002", size: "M", previous: null }),
      ev("e3", "question.reopen"),
      ev("e3b", "question.reopen", {}, null, { sourceCommand: "proposal.accept" }),
      ev("e4", "run.retry"),
      ev("e5", "link.revalidate"),
      ev("e6", "proposal.reject", {}, "design_record"),
      ev("e6b", "proposal.reject", { reason: "Not what was asked" }, "design_record"),
      ev("e7", "proposal.reject", {}, "review"),
    ];
    const e = run("E11", i);
    expect(e.map((x) => x.key)).toEqual(["e1", "e3", "e6", "e6b"]);
    expect(e.map((x) => x.evidence.contained === true)).toEqual([false, false, true, true]);
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
      evidence: { reason_class: "duplicate", reason_missing: false },
    });
    i.steps = [step("s", "r", "withdraw", "cancelled", { reason: "The build request was withdrawn." })];
    expect(run("E12", i)[0]?.evidence).toMatchObject({ reason_class: null, reason_missing: true });
  });

  it("E15 shared files with no dependency are an escape (declared_without_shared_files no longer exists)", () => {
    const i = {
      ...empty(),
      records: [rec("a", "TSK-X-001", "task"), rec("b", "TSK-X-002", "task"), rec("c", "TSK-X-003", "task")],
      requests: [req("ra", "a"), req("rb", "b"), req("rc", "c")],
    };
    const fp = (id: string, request: string, at: string, files: { path: string; status: string }[]) => ({
      ...step(id, request, "merge", "ok", { footprint_files: files }),
      created_at: at,
    });
    i.steps = [
      fp("s1", "ra", T0, [{ path: "src/a/x.ts", status: "added" }]),
      fp("s2", "rb", T1, [{ path: "src/b/y.ts", status: "added" }]),
      fp("s3", "rc", T2, [{ path: "src/a/x.ts", status: "modified" }]),
    ];
    i.links = [link("depends_on", "b", "a", "task")];
    const e = run("E15", i);
    expect(e.map((x) => x.evidence.class)).toEqual(["shared_without_dependency"]);
    expect(e[0]).toMatchObject({ record_code: "TSK-X-003", introduced_phase: "P7" });
    i.links.push(link("depends_on", "c", "a", "task"));
    expect(run("E15", i)).toHaveLength(0);
  });

  it("E16 a feature approved without tasks while dependents wait for hours is an escape", () => {
    const i = {
      ...empty(),
      records: [rec("f", "FDR-X-001", "fdr", T0), rec("t", "TSK-X-001", "task", T1), rec("p", "TSK-X-002", "task", T2)],
    };
    i.versions = [ver("fv", "f", 1, T0, T0)];
    i.links = [link("depends_on", "t", "f", "fdr")];
    const e = run("E16", i);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ record_code: "FDR-X-001", evidence: { waiting: 1, planned: false, hours_waited: 1 } });
    i.taskBases = [{ task_id: "p", fdr_id: "f", batch_id: null }];
    expect(run("E16", i)[0]?.evidence).toMatchObject({ planned: true, hours_waited: 1 });
    i.links = [link("depends_on", "t", "f", "fdr")];
    i.records[1] = rec("t", "TSK-X-001", "task", "2026-09-30T13:00:00.000Z");
    expect(run("E16", i)).toHaveLength(0);
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
    expect(read.pending_rules).toEqual(["E14"]);

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
