// "Ask DEMIURGO about this" (DESIGN.md §3.5, §3.6): the conversation as a tool tied to what is on
// screen — the whole product on the overview, a record on its page — always at the bottom of the
// side column (R88). It finds the subject's active thread or opens one, posts the message and asks
// DEMIURGO to answer; under it, how the answer goes and the way to the thread. Enter asks,
// Shift+Enter adds a line (D-013). The text stays when sending fails.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, type KeyboardEvent, type Ref, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { runCommand } from '../api/commands.ts';
import { explorationQuery, explorationsQuery, keys, runsQuery } from '../api/queries.ts';
import { canCreate } from '../api/tables.ts';
import { cn } from '../lib/cn.ts';
import { useTables } from '../lib/hooks.ts';
import { type AskSubject, askPlaceholder, askProgress, openThreadData, subjectWords, threadFor } from './ask.ts';
import { Button } from './Button.tsx';
import { TextArea } from './Field.tsx';
import { ArrowRightIcon, SendIcon } from './icons.tsx';
import { ErrorNotice } from './Notice.tsx';
import { StateIcon } from './status.tsx';
import { WhoAvatar } from './Who.tsx';

export type AskBoxHandle = { prefill: (beginning: string) => void };

type Sent = { explorationId: string; messageId: string; purpose: string };

export function AskBox({
  projectId,
  subject,
  className,
  ref,
}: {
  projectId: string;
  subject: AskSubject;
  className?: string;
  ref?: Ref<AskBoxHandle>;
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

  return (
    <section aria-labelledby={`${id}-title`} className={cn('flex flex-col gap-2', className)} data-ask>
      <h2 id={`${id}-title`} className="flex items-center gap-2 text-base font-semibold text-fg">
        <WhoAvatar kind="demiurgo" size={20} />
        {label}
      </h2>
      {send.error ? <ErrorNotice error={send.error} compact /> : null}
      <form aria-label={label} onSubmit={onSubmit} className="flex flex-col gap-2">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <TextArea
          id={id}
          ref={field}
          autoGrow
          maxRows={8}
          rows={2}
          value={text}
          maxLength={20_000}
          placeholder={askPlaceholder(subject)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-fg-3">Enter asks · Shift Enter for a new line</span>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            icon={<SendIcon size={14} />}
            disabled={empty}
            pending={send.isPending}
            pendingLabel="Sending…"
          >
            Ask
          </Button>
        </div>
      </form>
      {sent ? <AskStatus projectId={projectId} sent={sent} /> : null}
    </section>
  );
}

/** How the answer goes: working while DEMIURGO answers, then the way to the thread. */
function AskStatus({ projectId, sent }: { projectId: string; sent: Sent }) {
  const thread = useQuery(explorationQuery(projectId, sent.explorationId));
  const runs = useQuery(runsQuery(projectId, { exploration: sent.explorationId }));
  const progress = askProgress(thread.data, runs.data, sent.messageId);
  const where = (
    <Link
      to="/p/$projectId/threads/$explorationId"
      params={{ projectId, explorationId: sent.explorationId }}
      className="font-medium text-fg underline-offset-2 hover:underline"
    >
      {sent.purpose}
    </Link>
  );
  const open = (
    <Link
      to="/p/$projectId/threads/$explorationId"
      params={{ projectId, explorationId: sent.explorationId }}
      className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-accent-text hover:underline"
    >
      Open the thread <ArrowRightIcon size={12} />
    </Link>
  );
  return (
    <p
      role="status"
      data-ask-status={progress.state}
      className={cn('flex items-start gap-2 text-sm text-fg-2', progress.state === 'failed' && 'text-danger-text')}
    >
      <span className="flex h-5 shrink-0 items-center">
        <StateIcon kind={progress.state === 'answering' ? 'working' : progress.state === 'answered' ? 'done' : 'problem'} />
      </span>
      <span className="min-w-0 leading-5">
        {progress.state === 'answering' && <>Sent to {where} · DEMIURGO is answering…</>}
        {progress.state === 'answered' && (
          <>
            DEMIURGO answered in {where} · {open}
          </>
        )}
        {progress.state === 'failed' && (
          <>
            DEMIURGO couldn't answer: {progress.failure} · {open}
          </>
        )}
      </span>
    </p>
  );
}
