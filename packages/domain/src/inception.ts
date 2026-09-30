// The inception path: one model of «what comes next and what blocks what» from a new project to its
// walking skeleton. Pure: the server gathers the facts (`InceptionInput`) and this orders them.
// Sources are shown to the person next to each step. The stages (stages.ts), the stage guard and
// readiness (records.ts) stay the rules that enforce; this is the map that tells the person where
// they are.
//
// decisión de la misión: Architecture and Security come BEFORE the tasks, because the task plan
// must rest on the approved ADRs and threat mitigations (a previous run planned a walking skeleton
// without the authentication its ADR required). Security also blocks Build (readiness).

import { STAGES } from "./stages.ts";

export type InceptionStepKey =
  | "definition"
  | "quality"
  | "principles"
  | "design_system"
  | "backlog"
  | "first_feature"
  | "screens"
  | "architecture"
  | "security"
  | "tasks"
  | "repository"
  | "build";

export type InceptionAction =
  | { kind: "answer_stage"; stage: string; thread: string | null }
  | {
      kind: "pass_stage";
      stage: string;
      stageId: string;
      thread: string | null;
    }
  | { kind: "open_stage"; stage: string }
  | { kind: "approve"; code: string }
  | { kind: "design_system" }
  | { kind: "epics" }
  | { kind: "feature"; code: string }
  | { kind: "repository" }
  | { kind: "build"; code: string | null };

export type InceptionStep = {
  key: InceptionStepKey;
  title: string;
  state: "done" | "current" | "todo" | "skipped";
  /** One sentence: what the step is for. */
  why: string;
  /** What it blocks (shown when it is the current step), or null. */
  blocks: string | null;
  source: string;
  /** Only on the current step. */
  action: InceptionAction | null;
};

export type InceptionPath = {
  steps: InceptionStep[];
  current: InceptionStepKey | null;
  done: number;
  /** Steps that count: not the skipped ones. */
  total: number;
};

/** A record the path needs: `approved` is false when only a draft version exists. */
export type InceptionRecord = { code: string; approved: boolean };

export type InceptionInput = {
  /** To be inferred later from the definition; for now the server passes true. */
  hasInterface: boolean;
  /** The stages opened so far; `uncovered` = mandatory questions neither confirmed nor discarded. */
  stages: {
    key: string;
    id: string;
    state: string;
    thread: string | null;
    uncovered: number;
  }[];
  definition: InceptionRecord | null;
  designSystem: InceptionRecord | null;
  epics: InceptionRecord[];
  /** Features (FDR) in order: the first of the first epic, else the oldest. */
  features: InceptionRecord[];
  /** The first approved feature with what hangs from it, or null when none is approved. */
  firstFeature: {
    code: string;
    screens: InceptionRecord | null;
    tasks: InceptionRecord[];
  } | null;
  repository: boolean;
  /** Tasks of the project built (all their criteria have evidence). */
  builtTasks: number;
  /** An approved task ready to build, if any. */
  nextTask: string | null;
};

type Draft = Omit<InceptionStep, "state" | "action"> & {
  done: boolean;
  skipped?: boolean;
  action: () => InceptionAction | null;
};

