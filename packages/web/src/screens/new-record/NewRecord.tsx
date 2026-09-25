// New record written by hand: a decision, a feature (FDR), a tech decision (ADR) or a bug. The
// type's template sections in markdown, a title, the area it belongs to and its checks. "Save
// draft" runs record.create (version 1 as a draft) and opens the record, where it is approved.

import { Chip } from '@demiurgo/design-system';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { stateQuery } from '../../api/queries.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { Button, buttonClass } from '../../ui/Button.tsx';
import { PlusIcon, RECORD_ICON, TypeIcon } from '../../ui/icons.tsx';
import { Breadcrumbs, Page } from '../../ui/layout.tsx';
import { Mark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { TYPE_WORDS } from '../../words.ts';
import { CheckEditor, field, titleField } from '../new-version/CheckEditor.tsx';
import { type CheckDraft, addCheck } from '../new-version/form.ts';
import { linkTargets } from '../new-version/links.ts';
import { LinksEditor } from '../new-version/LinksEditor.tsx';
import { Section } from '../new-version/NewVersion.tsx';
import {
  type RecordForm,
  type RecordType,
  WRITABLE_TYPES,
  blankRecord,
  recordMissing,
  toCreateCommand,
  withType,
} from './form.ts';

const HINTS: Record<RecordType, string> = {
  decision: 'Something decided about the product: what, and what follows from it.',
  fdr: 'A feature: what it is for, what it covers and how it behaves, with the checks that prove it.',
  adr: 'A technical choice: the options weighed, the one taken and its consequences, with its checks.',
  bug: 'Something that does not work: how to reproduce it, what was expected and what happened.',
  requirement: 'A requirement in EARS form ("When <trigger>, the system shall <response>"), with the measurable criterion that shows it is met.',
  quality_requirement: 'A quality target (performance, availability, usability…) as a scenario with its measure.',
  threat_model: 'What is protected, from whom, the STRIDE threats and the mitigation for each one.',
  production_readiness: 'How it rolls out and back, how it is monitored, how it fails and scales, and who supports it.',
};

export function NewRecordScreen() {
  const projectId = useProjectId();
  const search = useSearch({ strict: false }) as { type?: string };
  const initial = WRITABLE_TYPES.find((t) => t === search.type) ?? 'decision';
  const navigate = useNavigate();
  const state = useQuery(stateQuery(projectId));
  const command = useCommand<{ code: string; version: number }>(projectId);
  const [form, setForm] = useState<RecordForm>(() => blankRecord(initial));
  const titleId = useId();
  const domainId = useId();
  const domains = [...new Set([...(state.data?.decisions ?? []), ...(state.data?.designs ?? [])].map((r) => r.domain))].sort();
  const miss = recordMissing(form);
  const needsChecks = form.type !== 'decision';

  const update = (next: CheckDraft) => setForm((f) => ({ ...f, checks: f.checks.map((c) => (c.key === next.key ? next : c)) }));
  const remove = (key: string) => setForm((f) => ({ ...f, checks: f.checks.filter((c) => c.key !== key) }));
  const save = () => {
    if (miss.length > 0) return;
    command.mutate(
      { command: 'record.create', data: toCreateCommand(form) },
      {
        onSuccess: (r) => {
          if (!r.result) return;
          void navigate({
            to: '/p/$projectId/records/$code',
            params: { projectId, code: r.result.code },
            search: { v: r.result.version },
          });
        },
      },
    );
  };

  const aside = (
    <>
      <section aria-labelledby={`${titleId}-summary`} className="flex flex-col gap-3">
        <h2 id={`${titleId}-summary`} className="dm-text-heading">
          This new record
        </h2>
        <p className="dm-text-small flex items-center gap-2 text-ink-2">
          <Mark kind="proposed" size={9} label="Draft" />
          <span>Version 1 is saved as a draft. Nothing is decided until you approve it.</span>
        </p>
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
        <Button variant="secondary" disabled={miss.length > 0 || command.isPending} onClick={save}>
          {command.isPending ? 'Saving…' : 'Save draft'}
        </Button>
        <Link to="/p/$projectId" params={{ projectId }} className={buttonClass('text')}>
          Cancel
        </Link>
      </section>
    </>
  );

  return (
    <Page aside={aside} className="[&>*]:max-w-[900px]">
      <Breadcrumbs items={[{ label: 'Product', to: '/p/$projectId', params: { projectId } }, { label: 'New record' }]} />
      <header className="mb-6 flex flex-col gap-1.5">
        <h1 className="dm-text-page-title">New record</h1>
        <p className="dm-text-body text-ink-3">Write it yourself. DEMIURGO is not asked anything.</p>
      </header>

      <div className="flex flex-col gap-6">
        <section
          aria-labelledby={`${titleId}-type`}
          className="flex flex-col gap-2.5 rounded-card border border-line bg-surface px-6 py-5"
        >
          <h2 id={`${titleId}-type`} className="dm-label">
            What it is
          </h2>
          <div role="group" aria-labelledby={`${titleId}-type`} className="flex flex-wrap gap-2">
            {WRITABLE_TYPES.map((t) => (
              <Chip key={t} pressed={form.type === t} onClick={() => setForm((f) => withType(f, t))}>
                <span className="inline-flex items-center gap-1.5">
                  <TypeIcon kind={RECORD_ICON[t] ?? 'feature'} size={13} />
                  {TYPE_WORDS[t]}
                </span>
              </Chip>
            ))}
          </div>
          <p className="dm-text-small text-ink-3">{HINTS[form.type]}</p>
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
          <div className="flex flex-col gap-1">
            <label htmlFor={domainId} className="dm-label">
              Area
            </label>
            <input
              id={domainId}
              value={form.domain}
              list={`${domainId}-known`}
              maxLength={40}
              aria-describedby={`${domainId}-hint`}
              onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
              className={field}
            />
            <datalist id={`${domainId}-known`}>
              {domains.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            <span id={`${domainId}-hint`} className="dm-text-caption text-muted">
              Lowercase letters and underscores. It names the code: «club» gives DEC-CLU-001.
            </span>
          </div>
          {form.sections.map((s, i) => (
            <Section
              key={`${form.type}-${s.title}`}
              title={s.title}
              content={s.content}
              onChange={(content) =>
                setForm((f) => ({ ...f, sections: f.sections.map((x, j) => (j === i ? { ...x, content } : x)) }))
              }
            />
          ))}
        </section>

        {(needsChecks || form.checks.length > 0) && (
          <section aria-labelledby={`${titleId}-checks`} className="flex flex-col gap-2.5">
            <h2 id={`${titleId}-checks`} className="dm-text-caption font-semibold text-muted">
              Checks <span className="font-normal">· {form.checks.length}</span>
            </h2>
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

        <LinksEditor
          targets={linkTargets(state.data)}
          links={form.links}
          onChange={(links) => setForm((f) => ({ ...f, links }))}
        />
      </div>
    </Page>
  );
}
