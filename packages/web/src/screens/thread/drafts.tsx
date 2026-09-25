// Drafts of a thread (DESIGN.md §3.3, INV-THR-37…41): the answers the person picked or wrote and
// their choices on the threads DEMIURGO suggests, kept in this browser until "Confirm and send"
// settles them together — nothing reaches DEMIURGO before that. Every item is sent on its own and
// gets its own result, so a partial send says what went and what stayed (INVENTORY Part C). With
// nothing left to answer, DEMIURGO is asked to read the answers and go on.

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { runCommand } from '../../api/commands.ts';
import { keys } from '../../api/queries.ts';
import type { ExplorationDetail } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { MAX_ANSWER, isOpenQuestion, isShown } from './answers.ts';

export type ForkChoice = 'explore' | 'keep';

/** What the person chose in the thread and has not sent yet. */
export type Drafts = {
  answers: Readonly<Record<string, string>>;
  forks: Readonly<Record<string, ForkChoice>>;
  setAnswer: (questionId: string, text: string | null) => void;
  setFork: (proposalId: string, choice: ForkChoice | null) => void;
  clear: () => void;
  /** Drops drafts that can no longer be sent: questions settled elsewhere, suggestions resolved. */
  prune: (keepAnswer: (questionId: string) => boolean, keepFork: (proposalId: string) => boolean) => void;
};

const DraftsContext = createContext<Drafts | null>(null);
export const DraftsProvider = DraftsContext.Provider;
export const useDrafts = (): Drafts | null => useContext(DraftsContext);

type Stored = { answers: Record<string, string>; forks: Record<string, ForkChoice> };
const storageKey = (thread: string) => `dm-thread-drafts:${thread}`;

function load(thread: string): Stored {
  try {
    const raw = window.localStorage.getItem(storageKey(thread));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored>;
      return { answers: parsed.answers ?? {}, forks: parsed.forks ?? {} };
    }
  } catch {
    // Drafts kept across reloads are a convenience: without storage they last for this visit.
  }
  return { answers: {}, forks: {} };
}

function save(thread: string, s: Stored): void {
  try {
    if (Object.keys(s.answers).length === 0 && Object.keys(s.forks).length === 0)
      window.localStorage.removeItem(storageKey(thread));
    else window.localStorage.setItem(storageKey(thread), JSON.stringify(s));
  } catch {
    // As above: storage may be unavailable.
  }
}

/** The drafts of one thread. Another tab of the same browser that changes them is followed. */
export function useDraftsState(threadId: string): Drafts {
  const [stored, setStored] = useState(() => load(threadId));

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey(threadId)) setStored(load(threadId));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [threadId]);

  const change = useCallback(
    (f: (s: Stored) => Stored) =>
      setStored((s) => {
        const next = f(s);
        if (next === s) return s;
        save(threadId, next);
        return next;
      }),
    [threadId],
  );

  return useMemo<Drafts>(
    () => ({
      answers: stored.answers,
      forks: stored.forks,
      setAnswer: (id, text) =>
        change((s) => {
          const answers = { ...s.answers };
          const clean = text?.trim().slice(0, MAX_ANSWER);
          if (clean) answers[id] = clean;
          else delete answers[id];
          return { ...s, answers };
        }),
      setFork: (id, choice) =>
        change((s) => {
          const forks = { ...s.forks };
          if (choice) forks[id] = choice;
          else delete forks[id];
          return { ...s, forks };
        }),
      clear: () => change(() => ({ answers: {}, forks: {} })),
      prune: (keepAnswer, keepFork) =>
        change((s) => {
          const answers = Object.fromEntries(Object.entries(s.answers).filter(([id]) => keepAnswer(id)));
          const forks = Object.fromEntries(Object.entries(s.forks).filter(([id]) => keepFork(id))) as Stored['forks'];
          const same =
            Object.keys(answers).length === Object.keys(s.answers).length &&
            Object.keys(forks).length === Object.keys(s.forks).length;
          return same ? s : { answers, forks };
        }),
    }),
    [stored, change],
  );
}

