// Deterministic lint of a feature's acceptance criteria, run at design time (before the version is
// approved) so that a criterion born with the wrong verification level is caught in P5 and not
// when the builder or the reviewer trips over it.
//
// Practice: lightweight static analysis of natural-language requirements "as soon as they are
// written" (Femmer, Méndez Fernández, Wagner and Eder, «Rapid quality assurance with Requirements
// Smells», Journal of Systems and Software, 2017) and the «verifiable» characteristic of a good
// requirement (ISO/IEC/IEEE 29148). Both say a requirement must be checkable; neither gives the
// patterns below. The pattern lists, and which kinds block approval, are OUR CONVENTION (a Definition
// of Ready the team is free to define, as the Scrum Guide leaves it to the team).

export type CriterionLintKind = 'needs_deployed_candidate' | 'depends_on_unbuilt_feature';

export type CriterionLintInput = {
  code: string;
  /** automatic, manual or release. */
  verification: string;
  statement: string;
  check?: string | null;
  given?: string | null;
  when?: string | null;
  then?: string | null;
};

export type CriterionLintFinding = {
  criterion_code: string;
  kind: CriterionLintKind;
  /** The text that matched (for `depends_on_unbuilt_feature`, the cited code). */
  evidence: string;
  suggestion: string;
};

const NUMBER_WORD = 'one|two|three|four|five|six|seven|eight|nine|ten|twelve|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez';
const POPULATION_NOUN =
  'cases|requests?|users?|loads?|opens?|sessions?|attempts?|calls?|times|casos|solicitudes|peticiones|usuarios?|veces|cargas|intentos|sesiones';

// Population or statistical properties: a CI run on synthetic data cannot establish them.
const POPULATION: RegExp[] = [
  new RegExp(`\\b\\d{1,3}(?:[.,]\\d+)?\\s?%\\s+(?:of|de)\\s+(?:the\\s+|los\\s+|las\\s+)?(?:${POPULATION_NOUN})\\b`, 'i'),
  new RegExp(`\\b(?:in|en)\\s+(?:the\\s+|el\\s+)?\\d{1,3}(?:[.,]\\d+)?\\s?%`, 'i'),
  /\bp(?:9[05]|99)\b/i,
  /\b(?:percentile|percentil)\b/i,
  new RegExp(`\\b(?:\\d+|${NUMBER_WORD})\\s+(?:years?|months?|años?|meses)\\s+(?:of|de)\\s+\\w+`, 'i'),
];

// Real-environment properties: only a deployed candidate (real network, device, data volume) shows them.
const REAL_ENVIRONMENT: RegExp[] = [
  /\b(?:mobile|cellular|slow|real|móvil|lenta|real)\s+(?:connection|network|conexi[oó]n|red)\b/i,
  /\b[345]g\b/i,
  /\bthrottl\w+/i,
  /\bcold[- ]starts?\b|\barranque en fr[ií]o\b/i,
  /\b(?:real|physical|actual|real)\s+(?:device|phone|dispositivo|tel[eé]fono)s?\b/i,
  /\b(?:dispositivo|tel[eé]fono|m[oó]vil)\s+real(?:es)?\b/i,
  /\bon\s+(?:a|the)\s+(?:phone|mobile|device)\b/i,
  /\bproduction[- ](?:sized|data|environment|volume|load)\b|\bin production\b/i,
  /\b(?:deployed|desplegad[oa])\b/i,
];

// «within 2 seconds» alone can be a timeout a unit test checks; it only needs the deployed
// candidate when it is stated for a real environment.
const TIMING = /\b(?:within|in under|under|less than|dentro de|en menos de)\s+\d+(?:[.,]\d+)?\s?(?:s|sec|seconds?|ms|milliseconds?|segundos?)\b/i;

const CITED_CODE = /\b(?:FDR|EPC)-[A-Z]{3}-\d{3}\b/g;

function textOf(c: CriterionLintInput): string {
  return [c.statement, c.check, c.given, c.when, c.then].filter((s): s is string => !!s && s.trim() !== '').join(' ');
}

/** `AC-MEA-002-12` belongs to the feature `FDR-MEA-002`: the DOM-NNN part is shared. */
function ownDomainNumber(code: string): string | null {
  const m = /^[A-Z]{2,4}-([A-Z]{3}-\d{3})\b/.exec(code);
  return m?.[1] ?? null;
}

export function lintCriteria(criteria: CriterionLintInput[]): CriterionLintFinding[] {
  const findings: CriterionLintFinding[] = [];
  for (const c of criteria) {
    const text = textOf(c);
    if (c.verification === 'automatic') {
      let evidence: string | null = null;
      for (const re of [...POPULATION, ...REAL_ENVIRONMENT]) {
        const m = re.exec(text);
        if (m) {
          evidence = m[0].trim();
          break;
        }
      }
      if (evidence === null) {
        const t = TIMING.exec(text);
        const env = t ? REAL_ENVIRONMENT.find((re) => re.test(text)) : undefined;
        if (t && env) evidence = t[0];
      }
      if (evidence !== null) {
        findings.push({
          criterion_code: c.code,
          kind: 'needs_deployed_candidate',
          evidence,
          suggestion:
            'It looks like it needs the deployed release candidate or real-world data: mark it release, or reduce it to something CI can measure.',
        });
      }
    }
    const own = ownDomainNumber(c.code);
    const cited = new Set<string>();
    for (const m of text.matchAll(CITED_CODE)) {
      if (own && m[0].endsWith(own)) continue;
      cited.add(m[0]);
    }
    for (const code of cited) {
      findings.push({
        criterion_code: c.code,
        kind: 'depends_on_unbuilt_feature',
        evidence: code,
        suggestion: `It cites ${code}: if that feature is not built yet, the criterion cannot be checked before it; put it in its own task that waits for ${code}.`,
      });
    }
  }
  return findings;
}

/** The findings that stop an approval unless the person gives a reason (our convention). */
export function blockingCriterionFindings(findings: CriterionLintFinding[]): CriterionLintFinding[] {
  return findings.filter((f) => f.kind === 'needs_deployed_candidate');
}
