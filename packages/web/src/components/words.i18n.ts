// The words of the shared components (DESIGN.md §6.6): dialogs, notices, fields, the preview
// sheet, question actions, the side panel's separator and the readiness meter. Screen-specific
// catalogs live next to their own screen; this file holds only what the kit itself says.

import { messages } from '../i18n/define.ts';

/** Dialog.tsx: the defaults every dialog falls back to. */
export const DIALOG = messages(
  {
    close: 'Close',
    notNow: 'Not now',
    working: 'Working…',
    writeSomething: 'Write something to continue.',
  },
  {
    close: 'Cerrar',
    notNow: 'Ahora no',
    working: 'Trabajando…',
    writeSomething: 'Escribe algo para continuar.',
  },
);

/** Field.tsx: the optional marker next to a label. */
export const PAGE = messages({ breadcrumb: 'Breadcrumb' }, { breadcrumb: 'Ruta de navegación' });

export const FIELD = messages({ optional: ' · optional' }, { optional: ' · opcional' });

/** Meter.tsx: the readiness word and phrase of each stage. */
export const METER = messages(
  {
    stageWord: (stage: 'ready' | 'not-ready' | 'doubt', blocking?: number) =>
      stage === 'not-ready' && blocking ? `Not ready · ${blocking} ${blocking === 1 ? 'thing' : 'things'}` : STAGE_WORD_EN[stage],
    stagePhrase: (stage: 'ready' | 'not-ready' | 'doubt') => STAGE_PHRASE_EN[stage],
  },
  {
    stageWord: (stage: 'ready' | 'not-ready' | 'doubt', blocking?: number) =>
      stage === 'not-ready' && blocking ? `No listo · ${blocking} ${blocking === 1 ? 'cosa' : 'cosas'}` : STAGE_WORD_ES[stage],
    stagePhrase: (stage: 'ready' | 'not-ready' | 'doubt') => STAGE_PHRASE_ES[stage],
  },
);

const STAGE_WORD_EN: Record<'ready' | 'not-ready' | 'doubt', string> = {
  ready: 'Ready to build',
  'not-ready': 'Not ready',
  doubt: 'In doubt',
};
const STAGE_PHRASE_EN: Record<'ready' | 'not-ready' | 'doubt', string> = {
  ready: 'Confirmed, nothing blocks it. Not built yet.',
  'not-ready': 'Something still blocks it. Not built.',
  doubt: 'It was ready to build, and now something blocks it.',
};
const STAGE_WORD_ES: Record<'ready' | 'not-ready' | 'doubt', string> = {
  ready: 'Listo para construir',
  'not-ready': 'No listo',
  doubt: 'En duda',
};
const STAGE_PHRASE_ES: Record<'ready' | 'not-ready' | 'doubt', string> = {
  ready: 'Confirmado, nada lo bloquea. Aún no está construido.',
  'not-ready': 'Algo todavía lo bloquea. No está construido.',
  doubt: 'Estaba listo para construir, y ahora algo lo bloquea.',
};

/** Notice.tsx: the ErrorNotice actions and the Spanish lead sentence per error type. */
export const NOTICE = messages(
  {
    retry: 'Retry',
    openModels: 'Open Models & providers',
    leadFor: (_type: string | null) => '',
  },
  {
    retry: 'Reintentar',
    openModels: 'Abrir Modelos y proveedores',
    leadFor: (type: string | null) => {
      switch (type) {
        case 'unauthenticated':
          return 'Tu sesión terminó.';
        case 'forbidden':
          return 'Esto no está permitido aquí.';
        case 'not_found':
          return 'No lo hemos encontrado.';
        case 'invalid_transition':
          return 'No se puede hacer ahora mismo.';
        case 'guard':
          return 'No se cumplen las condiciones.';
        case 'conflict':
          return 'Hay un conflicto.';
        case 'validation':
          return 'Algo de lo que escribiste necesita un cambio.';
        case 'not_implemented':
          return 'Todavía no está disponible.';
        default:
          return 'Algo ha fallado en nuestro lado.';
      }
    },
  },
);

/** Preview.tsx: the side sheet's own words. */
export const PREVIEW = messages(
  { label: 'Preview', closePreview: 'Close the preview' },
  { label: 'Vista previa', closePreview: 'Cerrar la vista previa' },
);

