// E15 / E09 after the case-by-case validation of 01-10-2026 (validacion-fugas-esc3 §8 fixes 1-7), over synthetic inputs
// that mirror the real Comidas y entrenos examples.

import { describe, expect, it } from "vitest";
import { ESCAPE_RULES, type EscapeInputs } from "../src/harness/rules/escapes/index.ts";
import { taskFootprintsOf } from "../src/harness/rules/escapes/footprints.ts";
import { isInfraPath } from "../src/harness/rules/escapes/types.ts";

const T0 = "2026-09-30T10:00:00.000Z";
const T1 = "2026-09-30T11:00:00.000Z";
const T2 = "2026-09-30T12:00:00.000Z";
const BACKFILL = "2026-10-01T11:37:52.000Z";

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
const rec = (id: string, code: string, type: string) => ({ id, code, type, created_at: T0 });
const req = (id: string, task_id: string, done_at: string | null = null) => ({
  id,
  task_id,
  requested_at: T0,
  state: "done",
  withdrawn_at: null,
  done_at,
});
type F = { path: string; status: string };
const merge = (id: string, request: string, at: string, files: F[]) => ({
  id,
  build_request_id: request,
  attempt: 1,
  stage: "merge",
  outcome: "ok",
  created_at: at,
  detail: { footprint_files: files },
});
const link = (type: string, from: string, to: string, to_type: string, from_type = "task") => ({
  type,
  state: "current",
  from_record_id: from,
  from_version_id: `${from}v`,
  from_n: 1,
  from_type,
  to_record_id: to,
  to_type,
});
const run = (rule: string, i: EscapeInputs) => (ESCAPE_RULES[rule] as (x: EscapeInputs) => ReturnType<(typeof ESCAPE_RULES)[string]>)(i);

/** Two features: MEA (f1) owns the day view; PRO (f2) extends it. */
const twoFeatures = (extra: Partial<EscapeInputs> = {}): EscapeInputs => ({
  ...empty(),
  records: [rec("f1", "FDR-MEA-002", "fdr"), rec("f2", "FDR-PRO-011", "fdr"), rec("a", "TSK-MEA-007", "task"), rec("b", "TSK-PRO-013", "task"), rec("c", "TSK-PRO-015", "task")],
  requests: [req("ra", "a"), req("rb", "b"), req("rc", "c")],
  taskBases: [
    { task_id: "a", fdr_id: "f1", batch_id: null },
    { task_id: "b", fdr_id: "f2", batch_id: null },
    { task_id: "c", fdr_id: "f2", batch_id: null },
  ],
  steps: [
    merge("s1", "ra", T0, [{ path: "src/app/day/page.tsx", status: "added" }, { path: "src/server/day.ts", status: "added" }]),
    merge("s2", "rb", T1, [{ path: "src/app/day/page.tsx", status: "modified" }]),
    merge("s3", "rc", T2, [{ path: "src/server/day.ts", status: "modified" }]),
  ],
  ...extra,
});

