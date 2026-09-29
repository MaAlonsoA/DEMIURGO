// The UI's dictionary (spec §6): state and command codes → words and marks. The labels of
// /api/tables are the default word; this dictionary adds the mark and changes the word only where
// the agreed language differs. Record prose is stored in English and shown as written; a person reading
// in another language sees a marked reading translation next to it (i18n/reading.tsx), never in its place.

import type { Actor, RecordType } from './api/types.ts';
import { type Locale, useLocale } from './i18n/locale.ts';

/** The language shown now (the same store as i18n/locale.ts; it needs no query client). */
export function useSafeLocale(): Locale {
  return useLocale();
}

/** Marks of the visual language (canvas S3A): dots, not-active marks and colors. */
export type MarkKind =
  | 'confirmed'
  | 'assumed'
  | 'proposed'
  | 'open'
  | 'unknown'
  | 'parked'
  | 'dropped'
  | 'replaced'
  | 'stale'
  | 'conflict'
  | 'problem'
  | 'working'
  | 'inactive'
  | 'done';

/** Name and phrase of each mark: the tooltip and the legend say the same thing. */
export const MARKS: Record<MarkKind, { name: string; phrase: string }> = {
  confirmed: { name: 'Confirmed', phrase: 'A person said yes.' },
  assumed: { name: 'Assumed', phrase: 'DEMIURGO concluded it. Not confirmed yet.' },
  proposed: { name: 'Proposed', phrase: 'Suggested, waiting for you.' },
  open: { name: 'Open', phrase: 'Asked, no answer yet.' },
  unknown: { name: 'Unknown', phrase: 'Not known yet.' },
  parked: { name: 'Parked', phrase: 'Kept for later.' },
  dropped: { name: 'Dropped', phrase: "Doesn't apply." },
  replaced: { name: 'Replaced', phrase: 'A newer version exists.' },
  stale: { name: 'Out of date', phrase: 'What it was based on changed: it can no longer be accepted.' },
  conflict: { name: 'Conflict', phrase: 'Contradicts something confirmed.' },
  problem: { name: 'Problem', phrase: 'Something went wrong or needs a review.' },
  working: { name: 'Working', phrase: 'DEMIURGO or an agent is on it.' },
  inactive: { name: 'Not active', phrase: 'Finished or stopped: nothing to do.' },
  done: { name: 'Done', phrase: 'Finished without problems.' },
};

export type Word = { word: string; mark: MarkKind };

