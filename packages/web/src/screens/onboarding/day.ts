// Pure logic of Day 1 (canvas step 4, adapted to H1): the idea becomes a project and its first
// thread, DEMIURGO reads it in an exploration_chat run, the person answers its questions one at a
// time and asks it to propose decisions. Everything here is derived from the thread, its runs and
// their batches: H1 has no entities for the product's purpose, users, rules or features (S6).

import type { BatchDetail, Message, Question, RunListItem } from '../../api/types.ts';
import { shortDate } from '../../lib/time.ts';
import { proposalTitle } from '../batch/model.ts';

/** What exploration.open and message.post accept. */
export const PURPOSE_MAX = 1000;
export const MESSAGE_MAX = 20_000;

export type IdeaExample = { label: string; name: string; idea: string };

/** The examples of "What do you want to build?" (canvas S4A): each fills the idea and a name. */
export const IDEA_EXAMPLES: IdeaExample[] = [
  {
    label: 'Activities for my association',
    name: 'Club Activities',
    idea: "We want an app to publish our association's activities and let members sign up. Organizers post trips, workshops and meetings, and they need to know who is coming.",
  },
  {
    label: 'Bookings for a small studio',
    name: 'Studio Bookings',
    idea: 'We run a small yoga studio and people should be able to book a place in a class online. Teachers publish their weekly classes, and we need to see who booked and close a class when it is full.',
  },
  {
    label: 'A simple game in Python',
    name: 'Word Game',
    idea: 'A simple word-guessing game in Python that runs in the terminal. The player guesses a hidden word letter by letter with a limited number of tries, and sees the score at the end.',
  },
];

/** The thread's purpose: the idea, trimmed to what a thread accepts. */
export function purposeOf(idea: string): string {
  const clean = idea.trim();
  return clean.length > PURPOSE_MAX ? `${clean.slice(0, PURPOSE_MAX - 1).trimEnd()}…` : clean;
}

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : 0);
const byTime = <T extends { created_at: string }>(a: T, b: T) => time(a.created_at) - time(b.created_at);
const isPerson = (m: Pick<Message, 'author'>) => m.author.startsWith('human:');

/** The person's messages in the thread, oldest first: the first one is the idea. */
export function personMessages(messages: readonly Message[]): Message[] {
  return messages.filter(isPerson).sort(byTime);
}

export type ReadingPhase = 'catching_up' | 'waiting' | 'working' | 'failed' | 'cancelled' | 'read' | 'unanswered';
export type Reading = { phase: ReadingPhase; run: RunListItem | null };

const isChat = (r: RunListItem) => r.action === 'exploration_chat';

/** A run followed through its retries, to the last one. */
function latestRetry(runs: readonly RunListItem[], first: RunListItem): RunListItem {
  let current = first;
  for (;;) {
    const next = runs.find((r) => r.retry_of === current.id);
    if (!next) return current;
    current = next;
  }
}

/** The run that answers a message: the first conversation requested after it, through its retries. */
export function answerOf(runs: readonly RunListItem[], at: string): RunListItem | null {
  const first = runs.filter((r) => isChat(r) && !r.retry_of && time(r.created_at) >= time(at)).sort(byTime)[0];
  return first ? latestRetry(runs, first) : null;
}

/**
 * Where the reading of a message stands, from what the server says about its answer: waiting for
 * knowledge (catching up) or requested (the run it links to). Abandoned, or never asked for, it is
 * answered by the first conversation requested after it, if any. Never from the clock.
 */
export function readingOf(
  runs: readonly RunListItem[],
  message: Pick<Message, 'created_at' | 'response' | 'response_run'> | undefined,
): Reading {
  if (!message) return { phase: 'unanswered', run: null };
  if (message.response === 'waiting') return { phase: 'catching_up', run: null };
  let run: RunListItem | null;
  if (message.response === 'requested') {
    const linked = runs.find((r) => r.id === message.response_run);
    if (!linked) return { phase: 'waiting', run: null };
    run = latestRetry(runs, linked);
  } else {
    run = answerOf(runs, message.created_at);
  }
  if (!run) return { phase: 'unanswered', run: null };
  switch (run.state) {
    case 'queued':
    case 'running':
      return { phase: 'working', run };
    case 'failed':
    case 'interrupted':
      return { phase: 'failed', run };
    case 'cancelled':
      return { phase: 'cancelled', run };
    default:
      return { phase: 'read', run };
  }
}

/** What a run wrote in the thread: its reply and its observations (claim, hypothesis, unknown). */
export function writtenBy(messages: readonly Message[], runId: string): { reply: Message | null; observations: Message[] } {
  const own = messages.filter((m) => m.run_id === runId).sort(byTime);
  return { reply: own.find((m) => !m.kind) ?? null, observations: own.filter((m) => m.kind) };
}

/** The original of a run: a retry answers what the run it retries answered. */
function rootOf(run: RunListItem, runs: readonly RunListItem[]): RunListItem {
  let current = run;
  for (let i = 0; current.retry_of && i < runs.length; i++) {
    const previous = runs.find((r) => r.id === current.retry_of);
    if (!previous) break;
    current = previous;
  }
  return current;
}

/** The person's message a run answers: the last one written before it was requested. */
export function promptOf(run: RunListItem, messages: readonly Message[], runs: readonly RunListItem[]): Message | null {
  const requested = time(rootOf(run, runs).created_at);
  return (
    personMessages(messages)
      .filter((m) => time(m.created_at) <= requested)
      .at(-1) ?? null
  );
}

