// Guided thread: DEMIURGO's questions live in the conversation as its messages, at most two open
// at a time (the rest wait in the reserve). Answering is replying: one click on an option (or
// several), or the person's own words. Answers and the choices on suggested threads are drafts the
// person can change freely until "Confirm and send" settles them together: nothing reaches
// DEMIURGO before that. "Go deeper" opens a side conversation about one question, and "Use as
// answer" drafts its answer in the main thread. When the thread has nothing left to answer,
// DEMIURGO reads the answers and goes on.

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import type { ExplorationDetail, Question, RunListItem, StageRow } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { useAllows } from '../../ui/ActionBar.tsx';
import { Button } from '../../ui/Button.tsx';
import { TypeIcon } from '../../ui/icons.tsx';
import { Markdown } from '../../ui/Markdown.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { readingOf } from '../onboarding/day.ts';

const OPEN = new Set(['pending', 'inferred']);
export const isOpenQuestion = (q: Question) => OPEN.has(q.state);
export const isShown = (q: Question) => !!q.shown_at;

/** The longest answer a question takes (question.confirm). */
const MAX_ANSWER = 3000;

export type ForkChoice = 'explore' | 'keep';

/** What the person chose in the thread and has not sent yet. */
export type Drafts = {
  answers: Record<string, string>;
  forks: Record<string, ForkChoice>;
  setAnswer: (questionId: string, text: string | null) => void;
  setFork: (proposalId: string, choice: ForkChoice | null) => void;
  clear: () => void;
};

const DraftsContext = createContext<Drafts | null>(null);
export const DraftsProvider = DraftsContext.Provider;
export const useDrafts = () => useContext(DraftsContext);

type Stored = { thread: string; answers: Record<string, string>; forks: Record<string, ForkChoice> };
const draftsKey = (thread: string) => `dm-thread-drafts:${thread}`;

function loadDrafts(thread: string): Stored {
  try {
    const raw = window.localStorage.getItem(draftsKey(thread));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored>;
      return { thread, answers: parsed.answers ?? {}, forks: parsed.forks ?? {} };
    }
  } catch {
    // Drafts kept across reloads are a convenience.
  }
  return { thread, answers: {}, forks: {} };
}

function storeDrafts(s: Stored) {
  try {
    if (Object.keys(s.answers).length === 0 && Object.keys(s.forks).length === 0)
      window.localStorage.removeItem(draftsKey(s.thread));
    else window.localStorage.setItem(draftsKey(s.thread), JSON.stringify({ answers: s.answers, forks: s.forks }));
  } catch {
    // Drafts kept across reloads are a convenience.
  }
}

