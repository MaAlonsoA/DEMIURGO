// Versioned records (decision, FDR, ADR, bug): templates, readiness, epistemic
// status and verifiability warning. All pure.

import { suspectReason } from './impact.ts';

export const RECORD_TYPES = [
  'decision',
  'epic',
  'fdr',
  'task',
  'adr',
  'bug',
  'requirement',
  'quality_requirement',
  'threat_model',
  'production_readiness',
  'product_definition',
  'design_system',
  'screen_design',
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const RECORD_PREFIX: Record<RecordType, string> = {
  decision: 'DEC',
  epic: 'EPC',
  fdr: 'FDR',
  task: 'TSK',
  adr: 'ADR',
  bug: 'BUG',
  requirement: 'REQ',
  quality_requirement: 'NFR',
  threat_model: 'THR',
  production_readiness: 'PRR',
  product_definition: 'DEF',
  design_system: 'DSY',
  screen_design: 'SCR',
};

// Cockburn, Writing Effective Use Cases: "Use 3 to 9 steps" in the main success scenario.
export const MAIN_FLOW_STEPS = { min: 3, max: 9 } as const;

export const RECORD_TEMPLATES: Record<RecordType, { sections: readonly string[]; requiresCriteria: boolean }> = {
  decision: { sections: ['Context', 'Decision', 'Consequences'], requiresCriteria: false },
  adr: { sections: ['Context', 'Options', 'Decision', 'Consequences'], requiresCriteria: true },
  // An epic: a capability of the first version too big for one feature. Its features are records
  // of their own from the moment it lists them (planned_features, in order, the smallest end-to-end
  // walk first); each FDR rests on it. Its criteria check the whole walk, not what its features
  // already check. Older versions still carry a "Features" section: an extra section is allowed.
  // Goal (naming the product outcome it serves), Out of scope (what it deliberately leaves out) and
  // Done when. Versions written before "Out of scope" existed still pass: they only get a warning.
  epic: { sections: ['Goal', 'Out of scope', 'Done when'], requiresCriteria: true },
  fdr: { sections: ['Goal', 'Scope', 'Out of scope', 'Behavior'], requiresCriteria: true },
  // A task: a piece of the construction of a feature, small enough to build and check on its own. It
  // rests on its feature (based_on the FDR) and covers some of the feature's criteria (`covers`); it
  // has none of its own (older tasks keep theirs).
  task: { sections: ['Goal', 'Scope'], requiresCriteria: false },
  bug: { sections: ['Reproduction', 'Expected', 'Observed'], requiresCriteria: true },
  // Design stages: a requirement in EARS with its Volere fit criterion; quality scenarios (arc42);
  // a STRIDE threat model; the production readiness review (KEP PRR, Google SRE).
  requirement: { sections: ['Statement', 'Rationale', 'Fit criterion'], requiresCriteria: true },
  quality_requirement: { sections: ['Quality attribute', 'Scenario', 'Measure'], requiresCriteria: true },
  threat_model: { sections: ['Assets', 'Actors and trust boundaries', 'Threats', 'Mitigations'], requiresCriteria: true },
  production_readiness: {
    sections: ['Rollout and rollback', 'Monitoring', 'Failure modes', 'Scalability', 'Support'],
    requiresCriteria: true,
  },
  // What the product is, what it builds first and how: composed from the product definition
  // stage's confirmed answers (domain/definition.ts). One per project; its changes are versions.
  product_definition: {
    sections: ['Purpose', 'Outcomes', 'Principles', 'Users', 'Problem', 'First version', 'Out of scope', 'Constraints'],
    requiresCriteria: false,
  },
  // How the product looks and moves: one per project, versioned. Its machine-readable part (tokens,
  // components, patterns) is the version's `spec` (domain/design-system.ts). Sections are our
  // convention, taken from what Material 3, Carbon and Atlassian document.
  design_system: {
    sections: ['Principles', 'Visual direction', 'Tokens', 'Components', 'Patterns', 'Motion', 'Accessibility', 'Governance'],
    requiresCriteria: false,
  },
  // The screens of one feature: its flow, each screen with its states and the design-system components
  // it uses. Based on its FDR version; the machine part is the version's `spec` (domain/screen-design.ts).
  screen_design: { sections: ['Flow', 'Screens', 'States', 'Components'], requiresCriteria: false },
};

export type Section = { title: string; content: string };

/** Limits on a version's content: shared by command validation and the design/ validator. */
export const VERSION_LIMITS = {
  title: 200,
  sectionTitle: 120,
  section: 50_000,
  sections: 40,
  criteria: 60,
  links: 40,
  changeNote: 2000,
  criterionTitle: 200,
  statement: 3000,
  check: 1000,
} as const;

/** Reasons why some sections don't meet their type's template (empty if they do). */
export function templateGaps(type: RecordType, sections: readonly Section[], forApproval = false): string[] {
  const gaps: string[] = [];
  const template = RECORD_TEMPLATES[type];
  // An epic version written before "Out of scope" existed can still be approved (a warning says so).
  const expected =
    forApproval && type === 'epic' && !sections.some((s) => s.title.startsWith('Out of scope'))
      ? template.sections.filter((t) => t !== 'Out of scope')
      : template.sections;
  // A title may add a note in parentheses to the template's name ("Scenario (stimulus → response)").
  const bare = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, '');
  let i = 0;
  for (const s of sections) if (bare(s.title) === expected[i]) i++;
  if (i < expected.length) gaps.push(`Missing template sections: ${expected.slice(i).join(', ')}.`);
  for (const s of sections) if (s.content.trim() === '') gaps.push(`Section "${s.title}" is empty.`);
  const titles = sections.map((s) => s.title);
  if (new Set(titles).size !== titles.length) gaps.push('There are repeated sections.');
  return gaps;
}

