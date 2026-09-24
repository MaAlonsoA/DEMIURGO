// "Ask DEMIURGO about this" (canvas B1 bottom bar, S5A right column; design doc §2): a composer
// tied to what is on screen. Sending finds the thread of the subject or opens it, posts the message
// with an answer asked for, and says under the bar how the answer goes. What was written stays
// when a command fails, with its reasons.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { runCommand } from '../api/commands.ts';
import { explorationQuery, explorationsQuery, keys, runsQuery } from '../api/queries.ts';
import { canCreate } from '../api/tables.ts';
import { cn } from '../lib/cn.ts';
import { useTables } from '../lib/hooks.ts';
import { type AskSubject, askPlaceholder, askProgress, openThreadData, subjectWords, threadFor } from './ask.ts';
import { Button } from './Button.tsx';
import { ArrowRight, ChevronRight } from './icons.tsx';
import { Mark } from './marks.tsx';
import { Reasons } from './Reasons.tsx';
import { WhoGlyph } from './signals.tsx';

export type AskBarHandle = {
  /** Writes a beginning ("In Checks: ") and puts the cursor after it. */
  prefill: (text: string) => void;
};

type Sent = { explorationId: string; messageId: string; purpose: string };

export function AskBar({
  projectId,
  subject,
  variant = 'bar',
  className,
  ref,
}: {
  projectId: string;
  subject: AskSubject;
  /** bar: one line with its subject (the overview); panel: a box in the right column (a record). */
  variant?: 'bar' | 'panel';
  className?: string;
  ref?: Ref<AskBarHandle>;
}) {
  const tables = useTables();
  const client = useQueryClient();
  const [text, setText] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const caretToEnd = useRef(false);
  const id = useId();

  const focusAtEnd = () => {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };
  useImperativeHandle(ref, () => ({
    prefill(beginning: string) {
      // The same text again only takes the focus; a new one is written first.
      if (beginning === text) return focusAtEnd();
      caretToEnd.current = true;
      setText(beginning);
    },
  }));
  useEffect(() => {
    if (!caretToEnd.current) return;
    caretToEnd.current = false;
    focusAtEnd();
  }, [text]);
  // The field grows with what is written, up to a few lines.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const send = useMutation({
    mutationFn: async (message: string): Promise<Sent> => {
      // Fresh: a thread opened by the last question must be found, not opened twice.
      const threads = await client.fetchQuery({ ...explorationsQuery(projectId), staleTime: 0 });
      const thread = threadFor(threads, subject);
      let explorationId = thread?.id;
      let purpose = thread?.purpose ?? '';
      if (!explorationId) {
        const data = openThreadData(subject);
        explorationId = (await runCommand(projectId, { command: 'exploration.open', data })).entity_id;
        purpose = data.purpose;
      }
      const posted = await runCommand(projectId, {
        command: 'message.post',
        data: { exploration_id: explorationId, text: message, respond: true },
      });
      return { explorationId, messageId: posted.entity_id, purpose };
    },
    onSuccess: (s) => {
      setSent(s);
      setText('');
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.project(projectId) }),
  });

  if (!tables || !canCreate(tables, 'message.post') || !canCreate(tables, 'exploration.open')) return null;

  const empty = text.trim() === '';
  const submit = () => {
    if (empty || send.isPending) return;
    send.mutate(text.trim());
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  const label = `Ask DEMIURGO about ${subjectWords(subject)}`;
  const focusRing =
    'has-[textarea:focus-visible]:border-needs has-[textarea:focus-visible]:shadow-[0_0_0_3px_var(--color-needs-ring)]';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {send.error ? <Reasons error={send.error} /> : null}
      <form
        aria-label={label}
        onSubmit={onSubmit}
        className={cn(
          'flex rounded-xl border border-line-strong bg-surface transition-shadow',
          variant === 'bar'
            ? 'items-center gap-2.5 py-2 pr-2 pl-3.5 shadow-[0_8px_24px_rgba(29,28,26,0.06)]'
            : 'items-end gap-2.5 py-2.5 pr-2.5 pl-3',
          focusRing,
        )}
      >
        {variant === 'bar' ? (
          <span className="shrink-0 rounded-md bg-line-soft px-2 py-[3px] text-xs font-semibold text-ink-3">
            About: whole product
          </span>
        ) : (
          <span className="mb-[7px] flex shrink-0" aria-hidden="true">
            <WhoGlyph kind="demiurgo" size={20} />
          </span>
        )}
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <textarea
          id={id}
          ref={field}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={variant === 'bar' ? 1 : 2}
          maxLength={20_000}
          placeholder={askPlaceholder(subject)}
          className={cn(
            'min-w-0 flex-1 resize-none bg-transparent text-ink outline-none placeholder:text-muted',
            variant === 'bar' ? 'py-1.5 text-[14px] leading-snug' : 'py-1 text-[13px] leading-relaxed',
          )}
        />
        {variant === 'bar' ? (
          <Button type="submit" variant="ink" disabled={send.isPending}>
            {send.isPending ? 'Sending…' : 'Send'}
          </Button>
        ) : (
          <button
            type="submit"
            aria-label="Send"
            disabled={send.isPending}
            className={cn(
              'inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed',
              empty ? 'bg-line-soft text-ink-3' : 'bg-ink text-white hover:bg-ink-2',
            )}
          >
            <ArrowRight size={16} />
          </button>
        )}
      </form>
      {sent && <AskStatus projectId={projectId} sent={sent} />}
    </div>
  );
}

/** How the answer goes, under the bar: amber while DEMIURGO answers, then the way to the thread. */
function AskStatus({ projectId, sent }: { projectId: string; sent: Sent }) {
  const thread = useQuery(explorationQuery(projectId, sent.explorationId));
  const runs = useQuery(runsQuery(projectId, { exploration: sent.explorationId }));
  const progress = askProgress(thread.data, runs.data, sent.messageId);
  const toThread = (children: ReactNode, className: string) => (
    <Link
      to="/p/$projectId/threads/$explorationId"
      params={{ projectId, explorationId: sent.explorationId }}
      className={className}
    >
      {children}
    </Link>
  );
  const open = toThread(
    <>
      Open the thread
      <ChevronRight size={11} />
    </>,
    'inline-flex items-center gap-0.5 font-semibold whitespace-nowrap text-needs hover:text-needs-hover',
  );
  const where = toThread(sent.purpose, 'font-semibold text-ink hover:text-needs');
  const dot = (
    <span className="text-inactive-light" aria-hidden="true">
      {' · '}
    </span>
  );
  return (
    <p
      role="status"
      data-ask-status={progress.state}
      className={cn('flex items-start gap-2 px-1 text-[13px] text-ink-2', progress.state === 'failed' && 'text-problem')}
    >
      <span className="flex h-5 shrink-0 items-center">
        {progress.state === 'answering' && <Mark kind="working" size={9} label="Working" />}
        {progress.state === 'answered' && <Mark kind="done" size={10} label="Answered" />}
        {progress.state === 'failed' && <Mark kind="problem" size={9} />}
      </span>
      <span className="min-w-0 leading-5">
        {progress.state === 'answering' && <>Sent to {where} · DEMIURGO is answering…</>}
        {progress.state === 'answered' && (
          <>
            DEMIURGO answered in {where}
            {dot}
            {open}
          </>
        )}
        {progress.state === 'failed' && (
          <>
            DEMIURGO couldn't answer: {progress.failure}
            {dot}
            {open}
          </>
        )}
      </span>
    </p>
  );
}
