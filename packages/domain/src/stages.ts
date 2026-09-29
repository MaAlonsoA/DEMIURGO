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
  /** In a stage of principles, the label of its line in the definition section. */
  label?: string;
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
        question: 'How will you know it works? Name two or three things you could observe.',
        reason: 'Observable outcomes turn the purpose into something that can be checked.',
        impact: 'high',
      },
      {
        key: 'principles',
        question: 'Which principles should settle a choice between two reasonable options?',
        reason: 'Principles let every proposal be checked against what matters most.',
        impact: 'medium',
      },
      {
        key: 'stakeholders',
        question: 'Who are the users and stakeholders, and which one comes first?',
        reason: 'Every requirement traces back to someone who needs it.',
        impact: 'high',
      },
      {
        key: 'problem',
        question: 'What problem does the product solve for them, and what happens today without it?',
        reason: 'The problem defines the scope and what success looks like.',
        impact: 'high',
      },
      {
        key: 'features',
        question: 'Which features must the first version have? Each one becomes a feature to design.',
        reason: 'The features are where the requirements and their checks live.',
        impact: 'high',
      },
      {
        key: 'scope_out',
        question: 'What is explicitly out of scope for the first version?',
        reason: 'Stating what is left out prevents scope creep and hidden expectations.',
        impact: 'medium',
      },
      {
        key: 'constraints',
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
      'Global quality: product-wide performance, availability, usability, accessibility, data and operability targets, each measurable (ISO/IEC 25010, arc42 quality scenarios).',
    questions: [
      {
        key: 'performance',
        label: 'Performance',
        question: 'What response times and load must the product handle (users, data volume, peaks)?',
        reason: 'Performance targets shape the architecture.',
        impact: 'high',
      },
      {
        key: 'availability',
        label: 'Availability and recovery',
        question: 'How available must it be, and what happens if it is down (acceptable downtime, data loss)?',
        reason: 'Availability and recovery targets drive infrastructure and cost.',
        impact: 'high',
      },
      {
        key: 'usability',
        label: 'Usability and accessibility',
        question: 'Who must be able to use it without help, and what accessibility level is required?',
        reason: 'Usability and accessibility are requirements, not polish.',
        impact: 'medium',
      },
      {
        key: 'data',
        label: 'Data retention and ownership',
        question: 'What data does it keep, for how long, and who owns it?',
        reason: 'Retention and ownership affect storage, privacy and compliance.',
        impact: 'medium',
      },
      {
        key: 'quality_scenarios',
        label: 'Priority quality scenario',
        question: 'Which quality scenario matters most, stated as stimulus → response → measure?',
        reason: 'arc42: quality goals must be concrete scenarios to be tested.',
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
        label: 'Forced by the constraints',
        question: 'Which hard-to-reverse choices do the constraints and quality goals already force (where it runs, for how many people, where the data lives)?',
        reason: 'Only a choice forced by what is already known can be decided before the features.',
        impact: 'high',
      },
      {
        key: 'assets',
        label: 'What must be protected',
        question: 'What must be protected (data, credentials, money, reputation)?',
        reason: 'The assets follow from the definition and guide every feature.',
        impact: 'high',
      },
      {
        key: 'actors',
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
      'Architecture: context, building blocks, key decisions with their reasons and the risks they carry (arc42, C4, ADRs).',
    questions: [
      {
        key: 'context',
        question: 'What is the system context: which people and external systems interact with it (C4 level 1)?',
        reason: 'The context fixes the boundaries and interfaces.',
        impact: 'high',
      },
      {
        key: 'containers',
        question: 'What are the main building blocks (apps, services, stores) and how do they communicate (C4 level 2)?',
        reason: 'The containers are where work is split and deployed.',
        impact: 'high',
      },
      {
        key: 'key_decisions',
        question: 'Which architecture decisions are significant and hard to reverse? Record each one as an ADR.',
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
        question: 'What are the main technical risks and technical debt accepted?',
        reason: 'arc42: risks named early can be mitigated.',
        impact: 'medium',
      },
    ],
  },
  {
    key: 'security',
    title: 'Security baseline',
    moment: 'before_release',
    produces: 'The product threat model (THR); each feature adds only its own threats.',
    purpose:
      'Security baseline: what we protect, from whom, the threats per component and their mitigations (threat modeling, STRIDE).',
    questions: [
      {
        key: 'assets',
        question: 'What assets must be protected (data, credentials, money, reputation)?',
        reason: 'Threat modeling starts from what is worth attacking.',
        impact: 'high',
      },
      {
        key: 'actors',
        question: 'Who could attack or misuse the system, and with what access?',
        reason: 'Attackers and trust boundaries define the threat surface.',
        impact: 'high',
      },
      {
        key: 'threats',
        question:
          'For each component, which STRIDE threats apply (spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege)?',
        reason: 'STRIDE makes sure no class of threat is forgotten.',
        impact: 'high',
      },
      {
        key: 'mitigations',
        question: 'What mitigation covers each relevant threat, and how is it verified?',
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
