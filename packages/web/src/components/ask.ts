// "Ask DEMIURGO about this" (canvas B1, S5A; design doc §2): the conversation is a tool tied to
// what is on screen. Pure part: which thread a subject talks in, how a new one is opened, and how
// the answer goes from the thread and its runs.

import type { Exploration, ExplorationDetail, RecordType, RunListItem } from '../api/types.ts';
import type { Locale } from '../i18n/locale.ts';
import { TYPE_WORDS, failureWordFor, typeWordFor } from '../words.ts';

export type AskSubject =
  | { kind: 'product'; name: string }
  /** A record: the version on screen and every version of it (a thread born from any of them is its thread). */
  | {
      kind: 'record';
      type: RecordType;
      title: string;
      versionIds: readonly string[];
      versionId: string;
      /** The thread the record was worked out in (the product definition's stage): asking goes on there. */
      threadId?: string | null;
      /** The thread a new one hangs from: a feature's epic thread. */
      parentId?: string | null;
    };

export const PRODUCT_PURPOSE = 'About the whole product';

/** Whether a thread is where a feature of an epic is designed (`Design "Name" (EPC-…)`), not the epic's own. */
export const isFeatureThread = (purpose: string): boolean => purpose.startsWith('Design "');

type ThreadLike = Pick<Exploration, 'id' | 'purpose' | 'state' | 'origin_type' | 'origin_id' | 'last_activity'>;

/** The active thread of the subject, the most recent first; undefined when it has none yet. */
export function threadFor<T extends ThreadLike>(threads: readonly T[], subject: AskSubject): T | undefined {
  if (subject.kind === 'record' && subject.threadId) {
    const own = threads.find((t) => t.id === subject.threadId && t.state === 'active');
    if (own) return own;
  }
  const mine = threads.filter((t) => {
    if (t.state !== 'active') return false;
    if (subject.kind === 'record') {
      // A feature's thread is born from its epic's version too: asking about the epic goes to the epic's own.
      if (subject.type === 'epic' && isFeatureThread(t.purpose)) return false;
      return t.origin_type === 'record_version' && subject.versionIds.includes(t.origin_id ?? '');
    }
    return t.origin_type === null && t.purpose.startsWith(PRODUCT_PURPOSE);
  });
  return mine.sort((a, b) => Date.parse(b.last_activity) - Date.parse(a.last_activity))[0];
}

/** Data of exploration.open for the subject's first thread. */
export function openThreadData(subject: AskSubject): {
  purpose: string;
  parent_id?: string;
  origin?: { type: 'record_version'; id: string };
} {
  if (subject.kind === 'product') return { purpose: PRODUCT_PURPOSE };
  return {
    purpose: `About ${subject.title}`,
    ...(subject.parentId ? { parent_id: subject.parentId } : {}),
    origin: { type: 'record_version', id: subject.versionId },
  };
}

export function askPlaceholder(subject: AskSubject, locale: Locale = 'en'): string {
  if (locale === 'es') {
    if (subject.kind === 'product') return `Pregunta o cuenta a DEMIURGO lo que quieras sobre ${subject.name}`;
    return `Pregunta sobre esta ${typeWordFor('es', subject.type).toLowerCase()}, o sugiere un cambio…`;
  }
  if (subject.kind === 'product') return `Ask or tell DEMIURGO anything about ${subject.name}`;
  return `Ask about this ${TYPE_WORDS[subject.type].toLowerCase()}, or suggest a change…`;
}

/** The subject in a few words, for the field's label. */
export function subjectWords(subject: AskSubject, locale: Locale = 'en'): string {
  if (locale === 'es')
    return subject.kind === 'product' ? 'todo el producto' : `esta ${typeWordFor('es', subject.type).toLowerCase()}`;
  return subject.kind === 'product' ? 'the whole product' : `this ${TYPE_WORDS[subject.type].toLowerCase()}`;
}

export type AskProgress = { state: 'answering' } | { state: 'answered' } | { state: 'failed'; failure: string };

const FAILED = ['failed', 'interrupted', 'cancelled'];

/**
 * How the answer to a message goes: DEMIURGO answered when it wrote after the message or the run
 * that answers finished; it failed when that run stopped and nothing retries it; otherwise it is
 * answering (the response is durable: its run may not exist yet).
 */
export function askProgress(
  thread: Pick<ExplorationDetail, 'messages'> | undefined,
  runs: readonly RunListItem[] | undefined,
  messageId: string,
  locale: Locale = 'en',
): AskProgress {
  const mine = thread?.messages.find((m) => m.id === messageId);
  if (!mine) return { state: 'answering' };
  const since = Date.parse(mine.created_at);
  const reply = thread?.messages.some(
    (m) => m.id !== mine.id && m.author.startsWith('agent:run:') && Date.parse(m.created_at) >= since,
  );
  if (reply) return { state: 'answered' };
  const after = (runs ?? [])
    .filter((r) => r.action === 'exploration_chat' && Date.parse(r.created_at) >= since)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const last = after.at(-1);
  if (!last) return { state: 'answering' };
  if (last.state === 'completed') return { state: 'answered' };
  if (FAILED.includes(last.state)) return { state: 'failed', failure: failureWordFor(locale, last.failure_kind, last.state) };
  return { state: 'answering' };
}