/**
 * DEMIURGO's readings of the idea, oldest first: the conversations that finished answering the idea
 * or a correction (the answer to "I decide:" is about decisions, not about the idea).
 */
export function readingsOf(messages: readonly Message[], runs: readonly RunListItem[]): RunListItem[] {
  return runs
    .filter((r) => {
      if (!isChat(r) || r.state !== 'completed') return false;
      const prompt = promptOf(r, messages, runs);
      return !prompt || !isDecisionRequest(prompt);
    })
    .sort(byTime);
}

/** What DEMIURGO understood of the idea: its last reading. */
export function understandingOf(messages: readonly Message[], runs: readonly RunListItem[]): RunListItem | null {
  return readingsOf(messages, runs).at(-1) ?? null;
}

/** The open questions, in the order DEMIURGO (or the person) asked them. */
export function pendingInOrder(questions: readonly Question[]): Question[] {
  return questions.filter((q) => q.state === 'pending').sort(byTime);
}

/** What happened to the questions walked one at a time: "You answered 1, skipped 1 and parked 1." */
export function walkSummary(walked: readonly Question[]): string {
  const answered = walked.filter((q) => q.state === 'confirmed').length;
  const skipped = walked.filter((q) => q.state === 'pending' || q.state === 'inferred').length;
  const parked = walked.filter((q) => q.state === 'postponed').length;
  const dropped = walked.filter((q) => q.state === 'discarded').length;
  const parts = [
    `answered ${answered}`,
    ...(skipped ? [`skipped ${skipped}`] : []),
    ...(parked ? [`parked ${parked}`] : []),
    ...(dropped ? [`dropped ${dropped}`] : []),
  ];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `You ${list}.`;
}

export type Answer = { question: string; conclusion: string };

/** The person's answers: the confirmed questions with their conclusion, in order. */
export function answersOf(questions: readonly Question[]): Answer[] {
  return questions
    .filter((q) => q.state === 'confirmed' && q.conclusion)
    .sort(byTime)
    .map((q) => ({ question: q.question, conclusion: q.conclusion ?? '' }));
}

export const DECIDE_PREFIX = 'I decide:';

const sentence = (t: string) => {
  const clean = t.trim();
  return /[.!?…]$/.test(clean) ? clean : `${clean}.`;
};

/**
 * The message that asks DEMIURGO to propose decisions from the answers. It starts with
 * "I decide:" so any agent (the simulated one included) reads it as the person deciding.
 */
export function decisionRequest(answers: readonly Answer[]): string {
  const head = `${DECIDE_PREFIX} ${answers.map((a) => sentence(a.conclusion)).join(' ')}`;
  const list = answers.map((a) => `- ${a.question.trim()} → ${sentence(a.conclusion)}`).join('\n');
  const text = `${head}\n\nMy answers to your questions:\n${list}\n\nPropose each one as a decision for me to review.`;
  return text.length > MESSAGE_MAX ? text.slice(0, MESSAGE_MAX) : text;
}

export function isDecisionRequest(m: Pick<Message, 'author' | 'body'>): boolean {
  return isPerson(m) && m.body.startsWith(DECIDE_PREFIX);
}

/** What each impact of a question means for the design. */
export const IMPACT_WORDS: Record<string, string> = {
  high: 'It shapes a lot of the design.',
  medium: 'It shapes part of the design.',
  low: 'It settles a detail.',
};

/** "Today" for something of today, its date otherwise. */
export function dayLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const n = new Date(now);
  const same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return same ? 'Today' : shortDate(iso);
}

export type WaitingDecision = { batchId: string; proposalId: string; title: string };

export type DaySummary = {
  day: string;
  minutes: number;
  answered: number;
  proposed: number;
  /** Decisions DEMIURGO proposed that wait for the person. */
  waiting: WaitingDecision[];
  /** Questions still open (or assumed by DEMIURGO): they wait for the person too. */
  open: Question[];
  parked: Question[];
};

/** The day in numbers (canvas S4E): from the thread's opening to its last activity. */
export function daySummary(p: {
  openedAt: string;
  messages: readonly Message[];
  questions: readonly Question[];
  runs: readonly RunListItem[];
  batches: readonly BatchDetail[];
  now?: number;
}): DaySummary {
  const last = Math.max(
    time(p.openedAt),
    ...p.messages.map((m) => time(m.created_at)),
    ...p.runs.map((r) => time(r.finished_at ?? r.created_at)),
  );
  const decisions = p.batches.flatMap((b) => b.proposals.filter((x) => x.type === 'decision').map((x) => ({ b, x })));
  return {
    day: dayLabel(p.openedAt, p.now),
    minutes: Math.max(1, Math.round((last - time(p.openedAt)) / 60_000)),
    answered: p.questions.filter((q) => q.state === 'confirmed').length,
    proposed: decisions.length,
    waiting: decisions
      .filter(({ x }) => x.state === 'pending')
      .map(({ b, x }) => ({ batchId: b.id, proposalId: x.id, title: proposalTitle(x) })),
    open: p.questions.filter((q) => q.state === 'pending' || q.state === 'inferred').sort(byTime),
    parked: p.questions.filter((q) => q.state === 'postponed').sort(byTime),
  };
}
