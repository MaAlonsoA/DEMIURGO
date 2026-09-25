// Versioned records (decision, FDR, ADR, bug): templates, readiness, epistemic
// status and verifiability warning. All pure.

export const RECORD_TYPES = [
  'decision',
  'fdr',
  'adr',
  'bug',
  'requirement',
  'quality_requirement',
  'threat_model',
  'production_readiness',
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const RECORD_PREFIX: Record<RecordType, string> = {
  decision: 'DEC',
  fdr: 'FDR',
  adr: 'ADR',
  bug: 'BUG',
  requirement: 'REQ',
  quality_requirement: 'NFR',
  threat_model: 'THR',
  production_readiness: 'PRR',
};

export const RECORD_TEMPLATES: Record<RecordType, { sections: readonly string[]; requiresCriteria: boolean }> = {
  decision: { sections: ['Context', 'Decision', 'Consequences'], requiresCriteria: false },
  adr: { sections: ['Context', 'Options', 'Decision', 'Consequences'], requiresCriteria: true },
  fdr: { sections: ['Goal', 'Scope', 'Out of scope', 'Behavior'], requiresCriteria: true },
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
export function templateGaps(type: RecordType, sections: readonly Section[]): string[] {
  const gaps: string[] = [];
  const template = RECORD_TEMPLATES[type];
  let i = 0;
  for (const s of sections) if (s.title === template.sections[i]) i++;
  if (i < template.sections.length) gaps.push(`Missing template sections: ${template.sections.slice(i).join(', ')}.`);
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
  criteria: { code: string; verification: string; check: string; statement: string }[];
  /** "based_on" links to decisions: linked version, that decision's current version, and link status. */
  basedOn: { code: string; version: number; versionState: string; current: number | null; linkState: string }[];
  /** Other links of this version that are pending review. */
  linksUnderReview: string[];
  /** Pending, postponed or assumed (inferred, not confirmed) questions in the origin exploration. */
  openQuestions: { question: string; state: string }[];
  /** Pending proposals that depend on this record. */
  pendingProposals: number;
};

export type Readiness = { ready: boolean; reasons: string[]; warnings: string[] };

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
    if (!['automatic', 'manual'].includes(c.verification) || c.check.trim() === '') {
      reasons.push(`Criterion ${c.code} doesn't say how it's checked.`);
    }
  }
  if (e.type === 'fdr' || e.type === 'adr') {
    const decisions = e.basedOn;
    if (decisions.length === 0) reasons.push('It is not based on any decision.');
    for (const d of decisions) {
      if (d.current === null) {
        reasons.push(`The decision it is based on, ${d.code}, is not approved.`);
      } else if (d.current !== d.version) {
        reasons.push(`It is based on ${d.code} v${d.version}, but the current one is v${d.current}.`);
      }
      if (d.linkState === 'needs_review') reasons.push(`The link with ${d.code} is pending review.`);
    }
  }
  for (const linkRef of e.linksUnderReview) reasons.push(`The link with ${linkRef} is pending review.`);
  // Every question of its thread still open is named; an answer DEMIURGO assumed blocks too, until
  // the person confirms it: nothing is ready to build on an answer no person gave.
  for (const state of ['pending', 'postponed', 'inferred']) {
    for (const q of e.openQuestions) if (q.state === state) reasons.push(questionReason(state, q.question));
  }
  if (e.pendingProposals > 0) reasons.push(`There are ${e.pendingProposals} pending proposal(s) affecting it.`);
  const warnings = e.criteria.flatMap((c) => verifiabilityWarnings(c.code, c.statement));
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