/** The drafts of one thread, kept in this browser until they are sent. */
export function useDraftsState(threadId: string): Drafts {
  const [stored, setStored] = useState(() => loadDrafts(threadId));
  let current = stored;
  if (stored.thread !== threadId) {
    current = loadDrafts(threadId);
    setStored(current);
  }
  const change = (f: (s: Stored) => Stored) =>
    setStored((s) => {
      const next = f(s);
      storeDrafts(next);
      return next;
    });
  return {
    answers: current.answers,
    forks: current.forks,
    setAnswer: (id, text) =>
      change((s) => {
        const answers = { ...s.answers };
        if (text?.trim()) answers[id] = text.trim().slice(0, MAX_ANSWER);
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
    clear: () => change((s) => ({ ...s, answers: {}, forks: {} })),
  };
}

/**
 * Sends the drafts together: confirms each answer and resolves each suggested thread, one after
 * another; with nothing left to answer, asks DEMIURGO to read the answers and go on. A suggestion
 * already resolved elsewhere (409) is dropped from the drafts.
 */
export function useSendDrafts(projectId: string, thread: ExplorationDetail | undefined, drafts: Drafts) {
  const command = useCommand(projectId);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const answers = (thread?.questions ?? []).filter((q) => isOpenQuestion(q) && isShown(q) && drafts.answers[q.id]);
  const forks = Object.entries(drafts.forks);
  const openShown = (thread?.questions ?? []).filter((q) => isOpenQuestion(q) && isShown(q)).length;

  const send = async () => {
    if (!thread || sending || answers.length + forks.length === 0) return;
    setSending(true);
    setError(null);
    try {
      for (const q of answers) {
        await command.mutateAsync({ command: 'question.confirm', entityId: q.id, data: { conclusion: drafts.answers[q.id] } });
        drafts.setAnswer(q.id, null);
      }
      for (const [id, choice] of forks) {
        try {
          await command.mutateAsync(
            choice === 'explore'
              ? { command: 'proposal.accept', entityId: id, data: {} }
              : { command: 'proposal.reject', entityId: id, data: { reason: 'Kept in this thread.' } },
          );
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 409)) throw e;
        }
        drafts.setFork(id, null);
      }
      const left = thread.questions.filter((q) => isOpenQuestion(q) && !answers.some((a) => a.id === q.id)).length;
      if (answers.length > 0 && left === 0)
        await command.mutateAsync({
          command: 'run.request',
          data: { action: 'exploration_chat', scope: { type: 'exploration', id: thread.id } },
        });
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  };
  return { answers: answers.length, forks: forks.length, openShown, send, sending, error };
}

/** The bar above the composer while there are drafts: nothing is sent until the person confirms. */
export function SendDrafts({ state, onDiscard }: { state: ReturnType<typeof useSendDrafts>; onDiscard: () => void }) {
  const { answers, forks, openShown, send, sending, error } = state;
  if (answers + forks === 0 && !error) return null;
  const parts = [
    answers > 0 ? `${answers} of ${Math.max(openShown, answers)} ${openShown === 1 ? 'answer' : 'answers'}` : null,
    forks > 0 ? `${forks} thread ${forks === 1 ? 'choice' : 'choices'}` : null,
  ].filter(Boolean);
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-control border border-needs-line bg-needs-soft px-4 py-2.5">
      <div className="flex items-center gap-3">
        <p className="dm-text-small min-w-0 flex-1 text-ink">
          <span className="font-semibold">{parts.join(' and ')} ready.</span>{' '}
          <span className="text-ink-3">Nothing is sent until you confirm; you can still change them.</span>
        </p>
        <Button variant="text" disabled={sending} onClick={onDiscard}>
          Discard
        </Button>
        <Button variant="primary" disabled={sending || answers + forks === 0} onClick={() => void send()}>
          {sending ? 'Sending…' : 'Confirm and send'}
        </Button>
      </div>
      {error ? <Reasons error={error} /> : null}
    </div>
  );
}

