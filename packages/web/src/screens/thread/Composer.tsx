// Writing in a thread (spec §4.7): Send posts the message; Ask DEMIURGO posts it and asks for an
// answer (or, with nothing written, asks for the conversation to go on); Draft it asks for a
// feature from an approved decision, the ones born in this thread first. What was written stays
// when a command fails, with its reasons. A thread that is not active waits for Resume.

import { DropdownMenu } from 'radix-ui';
import { type FormEvent, type KeyboardEvent, useId, useState } from 'react';
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
}: {
  projectId: string;
  explorationId: string;
  active: boolean;
  inactiveNote: string;
  decisions: Draftable[] | undefined;
  onResume?: (() => void) | undefined;
}) {
  const tables = useTables();
  const command = useCommand(projectId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState<Sending | null>(null);
  const id = useId();
  const canPost = !!tables && canCreate(tables, 'message.post');
  const canRequest = !!tables && canCreate(tables, 'run.request');
  const empty = text.trim() === '';
  const busy = command.isPending;

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
      <form
        onSubmit={onSubmit}
        aria-label="Write in the thread"
        className="flex flex-col rounded-[14px] border border-line-strong bg-surface shadow-[0_8px_24px_rgba(29,28,26,0.06)] has-[textarea:focus-visible]:border-needs has-[textarea:focus-visible]:shadow-[0_0_0_3px_var(--color-needs-ring)]"
      >
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
          placeholder={active ? 'Write to the thread…' : ''}
          className={cn(
            'w-full rounded-t-[14px] bg-transparent px-4 pt-3 pb-1 text-[14px] leading-relaxed text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:bg-surface-2',
            active ? 'min-h-[76px] resize-y' : 'h-10 resize-none',
          )}
        />
        <div className="flex items-center gap-2 border-t border-line-soft px-3 py-2">
          <p className="min-w-0 flex-1 text-xs text-muted">
            {!active ? (
              <span className="flex items-center gap-2">
                <span className="font-medium text-ink-2">{inactiveNote}</span>
                {onResume && (
                  <Button type="button" size="sm" variant="outline" onClick={onResume}>
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
            <Button type="submit" size="sm" variant="ghost" disabled={!active || empty || busy}>
              {sending === 'send' ? 'Sending…' : 'Send'}
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
            <Button type="button" size="sm" variant="ink" disabled={!active || busy} onClick={ask} data-command="run.request">
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
        <Button type="button" size="sm" variant="outline" disabled={disabled}>
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
          className="z-50 w-[400px] animate-fade-in rounded-[var(--radius-panel)] border border-line bg-surface p-1.5 shadow-[0_16px_40px_rgba(29,28,26,0.14)]"
        >
          <DropdownMenu.Label className="px-2.5 pt-1.5 pb-2 text-xs text-muted">
            DEMIURGO drafts a feature with its checks from an approved decision. You review it before anything changes.
          </DropdownMenu.Label>
          {decisions.map((d) => (
            <DropdownMenu.Item
              key={d.versionId}
              onSelect={() => onPick(d)}
              className="flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-line-soft"
            >
              <span className="mt-0.5 flex text-muted">
                <TypeIcon kind="decision" size={14} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="line-clamp-2 text-[13px] font-semibold text-ink">{d.title}</span>
                <span className="flex items-center gap-2">
                  <Code>
                    {d.code} v{d.version}
                  </Code>
                  {d.bornHere && <span className="text-[11px] font-semibold text-ink-2">From this thread</span>}
                </span>
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
