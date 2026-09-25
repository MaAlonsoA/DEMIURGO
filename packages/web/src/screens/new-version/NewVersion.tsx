// New version of a record (DESIGN.md §3.6, INV-NEWVER-*): what changed (required), the title and
// the template's sections in Markdown, an explicit Keep, Change or Drop for every check of the base
// version plus new ones, and its links — the carried ones can be removed. The summary and "Save
// draft" stay in a sticky footer near the fields; leaving with unsaved text asks first; the
// warnings the save returns are shown on the new version's page.

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { inboxQuery, recordQuery, stateQuery } from '../../api/queries.ts';
import type { ProductState, RecordDetail, RecordVersion } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Field, TextArea, TextInput } from '../../components/Field.tsx';
import { PlusIcon } from '../../components/icons.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, usePageTitle } from '../../components/Page.tsx';
import { PageSkeleton } from '../../components/Spinner.tsx';
import { StatusBadge } from '../../components/status.tsx';
import { TypeIcon } from '../../components/types.tsx';
import { useRouteParams } from '../../lib/hooks.ts';
import { TYPE_WORDS } from '../../words.ts';
import { NotFound } from '../not-found/NotFound.tsx';
import { recordCrumbs } from '../record/Header.tsx';
import { type VersionRef, baseVersion, versionIndex } from '../record/logic.ts';
import { leaveSaveWarnings } from '../record/saved.ts';
import { CheckEditor } from './CheckEditor.tsx';
import { FormPanel, MissingList, SaveFooter, SectionField, useLeaveGuard } from './FormParts.tsx';
import {
  type CheckDraft,
  type LinkInput,
  type VersionForm,
  addCheck,
  carriedLinks,
  initialForm,
  missing,
  toCommand,
  versionDirty,
} from './form.ts';
import { linkTargets } from './links.ts';
import { LinksEditor } from './LinksEditor.tsx';

