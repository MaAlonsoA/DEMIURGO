// Design stages (design engine): the product-level stages, a fixed catalog in order. They cover what
// holds for the whole product; the functional requirements live in each feature (FDR), which has
// its own journey (requirements with fit criteria, its quality/security/rollout deltas, Ready to
// build). Each stage has mandatory questions that the system raises when the stage opens; a stage
// passes only when a person has confirmed (or discarded with a reason) every one of them. The AI
// helps answer; it never decides coverage.
// References: ISO/IEC/IEEE 29148 and Volere (measurable fit criteria), EARS, arc42/C4/ADR,
// STRIDE threat modeling, the Kubernetes KEP production readiness review and Google SRE's PRR.

export type StageQuestion = {
  key: string;
  question: string;
  reason: string;
  impact: 'high' | 'medium' | 'low';
  /** The answer is a list (several outcomes, principles, exclusions): the person may pick several options. */
  multiple?: boolean;
  /** In a stage of principles, the label of its line in the definition section. */
  label?: string;
  /**
   * A well-founded answer the options of this question must include (the system adds it when the
   * model leaves it out: structured output guarantees the schema, not the business rules).
   */
  reference?: ReferenceAnswer;
};

export type ReferenceAnswer = {
  answer: string;
  implies: string;
  /** The real source of the answer, or which part is our convention. */
  source: string;
  /** Regex source, case-insensitive: an option that matches already covers the reference. */
  mentions: string;
};

/**
 * When a stage opens, by what it needs to rest on. The onboarding leaves principles (the product
 * definition and its sections); the product's architecture waits until there is a feature to build;
 * its security and operations, until the first version is being prepared.
 */
export type StageMoment = 'onboarding' | 'before_build' | 'before_release';

export type StageDefinition = {
  key: string;
  title: string;
  moment: StageMoment;
  /** A stage of principles: the section of the product definition its answers make. */
  principles?: string;
  /** What the stage leaves on record once passed. */
  produces: string;
  purpose: string;
  questions: StageQuestion[];
};