/** Entities the UI shows, with every state of their table (a unit test checks it's complete). */
export const STATE_WORDS: Record<string, Record<string, Word>> = {
  record_version: {
    draft: { word: 'Accepted proposal', mark: 'proposed' },
    approved: { word: 'Record', mark: 'confirmed' },
    superseded: { word: 'Replaced', mark: 'replaced' },
    discarded: { word: 'Discarded', mark: 'dropped' },
  },
  question: {
    pending: { word: 'Open', mark: 'open' },
    inferred: { word: 'Assumed', mark: 'assumed' },
    confirmed: { word: 'Confirmed', mark: 'confirmed' },
    postponed: { word: 'Parked', mark: 'parked' },
    discarded: { word: 'Dropped', mark: 'dropped' },
  },
  proposal: {
    pending: { word: 'Proposed', mark: 'proposed' },
    accepted: { word: 'Accepted', mark: 'confirmed' },
    accepted_edited: { word: 'Accepted with edits', mark: 'confirmed' },
    rejected: { word: 'Rejected', mark: 'dropped' },
    superseded: { word: 'Out of date', mark: 'stale' },
  },
  batch: {
    pending: { word: 'Pending', mark: 'proposed' },
    accepted: { word: 'Accepted', mark: 'confirmed' },
    rejected: { word: 'Rejected', mark: 'dropped' },
    resolved: { word: 'Resolved', mark: 'done' },
    superseded: { word: 'Out of date', mark: 'stale' },
  },
  link: {
    current: { word: 'Current', mark: 'confirmed' },
    needs_review: { word: 'Needs review', mark: 'problem' },
    kept: { word: 'Kept', mark: 'confirmed' },
    changed: { word: 'Changed', mark: 'confirmed' },
    obsolete: { word: 'Out of date', mark: 'stale' },
  },
  ai_run: {
    queued: { word: 'Queued', mark: 'working' },
    running: { word: 'Working', mark: 'working' },
    completed: { word: 'Completed', mark: 'done' },
    failed: { word: 'Failed', mark: 'problem' },
    cancelled: { word: 'Cancelled', mark: 'inactive' },
    interrupted: { word: 'Interrupted', mark: 'problem' },
  },
  knowledge_update: {
    queued: { word: 'Updating', mark: 'working' },
    classifying: { word: 'Updating', mark: 'working' },
    verifying: { word: 'Updating', mark: 'working' },
    applied: { word: 'Applied', mark: 'done' },
    rejected: { word: 'Failed', mark: 'problem' },
  },
  classification: {
    applied: { word: 'Applied', mark: 'confirmed' },
    pending_review: { word: 'Needs review', mark: 'proposed' },
    resolved: { word: 'Resolved', mark: 'confirmed' },
  },
  exploration: {
    active: { word: 'Active', mark: 'open' },
    concluded: { word: 'Concluded', mark: 'confirmed' },
    set_aside: { word: 'Set aside', mark: 'parked' },
  },
  taxonomy: {
    draft: { word: 'Proposed', mark: 'proposed' },
    approved: { word: 'Approved', mark: 'confirmed' },
    superseded: { word: 'Replaced', mark: 'replaced' },
  },
  knowledge_node: {
    current: { word: 'Current', mark: 'done' },
    invalidated: { word: 'Invalidated', mark: 'inactive' },
  },
  knowledge_edge: {
    current: { word: 'Current', mark: 'done' },
    invalidated: { word: 'Invalidated', mark: 'inactive' },
  },
  source: {
    registered: { word: 'Registered', mark: 'unknown' },
  },
};

/** Observation types of DEMIURGO's messages. */
export const OBSERVATION_WORDS: Record<string, Word> = {
  claim: { word: 'Claim', mark: 'proposed' },
  hypothesis: { word: 'Hypothesis', mark: 'proposed' },
  unknown: { word: 'Unknown', mark: 'unknown' },
};

/** Epistemic status of the API → mark (FDR-DIS-001 correspondence). */
export const EPISTEMIC_MARK: Record<string, MarkKind> = {
  confirmed: 'confirmed',
  proposed: 'proposed',
  pending: 'open',
  unknown: 'unknown',
};

export function stateWord(entity: string, state: string, fallbackLabel?: string): Word {
  return STATE_WORDS[entity]?.[state] ?? { word: fallbackLabel ?? state, mark: 'unknown' };
}

/** Words of the commands a person runs from the UI. */
export const COMMAND_WORDS: Record<string, string> = {
  'batch.accept_package': 'Accept package',
  'batch.reject_package': 'Reject package',
  'proposal.accept': 'Accept',
  'proposal.accept_edited': 'Change',
  'proposal.reject': 'Reject',
  'record_version.approve': 'Approve',
  'record_version.discard': 'Discard',
  'record_version.create': 'New version',
  'question.confirm': 'Confirm',
  'question.postpone': 'Park',
  'question.discard': 'Drop',
  'question.reopen': 'Reopen',
  'question.raise': 'Ask a question',
  'link.create': 'Add a link',
  'exploration.open': 'New thread',
  'exploration.conclude': 'Conclude',
  'exploration.set_aside': 'Set aside',
  'exploration.resume': 'Resume',
  'message.post': 'Send',
  'run.request': 'Ask DEMIURGO',
  'run.retry': 'Retry',
  'run.cancel': 'Cancel',
  'link.keep': 'Keep',
  'link.change': 'Mark as changed',
  'link.obsolete': 'Out of date',
  'classification.resolve': 'Resolve',
  'knowledge_update.retry': 'Retry',
  'taxonomy.propose': 'Propose',
  'taxonomy.approve': 'Approve',
  'source.register': 'Add a source',
  'design.import': 'Import design/',
};

