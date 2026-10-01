// Writing in a thread (DESIGN.md §3.3, D-013; INV-THR-42…51). The composer always writes to the
// thread: Send posts (Enter), Ask DEMIURGO posts and asks for an answer — or, with nothing written,
// asks the conversation to go on (Ctrl/⌘+Enter) — and Draft it asks for a feature from an approved
// decision, the ones born here first. It turns text into an answer only after "Answer in my own
// words", and then says so in a chip that can be dismissed; the answer is a draft, sent with the
// others. The keys are written under it. What was written stays when a command fails, and the focus
// comes back to the field after sending. A thread that is not active waits for Resume.

import {
  type FormEvent,
  type KeyboardEvent,
  type Ref,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useCommand } from '../../api/commands.ts';
import { canCreate } from '../../api/tables.ts';
import { Code, Tag } from '../../components/Badge.tsx';
import { announce } from '../../components/announce.tsx';
import { Link } from '@tanstack/react-router';
import { Button, buttonClass } from '../../components/Button.tsx';
import { ChevronDownIcon, CloseIcon, DecisionIcon, SendIcon, WandIcon } from '../../components/icons.tsx';
import { Menu, MenuItem, MenuLabel } from '../../components/Menu.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { KNOWLEDGE_WAIT } from '../../components/words.i18n.ts';
import { QueuedNotice } from '../../components/QueuedNotice.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { useTables } from '../../lib/hooks.ts';
import type { Draftable, ThreadDraft } from './timeline.ts';
import { COMPOSER } from './words.i18n.ts';

type Sending = 'send' | 'ask' | 'draft' | 'resume' | 'draftRecord';

export type ComposerHandle = {
  focus: () => void;
  /** Puts a text in the field when it is empty (an answer being rewritten), and focuses it. */
  prefill: (text: string) => void;
};

const MAX_MESSAGE = 20_000;
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