/** A reply of DEMIURGO as plain text: without the marks of its markdown. */
const plain = (body: string) =>
  body
    .replace(/\*\*|__/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`/g, '')
    .trim();

/** The answer a multiple choice records: every option picked, in their order. */
const joined = (q: Question, picked: number[]) =>
  [...picked]
    .sort((a, b) => a - b)
    .map((k) => q.options?.[k]?.answer ?? '')
    .filter(Boolean)
    .join(' · ');

/** The options a draft picks: the one it names, or (multiple choice) every one it joins. */
const pickedOf = (q: Question, draft: string | undefined): number[] => {
  if (!draft) return [];
  const options = q.options ?? [];
  const parts = q.multiple ? draft.split(' · ') : [draft];
  return options.flatMap((o, k) => (parts.includes(o.answer) ? [k] : []));
};

/** Toggling an option: an exclusive one clears the others, and any other clears the exclusive ones. */
const toggled = (q: Question, picked: number[], k: number) => {
  const options = q.options ?? [];
  if (picked.includes(k)) return picked.filter((x) => x !== k);
  if (options[k]?.exclusive) return [k];
  return [...picked.filter((x) => !options[x]?.exclusive), k];
};

export function QuestionCard({
  thread,
  question: q,
  stageTitle,
  deeperOpen,
  deeperCount,
  onDeeper,
  onOwnWords,
}: {
  thread: ExplorationDetail;
  question: Question;
  stageTitle: string | null;
  deeperOpen: boolean;
  deeperCount: number;
  onDeeper: () => void;
  onOwnWords: () => void;
}) {
  const drafts = useDrafts();
  const allows = useAllows('question', q.state);
  if (!isOpenQuestion(q)) return <SettledQuestion question={q} />;
  const options = q.options ?? [];
  const inferred = q.state === 'inferred' && q.conclusion ? q.conclusion : null;
  const canAnswer = !!drafts && allows('question.confirm') && thread.state === 'active';
  const draft = drafts?.answers[q.id];
  const picked = pickedOf(q, draft);
  const ownWords = !!draft && picked.length === 0 && draft !== inferred;
  const set = (text: string | null) => drafts?.setAnswer(q.id, text);

  return (
    <article
      data-question={q.id}
      data-draft={draft ? 'true' : undefined}
      className="flex max-w-[680px] flex-col gap-3 self-start rounded-card-md border-2 border-needs bg-surface px-4 py-3.5"
    >
      <header className="dm-label flex items-center gap-1.5">
        <TypeIcon kind="question" size={14} />
        Question{stageTitle ? ` · ${stageTitle}` : ''}
      </header>
      <h3 className="dm-text-heading leading-snug text-ink">{q.question}</h3>
      {q.reason && <p className="dm-text-small text-ink-3">Why it matters: {q.reason}</p>}
      {canAnswer && (inferred || options.length > 0) && (
        <div className={cn('grid gap-2', options.length === 4 || inferred ? 'grid-cols-2' : 'grid-cols-3')}>
          {inferred && (
            <Option
              answer={inferred}
              implies={q.reasoning ? `DEMIURGO inferred it: ${q.reasoning}` : 'DEMIURGO inferred it from the conversation.'}
              selected={draft === inferred}
              onClick={() => set(draft === inferred ? null : inferred)}
            />
          )}
          {options.map((o, k) => (
            <Option
              key={k}
              answer={o.answer}
              implies={o.implies}
              multiple={!!q.multiple}
              selected={picked.includes(k)}
              onClick={() => {
                if (q.multiple) set(joined(q, toggled(q, picked, k)) || null);
                else set(picked.includes(k) ? null : o.answer);
              }}
            />
          ))}
        </div>
      )}
      {canAnswer && q.multiple && options.length > 0 && picked.length === 0 && (
        <span className="dm-text-caption text-muted">Pick all that apply</span>
      )}
      {canAnswer && ownWords && (
        <p className="dm-text-small flex items-baseline gap-2 rounded-sm bg-surface-soft px-3 py-2 text-ink">
          <span className="line-clamp-4 min-w-0 flex-1 whitespace-pre-wrap" title={draft}>
            <span className="text-ink-3">Your answer: </span>
            {draft}
          </span>
          <Button variant="text" className="shrink-0" onClick={() => set(null)}>
            Clear
          </Button>
        </p>
      )}
      {canAnswer && (
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="text" onClick={onDeeper} className={cn(deeperOpen && 'bg-needs-tint')}>
            {deeperOpen ? 'Going deeper' : 'Go deeper →'}
            {deeperCount > 0 && !deeperOpen ? ` · ${deeperCount}` : ''}
          </Button>
          <Button variant="text" onClick={onOwnWords}>
            Answer in my own words
          </Button>
          {draft && <span className="dm-text-caption ml-auto text-muted">Not sent yet</span>}
        </div>
      )}
    </article>
  );
}

function Option({
  answer,
  implies,
  multiple = false,
  selected = false,
  onClick,
}: {
  answer: string;
  implies: string;
  multiple?: boolean;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex flex-col gap-0.5 rounded-card-md border bg-surface px-3 py-2.5 text-left hover:border-needs',
        selected ? 'border-2 border-needs bg-needs-soft' : 'border-line',
      )}
    >
      <span className="dm-text-small flex items-center gap-2 font-semibold text-ink">
        {multiple && (
          <span
            aria-hidden="true"
            className={cn('size-3 shrink-0 rounded-tag border', selected ? 'border-needs bg-needs' : 'border-line-strong')}
          />
        )}
        {answer}
      </span>
      <span className="dm-text-caption text-muted">{implies}</span>
    </button>
  );
}

/** A question already settled: what was asked and what the person answered, quiet. */
function SettledQuestion({ question: q }: { question: Question }) {
  const word = q.state === 'postponed' ? 'Parked' : q.state === 'discarded' ? 'Dropped' : null;
  return (
    <div
      data-question={q.id}
      data-state={q.state}
      className="dm-text-small flex max-w-[680px] items-start gap-2.5 self-start rounded-sm border border-line-soft bg-surface-soft px-3 py-2"
    >
      <span aria-hidden="true" className={cn('mt-1.5 size-2 shrink-0 rounded-pill', word ? 'bg-inactive' : 'bg-ink')} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-ink-3">{q.question}</span>
        <span className="line-clamp-3 font-semibold text-ink" title={q.conclusion ?? undefined}>
          {word ?? q.conclusion}
        </span>
      </span>
    </div>
  );
}

/**
 * The side conversation about one question, and settling it with an option, one's own words or a
 * reply of DEMIURGO (to trim first). Settling it drafts the answer in the main thread.
 */
export function DeeperPanel({
  projectId,
  thread,
  question: q,
  runs,
  onClose,
}: {
  projectId: string;
  thread: ExplorationDetail;
  question: Question;
  runs: RunListItem[];
  onClose: () => void;
}) {
  const command = useCommand(projectId);
  const drafts = useDrafts();
  const draft = drafts?.answers[q.id];
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<number[]>(() => pickedOf(q, draft));
  const [own, setOwn] = useState<string | null>(() => (draft && pickedOf(q, draft).length === 0 ? draft : null));
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const messages = thread.messages.filter((m) => m.question_id === q.id);
  // DEMIURGO is writing while the run that answers the last message of the person has not ended.
  const lastAsked = messages.toReversed().find((m) => m.author.startsWith('human:'));
  const phase = lastAsked ? readingOf(runs, lastAsked).phase : 'read';
  const writing = phase === 'catching_up' || phase === 'waiting' || phase === 'working';
  const failed = phase === 'failed' || phase === 'cancelled';
  const scroller = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the bottom when the conversation grows
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length, writing]);
  const options = q.options ?? [];
  const conclusion = own !== null ? own.trim() : q.multiple ? joined(q, picked) : (options[picked[0] ?? -1]?.answer ?? '');
  const send = () => {
    if (!text.trim() || command.isPending) return;
    command.mutate(
      { command: 'message.post', data: { exploration_id: thread.id, question_id: q.id, text: text.trim(), respond: true } },
      { onSuccess: () => setText('') },
    );
  };
  const takeReply = (body: string) => {
    setOwn(plain(body).slice(0, MAX_ANSWER));
    requestAnimationFrame(() => ownRef.current?.focus());
  };

  return (
    <section aria-label="Going deeper" className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="dm-label">Going deeper</span>
          <Button variant="text" onClick={onClose} aria-label="Close and go back to the thread">
            Close
          </Button>
        </div>
        <h2 className="dm-text-heading text-ink">{q.question}</h2>
        <span className="dm-text-caption text-muted">The main thread waits here. Nothing is lost.</span>
      </div>
      <div ref={scroller} className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
        {messages.length === 0 && !writing && (
          <p className="dm-text-small text-muted">
            Ask anything about this question: what each option means, examples, what others do.
          </p>
        )}
        {messages.map((m) =>
          m.author.startsWith('human:') ? (
            <p
              key={m.id}
              className="dm-text-small max-w-[90%] self-end rounded-card-md bg-line-soft px-3 py-2 whitespace-pre-wrap text-ink"
            >
              {m.body}
            </p>
          ) : (
            <div key={m.id} className="dm-text-small flex items-start gap-2 leading-relaxed text-ink">
              <span className="mt-0.5 flex shrink-0">
                <WhoMark actor={m.author} size={16} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Markdown>{m.body}</Markdown>
                {!m.kind && drafts && (
                  <Button variant="text" className="self-start" onClick={() => takeReply(m.body)}>
                    Use this reply as the answer
                  </Button>
                )}
              </div>
            </div>
          ),
        )}
        {writing && <p className="dm-text-caption text-working-text">DEMIURGO is writing…</p>}
        {failed && <p className="dm-text-caption text-muted">DEMIURGO couldn't answer this time. Send it again.</p>}
      </div>
      <div className="flex flex-col gap-2">
        <label className="sr-only" htmlFor={`deeper-${q.id}`}>
          Talk it through
        </label>
        <textarea
          id={`deeper-${q.id}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="Talk it through…"
          className="dm-text-small w-full resize-y rounded-control border border-line-strong bg-surface px-3 py-2 text-ink outline-none placeholder:text-muted focus:border-needs"
        />
        <Button variant="secondary" className="self-end" disabled={!text.trim() || command.isPending} onClick={send}>
          {command.isPending ? 'Sending…' : 'Send'}
        </Button>
        {command.error ? <Reasons error={command.error} /> : null}
      </div>
      <div className="flex flex-col gap-2.5 rounded-card-md border border-needs-line bg-needs-soft p-3">
        <span className="dm-label text-needs-strong">Settle the question with</span>
        <div className="flex flex-wrap gap-1.5">
          {options.map((o, k) => (
            <button
              key={k}
              type="button"
              aria-pressed={own === null && picked.includes(k)}
              onClick={() => {
                setOwn(null);
                setPicked(q.multiple ? toggled(q, picked, k) : [k]);
              }}
              className={cn(
                'dm-text-caption rounded-pill border bg-surface px-3 py-1.5 font-semibold text-ink',
                own === null && picked.includes(k) ? 'border-2 border-needs' : 'border-line-strong',
              )}
            >
              {o.answer}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={own !== null}
            onClick={() => setOwn(own ?? '')}
            className={cn(
              'dm-text-caption rounded-pill border bg-surface px-3 py-1.5 font-semibold text-ink',
              own !== null ? 'border-2 border-needs' : 'border-line-strong',
            )}
          >
            My own words
          </button>
        </div>
        {own !== null && (
          <textarea
            ref={ownRef}
            aria-label="Your answer"
            value={own}
            onChange={(e) => setOwn(e.target.value)}
            rows={own.length > 200 ? 6 : 2}
            maxLength={MAX_ANSWER}
            className="dm-text-small w-full resize-y rounded-control border border-line-strong bg-surface px-3 py-2 text-ink outline-none focus:border-needs"
          />
        )}
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={!conclusion || !drafts}
            onClick={() => {
              drafts?.setAnswer(q.id, conclusion);
              onClose();
            }}
          >
            Use as answer
          </Button>
          <span className="dm-text-caption text-muted">
            {conclusion ? 'You confirm it with the others in the thread.' : 'Pick an option, or use a reply or your own words.'}
          </span>
        </div>
      </div>
    </section>
  );
}

/** The thread's stage is complete: passing it is the person's call, and nothing else is asked. */
export function StageComplete({ projectId, stage, next }: { projectId: string; stage: StageRow; next: string | null }) {
  const command = useCommand(projectId);
  return (
    <article
      data-stage-complete={stage.key}
      className="flex max-w-[680px] flex-col gap-2.5 self-start rounded-card-md border border-needs-line bg-needs-soft px-4 py-3.5"
    >
      <p className="dm-text-body text-ink">
        <span className="font-semibold">
          {stage.title} is complete: {stage.covered} of {stage.total} answered.
        </span>{' '}
        You can pass the stage{next ? `; next comes ${next}` : ''}.
      </p>
      <Button
        variant="primary"
        className="self-start"
        disabled={command.isPending || !stage.id}
        onClick={() => stage.id && command.mutate({ command: 'stage.pass', entityId: stage.id })}
      >
        {command.isPending ? 'Passing…' : 'Pass stage'}
      </Button>
      {command.error ? <Reasons error={command.error} /> : null}
    </article>
  );
}
