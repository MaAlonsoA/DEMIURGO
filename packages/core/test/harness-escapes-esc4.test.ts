// esc-4 (validacion-fugas-esc3.md §8, fixes 8-15): each fix with the real examples of the Comidas validation, over
// synthetic inputs. Pure: no database.

import { describe, expect, it } from "vitest";
import { containmentOf, containmentSeries } from "../src/harness/containment.ts";
import { ESCAPES_RULES_VERSION, ESCAPE_RULES, type Esc4Inputs, type EscapeInputs } from "../src/harness/rules/escapes/index.ts";

const T0 = "2026-09-30T10:00:00.000Z";
const T1 = "2026-09-30T11:00:00.000Z";
const T2 = "2026-09-30T12:00:00.000Z";
const at = (base: string, min: number) => new Date(new Date(base).getTime() + min * 60_000).toISOString();

const empty = (): Esc4Inputs => ({
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
const rec = (id: string, code: string, type: string, created_at = T0) => ({ id, code, type, created_at });
const ver = (id: string, record_id: string, n: number, created_at = T0, approved_at: string | null = null, change_note: string | null = null) => ({
  id,
  record_id,
  n,
  state: "approved",
  created_at,
  approved_at,
  change_note,
});
const fromProposal = (id: string, record_id: string, n: number, created_at: string, proposal: string, approved_at: string | null = null, note: string | null = null) =>
  ({ ...ver(id, record_id, n, created_at, approved_at, note), origin_type: "proposal", origin_id: proposal }) as never;
const req = (id: string, task_id: string, requested_at = T1) => ({ id, task_id, requested_at, state: "done", withdrawn_at: null });
const run = (rule: string, i: Esc4Inputs) => (ESCAPE_RULES[rule] as (x: EscapeInputs) => ReturnType<(typeof ESCAPE_RULES)[string]>)(i);
const crit = (record_version_id: string, code: string, verification: string, carry = "new") => ({ record_version_id, code, carry, verification });

describe("esc-4", () => {
  it("is the rules version", () => {
    expect(ESCAPES_RULES_VERSION).toBe("esc-4");
  });

  describe("fix 8: E01", () => {
    const base = (): Esc4Inputs => {
      const i = empty();
      i.records = [rec("t", "TSK-MEA-034", "task")];
      i.requests = [req("r", "t")];
      i.versions = [ver("fv", "f", 1, T0, T0)];
      i.covers = [{ record_id: "t", codes: ["AC-MEA-005-10"] }];
      i.criteria = [crit("fv", "AC-MEA-005-10", "automatic")];
      return i;
    };
    const c = (body: string, path: string) => ({ severity: "blocking", body, path });

    it("takes the criterion from `covers` when the comment does not name it, and dedupes across paths (MEA-034: 2 rows -> 1)", () => {
      const i = base();
      i.reviews = [
        { id: "a", build_request_id: "r", created_at: T1, comments: [c("The 2 s goal needs the candidate running in hosting", "release/perf.md")] },
        { id: "b", build_request_id: "r", created_at: T2, comments: [c("'Cold' does not show a cold start", "e2e/perf.spec.ts")] },
      ];
      i.findingKinds = [
        { pr_review_id: "a", comment_index: 0, category: "manual_evidence" },
        { pr_review_id: "b", comment_index: 0, category: "manual_evidence" },
      ];
      const e = run("E01", i);
      expect(e).toHaveLength(1);
      expect(e[0]).toMatchObject({ criterion_code: "AC-MEA-005-10", evidence: { rounds: 2, defect_key: "ac:AC-MEA-005-10" } });
    });

    it("leaves out a comment when every covered criterion is manual (MEA-023 VoiceOver)", () => {
      const i = base();
      i.criteria = [crit("fv", "AC-MEA-005-10", "manual")];
      i.reviews = [{ id: "a", build_request_id: "r", created_at: T1, comments: [c("Requires VoiceOver/TalkBack evidence", "a11y.md")] }];
      i.findingKinds = [{ pr_review_id: "a", comment_index: 0, category: "manual_evidence" }];
      expect(run("E01", i)).toHaveLength(0);
    });

    it("attributes a test_gap about the deployed candidate to P5 (MEA-015 cold starts, WOR-013), and an ordinary one stays P7", () => {
      const i = base();
      i.reviews = [
        { id: "a", build_request_id: "r", created_at: T1, comments: [c("The procedure does not measure cold starts", "perf.spec.ts")] },
      ];
      i.findingKinds = [{ pr_review_id: "a", comment_index: 0, category: "test_gap" }];
      expect(run("E01", i)[0]).toMatchObject({ introduced_phase: "P5", evidence: { cause: "deployed_candidate" } });
      i.reviews = [{ id: "a", build_request_id: "r", created_at: T1, comments: [c("The test never asserts the total", "x.spec.ts")] }];
      expect(run("E01", i)[0]).toMatchObject({ introduced_phase: "P7" });
    });
  });

  describe("fix 9: review -> version link", () => {
    it("E03 skips the cascade version born from a record_change proposal within 30 min of an accepted review (TSK-MEA-021 v2)", () => {
      const i = empty();
      i.records = [rec("t", "TSK-MEA-021", "task")];
      i.requests = [req("r", "t", T0)];
      i.versions = [ver("v1", "t", 1, T0, T0), fromProposal("v2", "t", 2, at(T1, 2), "rc")];
      i.reviewProposals = [{ id: "rev", batch_id: "kb", state: "accepted", resolved_at: T1, verdict: "update", record_code: "TSK-MEA-021" }];
      expect(run("E03", i)).toHaveLength(0);
      // 31 minutes later it is no longer the review's consequence.
      i.versions = [ver("v1", "t", 1, T0, T0), fromProposal("v2", "t", 2, at(T1, 31), "rc")];
      expect(run("E03", i)).toHaveLength(1);
    });

    it("E06 review_accepted is no longer blind", () => {
      const i = empty();
      i.records = [rec("f", "FDR-X-001", "fdr")];
      i.versions = [ver("f1", "f", 1, T0, T0), fromProposal("f2", "f", 2, at(T1, 5), "rc")];
      i.reviewProposals = [{ id: "rev", batch_id: "kb", state: "accepted", resolved_at: T1, verdict: "update", record_code: "FDR-X-001" }];
      expect(run("E06", i).map((e) => e.subject)).toEqual(["review_accepted"]);
    });
  });

  describe("fix 10: E06 and E11 phase by record type", () => {
    it("E06 on a task is P7 -> P7 contained (TSK-MEA-038 v3)", () => {
      const i = empty();
      i.records = [rec("t", "TSK-MEA-038", "task"), rec("u", "TSK-MEA-040", "task")];
      i.versions = [ver("t1", "t", 1, T0, T0), ver("t3", "t", 3, T1, null, "Scope conflicting with TSK-MEA-040")];
      expect(run("E06", i)[0]).toMatchObject({ introduced_phase: "P7", found_phase: "P7", evidence: { contained: true } });
    });

    it("E11 proposal.reject is always contained and takes the phase of the rejected record (task P7, feature P5)", () => {
      const i = empty();
      i.rejectedProposals = [
        { id: "p1", record_type: "task" },
        { id: "p2", record_type: "fdr" },
        { id: "p3", record_type: null },
      ];
      const ev = (id: string, entity_id: string, reason: string) => ({
        id,
        command: "proposal.reject",
        at: T1,
        entity_id,
        after: { reason },
        cause: {},
        proposal_type: "design_record",
      });
      i.events = [
        ev("e1", "p1", "Not what was asked: AC-MEA-004-07..09 are already covered by TSK-MEA-026"),
        ev("e2", "p2", "Too big"),
        ev("e3", "p3", "No"),
      ];
      const e = run("E11", i);
      expect(e.map((x) => [x.introduced_phase, x.found_phase, x.evidence.contained])).toEqual([
        ["P7", "P7", true],
        ["P5", "P5", true],
        ["P5", "P5", true],
      ]);
      expect(e[0]?.evidence.class).toBe("not_asked");
    });
  });

  describe("fix 11: E03 before the first build", () => {
    it("a task version over an approved one created before the first request is P7 -> P7 contained", () => {
      const i = empty();
      i.records = [rec("t", "TSK-X-001", "task")];
      i.requests = [req("r", "t", T2)];
      i.versions = [ver("v1", "t", 1, T0, T0), ver("v2", "t", 2, T1)];
      const e = run("E03", i);
      expect(e).toHaveLength(1);
      expect(e[0]).toMatchObject({ introduced_phase: "P7", found_phase: "P7", evidence: { contained: true } });
    });

    it("drafting over an unapproved version is not a caught error", () => {
      const i = empty();
      i.records = [rec("t", "TSK-X-001", "task")];
      i.requests = [req("r", "t", T2)];
      i.versions = [ver("v1", "t", 1, T0), ver("v2", "t", 2, T1)];
      expect(run("E03", i)).toHaveLength(0);
    });
  });

  describe("fix 12: E05", () => {
    const feature = (note: string, tasks: boolean): Esc4Inputs => {
      const i = empty();
      i.records = [rec("f", "FDR-PRO-011", "fdr"), rec("t", "TSK-PRO-001", "task")];
      i.versions = [ver("v1", "f", 1, T0, T0), ver("v2", "f", 2, T1, null, note)];
      i.criteria = [crit("v2", "AC-PRO-011-09", "automatic")];
      if (tasks) i.taskBases = [{ task_id: "t", fdr_id: "f", batch_id: null }];
      return i;
    };

    it("a feature without tasks is P5 -> P5 contained", () => {
      expect(run("E05", feature("Tightened the rounding rule", false))[0]).toMatchObject({
        introduced_phase: "P5",
        found_phase: "P5",
        evidence: { class: "defect", contained: true },
      });
    });

    it("an owner scope change is not a defect (FDR-PRO-011 v2)", () => {
      const e = run("E05", feature("The user explicitly requests a weekly average row", true));
      expect(e[0]).toMatchObject({ introduced_phase: "P5", found_phase: "P5", evidence: { class: "scope_change" } });
      expect(e[0]?.evidence.contained).toBeUndefined();
      expect(containmentOf(e)).toEqual([]);
    });

    it("with tasks, a review comment on one of them just before the version makes it P10 (FDR-MEA-003 v2)", () => {
      const i = feature("Rounding contradicts the definition", true);
      i.requests = [req("r", "t", T0)];
      i.reviews = [{ id: "rv", build_request_id: "r", created_at: at(T1, -4), comments: [] }];
      expect(run("E05", i)[0]).toMatchObject({ found_phase: "P10", evidence: { class: "defect" } });
    });
  });

  describe("fix 13: E17", () => {
    it("one contained P5 escape per (task, criterion) with a wait_testability hold", () => {
      const i = empty();
      i.records = [rec("t", "TSK-WOR-013", "task")];
      i.versions = [ver("fv", "f", 1, T0, T0)];
      i.criteria = [crit("fv", "AC-WOR-002-12", "automatic")];
      const d = (decided_at: string) => ({ task_code: "TSK-WOR-013", decided_at, item: "AC-WOR-002-12", criteria: ["AC-WOR-002-12"] });
      i.queueDecisions = [d(T1), d(T2), { task_code: "TSK-PRO-019", decided_at: T1, item: null, criteria: [] }];
      const e = run("E17", i);
      expect(e).toHaveLength(2);
      expect(e[0]).toMatchObject({
        rule: "E17",
        introduced_phase: "P5",
        found_phase: "P7",
        criterion_code: "AC-WOR-002-12",
        evidence: { contained: true, defect_key: "ac:AC-WOR-002-12", introduced_at: T0 },
      });
    });

    it("is registered", () => {
      expect(Object.keys(ESCAPE_RULES)).toContain("E17");
    });

    it("a later E01 on the same criterion makes it one escaped defect", () => {
      const rows = [
        { introduced_phase: "P5", found_phase: "P7", evidence: { contained: true, defect_key: "ac:AC-WOR-002-12" } },
        { introduced_phase: "P5", found_phase: "P10", evidence: { defect_key: "ac:AC-WOR-002-12" } },
      ];
      expect(containmentOf(rows)).toEqual([{ phase: "P5", contained: 0, escaped: 1, pce: 0, n: 1, target_met: null }]);
    });
  });

  describe("fix 14: containment per defect", () => {
    it("rows with the same defect_key are one defect; rows without a key are their own", () => {
      const row = (found: string, key?: string, contained = false) => ({
        introduced_phase: "P5",
        found_phase: found,
        evidence: { ...(key ? { defect_key: key } : {}), ...(contained ? { contained: true } : {}) },
      });
      // R2 AC-MEA-005-10 seen by four rows (E01 x2 are one, E05, E08) -> one defect.
      const rows = [row("P10", "ac:AC-MEA-005-10"), row("P13", "ac:AC-MEA-005-10"), row("P9", "ac:AC-MEA-005-10"), row("P9"), row("P9"), row("P5", "ver:x", true)];
      expect(containmentOf(rows)[0]).toMatchObject({ contained: 1, escaped: 3, n: 4 });
    });

    it("the series dedupes per window too", () => {
      const rows = [
        { introduced_phase: "P5", found_phase: "P9", evidence: { defect_key: "k", introduced_at: T0 } },
        { introduced_phase: "P5", found_phase: "P9", evidence: { defect_key: "k", introduced_at: T0 } },
      ];
      const s = containmentSeries(rows, [{ id: "c", computed_at: T2, window_from: T0, window_to: T2 }]);
      expect(s[0]?.phases[0]).toMatchObject({ escaped: 1 });
    });
  });
});
