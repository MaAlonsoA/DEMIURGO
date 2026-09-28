// New record written by hand (DESIGN.md §3.6, INV-NEWREC-*): what it is (any of the eight types),
// its title and area, the type's template sections in Markdown, its checks and its links. Version
// 1 is saved as a draft; nothing is decided until the person approves it on its page. Switching the
// type keeps the text of sections the new type doesn't have; the summary and "Save draft" stay in
// a sticky footer; leaving with unsaved text asks first. DEMIURGO is not asked anything.

import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { stateQuery } from '../../api/queries.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { ChoiceGroup, Field, TextInput } from '../../components/Field.tsx';
import { PlusIcon } from '../../components/icons.tsx';
import { Notice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, usePageTitle } from '../../components/Page.tsx';
import { StatusBadge } from '../../components/status.tsx';
import { TypeIcon } from '../../components/types.tsx';
import { useProjectId } from '../../lib/hooks.ts';
import { typeWordFor, useSafeLocale, useTypeWord } from '../../words.ts';
import { useMessages } from '../../i18n/define.ts';
import { CheckEditor } from '../new-version/CheckEditor.tsx';
import { FormPanel, MissingList, SaveFooter, SectionField, useLeaveGuard } from '../new-version/FormParts.tsx';
import { type CheckDraft, addCheck } from '../new-version/form.ts';
import { linkTargets } from '../new-version/links.ts';
import { LinksEditor } from '../new-version/LinksEditor.tsx';
import {
  type RecordForm,
  type RecordType,
  WRITABLE_TYPES,
  blankRecord,
  domainHint,
  recordDirty,
  recordMissing,
  toCreateCommand,
  withType,
} from './form.ts';
import { NEW_RECORD } from './words.i18n.ts';

const DOMAIN = /^[a-z][a-z_]*$/;

