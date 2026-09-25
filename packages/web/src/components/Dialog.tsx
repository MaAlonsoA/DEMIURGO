// Dialogs (DESIGN.md §6.6), following the APG modal dialog (R95): focus moves in, Tab stays in,
// Esc closes, focus returns to the trigger. A confirmation says what will happen before it happens
// (R20 G16); for what destroys or rejects, the least destructive button has the focus first. A text
// dialog keeps what was written when the server says no, shows the reasons and counts characters
// against the limit (R87).

import { AlertDialog, Dialog as D } from 'radix-ui';
import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { cn } from '../lib/cn.ts';
import { Button } from './Button.tsx';
import { CloseIcon } from './icons.tsx';
import { ErrorNotice } from './Notice.tsx';
import { useReturnFocus } from './returnFocus.ts';

const overlay = 'fixed inset-0 z-50 bg-scrim animate-enter';
const panel =
  'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[min(540px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border border-edge bg-panel p-6 shadow-dialog animate-enter';

/** A plain dialog (a form, a list): title, optional description, content and its own footer. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const returnFocus = useReturnFocus(open);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content className={cn(panel, wide && 'w-[min(760px,calc(100vw-32px))]', className)} onCloseAutoFocus={returnFocus}>
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <D.Title className="text-lg font-semibold text-fg">{title}</D.Title>
              {description ? (
                <D.Description asChild>
                  <div className="text-base text-fg-2">{description}</div>
                </D.Description>
              ) : (
                <D.Description className="sr-only">{typeof title === 'string' ? title : ''}</D.Description>
              )}
            </div>
            <D.Close
              aria-label="Close"
              className="-mt-1 -mr-2 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg"
            >
              <CloseIcon size={16} />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/**
 * The confirmation of a decisive or destructive command. `tone="danger"` paints the confirm button
 * red; Cancel ("Not now") keeps the first focus either way (Radix AlertDialog).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  onConfirm,
  pending,
  pendingLabel,
  error,
  children,
  tone = 'primary',
  cancel = 'Not now',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirm: string;
  onConfirm: () => void;
  pending?: boolean;
  pendingLabel?: string;
  error?: unknown;
  children?: ReactNode;
  tone?: 'primary' | 'danger';
  cancel?: string;
}) {
  const returnFocus = useReturnFocus(open);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlay} />
        <AlertDialog.Content className={panel} onCloseAutoFocus={returnFocus}>
          <AlertDialog.Title className="text-lg font-semibold text-fg">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="flex flex-col gap-2 text-base text-fg-2">{description}</div>
          </AlertDialog.Description>
          {children}
          {error ? <ErrorNotice error={error} compact /> : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <AlertDialog.Cancel asChild>
              <Button variant="quiet">{cancel}</Button>
            </AlertDialog.Cancel>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              pending={pending}
              pendingLabel={pendingLabel ?? 'Working…'}
              data-confirm
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {confirm}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/**
 * Asks for a text (a reason, a conclusion, a name). It starts from `initial` each time it opens,
 * trims on submit, says what is missing when required, counts against `maxLength` and keeps the
 * text when the command fails.
 */
export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  submit,
  onSubmit,
  required,
  multiline = true,
  initial = '',
  maxLength,
  placeholder,
  hint,
  pending,
  pendingLabel,
  error,
  tone = 'primary',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  label: string;
  submit: string;
  onSubmit: (text: string) => void;
  required?: boolean;
  multiline?: boolean;
  initial?: string;
  maxLength?: number;
  placeholder?: string;
  hint?: ReactNode;
  pending?: boolean;
  pendingLabel?: string;
  error?: unknown;
  tone?: 'primary' | 'danger';
}) {
  const id = useId();
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (open) setText(initial);
  }, [open, initial]);
  const missing = Boolean(required) && text.trim() === '';
  const submitIt = (e?: FormEvent) => {
    e?.preventDefault();
    if (missing || pending) return;
    onSubmit(text.trim());
  };
  const field = cn(
    'w-full rounded-md border border-edge-control bg-panel px-3 py-2 text-base text-fg placeholder:text-fg-3',
    'focus:border-focus focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0',
  );
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content className={panel}>
          <form onSubmit={submitIt} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <D.Title className="text-lg font-semibold text-fg">{title}</D.Title>
              {description ? (
                <D.Description asChild>
                  <div className="text-base text-fg-2">{description}</div>
                </D.Description>
              ) : (
                <D.Description className="sr-only">{label}</D.Description>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={id} className="text-sm font-medium text-fg">
                {label}
                {!required ? <span className="font-normal text-fg-3"> · optional</span> : null}
              </label>
              {multiline ? (
                <textarea
                  id={id}
                  rows={4}
                  value={text}
                  maxLength={maxLength}
                  placeholder={placeholder}
                  aria-describedby={`${id}-help`}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitIt();
                  }}
                  className={cn(field, 'min-h-24 resize-y')}
                />
              ) : (
                <input
                  id={id}
                  type="text"
                  value={text}
                  maxLength={maxLength}
                  placeholder={placeholder}
                  aria-describedby={`${id}-help`}
                  onChange={(e) => setText(e.target.value)}
                  className={cn(field, 'h-9')}
                />
              )}
              <div id={`${id}-help`} className="flex items-start justify-between gap-3 text-xs text-fg-3">
                <span>{missing ? 'Write something to continue.' : hint}</span>
                {maxLength ? (
                  <span className="shrink-0 tabular-nums">
                    {text.length.toLocaleString('en-GB')} / {maxLength.toLocaleString('en-GB')}
                  </span>
                ) : null}
              </div>
            </div>
            {error ? <ErrorNotice error={error} compact /> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <D.Close asChild>
                <Button variant="quiet">Not now</Button>
              </D.Close>
              <Button
                type="submit"
                variant={tone === 'danger' ? 'danger' : 'primary'}
                disabled={missing}
                pending={pending}
                pendingLabel={pendingLabel ?? 'Working…'}
              >
                {submit}
              </Button>
            </div>
          </form>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