export function commandWord(command: string): string {
  return COMMAND_WORDS[command] ?? command;
}

/** Names of the UI for the back's record types (spec §6, "Nombres"). */
export const TYPE_WORDS: Record<RecordType, string> = {
  epic: 'Epic',
  fdr: 'Feature',
  adr: 'Tech decision',
  decision: 'Decision',
  bug: 'Bug',
  requirement: 'Requirement',
  quality_requirement: 'Quality requirement',
  threat_model: 'Threat model',
  production_readiness: 'Production readiness',
  product_definition: 'Product definition',
};

export const TYPE_WORDS_PLURAL: Record<RecordType, string> = {
  epic: 'Epics',
  fdr: 'Features',
  adr: 'Tech decisions',
  decision: 'Decisions',
  bug: 'Bugs',
  requirement: 'Requirements',
  quality_requirement: 'Quality requirements',
  threat_model: 'Threat models',
  production_readiness: 'Production readiness',
  product_definition: 'Product definition',
};

/** Failure kinds of a run, in product words. */
export const FAILURE_WORDS: Record<string, string> = {
  invalid_output: "It couldn't finish: the output didn't match the format. Nothing was changed.",
  agent_error: 'The agent answered with an error. Nothing was changed.',
  timeout: 'It took too long and was stopped. Nothing was changed.',
  infra: 'DEMIURGO restarted while it was running. Nothing was changed.',
  cancelled: 'You cancelled it. Nothing was changed.',
  stale_knowledge: 'The knowledge changed while it was running. Nothing was changed.',
};

export function failureWord(kind: string | null, state?: string): string {
  if (state === 'interrupted') return 'DEMIURGO restarted while it was running. Nothing was changed.';
  if (!kind) return 'It stopped without saying why. Nothing was changed.';
  return FAILURE_WORDS[kind] ?? 'It stopped with an error. Nothing was changed.';
}

export const ACTION_WORDS: Record<string, string> = {
  exploration_chat: 'Conversation',
  design_proposal: 'Draft',
  echo: 'Echo',
};

/** Who did something, from the actor of an event or the producer of a batch (spec §6, "Quién"). */
export type Who = { kind: 'you' | 'demiurgo' | 'agent' | 'automatic'; name: string; detail: string };

export function whoOf(actor: string | Actor, model?: string | null): Who {
  const text = typeof actor === 'string' ? actor : formatActor(actor);
  if (text.startsWith('human:')) return { kind: 'you', name: 'You', detail: text.slice(6) };
  if (text.startsWith('agent:run:')) return { kind: 'demiurgo', name: 'DEMIURGO', detail: model ?? '' };
  const agent = /^agent:([^:]+):/.exec(text);
  if (agent?.[1]) return { kind: 'agent', name: agent[1], detail: 'Agent' };
  const s = /^system:([^@]+)@?(.*)$/.exec(text);
  if (s?.[1]) return { kind: 'automatic', name: 'Automatic', detail: `${s[1]}${s[2] ? `@${s[2]}` : ''}` };
  return { kind: 'automatic', name: 'Automatic', detail: text };
}

function formatActor(a: Actor): string {
  switch (a.type) {
    case 'human':
      return `human:${a.person}`;
    case 'agent_external':
      return `agent:${a.name}:${a.session}`;
    case 'agent_run':
      return `agent:run:${a.run}`;
    case 'system':
      return `system:${a.component}@${a.version}`;
  }
}

export const WHO_PHRASES: Record<Who['kind'], string> = {
  you: 'Only people confirm.',
  demiurgo: 'Drafts, asks and proposes.',
  agent: 'From outside. Only proposes.',
  automatic: 'A rule or test that ran alone.',
};

export const PRODUCT_WORDS = {
  needsYou: 'Needs you',
  nothingNeedsYou: 'Nothing needs you. You can close DEMIURGO.',
  readyToBuild: 'Ready to build',
  notReady: 'Not ready',
  notBuilt: 'not built',
  catchingUp: 'DEMIURGO is catching up with your latest changes. Try again in a moment.',
  cantReach: "Can't reach DEMIURGO. Retrying…",
  onlyAPerson: 'Only a person can do this.',
  notAllowed: "This isn't allowed here.",
} as const;

