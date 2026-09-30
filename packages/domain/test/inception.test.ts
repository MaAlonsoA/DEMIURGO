import { describe, expect, it } from "vitest";
import { type InceptionInput, inceptionPath } from "../src/inception.ts";

const empty: InceptionInput = {
  hasInterface: true,
  stages: [],
  definition: null,
  definitionProposal: false,
  pending: [],
  designSystemThread: null,
  capabilityThreads: [],
  approvedDecisions: 0,
  designSystem: null,
  epics: [],
  features: [],
  firstFeature: null,
  repository: false,
  builtTasks: 0,
  nextTask: null,
};
const passed = (key: string) => ({
  key,
  id: `id-${key}`,
  state: "passed",
  thread: "t",
  uncovered: 0,
});
const ok = (code: string) => ({ code, approved: true });

describe("the inception path", () => {
  it("a proposed definition asks to review and approve it, and a passed stage waits for its section to be approved", () => {
    const drafted = inceptionPath({
      ...empty,
      definitionProposal: true,
      stages: [{ key: "requirements", id: "r", state: "open", thread: "t", uncovered: 0 }],
    });
    expect(drafted.current).toBe("definition");
    expect(drafted.steps[0]?.action).toEqual({ kind: "review_definition" });
    const section = inceptionPath({
      ...empty,
      definition: ok("DEF-PRO-001"),
      definitionProposal: true,
      stages: [passed("requirements"), passed("quality")],
    });
    expect(section.current).toBe("quality");
    expect(section.steps[1]?.action).toEqual({ kind: "review_definition" });
  });

  it("lists the twelve steps in order with the first one current", () => {
    const p = inceptionPath(empty);
    expect(p.steps.map((s) => s.key)).toEqual([
      "definition",
      "quality",
      "principles",
      "design_system",
      "backlog",
      "first_feature",
      "screens",
      "architecture",
      "security",
      "tasks",
      "repository",
      "build",
    ]);
    expect(p).toMatchObject({ current: "definition", done: 0, total: 12 });
    expect(p.steps.filter((s) => s.state === "current")).toHaveLength(1);
    expect(p.steps[0]?.action).toEqual({
      kind: "open_stage",
      stage: "requirements",
    });
    expect(p.steps.slice(1).every((s) => s.action === null)).toBe(true);
  });

  it("asks to answer, then to pass, a stage; the definition is done only with its stage passed", () => {
    const open = (uncovered: number) => ({
      key: "requirements",
      id: "r1",
      state: "open",
      thread: "t1",
      uncovered,
    });
    expect(
      inceptionPath({ ...empty, stages: [open(3)] }).steps[0]?.action,
    ).toEqual({ kind: "answer_stage", stage: "requirements", thread: "t1" });
    expect(
      inceptionPath({ ...empty, stages: [open(0)] }).steps[0]?.action,
    ).toEqual({
      kind: "pass_stage",
      stage: "requirements",
      stageId: "r1",
      thread: "t1",
    });
    const approvedOnly = inceptionPath({
      ...empty,
      definition: ok("DEF-X-001"),
      stages: [open(0)],
    });
    expect(approvedOnly.current).toBe("definition");
    const done = inceptionPath({
      ...empty,
      definition: ok("DEF-X-001"),
      stages: [passed("requirements")],
    });
    expect(done.steps[0]?.state).toBe("done");
    expect(done.current).toBe("quality");
  });

  it("offers to approve a draft", () => {
    const p = inceptionPath({
      ...empty,
      definition: { code: "DEF-X-001", approved: false },
    });
    expect(p.steps[0]?.action).toEqual({ kind: "approve", code: "DEF-X-001" });
  });

  it("skips the design system and the screens when there is no interface", () => {
    const p = inceptionPath({ ...empty, hasInterface: false });
    expect(
      p.steps.filter((s) => s.state === "skipped").map((s) => s.key),
    ).toEqual(["design_system", "screens"]);
    expect(p.total).toBe(10);
  });

  it("puts Architecture and Security before the tasks, and Architecture waits for an approved feature", () => {
    const base: InceptionInput = {
      ...empty,
      definition: ok("DEF-X-001"),
      stages: [passed("requirements"), passed("quality"), passed("principles")],
      designSystem: ok("DSY-X-001"),
      epics: [ok("EPC-X-001")],
    };
    // No approved feature yet: the current step is the first feature, not Architecture.
    expect(inceptionPath(base).current).toBe("first_feature");
    const withFeature: InceptionInput = {
      ...base,
      features: [ok("FDR-X-001")],
      firstFeature: {
        code: "FDR-X-001",
        screens: ok("SCR-X-001"),
        tasks: [ok("TSK-X-001")],
      },
    };
    const p = inceptionPath(withFeature);
    expect(p.current).toBe("architecture");
    expect(p.steps.find((s) => s.key === "architecture")?.action).toEqual({
      kind: "open_stage",
      stage: "architecture",
    });
    // Passed with no approved ADR, the stage has decided nothing: Architecture stays current.
    const noDecision = inceptionPath({
      ...withFeature,
      stages: [...withFeature.stages, passed("architecture")],
    });
    expect(noDecision.current).toBe("architecture");
    const afterArch = inceptionPath({
      ...withFeature,
      approvedDecisions: 1,
      stages: [...withFeature.stages, passed("architecture")],
    });
    expect(afterArch.current).toBe("security");
    expect(afterArch.steps.find((s) => s.key === "security")?.blocks).toBe(
      "Build",
    );
    const ready = inceptionPath({
      ...withFeature,
      approvedDecisions: 1,
      stages: [
        ...withFeature.stages,
        passed("architecture"),
        passed("security"),
      ],
    });
    expect(ready.current).toBe("repository");
    const built = inceptionPath({
      ...withFeature,
      approvedDecisions: 1,
      stages: [
        ...withFeature.stages,
        passed("architecture"),
        passed("security"),
      ],
      repository: true,
      nextTask: "TSK-X-001",
    });
    expect(built.steps.find((s) => s.state === "current")?.action).toEqual({
      kind: "build",
      code: "TSK-X-001",
    });
    const all = inceptionPath({
      ...withFeature,
      approvedDecisions: 1,
      stages: [
        ...withFeature.stages,
        passed("architecture"),
        passed("security"),
      ],
      repository: true,
      builtTasks: 1,
    });
    expect(all).toMatchObject({ current: null, done: 12, total: 12 });
  });

  it("asks for screens of the first feature by opening it", () => {
    const p = inceptionPath({
      ...empty,
      definition: ok("D"),
      stages: [passed("requirements"), passed("quality"), passed("principles")],
      designSystem: ok("DSY"),
      epics: [ok("EPC")],
      features: [ok("FDR-X-001")],
      firstFeature: { code: "FDR-X-001", screens: null, tasks: [] },
    });
    expect(p.current).toBe("screens");
    expect(p.steps.find((s) => s.state === "current")?.action).toEqual({
      kind: "feature",
      code: "FDR-X-001",
    });
  });
});