export function NewRecordScreen() {
  const t = useMessages(NEW_RECORD);
  const locale = useSafeLocale();
  const projectId = useProjectId();
  const search = useSearch({ strict: false }) as { type?: string };
  const initial = WRITABLE_TYPES.find((tp) => tp === search.type) ?? 'decision';
  const navigate = useNavigate();
  const state = useQuery(stateQuery(projectId));
  const command = useCommand<{ code: string; version: number }>(projectId);
  const [form, setForm] = useState<RecordForm>(() => blankRecord(initial));
  const hintId = useId();
  usePageTitle([t.newRecord, state.data?.project.name]);
  const domains = [...new Set([...(state.data?.decisions ?? []), ...(state.data?.designs ?? [])].map((r) => r.domain))].sort();
  const miss = recordMissing(form);
  const needsChecks = form.type !== 'decision';
  const guard = useLeaveGuard(recordDirty(form) && !command.isSuccess);
  const areaInvalid = form.domain.trim() !== '' && !DOMAIN.test(form.domain.trim());
  const typeWord = useTypeWord(form.type);

  const update = (next: CheckDraft) => setForm((f) => ({ ...f, checks: f.checks.map((c) => (c.key === next.key ? next : c)) }));
  const remove = (key: string) => setForm((f) => ({ ...f, checks: f.checks.filter((c) => c.key !== key) }));
  const save = () => {
    if (miss.length > 0) return;
    command.mutate(
      { command: 'record.create', data: toCreateCommand(form) },
      {
        onSuccess: (r) => {
          if (!r.result) return;
          guard.release();
          announce(t.savedAnnounce(r.result.code, r.result.version));
          void navigate({
            to: '/p/$projectId/records/$code',
            params: { projectId, code: r.result.code },
            search: { v: r.result.version },
          });
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: t.product, link: { to: '/p/$projectId', params: { projectId } } }, { label: t.newRecord }]}
        title={t.newRecord}
        meta={<span>{t.writeItYourself}</span>}
      />
      <PageBody className="pb-0">
        <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <FormPanel title={t.whatItIs}>
              <ChoiceGroup
                legend={t.whatItIs}
                legendHidden
                columns={3}
                value={[form.type]}
                onChange={([tp]) => tp && setForm((f) => withType(f, tp as RecordType))}
                choices={WRITABLE_TYPES.map((tp) => ({
                  value: tp,
                  label: (
                    <span className="inline-flex items-center gap-2">
                      <TypeIcon type={tp} size={15} className="text-fg-2" />
                      {typeWordFor(locale, tp)}
                    </span>
                  ),
                }))}
              />
              <p id={hintId} className="text-sm text-fg-2" aria-live="polite">
                {t.hint(form.type)}
              </p>
              {form.kept.length > 0 ? (
                <Notice tone="info" title={t.keptFromPreviousType}>
                  <p>{t.keptBody}</p>
                  <dl className="mt-2 flex flex-col gap-2">
                    {form.kept.map((k) => (
                      <div key={k.title} className="flex flex-col gap-0.5">
                        <dt className="font-medium text-fg">{k.title}</dt>
                        <dd className="whitespace-pre-wrap text-fg-2">{k.content}</dd>
                      </div>
                    ))}
                  </dl>
                </Notice>
              ) : null}
            </FormPanel>

            <FormPanel title={t.content}>
              <Field label={t.title} count={[form.title.length, 200]}>
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
              <Field label={t.area} hint={t.areaHint} error={areaInvalid ? t.areaError(domainHint(form.domain)) : undefined}>
                {(p) => (
                  <>
                    <TextInput
                      {...p}
                      value={form.domain}
                      list={`${hintId}-areas`}
                      maxLength={40}
                      autoComplete="off"
                      onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
                    />
                    <datalist id={`${hintId}-areas`}>
                      {domains.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
              {form.sections.map((s, i) => (
                <SectionField
                  key={`${form.type}-${s.title}`}
                  title={s.title}
                  content={s.content}
                  onChange={(content) =>
                    setForm((f) => ({ ...f, sections: f.sections.map((x, j) => (j === i ? { ...x, content } : x)) }))
                  }
                />
              ))}
            </FormPanel>

            {needsChecks || form.checks.length > 0 ? (
              <FormPanel
                title={
                  <>
                    {t.checks} <span className="font-normal text-fg-2">· {form.checks.length}</span>
                  </>
                }
                note={needsChecks ? t.checksNoteRequired(typeWord) : t.checksNoteOptional}
              >
                {form.checks.length > 0 ? (
                  <ol className="flex flex-col gap-3">
                    {form.checks.map((c, i) => (
                      <CheckEditor key={c.key} check={c} index={i} onChange={update} onRemove={() => remove(c.key)} />
                    ))}
                  </ol>
                ) : null}
                <Button className="self-start" icon={<PlusIcon size={14} />} onClick={() => setForm(addCheck)}>
                  {t.addACheck}
                </Button>
              </FormPanel>
            ) : null}

            <LinksEditor
              targets={linkTargets(state.data)}
              links={form.links}
              onChange={(links) => setForm((f) => ({ ...f, links }))}
            />
          </div>
          <aside aria-label={t.thisNewRecord} className="flex w-full shrink-0 flex-col gap-4 xl:sticky xl:top-4 xl:w-80">
            <section className="flex flex-col gap-2 rounded-lg border border-edge bg-panel p-4">
              <h2 className="text-base font-semibold text-fg">{t.thisNewRecord}</h2>
              <p className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
                <StatusBadge kind="proposed" word={t.draft} />
                {t.versionOneAsDraft}
              </p>
            </section>
            <MissingList missing={miss} />
          </aside>
        </div>
        <SaveFooter
          summary={t.summary(typeWord, form.checks.length, form.links.length)}
          missing={miss}
          error={command.error}
          pending={command.isPending}
          canSave={miss.length === 0}
          onSave={save}
          onCancel={() => void navigate({ to: '/p/$projectId', params: { projectId } })}
        />
      </PageBody>
      {guard.dialog}
    </>
  );
}