// ---------------------------------------------------------------------------------------------
// Locale-aware accessors (additive; every export above keeps its English value and signature
// unchanged for backwards compatibility with screens that already import it). These read the
// person's interface language and give the Spanish word where the English one is a dictionary
// value rather than a record type's own prose.

/** Spanish names and phrases of the marks, same shape and keys as MARKS. */
export const MARKS_ES: Record<MarkKind, { name: string; phrase: string }> = {
  confirmed: { name: 'Confirmado', phrase: 'Una persona dijo que sí.' },
  assumed: { name: 'Supuesto', phrase: 'DEMIURGO lo dedujo. Aún sin confirmar.' },
  proposed: { name: 'Propuesto', phrase: 'Sugerido, a la espera de ti.' },
  open: { name: 'Abierta', phrase: 'Preguntado, sin respuesta todavía.' },
  unknown: { name: 'Desconocido', phrase: 'Todavía no se sabe.' },
  parked: { name: 'Aparcada', phrase: 'Guardado para más tarde.' },
  dropped: { name: 'Descartada', phrase: 'No aplica.' },
  replaced: { name: 'Reemplazado', phrase: 'Existe una versión más reciente.' },
  stale: { name: 'Desactualizado', phrase: 'Lo que lo motivó cambió: ya no se puede aceptar.' },
  conflict: { name: 'Conflicto', phrase: 'Contradice algo confirmado.' },
  problem: { name: 'Problema', phrase: 'Algo falló o necesita revisión.' },
  working: { name: 'En curso', phrase: 'DEMIURGO o un agente lo está haciendo.' },
  inactive: { name: 'Inactivo', phrase: 'Terminado o detenido: nada que hacer.' },
  done: { name: 'Hecho', phrase: 'Terminado sin problemas.' },
};

/** MARKS in the language given. */
export function marksFor(locale: Locale): typeof MARKS {
  return locale === 'es' ? MARKS_ES : MARKS;
}

/** MARKS in the language shown now. */
export function useMarks(): typeof MARKS {
  return marksFor(useSafeLocale());
}

const STATE_WORDS_ES: Record<string, Record<string, string>> = {
  record_version: { draft: 'Propuesta aceptada', approved: 'Registro', superseded: 'Reemplazada', discarded: 'Descartada' },
  question: { pending: 'Abierta', inferred: 'Supuesta', confirmed: 'Confirmada', postponed: 'Aparcada', discarded: 'Descartada' },
  proposal: {
    pending: 'Propuesta',
    accepted: 'Aceptada',
    accepted_edited: 'Aceptada con cambios',
    rejected: 'Rechazada',
    superseded: 'Desactualizada',
  },
  batch: {
    pending: 'Pendiente',
    accepted: 'Aceptado',
    rejected: 'Rechazado',
    resolved: 'Resuelto',
    superseded: 'Desactualizado',
  },
  link: {
    current: 'Actual',
    needs_review: 'Necesita revisión',
    kept: 'Mantenido',
    changed: 'Cambiado',
    obsolete: 'Desactualizado',
  },
  ai_run: {
    queued: 'En cola',
    running: 'En curso',
    completed: 'Completada',
    failed: 'Fallida',
    cancelled: 'Cancelada',
    interrupted: 'Interrumpida',
  },
  knowledge_update: {
    queued: 'Actualizando',
    classifying: 'Actualizando',
    verifying: 'Actualizando',
    applied: 'Aplicada',
    rejected: 'Fallida',
  },
  classification: { applied: 'Aplicada', pending_review: 'Necesita revisión', resolved: 'Resuelta' },
  exploration: { active: 'Activo', concluded: 'Concluido', set_aside: 'Aparcado' },
  taxonomy: { draft: 'Propuesta', approved: 'Aprobada', superseded: 'Reemplazada' },
  knowledge_node: { current: 'Actual', invalidated: 'Invalidado' },
  knowledge_edge: { current: 'Actual', invalidated: 'Invalidado' },
  source: { registered: 'Registrada' },
};

