// Guided thread: DEMIURGO's questions live in the conversation as its messages, at most two open
// at a time (the rest wait in the reserve). Answering is replying: one click on an option (or
// several, then "Answer with N selected"), or the person's own words. "Go deeper" opens a side
// conversation about one question, and "Use as answer" settles it in the main thread. When the
// thread has nothing left to answer, DEMIURGO reads the answers and goes on.

import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { ExplorationDetail, Question, StageRow } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { useAllows } from '../../ui/ActionBar.tsx';
import { Button } from '../../ui/Button.tsx';
import { TypeIcon } from '../../ui/icons.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { WhoMark } from '../../ui/signals.tsx';

const OPEN = new Set(['pending', 'inferred']);
export const isOpenQuestion = (q: Question) => OPEN.has(q.state);
export const isShown = (q: Question) => !!q.shown_at;

/** Confirms a question with its answer; with nothing left to answer, asks DEMIURGO to go on. */
export function useAnswer(projectId: string, thread: ExplorationDetail | undefined) {
  const command = useCommand(projectId);
  const answer = (q: Question, conclusion: string, onDone?: () => void) => {
    if (!thread) return;
    const left = thread.questions.filter((x) => x.id !== q.id && isOpenQuestion(x)).length;
    command.mutate(
      { command: 'question.confirm', entityId: q.id, data: { conclusion } },
      {
        onSuccess: () => {
          onDone?.();
          if (left === 0)
            command.mutate({
              command: 'run.request',
              data: { action: 'exploration_chat', scope: { type: 'exploration', id: thread.id } },
            });
        },
      },
    );
  };
  return { answer, pending: command.isPending, error: command.error };
}

/** The answer a multiple choice records: every option picked, in their order. */
const joined = (q: Question, picked: number[]) =>
  [...picked]
    .sort((a, b) => a - b)
    .map((k) => q.options?.[k]?.answer ?? '')
    .filter(Boolean)
    .join(' · ');

/** Toggling an option: an exclusive one clears the others, and any other clears the exclusive ones. */
const toggled = (q: Question, picked: number[], k: number) => {
  const options = q.options ?? [];
  if (picked.includes(k)) return picked.filter((x) => x !== k);
  if (options[k]?.exclusive) return [k];
  return [...picked.filter((x) => !options[x]?.exclusive), k];
};

export function QuestionCard({
  projectId,
  thread,
  question: q,
  stageTitle,
  deeperOpen,
  deeperCount,
  onDeeper,
  onOwnWords,
}: {
  projectId: string;
  thread: ExplorationDetail;
  question: Question;
  stageTitle: string | null;
  deeperOpen: boolean;
  deeperCount: number;
  onDeeper: () => void;
  onOwnWords: () => void;
}) {
  const { answer, pending, error } = useAnswer(projectId, thread);
  const allows = useAllows('question', q.state);
  const [picked, setPicked] = useState<number[]>([]);
  if (!isOpenQuestion(q)) return <SettledQuestion question={q} />;
  const options = q.options ?? [];
  const inferred = q.state === 'inferred' && q.conclusion ? q.conclusion : null;
  const canAnswer = allows('question.confirm') && thread.state === 'active';

  return (
    <article
      data-question={q.id}
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
              disabled={pending}
              onClick={() => answer(q, inferred)}
            />
          )}
          {options.map((o, k) => (
            <Option
              key={k}
              answer={o.answer}
              implies={o.implies}
              multiple={!!q.multiple}
              selected={picked.includes(k)}
              disabled={pending}
              onClick={() => (q.multiple ? setPicked(toggled(q, picked, k)) : answer(q, o.answer))}
            />
          ))}
        </div>
      )}
      {canAnswer && q.multiple && options.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="dm-text-caption text-muted">Pick all that apply</span>
          {picked.length > 0 && (
            <Button variant="primary" disabled={pending} onClick={() => answer(q, joined(q, picked))}>
              Answer with {picked.length} selected
            </Button>
          )}
        </div>
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
        </div>
      )}
      {error ? <Reasons error={error} /> : null}
    </article>
  );
}

function Option({
  answer,
  implies,
  multiple = false,
  selected = false,
  disabled,
  onClick,
}: {
  answer: string;
  implies: string;
  multiple?: boolean;
  selected?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={multiple ? selected : undefined}
      onClick={onClick}
      className={cn(
        'flex flex-col gap-0.5 rounded-card-md border bg-surface px-3 py-2.5 text-left hover:border-needs disabled:opacity-60',
        selected ? 'border-2 border-needs' : 'border-line',
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
      className="dm-text-small flex max-w-[680px] flex-wrap items-baseline gap-x-2.5 gap-y-1 self-start rounded-sm border border-line-soft bg-surface-soft px-3 py-2"
    >
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-pill', word ? 'bg-inactive' : 'bg-ink')} />
      <span className="text-ink-3">{q.question}</span>
      <span className="font-semibold text-ink">{word ?? q.conclusion}</span>
    </div>
  );
}

/** The side conversation about one question, and settling it with an option or one's own words. */
export function DeeperPanel({
  projectId,
  thread,
  question: q,
  onClose,
}: {
  projectId: string;
  thread: ExplorationDetail;
  question: Question;
  onClose: () => void;
}) {
  const command = useCommand(projectId);
  const { answer, pending, error } = useAnswer(projectId, thread);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [own, setOwn] = useState<string | null>(null);
  const messages = thread.messages.filter((m) => m.question_id === q.id);
  const writing = messages.some((m) => m.response === 'waiting' || m.response === 'requested');
  const options = q.options ?? [];
  const conclusion = own !== null ? own.trim() : q.multiple ? joined(q, picked) : (options[picked[0] ?? -1]?.answer ?? '');
  const send = () => {
    if (!text.trim() || command.isPending) return;
    command.mutate(
      { command: 'message.post', data: { exploration_id: thread.id, question_id: q.id, text: text.trim(), respond: true } },
      { onSuccess: () => setText('') },
    );
  };

  return (
    <section aria-label="Going deeper" className="flex flex-col gap-4">
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
      <div className="flex flex-col gap-3">
        {messages.length === 0 && !writing && (
          <p className="dm-text-small text-muted">Ask anything about this question: what each option means, examples, what others do.</p>
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
            <div key={m.id} className="dm-text-small flex gap-2 leading-relaxed text-ink">
              <WhoMark actor={m.author} size={16} />
              <span className="whitespace-pre-wrap">{m.body}</span>
            </div>
          ),
        )}
        {writing && <p className="dm-text-caption text-working-text">DEMIURGO is writing…</p>}
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
            aria-label="Your answer"
            value={own}
            onChange={(e) => setOwn(e.target.value)}
            rows={2}
            className="dm-text-small w-full resize-y rounded-control border border-line-strong bg-surface px-3 py-2 text-ink outline-none focus:border-needs"
          />
        )}
        <Button variant="primary" className="self-start" disabled={!conclusion || pending} onClick={() => answer(q, conclusion, onClose)}>
          Use as answer
        </Button>
        {error ? <Reasons error={error} /> : null}
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
