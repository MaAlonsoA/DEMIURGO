// One way to count and say a thread's questions, so Needs you, the Product card and the thread
// header agree: the ones the person sees now (shown, not yet answered) and the ones DEMIURGO keeps
// in reserve for later (they appear as the visible ones are answered). Pure.
//
// The thread header (screens/thread/Thread.tsx, Aside.tsx) should call `questionCounts` with its
// questions and show `questionCountText`, instead of counting open questions its own way.

export type CountableQuestion = { state: string; shown_at?: string | null };

/** The states that still wait for the person: pending, parked (postponed) and assumed (inferred). */
const OPEN_STATES = new Set(['pending', 'postponed', 'inferred']);

export type QuestionCounts = { now: number; later: number };

export function questionCounts(questions: readonly CountableQuestion[]): QuestionCounts {
  let now = 0;
  let later = 0;
  for (const q of questions) {
    if (!OPEN_STATES.has(q.state)) continue;
    if (q.shown_at) now += 1;
    else later += 1;
  }
  return { now, later };
}

/** «2 questions now · 2 more later», «2 questions now», «2 more questions later» or «No open questions». */
export function questionCountText({ now, later }: QuestionCounts): string {
  const noun = (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`;
  if (now > 0 && later > 0) return `${noun(now)} now · ${later} more later`;
  if (now > 0) return `${noun(now)} now`;
  if (later > 0) return `${later} more ${later === 1 ? 'question' : 'questions'} later`;
  return 'No open questions';
}

export function questionCountTextEs({ now, later }: QuestionCounts): string {
  const noun = (n: number) => `${n} ${n === 1 ? 'pregunta' : 'preguntas'}`;
  if (now > 0 && later > 0) return `${noun(now)} ahora · ${later} más después`;
  if (now > 0) return `${noun(now)} ahora`;
  if (later > 0) return `${later} ${later === 1 ? 'pregunta más' : 'preguntas más'} después`;
  return 'Ninguna pregunta abierta';
}