export const STAGES: readonly StageDefinition[] = [
  {
    key: 'requirements',
    title: 'Product definition',
    moment: 'onboarding',
    produces:
      'The product definition (DEF): what the product is for, how you will know it works, its principles, users, problem, first version, what is out and its constraints. Then one feature (FDR) per capability.',
    purpose:
      'Product definition: what job the product does and for whom, how you will know it works, the principles that settle choices, who uses it, what problem it solves, what is out and which features the first version has (ISO/IEC/IEEE 29148 stakeholder requirements).',
    questions: [
      {
        key: 'purpose',
        question: 'What job does the product do, for whom, and in which situation?',
        reason: 'The purpose is what every later decision is checked against.',
        impact: 'high',
      },
      {
        key: 'outcomes',
        multiple: true,
        question: 'How will you know it works? Name two or three things you could observe.',
        reason: 'Observable outcomes turn the purpose into something that can be checked.',
        impact: 'high',
      },
      {
        key: 'principles',
        multiple: true,
        question: 'Which principles should settle a choice between two reasonable options?',
        reason: 'Principles let every proposal be checked against what matters most.',
        impact: 'medium',
      },
      {
        key: 'stakeholders',
        multiple: true,
        question: 'Who are the users and stakeholders, and which one comes first?',
        reason: 'Every requirement traces back to someone who needs it.',
        impact: 'high',
      },
      {
        key: 'problem',
        multiple: true,
        question: 'What problem does the product solve for them, and what happens today without it?',
        reason: 'The problem defines the scope and what success looks like.',
        impact: 'high',
      },
      {
        key: 'features',
        multiple: true,
        question: 'Which features must the first version have? Each one becomes a feature to design, or an epic of several features if it is too big for one.',
        reason: 'The features are where the requirements and their checks live.',
        impact: 'high',
      },
      {
        key: 'scope_out',
        multiple: true,
        question: 'What is explicitly out of scope for the first version?',
        reason: 'Stating what is left out prevents scope creep and hidden expectations.',
        impact: 'medium',
      },
      {
        key: 'constraints',
        multiple: true,
        question: 'What constraints are fixed (platform, budget, deadlines, regulations, existing systems)?',
        reason: 'Constraints narrow the design space before choosing anything.',
        impact: 'medium',
      },
    ],
  },
  {
    key: 'quality',
    title: 'Global quality',
    moment: 'onboarding',
    principles: 'Quality goals',
    produces: "The product's quality goals, a section of the product definition that every feature keeps to.",
    purpose:
      'Global quality: product-wide performance, availability, usability, accessibility, data and operability targets, each with a measurable target (ISO/IEC 25010, arc42 quality scenarios). Treat an answer with no number or observable threshold (e.g. availability without how much saved work may be lost, "fast", "acceptable downtime") the way an unverifiable criterion is treated: do not accept it, and ask again for the measure with a concrete option (for example "how much saved work may you lose at most: none, the last minute?"). Only a measured answer is ready to confirm; the person may still discard the question with a reason.',
    questions: [
      {
        key: 'performance',
        label: 'Performance',
        question: 'What response times and load must the product handle, as numbers (users, data volume, peaks)?',
        reason: 'Performance targets shape the architecture.',
        impact: 'high',
      },
      {
        key: 'availability',
        label: 'Availability and recovery',
        question: 'How available must it be, and what happens if it is down? Give the numbers: acceptable downtime (recovery time) and how much saved work may be lost at most (recovery point).',
        reason: 'Availability and recovery targets drive infrastructure and cost.',
        impact: 'high',
      },
      {
        key: 'usability',
        label: 'Usability and accessibility',
        question: 'Who must be able to use it without help, and what accessibility level is required (a named standard and level, or a task and time to do it)?',
        reason: 'Usability and accessibility are requirements, not polish.',
        impact: 'medium',
        reference: {
          answer: 'Meet WCAG 2.2 level AA in every screen, and complete the main tasks without help on a phone.',
          implies: 'Every screen is checked against the WCAG 2.2 A and AA success criteria.',
          source:
            'W3C WCAG 2.2 (https://www.w3.org/TR/WCAG22/). WCAG defines levels A, AA and AAA without mandating one; AA is our convention unless a law applies.',
          mentions: 'WCAG',
        },
      },
      {
        key: 'data',
        label: 'Data retention and ownership',
        question: 'What data does it keep, for how long (a period), and who owns it?',
        reason: 'Retention and ownership affect storage, privacy and compliance.',
        impact: 'medium',
        reference: {
          answer:
            'Keep my records with no automatic expiry while I want them; they are mine, and I can export or delete them at any time. Keep nothing that is not needed.',
          implies: "Retention follows the owner's request; export and deletion are features.",
          source:
            'GDPR art. 5(1)(c) data minimisation, 5(1)(e) storage limitation, art. 17 erasure and art. 20 portability (https://gdpr-info.eu/art-5-gdpr/).',
          mentions: '(export|portab).*(delet|eras)|(delet|eras).*(export|portab)',
        },
      },
      {
        key: 'quality_scenarios',
        label: 'Priority quality scenario',
        question: 'Which quality scenario matters most, stated as stimulus → response → measure?',
        reason: 'arc42: quality goals must be concrete scenarios to be tested. The architecture stage cites this scenario as the basis of an ADR, and the feature that builds it turns it into an automated criterion.',
        impact: 'medium',
      },
    ],
  },
  {
    key: 'principles',
    title: 'Architecture and security principles',
    moment: 'onboarding',
    principles: 'Architecture and security principles',
    produces:
      'The architecture and security principles, a section of the product definition. Only the decisions they force are proposed now; the rest waits for the features.',
    purpose:
      'Architecture and security principles: who and what the product talks to, what the constraints and quality goals already force, what must be protected, from whom, and who may do what. Only what the definition supports; the rest is decided with the features.',
    questions: [
      {
        key: 'context',
        label: 'Context',
        question: 'Which people and external systems does the product talk to?',
        reason: 'The context fixes the boundaries, and it follows from the definition.',
        impact: 'high',
      },
      {
        key: 'forced_decisions',
        multiple: true,
        label: 'Forced by the constraints',
        question: 'Which hard-to-reverse choices do the constraints and quality goals already force (where it runs, for how many people, where the data lives)?',
        reason: 'Only a choice forced by what is already known can be decided before the features.',
        impact: 'high',
      },
      {
        key: 'assets',
        multiple: true,
        label: 'What must be protected',
        question: 'What must be protected (data, credentials, money, reputation)?',
        reason: 'The assets follow from the definition and guide every feature.',
        impact: 'high',
      },
      {
        key: 'actors',
        multiple: true,
        label: 'Who could misuse it',
        question: 'Who could attack or misuse the product, and with what access?',
        reason: 'Knowing who threatens it tells each feature what to guard against.',
        impact: 'medium',
      },
      {
        key: 'access',
        label: 'Who may do what',
        question: 'Who gets in, and what may each kind of person do?',
        reason: 'Access is a principle every feature keeps to.',
        impact: 'medium',
      },
    ],
  },
  {
    key: 'architecture',
    title: 'Architecture',
    moment: 'before_build',
    produces: 'The architecture decisions (ADR) the features need to be built, based on the approved features.',
    purpose:
      'Architecture: building blocks, key decisions with their reasons and the risks they carry (arc42, C4, ADRs). The system context (C4 level 1) is not asked again: read it from the "Architecture and security principles" section of the product definition. A decision may be based on the priority quality scenario of the "Quality goals" section, and then it cites that scenario.',
    questions: [
      {
        key: 'containers',
        question: 'What are the main building blocks (apps, services, stores) and how do they communicate (C4 level 2)?',
        reason: 'The containers are where work is split and deployed.',
        impact: 'high',
      },
      {
        key: 'key_decisions',
        multiple: true,
        question: 'Which architecture decisions are significant and hard to reverse? Record each one as an ADR, based on a feature, a constraint or the priority quality scenario of the definition (cite it).',
        reason: 'ADRs keep the why of each decision with its alternatives.',
        impact: 'high',
      },
      {
        key: 'tech_stack',
        question: 'What technologies will be used, and why those?',
        reason: 'The stack must fit the constraints and the quality targets.',
        impact: 'medium',
      },
      {
        key: 'risks',
        multiple: true,
        question: 'What are the main technical risks and technical debt accepted?',
        reason: 'arc42: risks named early can be mitigated.',
        impact: 'medium',
      },
    ],
  },
  {
    key: 'security',
    title: 'Security baseline',
    moment: 'before_build',
    produces: 'The product threat model (THR); each feature adds only its own threats.',
    purpose:
      'Security baseline, done at design time, right after the architecture (shift-left, SDL): the threats per component and their mitigations (threat modeling, STRIDE). What is protected, who could misuse it and who may do what are not asked again: read them from the "Architecture and security principles" section of the product definition, and the components from the architecture stage. Each mitigation is proposed as a criterion of the feature (FDR) or task (TSK) that builds it, so it is built and proved with it, not as a loose statement.',
    questions: [
      {
        key: 'threats',
        multiple: true,
        question:
          'For each component, which STRIDE threats apply (spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege)?',
        reason: 'STRIDE makes sure no class of threat is forgotten.',
        impact: 'high',
      },
      {
        key: 'mitigations',
        multiple: true,
        question: 'What mitigation covers each relevant threat, and which feature (FDR) or task (TSK) builds it as a criterion, so it is verified with evidence?',
        reason: 'A threat without a verified mitigation is an accepted risk.',
        impact: 'high',
      },
      {
        key: 'authn_authz',
        question: 'How are users authenticated and what is each role allowed to do?',
        reason: 'Identity and permissions are the first line of defense.',
        impact: 'medium',
      },
    ],
  },
  {
    key: 'production',
    title: 'Operations baseline',
    moment: 'before_release',
    produces: 'How the product is deployed, observed and supported (PRR); each feature adds its own rollout.',
    purpose:
      'Operations baseline: how it is deployed, observed, rolled back and supported (Kubernetes KEP production readiness review, Google SRE PRR).',
    questions: [
      {
        key: 'deploy_rollback',
        question: 'How is it deployed, and how is a bad release rolled back?',
        reason: 'KEP PRR: rollout and rollback must be planned before launch.',
        impact: 'high',
      },
      {
        key: 'monitoring',
        question: 'How do we know it is healthy: which metrics, logs and alerts (SLIs/SLOs)?',
        reason: 'SRE: what is not observed cannot be operated.',
        impact: 'high',
      },
      {
        key: 'failure_modes',
        multiple: true,
        question: 'What happens when a dependency fails, and how does the system degrade?',
        reason: 'Failure modes must be known before they happen in production.',
        impact: 'high',
      },
      {
        key: 'scalability',
        question: 'What limits will it hit first as usage grows, and what is the plan?',
        reason: 'KEP PRR asks for scalability limits per stage.',
        impact: 'medium',
      },
      {
        key: 'support',
        question: 'Who responds to incidents, and with what runbook?',
        reason: 'Operations need an owner and a procedure.',
        impact: 'medium',
      },
    ],
  },
];