/** stateWord in the language given: the mark never changes, only the word. */
export function stateWordFor(locale: Locale, entity: string, state: string, fallbackLabel?: string): Word {
  const base = stateWord(entity, state, fallbackLabel);
  if (locale !== 'es') return base;
  const word = STATE_WORDS_ES[entity]?.[state];
  return word ? { word, mark: base.mark } : base;
}

/** stateWord in the language shown now. */
export function useStateWord(entity: string, state: string, fallbackLabel?: string): Word {
  return stateWordFor(useSafeLocale(), entity, state, fallbackLabel);
}

const COMMAND_WORDS_ES: Record<string, string> = {
  'batch.accept_package': 'Aceptar paquete',
  'batch.reject_package': 'Rechazar paquete',
  'proposal.accept': 'Aceptar',
  'proposal.accept_edited': 'Cambiar',
  'proposal.reject': 'Rechazar',
  'record_version.approve': 'Aprobar',
  'record_version.discard': 'Descartar',
  'record_version.create': 'Nueva versión',
  'question.confirm': 'Confirmar',
  'question.postpone': 'Aparcar',
  'question.discard': 'Descartar',
  'question.reopen': 'Reabrir',
  'question.raise': 'Hacer una pregunta',
  'link.create': 'Añadir un enlace',
  'exploration.open': 'Nuevo hilo',
  'exploration.conclude': 'Concluir',
  'exploration.set_aside': 'Aparcar',
  'exploration.resume': 'Reanudar',
  'message.post': 'Enviar',
  'run.request': 'Preguntar a DEMIURGO',
  'run.retry': 'Reintentar',
  'run.cancel': 'Cancelar',
  'link.keep': 'Mantener',
  'link.change': 'Marcar como cambiado',
  'link.obsolete': 'Desactualizado',
  'classification.resolve': 'Resolver',
  'knowledge_update.retry': 'Reintentar',
  'taxonomy.propose': 'Proponer',
  'taxonomy.approve': 'Aprobar',
  'source.register': 'Añadir una fuente',
  'design.import': 'Importar design/',
};

/** commandWord in the language given. */
export function commandWordFor(locale: Locale, command: string): string {
  return locale === 'es' ? (COMMAND_WORDS_ES[command] ?? commandWord(command)) : commandWord(command);
}

/** commandWord in the language shown now. */
export function useCommandWord(command: string): string {
  return commandWordFor(useSafeLocale(), command);
}

const TYPE_WORDS_ES: Record<RecordType, string> = {
  epic: 'Épica',
  fdr: 'Funcionalidad',
  adr: 'Decisión técnica',
  decision: 'Decisión',
  bug: 'Fallo',
  requirement: 'Requisito',
  quality_requirement: 'Requisito de calidad',
  threat_model: 'Modelo de amenazas',
  production_readiness: 'Preparación para producción',
  product_definition: 'Definición del producto',
};

const TYPE_WORDS_PLURAL_ES: Record<RecordType, string> = {
  epic: 'Épicas',
  fdr: 'Funcionalidades',
  adr: 'Decisiones técnicas',
  decision: 'Decisiones',
  bug: 'Fallos',
  requirement: 'Requisitos',
  quality_requirement: 'Requisitos de calidad',
  threat_model: 'Modelos de amenazas',
  production_readiness: 'Preparación para producción',
  product_definition: 'Definición del producto',
};

/** TYPE_WORDS in the language given. */
export function typeWordFor(locale: Locale, type: RecordType): string {
  return locale === 'es' ? TYPE_WORDS_ES[type] : TYPE_WORDS[type];
}

/** TYPE_WORDS in the language shown now. */
export function useTypeWord(type: RecordType): string {
  return typeWordFor(useSafeLocale(), type);
}

/** TYPE_WORDS_PLURAL in the language given. */
export function typeWordPluralFor(locale: Locale, type: RecordType): string {
  return locale === 'es' ? TYPE_WORDS_PLURAL_ES[type] : TYPE_WORDS_PLURAL[type];
}