export function inceptionPath(input: InceptionInput): InceptionPath {
  const stage = (key: string) => input.stages.find((s) => s.key === key);
  const passed = (key: string) => stage(key)?.state === "passed";
  const approvedFeature = input.features.some((f) => f.approved);

  // What to do about a stage: answer it, pass it, open it (when allowed) or nothing.
  const stageAction = (key: string): InceptionAction | null => {
    const s = stage(key);
    if (s) {
      return s.uncovered > 0
        ? { kind: "answer_stage", stage: key, thread: s.thread }
        : { kind: "pass_stage", stage: key, stageId: s.id, thread: s.thread };
    }
    const i = STAGES.findIndex((d) => d.key === key);
    const def = STAGES[i];
    const previous = i > 0 ? STAGES[i - 1] : undefined;
    if (previous && !passed(previous.key)) return null;
    // The product's architecture rests on at least one approved feature (guard stage_in_order).
    if (
      def?.moment === "before_build" &&
      previous?.moment !== "before_build" &&
      !approvedFeature
    )
      return null;
    return { kind: "open_stage", stage: key };
  };
  const draftOf = (
    r: InceptionRecord | null | undefined,
  ): InceptionAction | null =>
    r && !r.approved ? { kind: "approve", code: r.code } : null;

  const first = input.firstFeature;
  const draftEpic = input.epics.find((e) => !e.approved);
  const draftFeature = input.features.find((f) => !f.approved);

  const drafts: Draft[] = [
    {
      key: "definition",
      title: "Product definition",
      why: "It says what the product is for and for whom: everything else is checked against it.",
      blocks: null,
      source: "VISION.md · Arranque 1; ISO/IEC/IEEE 29148",
      done: input.definition?.approved === true && passed("requirements"),
      action: () => draftOf(input.definition) ?? stageAction("requirements"),
    },
    {
      key: "quality",
      title: "Quality goals",
      why: "Quality goals turn «good enough» into scenarios that can be checked.",
      blocks: null,
      source: "VISION.md · Arranque 2; arc42 §10 quality scenarios",
      done: passed("quality"),
      action: () => stageAction("quality"),
    },
    {
      key: "principles",
      title: "Architecture and security principles",
      why: "Principles settle the choices that would otherwise be reopened in every feature.",
      blocks: null,
      source: "VISION.md · Arranque 3",
      done: passed("principles"),
      action: () => stageAction("principles"),
    },
    {
      key: "design_system",
      title: "Design system",
      why: "The screens are drawn with one set of components and tokens, decided before the first screen.",
      blocks: "Screens",
      source:
        "VISION.md · Arranque 4; Kholmatova, Design Systems; Frost, Atomic Design",
      done: input.designSystem?.approved === true,
      skipped: !input.hasInterface,
      action: () => draftOf(input.designSystem) ?? { kind: "design_system" },
    },
    {
      key: "backlog",
      title: "Epics and features of the first version",
      why: "The first version is split into capabilities that can be designed and built one by one.",
      blocks: null,
      source: "Patton, User Story Mapping; Scrum Guide (Product Backlog)",
      done:
        input.epics.length > 0
          ? input.epics.some((e) => e.approved)
          : input.features.some((f) => f.approved),
      action: () =>
        (input.epics.length > 0
          ? draftOf(draftEpic)
          : draftOf(draftFeature)) ?? { kind: "epics" },
    },
    {
      key: "first_feature",
      title: "First feature designed",
      why: "One feature designed end to end (flow, criteria) is what the rest of the design rests on.",
      blocks: null,
      source: "VISION.md · Funcionalidades; walking skeleton (Freeman & Pryce)",
      done: approvedFeature,
      action: () =>
        draftFeature
          ? { kind: "approve", code: draftFeature.code }
          : { kind: "epics" },
    },
    {
      key: "screens",
      title: "Screens of the first feature",
      why: "The screens show what the person will see before any task is planned.",
      blocks: "Tasks",
      source: "VISION.md · Diseño de pantallas (antes de las tareas)",
      done: first?.screens?.approved === true,
      skipped: !input.hasInterface,
      action: () =>
        draftOf(first?.screens) ??
        (first ? { kind: "feature", code: first.code } : null),
    },
    {
      key: "architecture",
      title: "Architecture",
      why: "The decisions about how the product is built, based on the first features.",
      blocks: "Tasks",
      source: "VISION.md; arc42, C4, MADR",
      done: passed("architecture"),
      action: () => stageAction("architecture"),
    },
    {
      key: "security",
      title: "Security baseline",
      why: "The threats and mitigations the first tasks have to include.",
      blocks: "Build",
      source: "VISION.md; Microsoft SDL, STRIDE",
      done: passed("security"),
      action: () => stageAction("security"),
    },
    {
      key: "tasks",
      title: "Tasks of the first feature",
      why: "The plan of the first feature, resting on its approved decisions and mitigations.",
      blocks: "Build",
      source: "VISION.md · Tareas",
      done: (first?.tasks ?? []).some((t) => t.approved),
      action: () => {
        const draft = (first?.tasks ?? []).find((t) => !t.approved);
        return draft
          ? { kind: "approve", code: draft.code }
          : first
            ? { kind: "feature", code: first.code }
            : null;
      },
    },
    {
      key: "repository",
      title: "Repository",
      why: "The code lives in a GitHub repository where each task becomes a pull request.",
      blocks: "Build",
      source: "VISION.md · Construcción (GitHub flow)",
      done: input.repository,
      action: () => ({ kind: "repository" }),
    },
    {
      key: "build",
      title: "Walking skeleton built",
      why: "The thinnest real slice, built and checked end to end, proves the design holds.",
      blocks: null,
      source: "Freeman & Pryce, GOOS; Cockburn",
      done: input.builtTasks > 0,
      action: () => ({ kind: "build", code: input.nextTask }),
    },
  ];

  let current: InceptionStepKey | null = null;
  const steps: InceptionStep[] = drafts.map((d) => {
    const { done, skipped, action, ...rest } = d;
    if (skipped) return { ...rest, state: "skipped", action: null };
    if (done) return { ...rest, state: "done", action: null };
    if (current === null) {
      current = d.key;
      return { ...rest, state: "current", action: action() };
    }
    return { ...rest, state: "todo", action: null };
  });
  const counted = steps.filter((s) => s.state !== "skipped");
  return {
    steps,
    current,
    done: counted.filter((s) => s.state === "done").length,
    total: counted.length,
  };
}