// Epistemic status (original vision): confirmed, proposed, pending or unknown.
export type EpistemicStatus = 'confirmed' | 'proposed' | 'pending' | 'unknown';

export function epistemicOfVersion(state: string): EpistemicStatus {
  if (state === 'approved') return 'confirmed';
  if (state === 'draft') return 'proposed';
  return 'unknown';
}

export function epistemicOfQuestion(state: string): EpistemicStatus {
  if (state === 'confirmed') return 'confirmed';
  if (state === 'inferred') return 'proposed';
  if (state === 'pending' || state === 'postponed') return 'pending';
  return 'unknown';
}

export function epistemicOfProposal(state: string): EpistemicStatus {
  if (state === 'accepted' || state === 'accepted_edited') return 'confirmed';
  if (state === 'pending') return 'proposed';
  return 'unknown';
}

export function epistemicOfObservation(type: string | null): EpistemicStatus {
  if (type === 'claim') return 'proposed';
  if (type === 'hypothesis') return 'proposed';
  if (type === 'unknown') return 'unknown';
  return 'proposed';
}

// Readiness: "Ready to build". Returns what's missing in product language.

export type VersionSummary = { n: number; state: string };

export type ReadinessInput = {
  code: string;
  type: RecordType;
  version: VersionSummary;
  /** Last approved version of the record (the current one), if any. */
  current: number | null;
  criteria: { code: string; verification: string; check: string; statement: string; step?: number | null }[];
  /** How many numbered steps the Behavior section of a feature has (Definition of Ready: each has a criterion). */
  behaviorSteps?: number;
  /**
   * "based_on" links to what it rests on (READINESS_BASES: an epic, the product definition or a
   * decision for a feature; a feature, the definition or a decision for an ADR): linked version, that
   * record's current version, and link status.
   */
  basedOn: {
    code: string;
    type: string;
    version: number;
    versionState: string;
    current: number | null;
    linkState: string;
    /** This version is current and rests on an older version of it than its current one, unconfirmed (domain/impact.ts). */
    suspect?: { upstream: string; from: number; to: number };
    /** Knowledge has compared it with the current version, when it rests on an older one. */
    checked?: boolean;
  }[];
  /** A task's dependencies (`depends_on` links), already resolved against the build state; only for a task. */
  taskWaits?: TaskWaits;
  /** Features this feature needs (based_on links to other features), with how built each one is. */
  needs: { code: string; implementation: string }[];
  /** Whether the Architecture stage (before_build) has passed: a feature is not built before it. */
  architecturePassed: boolean;
  /** Whether the Security baseline stage (before_build) has passed: a feature is not built before it. */
  securityPassed: boolean;
  /** An epic's listed features (not dropped), and whether each one has its approved design yet. */
  features?: { code: string; name: string; designed: boolean }[];
  /** An epic version: whether it has an "Out of scope" section (older ones do not: a warning). */
  hasOutOfScope?: boolean;
  /** Other links of this version that are pending review. */
  linksUnderReview: string[];
  /** Pending, postponed or assumed (inferred, not confirmed) questions in the origin exploration. */
  openQuestions: { question: string; state: string }[];
  /** Pending proposals that depend on this record. */
  pendingProposals: number;
};

/**
 * What a task waits for (our convention, not a published rule: a dependency-blocked task is not
 * startable, as in Jira's «is blocked by» and Linear's «blocked by»): the tasks it depends on and the
 * features it waits for, each with whether it is done, and the dependency cycle it is part of, if any.
 */
export type TaskWaits = {
  tasks: { code: string; title: string; merged: boolean }[];
  features: { code: string; title: string; built: boolean }[];
  /** Codes of the other tasks of a dependency cycle this task is in (itself when it waits for itself); null when none. */
  cycle: string[] | null;
};

