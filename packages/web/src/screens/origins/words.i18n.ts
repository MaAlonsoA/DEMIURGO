// Interface words of the origins tree: the page chrome, column headers, cards and the "Why does
// this exist?" panel. The sentence built by whyOf (tree.ts) stays in English: it is a heavily
// tested pure helper that assembles many combinations of segments and is too deeply woven into its
// generation logic to translate safely here (see the report).

import { messages } from '../../i18n/define.ts';

export const ORIGINS = messages(
  {
    you: 'you',
    pageTitle: 'Origins',
    product: 'Product',
    meta: 'Where each decision, feature and tech decision comes from, and why it exists.',
    loading: 'Loading the origins',
    nothingHereYet: 'Nothing here yet',
    nothingHereBody: 'Threads, decisions and designs appear here as they are created.',
    headerStart: 'Where it started',
    headerDecisions: 'Decisions',
    headerFeatures: 'Features and other records',
    readingLinks: (loaded: number, total: number) => `Reading the links of ${loaded} of ${total} records…`,
    linksNotRead: (n: number) => `The links of ${n} ${n === 1 ? 'record' : 'records'} couldn't be read`,
    retry: 'Retry',
    shownWithout: (n: number) => `${n === 1 ? 'is' : 'are'} shown without where ${n === 1 ? 'it comes' : 'they come'} from`,
    origins: 'Origins',
    notFromThread: 'Not from a thread',
    doesntComeFromConversation: "What follows doesn't come from a conversation.",
    thread: 'Thread',
    insideThread: ' · inside a thread',
    linksCouldntBeRead: "Its links couldn't be read",
    inDoubt: 'In doubt',
    whyDoesThisExist: 'Why does this exist?',
    openThread: 'Open the thread',
    openThe: (typeWord: string) => `Open the ${typeWord}`,
    clearTrace: 'Clear trace',
    noConclusionOrNote: 'No thread conclusion or change note says why yet.',
    selectToTrace:
      'Select a thread, a decision or a feature to trace where it comes from and why it exists. Esc clears the trace.',
  },
  {
    you: 'ti',
    pageTitle: 'Orígenes',
    product: 'Producto',
    meta: 'De dónde viene cada decisión, funcionalidad y decisión técnica, y por qué existe.',
    loading: 'Cargando los orígenes',
    nothingHereYet: 'Aún no hay nada aquí',
    nothingHereBody: 'Los hilos, decisiones y diseños aparecen aquí según se crean.',
    headerStart: 'Dónde empezó',
    headerDecisions: 'Decisiones',
    headerFeatures: 'Funcionalidades y otros registros',
    readingLinks: (loaded: number, total: number) => `Leyendo los enlaces de ${loaded} de ${total} registros…`,
    linksNotRead: (n: number) =>
      `No se ${n === 1 ? 'pudo' : 'pudieron'} leer los enlaces de ${n} ${n === 1 ? 'registro' : 'registros'}`,
    retry: 'Reintentar',
    shownWithout: (n: number) => `se ${n === 1 ? 'muestra' : 'muestran'} sin saber de dónde ${n === 1 ? 'viene' : 'vienen'}`,
    origins: 'Orígenes',
    notFromThread: 'No viene de un hilo',
    doesntComeFromConversation: 'Lo que sigue no viene de una conversación.',
    thread: 'Hilo',
    insideThread: ' · dentro de un hilo',
    linksCouldntBeRead: 'No se pudieron leer sus enlaces',
    inDoubt: 'En duda',
    whyDoesThisExist: '¿Por qué existe esto?',
    openThread: 'Abrir el hilo',
    openThe: (typeWord: string) => `Abrir ${typeWord}`,
    clearTrace: 'Borrar el rastro',
    noConclusionOrNote: 'Ninguna conclusión del hilo ni nota de cambio dice aún por qué.',
    selectToTrace:
      'Elige un hilo, una decisión o una funcionalidad para rastrear de dónde viene y por qué existe. Esc borra el rastro.',
  },
);
