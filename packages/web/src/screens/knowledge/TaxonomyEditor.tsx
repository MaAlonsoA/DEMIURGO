// Proposing a new taxonomy version (taxonomy.propose): the title and the axes with their
// categories as fields, starting from the current version. Its text is kept as it is. The rules
// of a taxonomy are the server's: a refusal shows its reasons and keeps what was written.

import { type FormEvent, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { Taxonomy } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { Button } from '../../ui/Button.tsx';
import { CloseIcon, PlusIcon } from '../../ui/icons.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import {
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

const FIELD =
  'h-8 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-2.5 text-[13px] text-ink placeholder:text-muted focus:border-needs focus:outline-none';
const MONO = 'font-mono text-[12px]';

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
  const command = useCommand(projectId);
  const [draft, setDraft] = useState(initial);
  const gaps = missing(draft);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (gaps.length > 0) return;
    command.mutate({ command: 'taxonomy.propose', data: toProposal(draft) }, { onSuccess: onClose });
  };
  return (
    <form
      aria-label={`New version of ${draft.code}`}
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-[var(--radius-card)] border-2 border-needs bg-surface px-[18px] py-4"
    >
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold tracking-[0.05em] text-needs-hover uppercase">
          {base ? `New version of ${base.code} · from v${base.version}` : `New taxonomy · ${draft.code}`}
        </span>
        <p className="text-[13px] text-ink-3">
          Each axis is a closed set of categories. The server checks the rules: every axis keeps an “other” category, with code{' '}
          <code className="font-mono text-[12px]">other</code>, and no code repeats.
        </p>
      </header>
      <label className="flex max-w-[560px] flex-col gap-1">
        <span className="text-xs font-semibold text-ink-2">Title</span>
        <input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          maxLength={200}
          className={cn(FIELD, 'h-9 text-sm')}
        />
      </label>
      {draft.axes.map((a) => {
        const axisName = a.name.trim() || 'the new axis';
        return (
          <fieldset
            key={a.key}
            aria-label={a.name.trim() || 'New axis'}
            className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface-2 px-3.5 pt-3 pb-3.5"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_200px_auto] items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-ink-2">Axis name</span>
                <input
                  value={a.name}
                  onChange={(e) => setDraft(updateAxis(draft, a.key, { name: e.target.value }))}
                  className={cn(FIELD, 'font-semibold')}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-ink-2">Axis code</span>
                <input
                  value={a.code}
                  onChange={(e) => setDraft(updateAxis(draft, a.key, { code: e.target.value }))}
                  className={cn(FIELD, MONO)}
                />
              </label>
              <Button variant="ghost" size="md" onClick={() => setDraft(removeAxis(draft, a.key))}>
                Remove axis
              </Button>
            </div>
            <div
              aria-hidden="true"
              className="mt-1 grid grid-cols-[200px_170px_minmax(0,1fr)_28px] gap-2 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase"
            >
              <span>Category</span>
              <span>Code</span>
              <span>Description</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {a.categories.map((c) => {
                const name = c.name.trim() || 'the new category';
                return (
                  <li key={c.key} className="grid grid-cols-[200px_170px_minmax(0,1fr)_28px] items-center gap-2">
                    <input
                      aria-label={`Name of ${name}`}
                      value={c.name}
                      onChange={(e) => setDraft(updateCategory(draft, a.key, c.key, { name: e.target.value }))}
                      className={FIELD}
                    />
                    <input
                      aria-label={`Code of ${name}`}
                      value={c.code}
                      onChange={(e) => setDraft(updateCategory(draft, a.key, c.key, { code: e.target.value }))}
                      className={cn(FIELD, MONO)}
                    />
                    <input
                      aria-label={`Description of ${name}`}
                      value={c.description}
                      onChange={(e) => setDraft(updateCategory(draft, a.key, c.key, { description: e.target.value }))}
                      className={FIELD}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${c.name.trim() || 'the new category'}`}
                      onClick={() => setDraft(removeCategory(draft, a.key, c.key))}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-line-soft hover:text-ink"
                    >
                      <CloseIcon size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              aria-label="Add a category"
              title={`Add a category to ${axisName}`}
              onClick={() => setDraft(addCategory(draft, a.key))}
            >
              <PlusIcon size={12} />
              Add a category
            </Button>
          </fieldset>
        );
      })}
      <Button variant="outline" size="sm" className="self-start" onClick={() => setDraft(addAxis(draft))}>
        <PlusIcon size={12} />
        Add an axis
      </Button>
      {draft.sections.length > 0 && (
        <p className="text-xs text-muted">
          Its text ({draft.sections.map((s) => s.title).join(' · ')}) is kept as it is{base ? ` in v${base.version}` : ''}.
        </p>
      )}
      {command.error ? <Reasons error={command.error} /> : null}
      <footer className="flex items-center justify-end gap-3 border-t border-line-soft pt-3">
        {gaps.length > 0 && (
          <p className="mr-auto text-xs text-muted" aria-live="polite">
            {gaps[0]}
            {gaps.length > 1 ? ` And ${gaps.length - 1} more.` : ''}
          </p>
        )}
        <Button variant="ghost" onClick={onClose}>
          Not now
        </Button>
        <Button type="submit" variant="ink" disabled={gaps.length > 0 || command.isPending}>
          {command.isPending ? 'Proposing…' : 'Propose'}
        </Button>
      </footer>
    </form>
  );
}