export function stageDefinition(key: string): StageDefinition | undefined {
  return STAGES.find((s) => s.key === key);
}

/** The stage that opens when a given one passes: the next one of the same moment, or null. */
export function nextStage(key: string): StageDefinition | null {
  const i = STAGES.findIndex((s) => s.key === key);
  const next = i >= 0 ? STAGES[i + 1] : undefined;
  return next && next.moment === STAGES[i]?.moment ? next : null;
}

/** States of a mandatory question that count as covered: confirmed, or discarded with a reason. */
export const COVERED_QUESTION_STATES = ['confirmed', 'discarded'] as const;

/** The reference answer of a stage question, if it has one. */
export function stageQuestionReference(stageKey: string, questionKey: string): ReferenceAnswer | undefined {
  return stageDefinition(stageKey)?.questions.find((q) => q.key === questionKey)?.reference;
}

/** Whether a stage question is a list by nature; the system sets it, the model's guess does not decide it. */
export function stageQuestionMultiple(stageKey: string, questionKey: string): boolean {
  return stageDefinition(stageKey)?.questions.find((q) => q.key === questionKey)?.multiple === true;
}

/**
 * What a question stores as `multiple` once the stage's rule applies: a stage question takes several
 * answers when its stage says so (the model's guess and rows raised before the rule do not decide it);
 * any other question keeps its own flag.
 */