export function Composer({
  projectId,
  explorationId,
  active,
  inactiveNote,
  decisions,
  threadDraft,
  drafting,
  answering,
  onStopAnswering,
  onAnswer,
  onResume,
  onSent,
  onRequested,
  ref,
}: {
  projectId: string;
  explorationId: string;
  active: boolean;
  inactiveNote: string;
  decisions: Draftable[] | undefined;
  /** The record DEMIURGO can draft from this thread, when it can (one dedicated agent per kind). */
  threadDraft?: ThreadDraft | null;
  /** A run of that draft is already working. */
  drafting?: boolean;
  /** The question the person chose to answer in their own words, if any. */
  answering: { id: string; question: string } | null;
  onStopAnswering: () => void;
  /** Keeps the text as that question's draft answer (nothing is sent). */
  onAnswer: (questionId: string, text: string) => void;
  onResume?: (() => Promise<unknown>) | undefined;
  /** Something was posted: the conversation shows its end. */
  onSent: () => void;
  /** A reply from DEMIURGO was asked for (its run may not exist yet). */
  onRequested?: () => void;
  ref?: Ref<ComposerHandle>;
}) {
  const t = useMessages(COMPOSER);
  const tables = useTables();
  const command = useCommand(projectId);
  const w = useMessages(KNOWLEDGE_WAIT);
  const [text, setText] = useState('');
  const [sending, setSending] = useState<Sending | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const canPost = !!tables && canCreate(tables, 'message.post');
  const canRequest = !!tables && canCreate(tables, 'run.request');
  const empty = text.trim() === '';
  const busy = command.isPending;

  const focus = () => {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };
  useImperativeHandle(ref, () => ({
    focus,
    prefill: (v: string) => {
      if (!text.trim() && v) setText(v);
      requestAnimationFrame(focus);
    },
  }));

  // The field grows with what is written, up to about ten lines.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = 24 * 10 + 16;
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? 'auto' : 'hidden';
  }, [text, active]);

  const run = (kind: Sending, call: Parameters<typeof command.mutate>[0], done: () => void) => {
    setSending(kind);
    command.mutate(call, {
      onSuccess: () => {
        done();
        onSent();
        requestAnimationFrame(focus);
      },
      onSettled: () => setSending(null),
    });
  };

  const send = () => {
    if (empty || busy) return;
    if (answering) {
      onAnswer(answering.id, text.trim());
      setText('');
      announce(t.keptAsAnswer);
      requestAnimationFrame(focus);
      return;
    }
    run('send', { command: 'message.post', data: { exploration_id: explorationId, text: text.trim(), respond: false } }, () => {
      setText('');
      announce(t.sentToThread);
    });
  };
  const ask = () => {
    if (busy) return;
    if (empty)
      run(
        'ask',
        { command: 'run.request', data: { action: 'exploration_chat', scope: { type: 'exploration', id: explorationId } } },
        () => {
          onRequested?.();
          announce(t.askedToGoOn);
        },
      );
    else
      run('ask', { command: 'message.post', data: { exploration_id: explorationId, text: text.trim(), respond: true } }, () => {
        setText('');
        onRequested?.();
        announce(t.sentAnswersHere);
      });
  };
  const draft = (d: Draftable) =>
    run(
      'draft',
      { command: 'run.request', data: { action: 'design_proposal', scope: { type: 'record_version', id: d.versionId } } },
      () => announce(t.drafting(d.code)),
    );

  const draftRecord = (d: ThreadDraft) =>
    run('draftRecord', { command: 'run.request', data: { action: d.action, scope: d.scope } }, () => announce(t.draftStarted));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && !answering && canRequest) ask();
    else send();
  };

  if (!active) {
    return (
      <div className="flex flex-col gap-2">
        {command.error ? <ErrorNotice error={command.error} /> : null}
        <form aria-label={t.writeAria} className="flex flex-col rounded-lg border border-edge bg-sunken">
          <label htmlFor="thread-composer" className="px-3 pt-2 text-xs font-medium text-fg-2">
            {t.message}
          </label>
          <textarea
            id="thread-composer"
            ref={field}
            disabled
            rows={1}
            value=""
            readOnly
            className="w-full resize-none bg-transparent px-3 py-1.5 text-md text-fg disabled:cursor-not-allowed"
          />
          <div className="flex flex-wrap items-center gap-2 border-t border-edge-subtle px-3 py-2">
            <p className="mr-auto text-sm font-medium text-fg-2">{inactiveNote}</p>
            {onResume ? (
              <Button
                size="sm"
                variant="secondary"
                pending={sending === 'resume'}
                pendingLabel={t.resuming}
                onClick={() => {
                  setSending('resume');
                  void onResume().finally(() => setSending(null));
                }}
              >
                {t.resume}
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    );
  }

  const noDecision = decisions !== undefined && decisions.length === 0;
  const hint = answering ? t.hintAnswering : t.hint(MOD, canRequest);

  return (
    <div className="flex flex-col gap-1.5">
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <form
        onSubmit={onSubmit}
        aria-label={t.writeAria}
        className={cn(
          'flex flex-col rounded-lg border bg-panel',
          answering ? 'border-accent' : 'border-edge-control',
          'has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-focus',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 pt-2">
          <label htmlFor="thread-composer" className="text-xs font-medium text-fg-2">
            {t.message}
          </label>
          {answering ? (
            <span
              data-answering={answering.id}
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-accent-edge bg-accent-soft py-0.5 pr-0.5 pl-2.5 text-xs text-accent-text"
            >
              <span className="truncate">
                {t.answeringPrefix}
                <span className="font-medium">{answering.question}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  onStopAnswering();
                  requestAnimationFrame(focus);
                }}
                aria-label={t.stopAnswering}
                className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-accent-edge"
              >
                <CloseIcon size={12} />
              </button>
            </span>
          ) : (
            <span className="text-xs text-fg-3">{t.toTheThread}</span>
          )}
        </div>
        <textarea
          id="thread-composer"
          ref={field}
          value={text}
          rows={2}
          maxLength={MAX_MESSAGE}
          disabled={!canPost}
          aria-describedby={hintId}
          placeholder={answering ? t.placeholderAnswering : t.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full resize-none bg-transparent px-3 py-1.5 text-md text-fg outline-none placeholder:text-fg-3 disabled:cursor-not-allowed"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-edge-subtle px-2 py-2">
          {canRequest && !answering && !noDecision ? (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <DraftIt decisions={decisions ?? []} disabled={busy} pending={sending === 'draft'} onPick={draft} />
            </div>
          ) : null}
          {canRequest && !answering && threadDraft ? (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {threadDraft.pending?.batchId ? (
                <Link
                  to="/p/$projectId/batches/$batchId"
                  params={{ projectId, batchId: threadDraft.pending.batchId }}
                  className={buttonClass({ size: 'sm', variant: 'primary' })}
                  data-draft-kind={threadDraft.kind}
                  data-draft-review=""
                >
                  {t.reviewDraft}
                </Link>
              ) : (
                <Button
                  size="sm"
                  variant={threadDraft.suggested ? 'primary' : 'secondary'}
                  icon={<WandIcon size={14} />}
                  data-command="run.request"
                  type="button"
                  data-draft-kind={threadDraft.kind}
                  disabled={drafting || !!threadDraft.pending || (busy && sending !== 'draftRecord')}
                  pending={sending === 'draftRecord' || drafting || !!threadDraft.pending}
                  pendingLabel={command.waiting ? w.waiting : t.draftingKind(threadDraft.kind)}
                  onClick={() => draftRecord(threadDraft)}
                >
                  {t.draftKind(threadDraft.kind)}
                </Button>
              )}
              {threadDraft.suggested && !threadDraft.pending?.batchId && threadDraft.why ? (
                <span className="text-xs text-fg-3">{t.thinksEnough(threadDraft.why)}</span>
              ) : null}
            </div>
          ) : null}
          <QueuedNotice queued={command.queued} />
          <div className="ml-auto flex items-center gap-2">
            {canRequest && !answering ? (
              <Button
                size="sm"
                variant="secondary"
                data-command="run.request"
                disabled={busy && sending !== 'ask'}
                pending={sending === 'ask'}
                pendingLabel={command.waiting ? w.waiting : t.asking}
                onClick={ask}
              >
                {t.askDemiurgo}
              </Button>
            ) : null}
            {canPost ? (
              <Button
                type="submit"
                size="sm"
                variant="primary"
                icon={<SendIcon size={13} />}
                disabled={empty || (busy && sending !== 'send')}
                pending={sending === 'send'}
                pendingLabel={t.sending}
              >
                {answering ? t.useAsAnswer : t.send}
              </Button>
            ) : null}
          </div>
        </div>
      </form>
      <p id={hintId} className="px-1 text-xs text-fg-3">
        {hint}
        {text.length > MAX_MESSAGE * 0.9
          ? ` · ${text.length.toLocaleString('en-GB')} / ${MAX_MESSAGE.toLocaleString('en-GB')}`
          : ''}
      </p>
    </div>
  );
}

/** "Draft it ▾": the approved decisions to draft a feature from, the ones born in this thread first. */
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
  const t = useMessages(COMPOSER);
  // Blocked by a rule: the button stays focusable, and the reason is printed beside it (DESIGN.md §5).
  if (disabled && !pending)
    return (
      <Button
        size="sm"
        variant="quiet"
        icon={<WandIcon size={14} />}
        aria-disabled="true"
        trailing={<ChevronDownIcon size={12} />}
      >
        {t.draftIt}
      </Button>
    );
  return (
    <Menu
      side="top"
      align="start"
      label={t.draftIt}
      trigger={
        <Button
          size="sm"
          variant="quiet"
          icon={<WandIcon size={14} />}
          trailing={<ChevronDownIcon size={12} />}
          pending={pending}
          pendingLabel={t.asking}
        >
          {t.draftIt}
        </Button>
      }
    >
      <MenuLabel>
        <span className="block max-w-80 whitespace-normal">{t.draftItHint}</span>
      </MenuLabel>
      {decisions.map((d) => (
        <MenuItem key={d.versionId} icon={<DecisionIcon size={14} />} onSelect={() => onPick(d)}>
          <span className="flex max-w-80 flex-col gap-0.5">
            <span className="line-clamp-2 font-medium text-fg">{d.title}</span>
            <span className="flex flex-wrap items-center gap-2">
              <Code>
                {d.code} v{d.version}
              </Code>
              {d.bornHere ? <Tag>{t.fromThisThread}</Tag> : null}
            </span>
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}
