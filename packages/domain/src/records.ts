// Registros con versiones (decisión, FDR, ADR, bug): plantillas, readiness, estado
// epistémico y aviso de verificabilidad. Todo puro.

export const RECORD_TYPES = ['decision', 'fdr', 'adr', 'bug'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const RECORD_PREFIX: Record<RecordType, string> = { decision: 'DEC', fdr: 'FDR', adr: 'ADR', bug: 'BUG' };

export const RECORD_TEMPLATES: Record<RecordType, { sections: readonly string[]; requiresCriteria: boolean }> = {
  decision: { sections: ['Context', 'Decisión', 'Consequences'], requiresCriteria: false },
  adr: { sections: ['Context', 'Options', 'Decisión', 'Consequences'], requiresCriteria: true },
  fdr: { sections: ['Goal', 'Scope', 'Fuera de alcance', 'Behavior'], requiresCriteria: true },
  bug: { sections: ['Reproducción', 'Expected', 'Observed'], requiresCriteria: true },
};

export type Section = { title: string; content: string };

/** Límites del contenido de una versión: los comparten la validación de los comandos y el validador de design/. */
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

/** Motivos por los que unas secciones no cumplen la plantilla de su tipo (vacío si la cumplen). */
export function templateGaps(type: RecordType, sections: readonly Section[]): string[] {
  const gaps: string[] = [];
  const template = RECORD_TEMPLATES[type];
  let i = 0;
  for (const s of sections) if (s.title === template.sections[i]) i++;
  if (i < template.sections.length)
    gaps.push(`Faltan secciones de la plantilla: ${template.sections.slice(i).join(', ')}.`);
  for (const s of sections) if (s.content.trim() === '') gaps.push(`La sección «${s.title}» está vacía.`);
  const titles = sections.map((s) => s.title);
  if (new Set(titles).size !== titles.length) gaps.push('Hay secciones repetidas.');
  return gaps;
}

// Estado epistémico (visión original): confirmado, propuesto, pendiente o desconocido.
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

// Readiness: «Listo para construir». Devuelve lo que falta en lenguaje de producto.

export type VersionSummary = { n: number; state: string };

export type ReadinessInput = {
  code: string;
  type: RecordType;
  version: VersionSummary;
  /** Última versión aprobada del registro (la vigente), si existe. */
  current: number | null;
  criteria: { code: string; verification: string; check: string; statement: string }[];
  /** Enlaces «based_on» a decisiones: versión enlazada, vigente de esa decisión y estado del enlace. */
  basedOn: { code: string; version: number; versionState: string; current: number | null; linkState: string }[];
  /** Otros enlaces de esta versión que están pendientes de revisión. */
  linksUnderReview: string[];
  /** Preguntas pendientes o pospuestas en la exploración de origen. */
  openQuestions: { question: string; state: string }[];
  /** Propuestas pendientes que dependen de este registro. */
  pendingProposals: number;
};

export type Readiness = { ready: boolean; reasons: string[]; warnings: string[] };

export function readiness(e: ReadinessInput): Readiness {
  const reasons: string[] = [];
  if (e.version.state === 'superseded') {
    reasons.push(`La versión ${e.version.n} está sustituida: la vigente es la ${e.current ?? '—'}.`);
  } else if (e.version.state === 'draft' && e.current !== null && e.current > e.version.n) {
    reasons.push(`La versión ${e.version.n} es un borrador anterior a la vigente (v${e.current}): solo se puede descartar.`);
  } else if (e.version.state !== 'approved') reasons.push(`La versión ${e.version.n} no está aprobada.`);
  else if (e.current !== e.version.n) reasons.push(`No es la versión vigente: la vigente es la ${e.current ?? '—'}.`);
  if (RECORD_TEMPLATES[e.type].requiresCriteria && e.criteria.length === 0) reasons.push('No tiene criterios de aceptación.');
  for (const c of e.criteria) {
    if (!['automatic', 'manual'].includes(c.verification) || c.check.trim() === '') {
      reasons.push(`El criterio ${c.code} no indica cómo se comprueba.`);
    }
  }
  if (e.type === 'fdr' || e.type === 'adr') {
    const decisions = e.basedOn;
    if (decisions.length === 0) reasons.push('No se basa en ninguna decisión.');
    for (const d of decisions) {
      if (d.current === null) {
        reasons.push(`La decisión ${d.code} en la que se basa no está aprobada.`);
      } else if (d.current !== d.version) {
        reasons.push(`Se basa en ${d.code} v${d.version}, pero la vigente es la v${d.current}.`);
      }
      if (d.linkState === 'needs_review') reasons.push(`El enlace con ${d.code} está pendiente de revisión.`);
    }
  }
  for (const linkRef of e.linksUnderReview) reasons.push(`El enlace con ${linkRef} está pendiente de revisión.`);
  const pending = e.openQuestions.filter((p) => p.state === 'pending').length;
  const postponed = e.openQuestions.filter((p) => p.state === 'postponed').length;
  if (pending > 0) reasons.push(`Hay ${pending} pregunta(s) pendiente(s) en la exploración de origen.`);
  if (postponed > 0) reasons.push(`Hay ${postponed} pregunta(s) pospuesta(s) en la exploración de origen.`);
  if (e.pendingProposals > 0) reasons.push(`Hay ${e.pendingProposals} propuesta(s) pendiente(s) que la afectan.`);
  const warnings = e.criteria.flatMap((c) => verifiabilityWarnings(c.code, c.statement));
  return { ready: reasons.length === 0, reasons, warnings };
}

const VAGUE =
  /\b(r[aá]pid[oa]s?|f[aá]cil(es|mente)?|intuitiv[oa]s?|adecuad[oa]s?|correctamente|bien|amigable|robust[oa]s?|eficiente(s|mente)?|mejor(es)?|user[- ]friendly)\b/i;
const OBSERVABLE = /\b(cuando|entonces|ve|recibe|muestra|devuelve|aparece|queda|rechaza|falla|contiene|guarda|responde)\b/i;

/**
 * Chequeo de verificabilidad determinista (el Noul de §7.5 lo sustituirá): solo avisa, nunca
 * bloquea (AC-DIS-001-14).
 */
export function verifiabilityWarnings(code: string, statement: string): string[] {
  const warnings: string[] = [];
  if (!OBSERVABLE.test(statement))
    warnings.push(`${code}: el enunciado no describe un resultado observable (Dado…, cuando…, entonces…).`);
  const vague = VAGUE.exec(statement);
  if (vague) warnings.push(`${code}: «${vague[0]}» es vago; indica una medida o un resultado comprobable.`);
  return warnings;
}