describe("E15 after the validation", () => {
  it("fix 5: across features it is one P5 row per (feature, owner feature) pair listing the tasks", () => {
    const e = run("E15", twoFeatures());
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      introduced_phase: "P5",
      found_phase: "P9",
      record_code: "FDR-PRO-011",
      subject: "shared_without_dependency FDR-MEA-002",
      evidence: {
        class: "shared_without_dependency",
        owner_feature: "FDR-MEA-002",
        tasks: { "TSK-PRO-013": { "TSK-MEA-007": ["src/app/day/page.tsx"] }, "TSK-PRO-015": { "TSK-MEA-007": ["src/server/day.ts"] } },
      },
    });
    expect(e[0]?.key).toBe("f2:f1:shared");
  });

  it("fix 5: within the same feature it stays P7 per task", () => {
    const i = twoFeatures();
    i.taskBases = i.taskBases.map((b) => ({ ...b, fdr_id: "f1" }));
    const e = run("E15", i);
    expect(e.map((x) => [x.record_code, x.introduced_phase])).toEqual([
      ["TSK-PRO-013", "P7"],
      ["TSK-PRO-015", "P7"],
    ]);
  });

  it("fix 1: a feature -> feature based_on chain (direct or transitive) is a declared dependency", () => {
    const i = twoFeatures({ records: [...twoFeatures().records, rec("f3", "FDR-PRO-020", "fdr")] });
    i.links = [link("based_on", "f2", "f1", "fdr", "fdr")];
    expect(run("E15", i)).toHaveLength(0);
    // f3 -> f2 -> f1: a task of f3 touching MEA files is covered by the chain
    i.taskBases = i.taskBases.map((b) => (b.task_id === "c" ? { ...b, fdr_id: "f3" } : b));
    i.links = [link("based_on", "f3", "f2", "fdr", "fdr"), link("based_on", "f2", "f1", "fdr", "fdr")];
    expect(run("E15", i)).toHaveLength(0);
    i.links = [link("based_on", "f3", "f2", "fdr", "fdr")];
    expect(run("E15", i).map((x) => x.record_code)).toEqual(["FDR-PRO-011", "FDR-PRO-020"]);
    // based_on to a definition is not a feature need
    i.links = [link("based_on", "f2", "def", "def", "fdr")];
    expect(run("E15", i).length).toBeGreaterThan(0);
  });

  it("fix 4: shared infrastructure is not evidence of a missing dependency", () => {
    for (const p of [".github/workflows/ci.yml", "scripts/migrate.ts", "src/server/db.ts", "src/design-system/TextField.tsx", "src/server/instance-state.ts"])
      expect(isInfraPath(p), p).toBe(true);
    for (const p of ["src/app/day/page.tsx", "src/server/day.ts"]) expect(isInfraPath(p), p).toBe(false);
    const i = twoFeatures();
    const infra = [
      { path: ".github/workflows/ci.yml", status: "added" },
      { path: "scripts/migrate.ts", status: "added" },
      { path: "src/server/db.ts", status: "added" },
      { path: "src/design-system/TextField.tsx", status: "added" },
      { path: "src/server/instance-state.ts", status: "added" },
    ];
    i.steps = [
      merge("s1", "ra", T0, infra),
      merge("s2", "rb", T1, infra.map((f) => ({ ...f, status: "modified" }))),
    ];
    expect(run("E15", i)).toHaveLength(0);
  });

  it("fix 6: a dependency whose tasks share no files is not a row", () => {
    const i = twoFeatures();
    i.steps = [
      merge("s1", "ra", T0, [{ path: "src/a/x.ts", status: "added" }]),
      merge("s2", "rb", T1, [{ path: "src/b/y.ts", status: "added" }]),
    ];
    i.links = [link("depends_on", "b", "a", "task")];
    expect(run("E15", i)).toHaveLength(0);
  });
});

describe("footprints (fix 7)", () => {
  it("the footprint is the union of all merged requests and `at` is the merge time, not the backfill time", () => {
    const i = {
      ...empty(),
      records: [rec("t", "TSK-MEA-021", "task")],
      requests: [req("r13", "t", T1), req("r16", "t", T2)],
      steps: [
        merge("s1", "r13", BACKFILL, [{ path: "src/search/SearchField.tsx", status: "added" }]),
        merge("s2", "r16", BACKFILL, [{ path: "src/search/form.tsx", status: "added" }, { path: "src/search/SearchField.tsx", status: "modified" }]),
      ],
    };
    const f = taskFootprintsOf(i).get("t");
    expect(f?.at).toBe(T2);
    expect(f?.request_id).toBe("r16");
    expect(f?.files.map((x) => `${x.path}:${x.status}`).sort()).toEqual(["src/search/SearchField.tsx:added", "src/search/form.tsx:added"]);
  });

  it("E15 occurred_at is the merge time and the first PR's files count", () => {
    const i = twoFeatures();
    i.requests = [req("ra", "a", T0), req("rb", "b", T1), req("rc", "c", T2)];
    i.steps = i.steps.map((s) => ({ ...s, created_at: BACKFILL }));
    const e = run("E15", i);
    expect(e[0]?.occurred_at).toBe(T1);
    expect(e[0]?.evidence.introduced_at).toBeUndefined();
  });
});

describe("E09 after the validation", () => {
  const owner = { kind: "route", name: "/auth/sign-in", owner: { code: "FDR-MEA-002" }, reason: "re-creates route added by TSK-MEA-008" };
  const design = (id: string, outcome: string, ownership: unknown[]) => ({
    id,
    build_request_id: "r",
    attempt: 1,
    stage: "design",
    outcome,
    created_at: T1,
    detail: { ownership },
  });

  it("fix 3: a failed or blocked design step with an ownership list is an escape found by the guard", () => {
    for (const outcome of ["failed", "blocked", "ok"]) {
      const i = { ...empty(), records: [rec("t", "TSK-MYA-018", "task")], requests: [req("r", "t")], steps: [design("s", outcome, [owner])] };
      const e = run("E09", i);
      expect(e, outcome).toHaveLength(1);
      expect(e[0]).toMatchObject({ record_code: "TSK-MYA-018", found_phase: "P9", subject: "route /auth/sign-in", evidence: { source: "guard", owner: "FDR-MEA-002" } });
    }
    const skipped = { ...empty(), records: [rec("t", "TSK-MYA-018", "task")], requests: [req("r", "t")], steps: [design("s", "cancelled", [owner])] };
    expect(run("E09", skipped)).toHaveLength(0);
  });

  it("fix 2: no footprint fallback: files shared across features without an ownership list give no E09 row", () => {
    expect(run("E09", twoFeatures())).toHaveLength(0);
  });
});
