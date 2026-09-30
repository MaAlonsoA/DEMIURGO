// Typed message catalogs for the blueprint screen (the record's navigator, its History and
// Questions tabs, and the tab chrome around its sections). Record content itself — questions,
// answers, thread purposes — is never translated here: only the interface words around it.

import type { Aspect } from '../../aspects.ts';
import { ASPECT_WORDS } from '../../aspects.i18n.ts';
import { messages, type Translation } from '../../i18n/define.ts';

// --- History (history.ts): the events of a record's versions, "who · what · when". Tested with
// fixed English strings in test/unit/blueprint-history.test.ts, so historyLines() defaults its
// words parameter to HISTORY_LINES.en and keeps those tests passing unchanged. ---

const HISTORY_LINES_EN = {
  versionCreated: (n: number) => `Created v${n}`,
  versionApproved: (n: number) => `Approved v${n}`,
  versionSuperseded: (n: number) => `v${n} was replaced`,
  versionDiscarded: (n: number) => `Discarded v${n}`,
  linkNeedsReview: (n: number) => `A link of v${n} needs a review`,
  linkKept: (n: number) => `Kept a link of v${n}`,
  linkChanged: (n: number) => `Marked a link of v${n} as changed`,
  linkObsolete: (n: number) => `Marked a link of v${n} out of date`,
  fallback: (word: string, n: number) => `${word} · v${n}`,
};

export const HISTORY_LINES = messages(HISTORY_LINES_EN, {
  versionCreated: (n) => `Creó la v${n}`,
  versionApproved: (n) => `Aprobó la v${n}`,
  versionSuperseded: (n) => `Se reemplazó la v${n}`,
  versionDiscarded: (n) => `Descartó la v${n}`,
  linkNeedsReview: (n) => `Un enlace de la v${n} necesita revisión`,
  linkKept: (n) => `Mantuvo un enlace de la v${n}`,
  linkChanged: (n) => `Marcó un enlace de la v${n} como cambiado`,
  linkObsolete: (n) => `Marcó un enlace de la v${n} como caducado`,
  fallback: (word, n) => `${word} · v${n}`,
});

export type HistoryLinesWords = Translation<typeof HISTORY_LINES_EN>;

// --- HistoryTab.tsx chrome ---

export const HISTORY_TAB = messages(
  {
    whatHappened: 'What happened',
    loadingHistory: 'Loading the history',
    everyVersion: 'Every version',
    current: 'current',
    openVersion: (n: number) => `Open v${n}`,
    firstVersion: 'The first version.',
    noChangeNote: 'No change note.',
    writtenBy: 'Written by',
    approvedBy: 'Approved by',
    you: 'you',
  },
  {
    whatHappened: 'Qué ha pasado',
    loadingHistory: 'Cargando el historial',
    everyVersion: 'Todas las versiones',
    current: 'actual',
    openVersion: (n) => `Abrir v${n}`,
    firstVersion: 'La primera versión.',
    noChangeNote: 'Sin nota de cambio.',
    writtenBy: 'Escrita por',
    approvedBy: 'Aprobada por',
    you: 'ti',
  },
);

// --- Rail (rail.ts): the feature status word and the group titles (one per aspect). Tested with fixed
// English strings in test/unit/blueprint-rail.test.ts, so featureStatus()/navigatorOf() default
// their words parameter to RAIL.en and keep those tests passing unchanged. ---

const RAIL_EN = {
  needsYou: 'Needs you',
  readyToBuild: 'Ready to build',
  inDoubt: 'In doubt',
  draft: 'Draft',
  notReady: 'Not ready',
  planned: 'Planned',
  groupDefinition: 'Product definition',
  groupAspect: (a: Aspect): string => ASPECT_WORDS.en[a],
  groupNone: 'Without a tag',
};

export const RAIL = messages(RAIL_EN, {
  needsYou: 'Te necesita',
  readyToBuild: 'Lista para construir',
  inDoubt: 'En duda',
  draft: 'Borrador',
  notReady: 'No está lista',
  planned: 'Prevista',
  groupDefinition: 'Definición del producto',
  groupAspect: (a: Aspect): string => ASPECT_WORDS.es[a],
  groupNone: 'Sin etiqueta',
});

export type RailWords = Translation<typeof RAIL_EN>;

// --- Navigator.tsx chrome ---

export const NAVIGATOR = messages(
  {
    recordsNav: 'Records',
    showRecords: 'Show the records',
    allRecords: 'All records',
    theProduct: 'The product',
    hideRecords: 'Hide the records',
    newRecord: 'New record',
    loadingRecords: 'Loading the records',
    noFeaturesYet: 'No features yet.',
    rulesForWholeProduct: 'Rules for the whole product',
    later: 'Later',
    laterProductRules: 'Rules that every feature follows come in a later increment.',
    parkedIdeas: 'Parked ideas',
    setAside: 'Set aside',
  },
  {
    recordsNav: 'Registros',
    showRecords: 'Mostrar los registros',
    allRecords: 'Todos los registros',
    theProduct: 'El producto',
    hideRecords: 'Ocultar los registros',
    newRecord: 'Nuevo registro',
    loadingRecords: 'Cargando los registros',
    noFeaturesYet: 'Aún no hay funcionalidades.',
    rulesForWholeProduct: 'Reglas para todo el producto',
    later: 'Más adelante',
    laterProductRules: 'Las reglas que sigue toda funcionalidad llegan en un incremento posterior.',
    parkedIdeas: 'Ideas aparcadas',
    setAside: 'Aparcada',
  },
);

