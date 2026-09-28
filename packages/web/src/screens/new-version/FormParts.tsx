// Pieces shared by the New record and New version pages (DESIGN.md §3.6): a template section in
// Markdown, the "To save it" list, the sticky footer that keeps the summary and "Save draft" near
// the fields, and the guard that asks before leaving with unsaved text (INVENTORY INV-NEWREC-13,
// INV-NEWVER-14, UX problems: Cancel lost everything without asking).

import { useBlocker } from '@tanstack/react-router';
import { type ReactNode, useId, useRef } from 'react';
import { Button } from '../../components/Button.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { Field, TextArea } from '../../components/Field.tsx';
import { InfoIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { useMessages } from '../../i18n/define.ts';
import { FORM_PARTS } from './words.i18n.ts';

/** A template section in Markdown; its title is the field's label. */
export function SectionField({
  title,
  content,
  onChange,
}: {
  title: string;
  content: string;
  onChange: (content: string) => void;
}) {
  const t = useMessages(FORM_PARTS);
  return (
    <Field label={title} hint={t.markdown}>
      {(p) => <TextArea {...p} autoGrow rows={3} maxRows={18} value={content} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

/** A titled part of a form, on its own surface. */
export function FormPanel({
  title,
  note,
  children,
  actions,
}: {
  title: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-lg border border-edge bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={id} className="text-lg font-semibold text-fg">
            {title}
          </h2>
          {note ? <p className="text-sm text-fg-2">{note}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** What still keeps the draft from being saved, in words. */
export function MissingList({ missing }: { missing: string[] }) {
  const t = useMessages(FORM_PARTS);
  if (missing.length === 0) return null;
  return (
    <div data-missing className="flex flex-col gap-1.5 rounded-lg border border-edge bg-sunken px-3.5 py-3 text-sm">
      <p className="font-medium text-fg">{t.toSaveIt}</p>
      <ul className="flex list-disc flex-col gap-0.5 pl-5 text-fg-2">
        {missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The bottom of the form, sticky: what will be saved and what is missing, the server's reasons when
 * the save failed (the form keeps everything), Cancel and "Save draft", the page's primary action.
 */
export function SaveFooter({
  summary,
  missing,
  error,
  pending,
  canSave,
  onSave,
  onCancel,
}: {
  summary: ReactNode;
  missing: string[];
  error: unknown;
  pending: boolean;
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useMessages(FORM_PARTS);
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-2 flex flex-col gap-3 border-t border-edge bg-panel px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {error ? <ErrorNotice error={error} /> : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-64 flex-col text-sm">
          <span className="text-fg">{summary}</span>
          {missing.length > 0 ? (
            <span className="flex items-center gap-1.5 text-fg-2">
              <InfoIcon size={13} className="shrink-0 text-fg-3" />
              {missing.length === 1 ? t.oneThing(missing[0] as string) : t.manyThings(missing.length)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="quiet" onClick={onCancel}>
            {t.cancel}
          </Button>
          <Button variant="primary" disabled={!canSave} pending={pending} pendingLabel={t.savingEllipsis} onClick={onSave}>
            {t.saveDraft}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Asks before leaving the page while `dirty` says there is unsaved text: a link, the sidebar, Back
 * or closing the tab. `release()` lets the next navigation through (after a successful save).
 */
export function useLeaveGuard(dirty: boolean): { dialog: ReactNode; release: () => void } {
  const t = useMessages(FORM_PARTS);
  const on = useRef(dirty);
  on.current = dirty;
  const released = useRef(false);
  const blocks = () => on.current && !released.current;
  const blocker = useBlocker({ shouldBlockFn: blocks, enableBeforeUnload: blocks, withResolver: true });
  const dialog = (
    <ConfirmDialog
      open={blocker.status === 'blocked'}
      onOpenChange={(o) => {
        if (!o && blocker.status === 'blocked') blocker.reset();
      }}
      title={t.leaveWithoutSaving}
      description={<p>{t.leaveBody}</p>}
      confirm={t.leaveAndLoseIt}
      cancel={t.keepWriting}
      tone="danger"
      onConfirm={() => {
        released.current = true;
        if (blocker.status === 'blocked') blocker.proceed();
      }}
    />
  );
  return {
    dialog,
    release: () => {
      released.current = true;
    },
  };
}