export function NewVersionScreen() {
  const { projectId, code = '' } = useRouteParams();
  const record = useQuery(recordQuery(projectId, code));
  const state = useQuery(stateQuery(projectId));
  const inbox = useQuery(inboxQuery(projectId));
  usePageTitle(['New version', code, state.data?.project.name]);
  if (record.error instanceof ApiError && record.error.status === 404) return <NotFound thing={`the record ${code}`} />;
  const r = record.data;
  const base = r ? baseVersion(r) : undefined;
  if (r && !base) return <NotFound thing={`a version of ${code} to start from`} />;
  if (!r || !base) {
    return (
      <>
        <PageHeader title="New version" />
        <PageBody width="reading">
          {record.error ? (
            <ErrorNotice error={record.error} onRetry={() => void record.refetch()} />
          ) : (
            <PageSkeleton label="Loading the record" />
          )}
        </PageBody>
      </>
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
  const command = useCommand<{ versionId: string; version: number; warnings: string[] }>(projectId);
  // The base is frozen when the form opens.
  const [base] = useState(current);
  const [form, setForm] = useState<VersionForm>(() => initialForm(base));
  /** Edits made under Change, kept while the person tries Keep or Drop (INVENTORY INV-NEWVER, UX problem). */
  const [edits, setEdits] = useState<Record<string, CheckDraft>>({});
  const carried = index ? carriedLinks(base.links, index) : null;
  const [links, setLinks] = useState<LinkInput[] | null>(null);
  useEffect(() => {
    if (links === null && carried) setLinks(carried.carried);
  }, [links, carried]);
  const originals = new Map(base.criteria.map((c) => [c.code, c]));
  const next = (record.versions.at(-1)?.n ?? 0) + 1;

  const update = (changed: CheckDraft) => {
    const was = form.checks.find((c) => c.key === changed.key);
    const o = changed.code ? originals.get(changed.code) : undefined;
    let result = changed;
    if (was && o && was.choice === 'change' && changed.choice !== 'change') {
      // Leaving Change: the check goes as it was, and the edits wait to come back.
      setEdits((e) => ({ ...e, [was.key]: was }));
      result = {
        ...changed,
        title: o.title,
        statement: o.statement,
        check: o.check,
        verification: o.verification === 'manual' ? 'manual' : 'automatic',
      };
    } else if (was && o && was.choice !== 'change' && changed.choice === 'change' && edits[was.key]) {
      // Back to Change: the edits come back.
      result = { ...(edits[was.key] as CheckDraft), choice: 'change' };
    }
    setForm((f) => ({ ...f, checks: f.checks.map((c) => (c.key === changed.key ? result : c)) }));
  };
  const remove = (key: string) => setForm((f) => ({ ...f, checks: f.checks.filter((c) => c.key !== key) }));

  const miss = missing(form);
  const ready = miss.length === 0 && links !== null;
  const counts = {
    kept: form.checks.filter((c) => c.choice === 'keep').length,
    changed: form.checks.filter((c) => c.choice === 'change').length,
    dropped: form.checks.filter((c) => c.choice === 'drop').length,
    added: form.checks.filter((c) => c.code === null).length,
  };
  const dirty = versionDirty(form, base) || (links !== null && carried !== null && links.length !== carried.carried.length);
  const guard = useLeaveGuard(dirty && !command.isSuccess);

  const back = () => void navigate({ to: '/p/$projectId/records/$code', params: { projectId, code: record.code } });
  const save = () => {
    if (!ready || !links) return;
    command.mutate(
      { command: 'record_version.create', data: toCommand(record.id, form, links) },
      {
        onSuccess: (r) => {
          guard.release();
          const n = r.result?.version ?? next;
          leaveSaveWarnings(record.code, n, r.result?.warnings ?? []);
          announce(`Saved: v${n} is a draft.`);
          void navigate({
            to: '/p/$projectId/records/$code',
            params: { projectId, code: record.code },
            search: { v: n },
          });
        },
      },
    );
  };

  const choices = [
    counts.kept ? `${counts.kept} kept` : '',
    counts.changed ? `${counts.changed} changed` : '',
    counts.dropped ? `${counts.dropped} dropped` : '',
    counts.added ? `${counts.added} new` : '',
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        crumbs={recordCrumbs(projectId, record, base.title, [{ label: 'New version' }])}
        eyebrow={
          <>
            <span className="inline-flex items-center gap-1.5">
              <TypeIcon type={record.type} size={15} className="text-fg-3" />
              {TYPE_WORDS[record.type]}
            </span>
            <Code>
              {record.code} · from v{base.n}
            </Code>
          </>
        }
        title={`New version of ${base.title}`}
        meta={<span>Say what changes, then choose what happens to each check.</span>}
      />
      <PageBody className="pb-0">
        <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <FormPanel title="Change note">
              <Field
                label="What changed"
                hint="Required. It tells whoever reads this version what it changes and why."
                count={[form.note.length, 2000]}
              >
                {(p) => (
                  <TextArea
                    {...p}
                    aria-required="true"
                    autoGrow
                    rows={3}
                    maxLength={2000}
                    value={form.note}
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  />
                )}
              </Field>
            </FormPanel>

            <FormPanel title="Content">
              <Field label="Title" count={[form.title.length, 200]}>
                {(p) => (
                  <TextInput
                    {...p}
                    value={form.title}
                    maxLength={200}
                    className="text-md font-medium"
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  />
                )}
              </Field>
              {form.sections.map((s, i) => (
                <SectionField
                  key={s.title}
                  title={s.title}
                  content={s.content}
                  onChange={(content) =>
                    setForm((f) => ({ ...f, sections: f.sections.map((x, j) => (j === i ? { ...x, content } : x)) }))
                  }
                />
              ))}
            </FormPanel>

            {form.checks.length > 0 || record.type !== 'decision' ? (
              <FormPanel
                title={
                  <>
                    Checks <span className="font-normal text-fg-2">· {form.checks.length}</span>
                  </>
                }
                note="A changed check keeps its code; a dropped one stays in earlier versions."
              >
                <ol className="flex flex-col gap-3">
                  {form.checks.map((c, i) => (
                    <CheckEditor
                      key={c.key}
                      check={c}
                      index={i}
                      onChange={update}
                      onRemove={() => remove(c.key)}
                      editsKept={!!edits[c.key]}
                    />
                  ))}
                </ol>
                <Button className="self-start" icon={<PlusIcon size={14} />} onClick={() => setForm(addCheck)}>
                  Add a check
                </Button>
              </FormPanel>
            ) : null}

            {carried && carried.unknown.length > 0 ? (
              <Notice tone="warning">
                {carried.unknown.length} {carried.unknown.length === 1 ? 'link points' : 'links point'} to a version that is no
                longer shown: {carried.unknown.length === 1 ? 'it is' : 'they are'} not carried.
              </Notice>
            ) : null}
            <LinksEditor
              targets={linkTargets(state, record.code)}
              links={links ?? []}
              carried={carried?.carried ?? []}
              onChange={setLinks}
              note="The links of the base version are carried as they are; remove any that no longer holds, or add new ones."
            />
          </div>
          <aside aria-label="This new version" className="flex w-full shrink-0 flex-col gap-4 xl:sticky xl:top-4 xl:w-80">
            <section className="flex flex-col gap-3 rounded-lg border border-edge bg-panel p-4">
              <h2 className="text-base font-semibold text-fg">This new version</h2>
              <p className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
                <StatusBadge kind="proposed" word="Draft" />
                <span>
                  <Code className="text-fg">v{next}</Code>, from v{base.n}. Nothing changes until you approve it.
                </span>
              </p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-edge-subtle pt-3 text-sm">
                {(
                  [
                    ['Kept', counts.kept],
                    ['Changed', counts.changed],
                    ['Dropped', counts.dropped],
                    ['New', counts.added],
                  ] as const
                )
                  .filter(([, n]) => n > 0)
                  .map(([word, n]) => (
                    <div key={word} className="contents">
                      <dt className="text-fg-2">{word}</dt>
                      <dd className="font-medium text-fg tabular-nums">{n}</dd>
                    </div>
                  ))}
              </dl>
              {choices.length === 0 ? <p className="text-sm text-fg-2">No check has a choice yet.</p> : null}
            </section>
            <MissingList missing={miss} />
          </aside>
        </div>
        <SaveFooter
          summary={
            <>
              v{next} as a draft{choices.length > 0 ? ` · checks: ${choices.join(', ')}` : ''}
            </>
          }
          missing={miss}
          error={command.error}
          pending={command.isPending}
          canSave={ready}
          onSave={save}
          onCancel={back}
        />
      </PageBody>
      {guard.dialog}
    </>
  );
}
