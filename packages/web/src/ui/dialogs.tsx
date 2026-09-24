// Dialogs: confirmation for decisive commands, and asking for a text (a reason, a conclusion).
// On a 409 or 422 they keep what the person wrote and show the reasons (spec §7.1).

import { AlertDialog, Dialog } from 'radix-ui';
import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { Button } from './Button.tsx';
import { Reasons } from './Reasons.tsx';

const overlay = 'fixed inset-0 z-50 bg-ink/25 animate-fade-in';
const panel =
  'fixed top-1/2 left-1/2 z-50 w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 animate-fade-in rounded-[var(--radius-panel)] border border-line bg-surface p-6 shadow-[0_24px_64px_rgba(29,28,26,0.18)]';

/** Confirmation of a decisive command: says what it does before doing it. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  onConfirm,
  pending,
  error,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirm: string;
  onConfirm: () => void;
  pending?: boolean;
  error?: unknown;
  children?: ReactNode;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlay} />
        <AlertDialog.Content className={panel}>
          <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-2 text-sm text-ink-2">{description}</div>
          </AlertDialog.Description>
          {children}
          {error ? <Reasons error={error} className="mt-4" /> : null}
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Not now</Button>
            </AlertDialog.Cancel>
            <Button
              variant="needs"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {pending ? 'Working…' : confirm}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** Asks for a text: the reason to park, drop or reject, or the conclusion of a thread. */
export function TextDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  submit,
  required = false,
  multiline = true,
  initial = '',
  maxLength,
  onSubmit,
  pending,
  error,
  variant = 'ink',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  label: string;
  submit: string;
  required?: boolean;
  multiline?: boolean;
  initial?: string;
  maxLength?: number;
  onSubmit: (text: string) => void;
  pending?: boolean;
  error?: unknown;
  variant?: 'ink' | 'needs';
}) {
  const [text, setText] = useState(initial);
  const id = useId();
  useEffect(() => {
    if (open) setText(initial);
  }, [open, initial]);
  const empty = text.trim() === '';
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (required && empty) return;
    onSubmit(text.trim());
  };
  const field =
    'w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-needs focus:outline-none';
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className={panel}>
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description asChild>
              <div className="mt-1 text-sm text-ink-2">{description}</div>
            </Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{label}</Dialog.Description>
          )}
          <form onSubmit={send} className="mt-4 flex flex-col gap-2">
            <label htmlFor={id} className="text-xs font-semibold text-ink-2">
              {label}
              {!required && <span className="font-normal text-muted"> · optional</span>}
            </label>
            {multiline ? (
              <textarea
                id={id}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                maxLength={maxLength}
                className={field}
              />
            ) : (
              <input id={id} value={text} onChange={(e) => setText(e.target.value)} maxLength={maxLength} className={field} />
            )}
            {error ? <Reasons error={error} className="mt-2" /> : null}
            <div className="mt-4 flex items-center justify-end gap-2">
              {required && empty && <span className="mr-auto text-xs text-muted">Write something to continue.</span>}
              <Dialog.Close asChild>
                <Button variant="ghost">Not now</Button>
              </Dialog.Close>
              <Button type="submit" variant={variant} disabled={pending || (required && empty)}>
                {pending ? 'Working…' : submit}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
