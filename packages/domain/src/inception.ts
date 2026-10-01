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
  | { kind: "build"; code: string | null }
  /** A proposed definition (or a change to it) waits: review and approve it on Product. */
  | { kind: "review_definition" }
  /** Ask DEMIURGO, in the product's main thread, for the story map of the first version. */
  | { kind: "plan_backlog"; thread: string | null }
  /** A proposal DEMIURGO made for this step waits in its batch. */
  | { kind: "review_batch"; batch: string; count?: number }
  /** The step is being worked on in a thread: continue there. */
  | { kind: "thread"; thread: string };

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
    /** Questions of the stage open for the person right now (shown, neither confirmed nor discarded). */
    open?: number;
  }[];
  definition: InceptionRecord | null;
  /** A product definition proposal (the first draft or a change to a section) is pending. */
  definitionProposal: boolean;
  /** Pending proposals of new records, by record type (epic, fdr, design_system, screen_design, task…). */
  pending: { type: string; batch: string }[];
  /** The active thread where the design system is being designed, if any. */
  designSystemThread: string | null;
  /** Active threads opened to design a capability (an epic or a feature) of the first version, oldest first. */
  capabilityThreads: string[];
  /** Approved architecture decisions (ADR). */
  approvedDecisions: number;
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
  const pendingOf = (...types: string[]): InceptionAction | null => {
    const p = input.pending.find((x) => types.includes(x.type));
    return p
      ? {
          kind: "review_batch",
          batch: p.batch,
          count: input.pending.filter((x) => types.includes(x.type)).length,
        }
      : null;
  };
  // A step whose own questions are open is not done, even when its stage had passed (a follow-up
  // question can arrive after): the person still has to answer them.
  const openQuestions = (key: string) => stage(key)?.open ?? 0;
  const answerOpen = (key: string): InceptionAction | null =>
    openQuestions(key) > 0 ? { kind: "answer_stage", stage: key, thread: stage(key)?.thread ?? null } : null;
  // A step with proposals of its own kind waiting is not done: the person still has to decide them.
  const hasPending = (...types: string[]) => input.pending.some((x) => types.includes(x.type));
  const draftEpic = input.epics.find((e) => !e.approved);
  const draftFeature = input.features.find((f) => !f.approved);

  const drafts: Draft[] = [
    {
      key: "definition",
      title: "Product definition",
      why: "It says what the product is for and for whom: everything else is checked against it.",
      blocks: null,
      source: "ISO/IEC/IEEE 29148 (stakeholder requirements)",
      done: input.definition?.approved === true && passed("requirements") && openQuestions("requirements") === 0,
      // The definition closes when the person approves it (that also passes its stage).
      action: () =>
        input.definitionProposal
          ? { kind: "review_definition" }
          : (draftOf(input.definition) ?? answerOpen("requirements") ?? stageAction("requirements")),
    },
    {
      key: "quality",
      title: "Quality goals",
      why: "Quality goals turn «good enough» into scenarios that can be checked. Each measurable quality goal becomes a quality requirement (NFR) you approve; the definition keeps a summary.",
      blocks: null,
      source: "arc42 §10, quality scenarios",
      // Passing the stage proposes its section of the definition: done once that is approved too.
      // A pending definition change belongs to the latest onboarding stage: once «principles» is
      // open, it is that stage's section.
      done:
        passed("quality") &&
        !(input.definitionProposal && !stage("principles")) &&
        !hasPending("quality_requirement") &&
        openQuestions("quality") === 0,
      action: () =>
        passed("quality")
          ? input.definitionProposal && !stage("principles")
            ? { kind: "review_definition" }
            : (pendingOf("quality_requirement") ?? answerOpen("quality") ?? { kind: "review_definition" })
          : stageAction("quality"),
    },
    {
      key: "principles",
      title: "Architecture and security principles",
      why: "Principles settle the choices that would otherwise be reopened in every feature.",
      blocks: null,
      source: "arc42 §2 constraints, §3 context and scope",
      // Passing the stage proposes its section of the definition: done once that is approved too.
      done: passed("principles") && !input.definitionProposal && openQuestions("principles") === 0,
      // Covering the stage proposes its section of the definition; approving it passes the stage.
      action: () =>
        input.definitionProposal && stage("principles")
          ? { kind: "review_definition" }
          : (answerOpen("principles") ?? stageAction("principles")),
    },
    {
      key: "design_system",
      title: "Design system",
      why: "The screens are drawn with one set of components and tokens, decided before the first screen.",
      blocks: "Screens",
      source:
        "Alla Kholmatova, Design Systems; Brad Frost, Atomic Design",
      done: input.designSystem?.approved === true,
      skipped: !input.hasInterface,
      action: () =>
        draftOf(input.designSystem) ??
        pendingOf("design_system") ??
        (input.designSystemThread ? { kind: "thread", thread: input.designSystemThread } : { kind: "design_system" }),
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
          : draftOf(draftFeature)) ??
        pendingOf("epic", "fdr") ??
        (input.capabilityThreads[0] ? { kind: "thread", thread: input.capabilityThreads[0] } : null) ?? {
          kind: "plan_backlog",
          thread: stage("requirements")?.thread ?? null,
        },
    },
    {
      key: "first_feature",
      title: "First feature designed",
      why: "One feature designed end to end (flow, criteria) is what the rest of the design rests on.",
      blocks: null,
      source: "Walking skeleton (Freeman & Pryce, GOOS); INVEST (Bill Wake)",
      done: approvedFeature,
      action: () =>
        draftFeature
          ? { kind: "approve", code: draftFeature.code }
          : (pendingOf("fdr") ?? { kind: "epics" }),
    },
    {
      key: "screens",
      title: "Screens of the first feature",
      why: "The screens show what the person will see before any task is planned.",
      blocks: "Tasks",
      source: "Wireflows (Nielsen Norman Group)",
      done: first?.screens?.approved === true,
      skipped: !input.hasInterface,
      action: () =>
        draftOf(first?.screens) ??
        pendingOf("screen_design") ??
        (first ? { kind: "feature", code: first.code } : null),
    },
    {
      key: "architecture",
      title: "Architecture",
      why: "The decisions about how the product is built, based on the first features.",
      blocks: "Tasks",
      source: "arc42, C4 model, MADR",
      // The stage exists to decide: it is done once it has passed with at least one approved ADR
      // (our convention; an Architecture stage with no decision leaves the tasks without a basis).
      done: passed("architecture") && input.approvedDecisions > 0 && !hasPending("adr", "decision") && openQuestions("architecture") === 0,
      action: () =>
        pendingOf("adr", "decision") ??
        answerOpen("architecture") ??
        (passed("architecture") ? { kind: "answer_stage", stage: "architecture", thread: stage("architecture")?.thread ?? null } : stageAction("architecture")),
    },
    {
      key: "security",
      title: "Security baseline",
      why: "The threats and mitigations the first tasks have to include.",
      blocks: "Build",
      source: "Microsoft SDL, STRIDE",
      done: passed("security") && !hasPending("threat_model") && openQuestions("security") === 0,
      action: () => pendingOf("threat_model") ?? answerOpen("security") ?? stageAction("security"),
    },
    {
      key: "tasks",
      title: "Tasks of the first feature",
      why: "The plan of the first feature, resting on its approved decisions and mitigations.",
      blocks: "Build",
      source: "Traceability of requirements to tasks (Wiegers & Beatty)",
      done: (first?.tasks ?? []).some((t) => t.approved),
      action: () => {
        const draft = (first?.tasks ?? []).find((t) => !t.approved);
        if (draft) return { kind: "approve", code: draft.code };
        return pendingOf("task") ?? (first ? { kind: "feature", code: first.code } : null);
      },
    },
    {
      key: "repository",
      title: "Repository",
      why: "The code lives in a GitHub repository where each task becomes a pull request.",
      blocks: "Build",
      source: "GitHub flow",
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

/** The kinds of action that wait on the person alone, with nothing of theirs already listed in Needs you. */
const PERSON_ACTIONS = [
  "pass_stage",
  "open_stage",
  "design_system",
  "epics",
  "feature",
  "repository",
  "build",
  "plan_backlog",
  "answer_stage",
] as const;

export type NextStepNeed = {
  key: InceptionStepKey;
  title: string;
  action: (typeof PERSON_ACTIONS)[number];
  /** The record the action is about, when it is one (feature, build). */
  code: string | null;
};

/**
 * The current step as one thing for Needs you, when its action is the person's to take and is not
 * already listed there: the proposals, the drafts to approve and the open questions are their own
 * items (a step «waiting on DEMIURGO» is a thread to continue, not a thing for the person).
 * `visibleQuestions` is how many questions Needs you already lists.
 */
export function nextStepNeed(path: InceptionPath, visibleQuestions: number): NextStepNeed | null {
  const step = path.steps.find((s) => s.key === path.current && s.state === "current");
  const action = step?.action;
  if (!step || !action) return null;
  if (!(PERSON_ACTIONS as readonly string[]).includes(action.kind)) return null;
  if (action.kind === "answer_stage" && visibleQuestions > 0) return null;
  return {
    key: step.key,
    title: step.title,
    action: action.kind as NextStepNeed["action"],
    code: "code" in action ? action.code : null,
  };
}