export type SendItem = {
  key: string;
  kind: 'answer' | 'fork' | 'go-on';
  label: string;
  state: 'sent' | 'failed';
  error?: unknown;
};

/** What the drafts bar counts and does. `forkStates` holds the known state of each suggested thread. */
export function useSendDrafts(
  projectId: string,
  thread: ExplorationDetail,
  drafts: Drafts,
  forkStates: ReadonlyMap<string, { purpose: string; state: string }>,
) {
  const client = useQueryClient();
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendItem[] | null>(null);
  const openShown = thread.questions.filter((q) => isOpenQuestion(q) && isShown(q));
  const answers = openShown.filter((q) => drafts.answers[q.id]);
  const forks = Object.entries(drafts.forks).filter(([id]) => (forkStates.get(id)?.state ?? 'pending') === 'pending');

  const send = async (): Promise<boolean> => {
    if (sending || answers.length + forks.length === 0) return false;
    setSending(true);
    setResults(null);
    const out: SendItem[] = [];
    try {
      for (const q of answers) {
        try {
          await runCommand(projectId, {
            command: 'question.confirm',
            entityId: q.id,
            data: { conclusion: drafts.answers[q.id] },
          });
          drafts.setAnswer(q.id, null);
          out.push({ key: q.id, kind: 'answer', label: q.question, state: 'sent' });
        } catch (error) {
          out.push({ key: q.id, kind: 'answer', label: q.question, state: 'failed', error });
        }
      }
      for (const [id, choice] of forks) {
        const label = `${choice === 'explore' ? 'Explore separately' : 'Keep it here'}: «${forkStates.get(id)?.purpose ?? 'a suggested thread'}»`;
        try {
          await runCommand(
            projectId,
            choice === 'explore'
              ? { command: 'proposal.accept', entityId: id, data: {} }
              : { command: 'proposal.reject', entityId: id, data: { reason: 'Kept in this thread.' } },
          );
          drafts.setFork(id, null);
          out.push({ key: id, kind: 'fork', label, state: 'sent' });
        } catch (error) {
          // Already resolved elsewhere (409): the choice has nothing left to do.
          if (error instanceof ApiError && error.status === 409) {
            drafts.setFork(id, null);
            out.push({ key: id, kind: 'fork', label, state: 'sent' });
          } else out.push({ key: id, kind: 'fork', label, state: 'failed', error });
        }
      }
      const answered = new Set(out.filter((r) => r.kind === 'answer' && r.state === 'sent').map((r) => r.key));
      const left = thread.questions.filter((q) => isOpenQuestion(q) && !answered.has(q.id)).length;
      if (answered.size > 0 && left === 0) {
        try {
          await runCommand(projectId, {
            command: 'run.request',
            data: { action: 'exploration_chat', scope: { type: 'exploration', id: thread.id } },
          });
          out.push({ key: 'go-on', kind: 'go-on', label: 'DEMIURGO reads your answers and goes on', state: 'sent' });
        } catch (error) {
          out.push({ key: 'go-on', kind: 'go-on', label: 'DEMIURGO reads your answers and goes on', state: 'failed', error });
        }
      }
    } finally {
      await client.invalidateQueries({ queryKey: keys.project(projectId) });
      setSending(false);
    }
    const failed = out.filter((r) => r.state === 'failed');
    const sent = out.filter((r) => r.state === 'sent' && r.kind !== 'go-on').length;
    setResults(failed.length > 0 ? out : null);
    if (failed.length === 0) {
      announce(`${sent === 1 ? '1 draft' : `${sent} drafts`} sent.${answered(out) ? ' DEMIURGO goes on.' : ''}`);
    } else {
      announce(`${sent} sent, ${failed.length} not sent. They stay as drafts.`);
    }
    return failed.length === 0;
  };

  return {
    answers: answers.length,
    openShown: openShown.length,
    forks: forks.length,
    send,
    sending,
    results,
    dismissResults: () => setResults(null),
  };
}

const answered = (items: readonly SendItem[]) => items.some((r) => r.kind === 'go-on' && r.state === 'sent');

export type SendDrafts = ReturnType<typeof useSendDrafts>;