/** QuestionActions.tsx: every dialog and button of a question's actions. */
export const QUESTION_ACTIONS = messages(
  {
    confirmTitle: 'Confirm this answer?',
    confirmAssumedBy: 'DEMIURGO assumed it. Confirming makes it your answer.',
    confirm: 'Confirm',
    confirming: 'Confirming…',
    answerTitle: 'Answer the question',
    yourAnswer: 'Your answer',
    answer: 'Answer',
    answering: 'Answering…',
    answered: 'Answered.',
    answerConfirmed: 'Answer confirmed.',
    changeTitle: 'Change the assumed answer',
    confirmMyAnswer: 'Confirm my answer',
    yourAnswerConfirmed: 'Your answer is confirmed.',
    change: 'Change',
    parkTitle: 'Park this question',
    parkDescription: 'It stays open for later, and it keeps blocking what depends on it. Say why.',
    reason: 'Reason',
    park: 'Park',
    parking: 'Parking…',
    parked: 'Question parked.',
    dropTitle: 'Drop this question',
    dropDescription: "It doesn't apply. It stays in its thread, marked as dropped. Say why.",
    drop: 'Drop',
    dropping: 'Dropping…',
    dropped: 'Question dropped.',
    reopenTitle: 'Reopen this question',
    reopenDescription: 'Its history is kept. The answer has to be given again.',
    reopen: 'Reopen',
    reopening: 'Reopening…',
    reopened: 'Question reopened.',
    parkMenu: 'Park…',
    dropMenu: 'Drop…',
    reopenMenu: 'Reopen…',
    questionActions: 'Question actions',
    moreActions: 'More actions for this question',
    answerLabel: 'Answer: ',
    assumedLabel: 'Assumed: ',
    whyLabel: 'Why: ',
    reasonLabel: 'Reason: ',
  },
  {
    confirmTitle: '¿Confirmar esta respuesta?',
    confirmAssumedBy: 'DEMIURGO lo supuso. Confirmarlo lo convierte en tu respuesta.',
    confirm: 'Confirmar',
    confirming: 'Confirmando…',
    answerTitle: 'Responde a la pregunta',
    yourAnswer: 'Tu respuesta',
    answer: 'Responder',
    answering: 'Respondiendo…',
    answered: 'Respondida.',
    answerConfirmed: 'Respuesta confirmada.',
    changeTitle: 'Cambia la respuesta supuesta',
    confirmMyAnswer: 'Confirmar mi respuesta',
    yourAnswerConfirmed: 'Tu respuesta está confirmada.',
    change: 'Cambiar',
    parkTitle: 'Aparca esta pregunta',
    parkDescription: 'Sigue abierta para más tarde, y sigue bloqueando lo que depende de ella. Di por qué.',
    reason: 'Motivo',
    park: 'Aparcar',
    parking: 'Aparcando…',
    parked: 'Pregunta aparcada.',
    dropTitle: 'Descarta esta pregunta',
    dropDescription: 'No aplica. Se queda en su hilo, marcada como descartada. Di por qué.',
    drop: 'Descartar',
    dropping: 'Descartando…',
    dropped: 'Pregunta descartada.',
    reopenTitle: 'Reabre esta pregunta',
    reopenDescription: 'Se conserva su historial. Hay que darle respuesta de nuevo.',
    reopen: 'Reabrir',
    reopening: 'Reabriendo…',
    reopened: 'Pregunta reabierta.',
    parkMenu: 'Aparcar…',
    dropMenu: 'Descartar…',
    reopenMenu: 'Reabrir…',
    questionActions: 'Acciones de la pregunta',
    moreActions: 'Más acciones para esta pregunta',
    answerLabel: 'Respuesta: ',
    assumedLabel: 'Supuesto: ',
    whyLabel: 'Por qué: ',
    reasonLabel: 'Motivo: ',
  },
);

/** SidePanel.tsx: the resizable separator's accessible name and value text. */
export const SIDE_PANEL = messages(
  {
    resize: (label: string) => `Resize ${label}`,
    pixelsWide: (width: number) => `${width} pixels wide`,
  },
  {
    resize: (label: string) => `Cambiar el ancho de ${label}`,
    pixelsWide: (width: number) => `${width} píxeles de ancho`,
  },
);

/** AskBox.tsx: "Ask DEMIURGO about this" (§3.5, §3.6). */
export const ASK_BOX = messages(
  {
    ask: 'Ask',
    sending: 'Sending…',
    enterHint: 'Enter asks · Shift Enter for a new line',
    sentTo: (where: string) => `Sent to ${where} · DEMIURGO is answering…`,
    answeredIn: (where: string) => `DEMIURGO answered in ${where} · `,
    couldntAnswer: (where: string) => `DEMIURGO couldn't answer: ${where}`,
    openThread: 'Open the thread',
  },
  {
    ask: 'Preguntar',
    sending: 'Enviando…',
    enterHint: 'Intro pregunta · Mayús Intro para una nueva línea',
    sentTo: (where: string) => `Enviado a ${where} · DEMIURGO está respondiendo…`,
    answeredIn: (where: string) => `DEMIURGO respondió en ${where} · `,
    couldntAnswer: (where: string) => `DEMIURGO no pudo responder: ${where}`,
    openThread: 'Abrir el hilo',
  },
);