// --- Questions logic (questions.ts): whether a version's readiness cites a question, in the
// server's own reason text. Tested with fixed English strings in
// test/unit/blueprint-questions.test.ts, so readinessCitation() defaults its words parameter to
// QUESTIONS_LOGIC.en and keeps those tests passing unchanged. ---

const QUESTIONS_LOGIC_EN = {
  waitsOnQuestion: 'Yes. It waits on this question of its thread.',
  waitsOnAssumed: 'Yes. It waits until you confirm the answer DEMIURGO assumed.',
  notCited: "Its readiness doesn't cite it.",
};

export const QUESTIONS_LOGIC = messages(QUESTIONS_LOGIC_EN, {
  waitsOnQuestion: 'Sí. Espera a esta pregunta de su hilo.',
  waitsOnAssumed: 'Sí. Espera a que confirmes la respuesta que asumió DEMIURGO.',
  notCited: 'Su preparación no la cita.',
});

export type QuestionsLogicWords = Translation<typeof QUESTIONS_LOGIC_EN>;

// --- QuestionsTab.tsx chrome ---

const IMPACT_EN: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const IMPACT_ES: Record<string, string> = { high: 'Alto', medium: 'Medio', low: 'Bajo' };

export const QUESTIONS_TAB = messages(
  {
    confirmNowShows: (question: string) => `If you confirm now shows: ${question}`,
    talkInThread: 'Talk about it in the thread',
    inIfYouConfirm: 'In "If you confirm"',
    whyItMatters: 'Why it matters:',
    impact: 'Impact:',
    impactWord: (level: string) => IMPACT_EN[level] ?? level,
    impactLine: (level: string) => `${IMPACT_EN[level] ?? level} impact`,
    recommended: 'Recommended',
    why: 'Why:',
    assumedNotice: 'DEMIURGO assumed it. Nothing is confirmed until you say so.',
    noQuestionsTitle: 'No questions',
    noQuestionsBody: "This version doesn't come from a thread, so it has no questions.",
    loadingQuestions: 'Loading the questions',
    noOpenQuestionsTitle: 'No open questions',
    noOpenQuestionsBody: 'Nothing to answer here: no question of its thread is open.',
    answered: 'Answered',
    parked: 'Parked',
    dropped: 'Dropped',
    openThread: (purpose: string) => `Open the thread: ${purpose}`,
    ifYouConfirm: 'If you confirm',
    becomesConfirmedAnswer: 'It becomes the confirmed answer in its thread',
    theAnswerYouWrite: 'The answer you write.',
    itAffects: 'It affects',
    beforeItCanBeBuilt: 'Before it can be built',
    howWellKnowItWorks: "How we'll know it works",
    noChecksYet: 'This version has no acceptance criteria yet.',
    later: 'Later',
    laterDecision: 'Becomes a decision and adds acceptance criteria on its own (later increment). Today confirming only answers the question.',
  },
  {
    confirmNowShows: (question) => `Si confirmas ahora se muestra: ${question}`,
    talkInThread: 'Habla de ello en el hilo',
    inIfYouConfirm: 'En «Si confirmas»',
    whyItMatters: 'Por qué importa:',
    impact: 'Impacto:',
    impactWord: (level) => IMPACT_ES[level] ?? level,
    impactLine: (level) => `impacto ${(IMPACT_ES[level] ?? level).toLowerCase()}`,
    recommended: 'Recomendada',
    why: 'Por qué:',
    assumedNotice: 'DEMIURGO lo ha asumido. Nada está confirmado hasta que tú lo digas.',
    noQuestionsTitle: 'Sin preguntas',
    noQuestionsBody: 'Esta versión no viene de un hilo, así que no tiene preguntas.',
    loadingQuestions: 'Cargando las preguntas',
    noOpenQuestionsTitle: 'Sin preguntas abiertas',
    noOpenQuestionsBody: 'Nada que responder aquí: ninguna pregunta de su hilo está abierta.',
    answered: 'Respondidas',
    parked: 'Aparcadas',
    dropped: 'Descartadas',
    openThread: (purpose) => `Abrir el hilo: ${purpose}`,
    ifYouConfirm: 'Si confirmas',
    becomesConfirmedAnswer: 'Se convierte en la respuesta confirmada de su hilo',
    theAnswerYouWrite: 'La respuesta que escribas.',
    itAffects: 'Afecta a',
    beforeItCanBeBuilt: 'Antes de poder construirse',
    howWellKnowItWorks: 'Cómo sabremos que funciona',
    noChecksYet: 'Esta versión aún no tiene criterios de aceptación.',
    later: 'Más adelante',
    laterDecision:
      'Se convierte en una decisión y añade criterios de aceptación por su cuenta (incremento posterior). Hoy confirmar solo responde la pregunta.',
  },
);

// --- Sections.tsx chrome: the record's section tabs. ---

export const SECTIONS = messages(
  {
    recordSectionsLabel: 'Record sections',
    tabOverview: 'Overview',
    tabQuestions: 'Questions',
    tabChecks: 'Acceptance criteria',
    tabScreens: 'Screens',
    tabTasks: 'Tasks',
    tabHistory: 'History',
  },
  {
    recordSectionsLabel: 'Secciones del registro',
    tabOverview: 'Resumen',
    tabQuestions: 'Preguntas',
    tabChecks: 'Criterios de aceptación',
    tabScreens: 'Pantallas',
    tabTasks: 'Tareas',
    tabHistory: 'Historial',
  },
);