/** TYPE_WORDS_PLURAL in the language shown now. */
export function useTypeWordPlural(type: RecordType): string {
  return typeWordPluralFor(useSafeLocale(), type);
}

const FAILURE_WORDS_ES: Record<string, string> = {
  invalid_output: 'No pudo terminar: la salida no encajaba en el formato. No se cambió nada.',
  agent_error: 'El agente respondió con un error. No se cambió nada.',
  timeout: 'Tardó demasiado y se detuvo. No se cambió nada.',
  infra: 'DEMIURGO se reinició mientras se ejecutaba. No se cambió nada.',
  cancelled: 'Lo cancelaste. No se cambió nada.',
  stale_knowledge: 'El conocimiento cambió mientras se ejecutaba. No se cambió nada.',
};

/** failureWord in the language given. */
export function failureWordFor(locale: Locale, kind: string | null, state?: string): string {
  if (locale !== 'es') return failureWord(kind, state);
  if (state === 'interrupted') return 'DEMIURGO se reinició mientras se ejecutaba. No se cambió nada.';
  if (!kind) return 'Se detuvo sin decir por qué. No se cambió nada.';
  return FAILURE_WORDS_ES[kind] ?? 'Se detuvo con un error. No se cambió nada.';
}

/** failureWord in the language shown now. */
export function useFailureWord(kind: string | null, state?: string): string {
  return failureWordFor(useSafeLocale(), kind, state);
}

export const WHO_PHRASES_ES: Record<Who['kind'], string> = {
  you: 'Solo las personas confirman.',
  demiurgo: 'Redacta, pregunta y propone.',
  agent: 'Desde fuera. Solo propone.',
  automatic: 'Una regla o prueba que se ejecutó sola.',
};

/** WHO_PHRASES in the language given. */
export function whoPhraseFor(locale: Locale, kind: Who['kind']): string {
  return locale === 'es' ? WHO_PHRASES_ES[kind] : WHO_PHRASES[kind];
}

/** WHO_PHRASES in the language shown now. */
export function useWhoPhrase(kind: Who['kind']): string {
  return whoPhraseFor(useSafeLocale(), kind);
}

const WHO_KIND_WORDS_ES: Record<Who['kind'], string> = {
  you: 'Tú',
  demiurgo: 'DEMIURGO',
  agent: 'Agente',
  automatic: 'Automático',
};

/** whoName in the language given: the fixed word for the kind, or "Agent · <name>" translated. */
export function whoNameFor(locale: Locale, who: Who): string {
  // Matches whoName (components/Who.tsx) for English, without importing it back (it imports this file).
  if (locale !== 'es') return who.kind === 'agent' ? `Agent · ${who.name}` : who.name;
  if (who.kind === 'agent') return `${WHO_KIND_WORDS_ES.agent} · ${who.name}`;
  return WHO_KIND_WORDS_ES[who.kind];
}

/** whoName in the language shown now. */
export function useWhoName(who: Who): string {
  return whoNameFor(useSafeLocale(), who);
}

export const PRODUCT_WORDS_ES = {
  needsYou: 'Te necesita',
  nothingNeedsYou: 'Nada te necesita. Puedes cerrar DEMIURGO.',
  readyToBuild: 'Listo para construir',
  notReady: 'No está listo',
  notBuilt: 'no construido',
  catchingUp: 'DEMIURGO está poniéndose al día con tus últimos cambios. Inténtalo de nuevo en un momento.',
  cantReach: 'No se puede contactar con DEMIURGO. Reintentando…',
  onlyAPerson: 'Solo una persona puede hacer esto.',
  notAllowed: 'Esto no está permitido aquí.',
} as const;

/** PRODUCT_WORDS in the language given. */
export function productWordFor(locale: Locale, key: keyof typeof PRODUCT_WORDS): string {
  return locale === 'es' ? PRODUCT_WORDS_ES[key] : PRODUCT_WORDS[key];
}

/** PRODUCT_WORDS in the language shown now. */
export function useProductWord(key: keyof typeof PRODUCT_WORDS): string {
  return productWordFor(useSafeLocale(), key);
}
