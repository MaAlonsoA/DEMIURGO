// Design stages (design engine): a fixed catalog, in order. Each stage has mandatory questions that
// the system raises when the stage opens; a stage passes only when a person has confirmed (or
// discarded with a reason) every one of them. The AI helps answer; it never decides coverage.
// References: ISO/IEC/IEEE 29148 and Volere (measurable fit criteria), EARS, arc42/C4/ADR,
// STRIDE threat modeling, the Kubernetes KEP production readiness review and Google SRE's PRR.

export type StageQuestion = { key: string; question: string; reason: string; impact: 'high' | 'medium' | 'low' };
export type StageDefinition = { key: string; title: string; purpose: string; questions: StageQuestion[] };

export const STAGES: readonly StageDefinition[] = [
  {
    key: 'requirements',
    title: 'Requirements',
    purpose:
      'Requirements: who uses the product, what they must be able to do and how we will know each requirement is met (ISO/IEC/IEEE 29148, Volere fit criteria, EARS).',
    questions: [
      { key: 'stakeholders', question: 'Who are the users and stakeholders, and which one comes first?', reason: 'Every requirement traces back to someone who needs it.', impact: 'high' },
      { key: 'problem', question: 'What problem does the product solve for them, and what happens today without it?', reason: 'The problem defines the scope and what success looks like.', impact: 'high' },
      { key: 'capabilities', question: 'What must a user be able to do in the first version? List the key capabilities.', reason: 'The first version needs a bounded set of capabilities to design and build.', impact: 'high' },
      { key: 'scope_out', question: 'What is explicitly out of scope for the first version?', reason: 'Stating what is left out prevents scope creep and hidden expectations.', impact: 'medium' },
      { key: 'fit_criteria', question: 'For each key capability, what measurable criterion shows it is met?', reason: 'Volere: a requirement without a fit criterion cannot be verified.', impact: 'high' },
      { key: 'constraints', question: 'What constraints are fixed (platform, budget, deadlines, regulations, existing systems)?', reason: 'Constraints narrow the design space before choosing anything.', impact: 'medium' },
    ],
  },
  {
    key: 'quality',
    title: 'Quality requirements',
    purpose:
      'Quality requirements: performance, availability, usability, accessibility, data and operability targets, each measurable (ISO/IEC 25010, arc42 quality scenarios).',
    questions: [
      { key: 'performance', question: 'What response times and load must the product handle (users, data volume, peaks)?', reason: 'Performance targets shape the architecture.', impact: 'high' },
      { key: 'availability', question: 'How available must it be, and what happens if it is down (acceptable downtime, data loss)?', reason: 'Availability and recovery targets drive infrastructure and cost.', impact: 'high' },
      { key: 'usability', question: 'Who must be able to use it without help, and what accessibility level is required?', reason: 'Usability and accessibility are requirements, not polish.', impact: 'medium' },
      { key: 'data', question: 'What data does it keep, for how long, and who owns it?', reason: 'Retention and ownership affect storage, privacy and compliance.', impact: 'medium' },
      { key: 'quality_scenarios', question: 'Which quality scenario matters most, stated as stimulus → response → measure?', reason: 'arc42: quality goals must be concrete scenarios to be tested.', impact: 'medium' },
    ],
  },
  {
    key: 'architecture',
    title: 'Architecture',
    purpose:
      'Architecture: context, building blocks, key decisions with their reasons and the risks they carry (arc42, C4, ADRs).',
    questions: [
      { key: 'context', question: 'What is the system context: which people and external systems interact with it (C4 level 1)?', reason: 'The context fixes the boundaries and interfaces.', impact: 'high' },
      { key: 'containers', question: 'What are the main building blocks (apps, services, stores) and how do they communicate (C4 level 2)?', reason: 'The containers are where work is split and deployed.', impact: 'high' },
      { key: 'key_decisions', question: 'Which architecture decisions are significant and hard to reverse? Record each one as an ADR.', reason: 'ADRs keep the why of each decision with its alternatives.', impact: 'high' },
      { key: 'tech_stack', question: 'What technologies will be used, and why those?', reason: 'The stack must fit the constraints and the quality targets.', impact: 'medium' },
      { key: 'risks', question: 'What are the main technical risks and technical debt accepted?', reason: 'arc42: risks named early can be mitigated.', impact: 'medium' },
    ],
  },
  {
    key: 'security',
    title: 'Security',
    purpose:
      'Security: what we protect, from whom, the threats per component and their mitigations (threat modeling, STRIDE).',
    questions: [
      { key: 'assets', question: 'What assets must be protected (data, credentials, money, reputation)?', reason: 'Threat modeling starts from what is worth attacking.', impact: 'high' },
      { key: 'actors', question: 'Who could attack or misuse the system, and with what access?', reason: 'Attackers and trust boundaries define the threat surface.', impact: 'high' },
      { key: 'threats', question: 'For each component, which STRIDE threats apply (spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege)?', reason: 'STRIDE makes sure no class of threat is forgotten.', impact: 'high' },
      { key: 'mitigations', question: 'What mitigation covers each relevant threat, and how is it verified?', reason: 'A threat without a verified mitigation is an accepted risk.', impact: 'high' },
      { key: 'authn_authz', question: 'How are users authenticated and what is each role allowed to do?', reason: 'Identity and permissions are the first line of defense.', impact: 'medium' },
    ],
  },
  {
    key: 'production',
    title: 'Production readiness',
    purpose:
      'Production readiness: how it is deployed, observed, rolled back and supported (Kubernetes KEP production readiness review, Google SRE PRR).',
    questions: [
      { key: 'deploy_rollback', question: 'How is it deployed, and how is a bad release rolled back?', reason: 'KEP PRR: rollout and rollback must be planned before launch.', impact: 'high' },
      { key: 'monitoring', question: 'How do we know it is healthy: which metrics, logs and alerts (SLIs/SLOs)?', reason: 'SRE: what is not observed cannot be operated.', impact: 'high' },
      { key: 'failure_modes', question: 'What happens when a dependency fails, and how does the system degrade?', reason: 'Failure modes must be known before they happen in production.', impact: 'high' },
      { key: 'scalability', question: 'What limits will it hit first as usage grows, and what is the plan?', reason: 'KEP PRR asks for scalability limits per stage.', impact: 'medium' },
      { key: 'support', question: 'Who responds to incidents, and with what runbook?', reason: 'Operations need an owner and a procedure.', impact: 'medium' },
    ],
  },
];

export function stageDefinition(key: string): StageDefinition | undefined {
  return STAGES.find((s) => s.key === key);
}

/** The stage after a given one, or null when it is the last. */
export function nextStage(key: string): StageDefinition | null {
  const i = STAGES.findIndex((s) => s.key === key);
  return i >= 0 && i + 1 < STAGES.length ? (STAGES[i + 1] ?? null) : null;
}

/** States of a mandatory question that count as covered: confirmed, or discarded with a reason. */
export const COVERED_QUESTION_STATES = ['confirmed', 'discarded'] as const;