/** The readiness reasons of a task's dependencies, in the words of the Build page. */
export function dependencyReasons(w: TaskWaits): string[] {
  const reasons: string[] = [];
  if (w.cycle) reasons.push(`Dependency cycle with ${w.cycle.join(', ')}.`);
  for (const t of w.tasks) if (!t.merged) reasons.push(`Waits for ${t.code} ${t.title} (not merged yet).`);
  for (const f of w.features) if (!f.built) reasons.push(`Waits for ${f.code} ${f.title} (not built yet).`);
  return reasons;
}

/** The dependency cycle `start` is in (as `start` first, then the codes along it), or null. Missing nodes have no edges. */
export function findDependencyCycle(graph: ReadonlyMap<string, readonly string[]>, start: string): string[] | null {
  const seen = new Set<string>();
  const walk = (node: string, path: string[]): string[] | null => {
    for (const next of graph.get(node) ?? []) {
      if (next === start) return path;
      if (seen.has(next)) continue;
      seen.add(next);
      const found = walk(next, [...path, next]);
      if (found) return found;
    }
    return null;
  };
  return walk(start, [start]);
}

/**
 * Stable topological order: always the first remaining item whose dependencies (`depsOf`, codes; the
 * ones not in `items` are ignored) are already out, so ties keep their order. If none is free (a
 * cycle), the first remaining goes: it never hangs.
 */
export function orderByDependencies<T>(items: readonly T[], codeOf: (t: T) => string, depsOf: (t: T) => readonly string[]): T[] {
  const present = new Set(items.map(codeOf));
  const rest = [...items];
  const out: T[] = [];
  const done = new Set<string>();
  while (rest.length > 0) {
    let i = rest.findIndex((t) => depsOf(t).every((d) => d === codeOf(t) || !present.has(d) || done.has(d)));
    if (i < 0) i = 0; // a cycle: the first one goes
    const [t] = rest.splice(i, 1);
    out.push(t as T);
    done.add(codeOf(t as T));
  }
  return out;
}

export type Readiness = { ready: boolean; reasons: string[]; warnings: string[] };

/** What a record rests on, in order of preference (the design hierarchy). */
export const READINESS_BASES: Partial<Record<RecordType, readonly RecordType[]>> = {
  fdr: ['epic', 'product_definition', 'decision'],
  adr: ['fdr', 'product_definition', 'decision'],
  task: ['fdr'],
};

const BASIS_NOUN: Record<string, string> = {
  epic: 'epic',
  product_definition: 'product definition',
  decision: 'decision',
  fdr: 'feature',
};

const QUESTION_REASONS: Record<string, string> = {
  pending: 'A question of its thread is open',
  postponed: 'A question of its thread was left for later',
  inferred: 'DEMIURGO assumed an answer you have not confirmed',
};

/** The readiness reason for a question of its thread, naming it (trimmed to a line). */
export function questionReason(state: string, question: string): string {
  const clean = question.replace(/\s+/g, ' ').trim();
  const shown = clean.length > 120 ? `${clean.slice(0, 119).trimEnd()}…` : clean;
  return `${QUESTION_REASONS[state] ?? 'A question of its thread is open'}: “${shown}”`;
}

