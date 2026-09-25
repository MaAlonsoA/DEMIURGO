// New version of a record (spec §4.6, canvas S5C): what changed, the template's sections in
// markdown, and an explicit Keep, Change or Drop for every check of the base version, plus new
// ones. "Save draft" runs record_version.create and goes back to the record with the draft on screen.

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { inboxQuery, recordQuery, stateQuery } from '../../api/queries.ts';
import type { ProductState, RecordDetail, RecordVersion } from '../../api/types.ts';
import { useRouteParams } from '../../lib/hooks.ts';
import { Button, buttonClass } from '../../ui/Button.tsx';
import { Code } from '../../ui/Card.tsx';
import { PlusIcon, RECORD_ICON, TypeIcon, WarningIcon } from '../../ui/icons.tsx';
import { Breadcrumbs, Page, Skeleton } from '../../ui/layout.tsx';
import { Mark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { TYPE_WORDS } from '../../words.ts';
import { NotFound } from '../not-found/NotFound.tsx';
import { LINK_WORDS, type VersionRef, baseVersion, versionIndex } from '../record/logic.ts';
import { CheckEditor, field, titleField } from './CheckEditor.tsx';
import {
  type CheckDraft,
  type LinkInput,
  type VersionForm,
  addCheck,
  carriedLinks,
  initialForm,
  missing,
  toCommand,
} from './form.ts';
import { linkTargets, mergeLinks } from './links.ts';
import { LinksEditor } from './LinksEditor.tsx';

export function NewVersionScreen() {
  const { projectId, code = '' } = useRouteParams();
  const record = useQuery(recordQuery(projectId, code));
  const state = useQuery(stateQuery(projectId));
  const inbox = useQuery(inboxQuery(projectId));
  if (record.error instanceof ApiError && record.error.status === 404) return <NotFound thing={`the record ${code}`} />;
  const r = record.data;
  const base = r ? baseVersion(r) : undefined;
  if (r && !base) return <NotFound thing={`a version of ${code} to start from`} />;
  if (!r || !base) {
    return (
      <Page>
        {record.error ? (
          <Reasons error={record.error} />
        ) : (
          <div role="status" aria-label="Loading the record" className="flex max-w-[900px] flex-col gap-3">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="mt-4 h-28 w-full rounded-card-md" />
          </div>
        )}
      </Page>
    );
  }
  // Keyed by the record: what the person writes is kept even if the record changes meanwhile.
  return (
    <NewVersionForm
      key={r.id}
      projectId={projectId}
      record={r}
      base={base}
      index={state.data ? versionIndex(state.data, inbox.data) : undefined}
      state={state.data}
    />
  );
}

function Count({ n, word }: { n: number; word: string }) {
  if (n === 0) return null;
  return (
    <li className="dm-text-small flex items-baseline justify-between">
      <span className="text-ink-2">{word}</span>
      <span className="font-semibold tabular-nums">{n}</span>
    </li>
  );
}

function NewVersionForm({
  projectId,
  record,
  base: current,
  index,
  state,
}: {
  projectId: string;
  record: RecordDetail;
  base: RecordVersion;
  index: Map<string, VersionRef> | undefined;
  state: ProductState | undefined;
}) {
  const navigate = useNavigate();
  const [added, setAdded] = useState<LinkInput[]>([]);
  const command = useCommand<{ versionId: string; version: number; warnings: string[] }>(projectId);
  const [base] = useState(current);
  const [form, setForm] = useState<VersionForm>(() => initialForm(base));
  const noteId = useId();
  const titleId = useId();
  const originals = new Map(base.criteria.map((c) => [c.code, c]));

  const update = (next: CheckDraft) =>
    setForm((f) => ({
      ...f,
      checks: f.checks.map((c) => {
        if (c.key !== next.key) return c;
        // Keep and Drop carry the check as it was: an edit only lives while "Change" is chosen.
        const o = next.code ? originals.get(next.code) : undefined;
        if (o && next.choice !== 'change' && c.choice === 'change') {
          return { ...next, title: o.title, statement: o.statement, check: o.check, verification: next.verification };
        }
        return next;
      }),
    }));
  const remove = (key: string) => setForm((f) => ({ ...f, checks: f.checks.filter((c) => c.key !== key) }));

  const links = index ? carriedLinks(base.links, index) : null;
  const miss = missing(form);
  const ready = miss.length === 0 && links !== null;
  const counts = {
    kept: form.checks.filter((c) => c.choice === 'keep').length,
    changed: form.checks.filter((c) => c.choice === 'change').length,
    dropped: form.checks.filter((c) => c.choice === 'drop').length,
    added: form.checks.filter((c) => c.code === null).length,
  };

  const save = () => {
    if (!ready || !links) return;
    command.mutate(
      { command: 'record_version.create', data: toCommand(record.id, form, mergeLinks(links.carried, added)) },
      {
        onSuccess: (r) =>
          void navigate({
            to: '/p/$projectId/records/$code',
            params: { projectId, code: record.code },
            search: r.result ? { v: r.result.version } : {},
          }),
      },
    );
  };

  const aside = (
    <>
      <section aria-labelledby={`${titleId}-summary`} className="flex flex-col gap-3">
        <h2 id={`${titleId}-summary`} className="dm-text-heading">
          This new version
        </h2>
        <p className="dm-text-small flex items-center gap-2 text-ink-2">
          <Mark kind="proposed" size={9} label="Draft" />
          <span>
            <span className="dm-text-caption font-mono font-semibold text-ink">v{(record.versions.at(-1)?.n ?? 0) + 1}</span>{' '}
            draft, from v{base.n}. Nothing changes until you approve it.
          </span>
        </p>
        <ul className="flex flex-col gap-1 border-t border-line-soft pt-3">
          <Count n={counts.kept} word="Kept" />
          <Count n={counts.changed} word="Changed" />
          <Count n={counts.dropped} word="Dropped" />
          <Count n={counts.added} word="New" />
          {counts.kept + counts.changed + counts.dropped + counts.added === 0 && (
            <li className="dm-text-small text-ink-3">No check has a choice yet.</li>
          )}
        </ul>
        {base.links.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-line-soft pt-3">
            <h3 className="dm-label">Links, carried as they are</h3>
            {links === null ? (
              <Skeleton className="h-3.5 w-48" />
            ) : (
              <ul className="flex flex-col gap-1">
                {links.carried.map((l) => (
                  <li key={`${l.type}-${l.target.code}`} className="dm-text-small flex items-center gap-2">
                    <span className="text-muted">{LINK_WORDS[l.type] ?? l.type}</span>
                    <Code className="ml-auto">
                      {l.target.code} v{l.target.version}
                    </Code>
                  </li>
                ))}
                {links.unknown.length > 0 && (
                  <li className="dm-text-caption flex items-start gap-1.5 text-problem">
                    <WarningIcon size={13} className="mt-[2px] shrink-0" />
                    {links.unknown.length} {links.unknown.length === 1 ? 'link points' : 'links point'} to a version that is no
                    longer shown: {links.unknown.length === 1 ? 'it is' : 'they are'} not carried.
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </section>
      <section aria-label="Save" className="flex flex-col gap-3">
        {miss.length > 0 && (
          <div data-missing className="dm-text-small rounded-control border border-line bg-surface-soft px-3 py-2.5">
            <p className="font-semibold text-ink">To save it:</p>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-ink-2 marker:text-muted">
              {miss.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        {command.error ? <Reasons error={command.error} /> : null}
        <Button variant="secondary" disabled={!ready || command.isPending} onClick={save}>
          {command.isPending ? 'Saving…' : 'Save draft'}
        </Button>
        <Link to="/p/$projectId/records/$code" params={{ projectId, code: record.code }} className={buttonClass('text')}>
          Cancel
        </Link>
      </section>
    </>
  );

  return (
    <Page aside={aside} className="[&>*]:max-w-[900px]">
      <Breadcrumbs
        items={[
          { label: 'Product', to: '/p/$projectId', params: { projectId } },
          { label: base.title, to: '/p/$projectId/records/$code', params: { projectId, code: record.code } },
          { label: 'New version' },
        ]}
      />
      <header className="mb-6 flex flex-col gap-1.5">
        <span className="dm-label flex items-center gap-1.5">
          <TypeIcon kind={RECORD_ICON[record.type] ?? 'feature'} size={14} />
          {TYPE_WORDS[record.type]}
          <span className="dm-sep" aria-hidden="true">
            ·
          </span>
          <Code className="tracking-normal normal-case">
            {record.code} · from v{base.n}
          </Code>
        </span>
        <h1 className="dm-text-page-title text-balance">New version of {base.title}</h1>
        <p className="dm-text-body text-ink-3">Say what changes, then choose what happens to each check.</p>
      </header>

      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-1.5 rounded-card border border-line bg-surface px-6 py-5">
          <label htmlFor={noteId} className="dm-text-heading">
            What changed
          </label>
          <p id={`${noteId}-hint`} className="dm-text-small text-ink-3">
            Required. It tells whoever reads this version what it changes and why.
          </p>
          <textarea
            id={noteId}
            value={form.note}
            rows={3}
            maxLength={2000}
            aria-describedby={`${noteId}-hint`}
            aria-required="true"
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            className={`${field} mt-1`}
          />
        </section>

        <section className="flex flex-col gap-4 rounded-card border border-line bg-surface px-6 py-5">
          <div className="flex flex-col gap-1">
            <label htmlFor={titleId} className="dm-label">
              Title
            </label>
            <input
              id={titleId}
              value={form.title}
              maxLength={200}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className={titleField}
            />
          </div>
          {form.sections.map((s, i) => (
            <Section
              key={s.title}
              title={s.title}
              content={s.content}
              onChange={(content) =>
                setForm((f) => ({ ...f, sections: f.sections.map((x, j) => (j === i ? { ...x, content } : x)) }))
              }
            />
          ))}
        </section>

        {(form.checks.length > 0 || record.type !== 'decision') && (
          <section aria-labelledby={`${titleId}-checks`} className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id={`${titleId}-checks`} className="dm-text-caption font-semibold text-muted">
                Checks <span className="font-normal">· {form.checks.length}</span>
              </h2>
              <span className="dm-text-caption text-muted">
                A changed check keeps its code; a dropped one stays in earlier versions.
              </span>
            </div>
            <ol className="flex flex-col gap-2.5">
              {form.checks.map((c, i) => (
                <CheckEditor key={c.key} check={c} index={i} onChange={update} onRemove={() => remove(c.key)} />
              ))}
            </ol>
            <Button variant="secondary" className="self-start" onClick={() => setForm(addCheck)}>
              <PlusIcon size={14} />
              Add a check
            </Button>
          </section>
        )}

        <LinksEditor targets={linkTargets(state, record.code)} links={added} onChange={setAdded} />
      </div>
    </Page>
  );
}

/** A template section in markdown (also used by New record). */
export function Section({ title, content, onChange }: { title: string; content: string; onChange: (content: string) => void }) {
  const id = useId();
  const rows = Math.min(18, Math.max(3, content.split('\n').length + 1));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="dm-label">
          {title}
        </label>
        <span id={`${id}-hint`} className="dm-text-caption text-muted">
          Markdown
        </span>
      </div>
      <textarea
        id={id}
        value={content}
        rows={rows}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
        className={`${field} leading-relaxed`}
      />
    </div>
  );
}
