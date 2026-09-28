// Proposing a taxonomy version (DESIGN.md §3.8, INV-KNOW-24): the title and the axes with their
// categories as fields, starting from the current version; its text is kept as it is. Every gap is
// listed before proposing (not only the first), removing a whole axis asks first, and the rules of
// a taxonomy stay the server's: a refusal shows its reasons next to the action and keeps what was
// written (R87).

import { type FormEvent, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { Taxonomy } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { Field, TextInput, controlClass } from '../../components/Field.tsx';
import { CloseIcon, PlusIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import {
  type DraftAxis,
  type TaxonomyDraft,
  addAxis,
  addCategory,
  missing,
  removeAxis,
  removeCategory,
  toProposal,
  updateAxis,
  updateCategory,
} from './taxonomy.ts';
import { TAXONOMY_EDITOR } from './words.i18n.ts';

const CELL = cn(controlClass, 'h-8 text-sm');
const ROW = 'grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,9rem)_minmax(0,1fr)_2rem] sm:items-center';

export function TaxonomyEditor({
  projectId,
  initial,
  base,
  onClose,
}: {
  projectId: string;
  initial: TaxonomyDraft;
  base: Taxonomy | null;
  onClose: () => void;
}) {
  const t = useMessages(TAXONOMY_EDITOR);
  const command = useCommand(projectId);
  const [draft, setDraft] = useState(initial);
  const [removing, setRemoving] = useState<DraftAxis | null>(null);
  const gaps = missing(draft);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (gaps.length > 0) return;
    command.mutate(
      { command: 'taxonomy.propose', data: toProposal(draft) },
      {
        onSuccess: () => {
          announce(t.proposed(draft.code));
          onClose();
        },
      },
    );
  };
  return (
    <form
      aria-label={t.newVersionOf(draft.code)}
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-lg border border-accent-edge bg-panel p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-fg">
          {base ? t.newVersionTitle(base.code, base.version) : t.newTaxonomyTitle(draft.code)}
        </h2>
        <p className="text-sm text-fg-2">
          {t.editorBodyPrefix} <code className="font-code text-xs">other</code>
          {t.editorBodySuffix}
        </p>
      </header>
      <Field label={t.title} count={[draft.title.length, 200]} className="max-w-xl">
        {(p) => (
          <TextInput {...p} value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        )}
      </Field>
      {draft.axes.map((a) => {
        const axisName = a.name.trim() || t.newAxisPlaceholder;
        return (
          <fieldset key={a.key} className="flex min-w-0 flex-col gap-3 rounded-lg border border-edge bg-sunken px-4 pt-2 pb-4">
            <legend className="px-1 text-sm font-semibold text-fg">{a.name.trim() || t.newAxis}</legend>
            <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
              <Field label={t.axisName}>
                {(p) => (
                  <TextInput
                    {...p}
                    value={a.name}
                    onChange={(e) => setDraft(updateAxis(draft, a.key, { name: e.target.value }))}
                  />
                )}
              </Field>
              <Field label={t.axisCode}>
                {(p) => (
                  <TextInput
                    {...p}
                    value={a.code}
                    onChange={(e) => setDraft(updateAxis(draft, a.key, { code: e.target.value }))}
                    className="font-code text-sm"
                  />
                )}
              </Field>
              <Button variant="quiet-danger" onClick={() => setRemoving(a)}>
                {t.removeAxis}
              </Button>
            </div>
            <div aria-hidden="true" className={cn(ROW, 'hidden text-xs font-medium text-fg-2 sm:grid')}>
              <span>{t.name}</span>
              <span>{t.code}</span>
              <span>{t.description}</span>
            </div>
            <ul className="flex flex-col gap-2">
              {a.categories.map((c) => {
                const name = c.name.trim() || t.newCategoryPlaceholder;
                return (
                  <li key={c.key} className={ROW}>
                    <input
                      aria-label={t.nameOf(name)}
                      placeholder={t.name}
                      value={c.name}
                      onChange={(e) => setDraft(updateCategory(draft, a.key, c.key, { name: e.target.value }))}
                      className={CELL}
                    />
                    <input
                      aria-label={t.codeOf(name)}
                      placeholder={t.code}
                      value={c.code}
                      onChange={(e) => setDraft(updateCategory(draft, a.key, c.key, { code: e.target.value }))}
                      className={cn(CELL, 'font-code')}
                    />
                    <input
                      aria-label={t.descriptionOf(name)}
                      placeholder={t.description}
                      value={c.description}
                      onChange={(e) => setDraft(updateCategory(draft, a.key, c.key, { description: e.target.value }))}
                      className={CELL}
                    />
                    <button
                      type="button"
                      aria-label={t.removeOf(c.name.trim() || t.newCategoryPlaceholder)}
                      title={t.removeOf(c.name.trim() || t.newCategoryPlaceholder)}
                      onClick={() => setDraft(removeCategory(draft, a.key, c.key))}
                      className="inline-flex h-8 w-8 cursor-pointer items-center justify-center justify-self-end rounded-md text-fg-2 hover:bg-hover hover:text-fg"
                    >
                      <CloseIcon size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button
              size="sm"
              variant="quiet"
              icon={<PlusIcon size={14} />}
              className="self-start"
              title={t.addCategoryTo(axisName)}
              onClick={() => setDraft(addCategory(draft, a.key))}
            >
              {t.addCategory}
            </Button>
          </fieldset>
        );
      })}
      <Button variant="secondary" icon={<PlusIcon size={15} />} className="self-start" onClick={() => setDraft(addAxis(draft))}>
        {t.addAxis}
      </Button>
      {draft.sections.length > 0 ? (
        <p className="text-sm text-fg-2">
          {t.textKept(draft.sections.map((s) => s.title).join(' · '), base ? ` in v${base.version}` : '')}.
        </p>
      ) : null}
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <footer className="flex flex-col gap-3 border-t border-edge-subtle pt-4 sm:flex-row sm:items-start sm:justify-between">
        <div aria-live="polite" className="min-w-0 text-sm text-fg-2">
          {gaps.length > 0 ? (
            <>
              <p className="font-medium text-fg">{t.beforeProposing}</p>
              <ul className="mt-1 list-disc pl-5">
                {gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>{t.readyToPropose}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            {t.notNow}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={gaps.length > 0}
            pending={command.isPending}
            pendingLabel={t.proposing}
          >
            {t.propose}
          </Button>
        </div>
      </footer>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t.removeAxisTitle(removing?.name.trim() || t.newAxis)}
        description={t.removeAxisBody(removing?.categories.length ?? 0)}
        confirm={t.removeAxis}
        tone="danger"
        onConfirm={() => {
          if (removing) setDraft(removeAxis(draft, removing.key));
          setRemoving(null);
        }}
      />
    </form>
  );
}