export function readiness(e: ReadinessInput): Readiness {
  const reasons: string[] = [];
  if (e.version.state === 'superseded') {
    reasons.push(`Version ${e.version.n} is superseded: the current one is ${e.current ?? '—'}.`);
  } else if (e.version.state === 'draft' && e.current !== null && e.current > e.version.n) {
    reasons.push(`Version ${e.version.n} is a draft earlier than the current one (v${e.current}): it can only be discarded.`);
  } else if (e.version.state !== 'approved') reasons.push(`Version ${e.version.n} is not approved.`);
  else if (e.current !== e.version.n) reasons.push(`It's not the current version: the current one is ${e.current ?? '—'}.`);
  if (RECORD_TEMPLATES[e.type].requiresCriteria && e.criteria.length === 0) reasons.push('It has no acceptance criteria.');
  for (const c of e.criteria) {
    if (!['automatic', 'manual', 'release'].includes(c.verification) || c.check.trim() === '') {
      reasons.push(`Criterion ${c.code} doesn't say how it's checked.`);
    }
  }
  // Features written before criteria named their step (all null) keep their readiness as it was.
  if (e.type === 'fdr' && e.behaviorSteps !== undefined && e.criteria.some((c) => c.step != null)) {
    const n = e.behaviorSteps;
    for (const c of e.criteria) {
      if (c.step == null || c.step < 1 || c.step > n) {
        reasons.push(`Criterion ${c.code} doesn't say which Behavior step it checks (1 to ${n}).`);
      }
    }
    const missing = Array.from({ length: n }, (_, i) => i + 1).filter((s) => !e.criteria.some((c) => c.step === s));
    if (missing.length > 0)
      reasons.push(
        `Behavior ${missing.length === 1 ? 'step' : 'steps'} ${missing.join(', ')} ha${missing.length === 1 ? 's' : 've'} no criterion.`,
      );
  }
  if (e.type === 'fdr' || e.type === 'adr' || e.type === 'task') {
    if (e.basedOn.length === 0) {
      reasons.push(
        e.type === 'fdr'
          ? 'It is not based on any epic or on the product definition.'
          : e.type === 'task'
            ? 'It is not based on any feature.'
            : 'It is not based on any feature, on the product definition or on a decision.',
      );
    }
    for (const d of e.basedOn) {
      if (d.current === null) {
        reasons.push(`The ${BASIS_NOUN[d.type] ?? 'record'} it is based on, ${d.code}, is not approved.`);
      } else if (d.suspect) {
        reasons.push(suspectReason(d.suspect));
      } else if (d.current !== d.version && d.checked === false && d.linkState !== 'kept') {
        // An older basis holds once knowledge has checked it against the current version (a
        // contradiction comes back as a review) or the person kept the link.
        reasons.push(`It is based on ${d.code} v${d.version}; knowledge has not yet checked it against v${d.current}.`);
      }
      if (d.linkState === 'needs_review') reasons.push(`The link with ${d.code} is pending review.`);
    }
  }
  if (e.type === 'fdr') {
    if (!e.architecturePassed) reasons.push('The Architecture stage has not passed.');
    if (!e.securityPassed) reasons.push('The Security baseline stage has not passed.');
    for (const n of e.needs) {
      if (n.implementation !== 'implemented') reasons.push(`It needs ${n.code}, which is not built yet.`);
    }
  }
  if (e.type === 'task' && e.taskWaits) reasons.push(...dependencyReasons(e.taskWaits));
  if (e.type === 'epic') {
    if (e.features && e.features.length === 0) reasons.push('It has no features yet.');
    // Approving an epic does not wait for its features to be designed: they are designed one by one.
  }
  for (const linkRef of e.linksUnderReview) reasons.push(`The link with ${linkRef} is pending review.`);
  // Every question of its thread still open is named; an answer DEMIURGO assumed blocks too, until
  // the person confirms it: nothing is ready to build on an answer no person gave.
  for (const state of ['pending', 'postponed', 'inferred']) {
    for (const q of e.openQuestions) if (q.state === state) reasons.push(questionReason(state, q.question));
  }
  if (e.pendingProposals > 0) reasons.push(`There are ${e.pendingProposals} pending proposal(s) affecting it.`);
  const warnings = e.criteria.flatMap((c) => verifiabilityWarnings(c.code, c.statement));
  if (
    e.type === 'fdr' &&
    e.behaviorSteps !== undefined &&
    (e.behaviorSteps < MAIN_FLOW_STEPS.min || e.behaviorSteps > MAIN_FLOW_STEPS.max)
  )
    warnings.push(`The main flow has ${e.behaviorSteps} steps; a use case's main success scenario has 3 to 9 (Cockburn).`);
  if (e.type === 'epic' && e.hasOutOfScope === false)
    warnings.push('It has no "Out of scope" section: say what this epic deliberately leaves out.');
  return { ready: reasons.length === 0, reasons, warnings };
}

const VAGUE =
  /\b(r[aá]pid[oa]s?|fast|quick(?:ly)?|f[aá]cil(es|mente)?|easy|easily|intuitiv[oa]s?|intuitive(?:ly)?|adecuad[oa]s?|adequate|suitable|correctamente|correctly|bien|well|amigable|friendly|robust[oa]s?|robust(?:ly)?|eficiente(?:s|mente)?|efficient(?:ly)?|mejor(?:es)?|better|best|user[- ]friendly)\b/i;
const OBSERVABLE =
  /\b(cuando|entonces|ve|recibe|muestra|devuelve|aparece|queda|rechaza|falla|contiene|guarda|responde|when|then|sees?|receives?|shows?|returns?|appears?|remains?|rejects?|fails?|contains?|saves?|responds?)\b/i;

/**
 * Deterministic verifiability check (§7.5's Noul will replace it): only warns, never
 * blocks (AC-DIS-001-14).
 */
export function verifiabilityWarnings(code: string, statement: string): string[] {
  const warnings: string[] = [];
  if (!OBSERVABLE.test(statement))
    warnings.push(`${code}: the statement doesn't describe an observable result (Given…, when…, then…).`);
  const vague = VAGUE.exec(statement);
  if (vague) warnings.push(`${code}: "${vague[0]}" is vague; state a measure or a checkable result.`);
  return warnings;
}
