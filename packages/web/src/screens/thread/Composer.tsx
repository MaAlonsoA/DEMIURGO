// Writing in a thread (spec §4.7): Send posts the message; Ask DEMIURGO posts it and asks for an
// answer (or, with nothing written, asks for the conversation to go on); Draft it asks for a
// feature from an approved decision, the ones born in this thread first. What was written stays
// when a command fails, with its reasons. A thread that is not active waits for Resume.

import { DropdownMenu } from 'radix-ui';
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { canCreate } from '../../api/tables.ts';
import { cn } from '../../lib/cn.ts';
import { useTables } from '../../lib/hooks.ts';
import { Button } from '../../ui/Button.tsx';
import { Code } from '../../ui/Card.tsx';
import { ChevronDown, TypeIcon } from '../../ui/icons.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import type { Draftable } from './timeline.ts';

type Sending = 'send' | 'ask' | 'draft';

export function Composer({
  projectId,
  explorationId,
  active,
  inactiveNote,
  decisions,
  onResume,
  replying,
  onClearReply,
  ready,
}: {
  projectId: string;
  explorationId: string;
  active: boolean;
  inactiveNote: string;
  decisions: Draftable[] | undefined;
  onResume?: (() => void) | undefined;
  /** An open question the composer answers: Send confirms it with what was written. */
  replying?:
    | { question: string; onAnswer: (text: string, done: () => void) => void; pending: boolean; error: unknown }
    | undefined;
  onClearReply?: () => void;
  /** Above the box: the drafts waiting to be confirmed and sent. */
  ready?: ReactNode;
}) {
  const tables = useTables();
  const command = useCommand(projectId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState<Sending | null>(null);
  const id = 'thread-composer';
  const canPost = !!tables && canCreate(tables, 'message.post');
  const canRequest = !!tables && canCreate(tables, 'run.request');
  const empty = text.trim() === '';
  const busy = command.isPending || !!replying?.pending;

  const run = (kind: Sending, call: Parameters<typeof command.mutate>[0], clear: boolean) => {
    setSending(kind);
    command.mutate(call, {
      onSuccess: () => {
        if (clear) setText('');
      },
      onSettled: () => setSending(null),
    });
  };
  const send = () => {
    if (empty || busy) return;
    if (replying) {
      replying.onAnswer(text.trim(), () => setText(''));
      return;
    }
    run('send', { command: 'message.post', data: { exploration_id: explorationId, text: text.trim(), respond: false } }, true);
  };
  const ask = () => {
    if (busy) return;
    if (empty) {
      run(
        'ask',
        { command: 'run.request', data: { action: 'exploration_chat', scope: { type: 'exploration', id: explorationId } } },
        false,
      );
    } else {
      run('ask', { command: 'message.post', data: { exploration_id: explorationId, text: text.trim(), respond: true } }, true);
    }
  };
  const draft = (d: Draftable) =>
    run(
      'draft',
      { command: 'run.request', data: { action: 'design_proposal', scope: { type: 'record_version', id: d.versionId } } },
      false,
    );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  };

  const noDecision = decisions !== undefined && decisions.length === 0;
  return (
    <div className="sticky bottom-0 z-10 bg-linear-to-t from-paper from-75% to-transparent pt-6 pb-6">
      {command.error ? <Reasons error={command.error} className="mb-2" /> : null}
      {replying?.error ? <Reasons error={replying.error} className="mb-2" /> : null}
      {ready}
      <form
        onSubmit={onSubmit}
        aria-label="Write in the thread"
        className="flex flex-col rounded-control border border-line-strong bg-surface shadow-raised has-[textarea:focus-visible]:border-needs"
      >
        {replying && active && (
          <div className="dm-text-caption flex items-center gap-2 border-b border-line-soft px-4 py-2 text-muted">
            <span className="min-w-0 flex-1 truncate">
              Replying to: <span className="font-semibold text-ink">{replying.question}</span>
            </span>
            {onClearReply && (
              <button
                type="button"
                onClick={onClearReply}
                className="shrink-0 font-semibold text-ink-3 hover:text-ink"
                aria-label="Write to the thread instead of answering"
              >
                Write something else
              </button>
            )}
          </div>
        )}
        <label htmlFor={id} className="sr-only">
          Message
        </label>
        <textarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!active || !canPost}
          rows={active ? 3 : 1}
          maxLength={20_000}
          placeholder={active ? (replying ? 'Your answer, or pick an option above' : 'Write to the thread…') : ''}
          className={cn(
            'dm-text-body w-full rounded-t-control bg-transparent px-4 pt-3 pb-1 leading-relaxed text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:bg-surface-soft',
            active ? 'min-h-[76px] resize-y' : 'h-10 resize-none',
          )}
        />
        <div className="flex items-center gap-2 border-t border-line-soft px-3 py-2">
          <p className="dm-text-caption min-w-0 flex-1 text-muted">
            {!active ? (
              <span className="flex items-center gap-2">
                <span className="font-medium text-ink-2">{inactiveNote}</span>
                {onResume && (
                  <Button type="button" variant="secondary" onClick={onResume}>
                    Resume
                  </Button>
                )}
              </span>
            ) : noDecision && canRequest ? (
              'Draft it needs an approved decision first.'
            ) : (
              <span className="hidden xl:inline">Ctrl+Enter sends</span>
            )}
          </p>
          {canPost && (
            <Button type="submit" variant="text" disabled={!active || empty || busy}>
              {replying ? 'Use as answer' : sending === 'send' ? 'Sending…' : 'Send'}
            </Button>
          )}
          {canRequest && (
            <DraftIt
              decisions={decisions ?? []}
              disabled={!active || busy || noDecision}
              pending={sending === 'draft'}
              onPick={draft}
            />
          )}
          {canRequest && (
            <Button type="button" variant="secondary" disabled={!active || busy} onClick={ask} data-command="run.request">
              {sending === 'ask' ? 'Asking…' : 'Ask DEMIURGO'}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function DraftIt({
  decisions,
  disabled,
  pending,
  onPick,
}: {
  decisions: Draftable[];
  disabled: boolean;
  pending: boolean;
  onPick: (d: Draftable) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <Button type="button" variant="secondary" disabled={disabled}>
          {pending ? 'Asking…' : 'Draft it'}
          <ChevronDown size={12} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-[400px] animate-fade-in rounded-card border border-line bg-surface p-1.5 shadow-float"
        >
          <DropdownMenu.Label className="dm-text-caption px-2.5 pt-1.5 pb-2 text-muted">
            DEMIURGO drafts a feature with its checks from an approved decision. You review it before anything changes.
          </DropdownMenu.Label>
          {decisions.map((d) => (
            <DropdownMenu.Item
              key={d.versionId}
              onSelect={() => onPick(d)}
              className="flex cursor-pointer items-start gap-2.5 rounded-tab px-2.5 py-2 outline-none data-[highlighted]:bg-line-soft"
            >
              <span className="mt-0.5 flex text-muted">
                <TypeIcon kind="decision" size={14} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="dm-text-small line-clamp-2 font-semibold text-ink">{d.title}</span>
                <span className="flex items-center gap-2">
                  <Code>
                    {d.code} v{d.version}
                  </Code>
                  {d.bornHere && <span className="dm-text-caption font-semibold text-ink-2">From this thread</span>}
                </span>
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