export function effectiveMultiple(stage: string | null | undefined, stageKey: string | null | undefined, stored: boolean): boolean {
  return stage && stageKey ? stageQuestionMultiple(stage, stageKey) : stored;
}

type ReferenceOptionShape = { answer: string; implies: string; exclusive: boolean; recommended?: boolean; downside?: string };

const OPTION_TEXT_MAX = 300;
const clip = (text: string) => (text.length <= OPTION_TEXT_MAX ? text : `${text.slice(0, OPTION_TEXT_MAX - 1).trimEnd()}…`);

/**
 * Deterministic gate on the options prepared for a question: if none mentions the reference answer,
 * adds it (at most 4 options: replaces the last non-recommended one when full). Pure.
 */
export function withReferenceOption<T extends ReferenceOptionShape>(
  options: T[],
  reference: ReferenceAnswer,
): { options: (T | ReferenceOptionShape)[]; added: boolean } {
  const re = new RegExp(reference.mentions, 'i');
  if (options.some((o) => re.test(`${o.answer} ${o.implies}`))) return { options, added: false };
  const option: ReferenceOptionShape = {
    answer: clip(reference.answer),
    implies: clip(`${reference.implies} Source: ${reference.source}`),
    exclusive: false,
    recommended: false,
  };
  const next: (T | ReferenceOptionShape)[] = [...options];
  if (next.length < 4) next.push(option);
  else {
    let i = next.length - 1;
    while (i >= 0 && (next[i] as ReferenceOptionShape).recommended) i--;
    if (i < 0) return { options, added: false };
    next[i] = option;
  }
  return { options: next, added: true };
}
