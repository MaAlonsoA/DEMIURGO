// Product → Journeys (DESIGN.md §3.7, FDR-INT-002): how people will use what is being designed. One
// journey per feature with a written Behavior: its numbered points are the steps, its criteria the
// paths ("If … → then …"), and the open questions of its thread are the gaps that wait on the
// person. The list of journeys is a single-select listbox (arrow keys move the selection, which
// lives in ?j=); every step shows all its details on demand instead of a dead "+n more"; nothing is
// clamped without a way to read it (INV-JRN-01…08).

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { projectsQuery } from '../../api/queries.ts';
import { type Journey, journeysQuery } from '../../api/views.ts';
import { Code } from '../../components/Badge.tsx';
import { buttonClass } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ArrowRightIcon, ChecksIcon, ChevronDownIcon, JourneyIcon, ProductIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, usePageTitle } from '../../components/Page.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { Certainty } from '../../components/status.tsx';
import { cn } from '../../lib/cn.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { ProductTabs } from '../../shell/ProductTabs.tsx';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The line under a journey in the list (INV-JRN-02). */
function summaryOf(j: Journey): string {
  if (j.gaps.length > 0) return `${plural(j.gaps.length, 'path waits', 'paths wait')} on you`;
  return j.paths.length > 0 ? 'All paths defined' : 'No paths written yet';
}

export function JourneysScreen() {
  const projectId = useProjectId();
  const journeys = useQuery(journeysQuery(projectId));
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  usePageTitle(['Journeys', project?.name]);
  const search = useSearch({ strict: false }) as { j?: string };
  const navigate = useNavigate();
  const list = journeys.data?.journeys ?? [];
  const current = list.find((j) => j.code === search.j) ?? list[0];
  const choose = (code: string) =>
    void navigate({ to: '/p/$projectId/journeys', params: { projectId }, search: { j: code }, replace: true });
  const name = journeys.data?.project.name ?? project?.name;

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <ProductIcon size={15} className="text-fg-3" />
            <span>{project?.name ?? 'Product'}</span>
          </>
        }
        title="Journeys"
        meta={name ? `How people will use ${name}: one journey per feature with its behavior written.` : null}
        tabs={<ProductTabs active="journeys" />}
      />
      <PageBody>
        {journeys.error ? (
          <ErrorNotice error={journeys.error} onRetry={() => void journeys.refetch()} />
        ) : journeys.isPending ? (
          <JourneysSkeleton />
        ) : list.length === 0 || !current ? (
          <EmptyState icon={<JourneyIcon size={28} />} title="No journeys yet" size="spacious">
            A journey appears when a feature has its behavior written: its steps come from it, and its paths from its checks.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
            <JourneyList journeys={list} current={current.code} onChoose={choose} />
            <JourneyView key={current.code} projectId={projectId} journey={current} />
          </div>
        )}
      </PageBody>
    </>
  );
}

/**
 * The journeys as an APG single-select listbox: one tab stop, arrow keys (and Home/End) move the
 * selection, which follows the focus (R93). Each option says what waits on the person in words.
 */
function JourneyList({
  journeys,
  current,
  onChoose,
}: {
  journeys: Journey[];
  current: string;
  onChoose: (code: string) => void;
}) {
  const id = useId();
  const box = useRef<HTMLUListElement>(null);
  const index = Math.max(
    0,
    journeys.findIndex((j) => j.code === current),
  );
  const optionId = (code: string) => `${id}-${code}`;
  const move = (i: number) => {
    const next = journeys[Math.min(journeys.length - 1, Math.max(0, i))];
    if (!next || next.code === current) return;
    onChoose(next.code);
    document.getElementById(optionId(next.code))?.scrollIntoView({ block: 'nearest' });
  };
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'ArrowDown') move(index + 1);
    else if (e.key === 'ArrowUp') move(index - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(journeys.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div className="flex w-full shrink-0 flex-col gap-2 lg:sticky lg:top-4 lg:w-72">
      <h2 id={`${id}-label`} className="text-sm font-medium text-fg-2">
        {plural(journeys.length, 'journey', 'journeys')}
      </h2>
      <ul
        ref={box}
        role="listbox"
        aria-label="Journeys"
        aria-describedby={`${id}-label`}
        aria-activedescendant={optionId(current)}
        tabIndex={0}
        onKeyDown={onKey}
        className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto rounded-lg outline-offset-2 lg:max-h-[calc(100vh-240px)]"
      >
        {journeys.map((j) => {
          const on = j.code === current;
          return (
            <li
              key={j.code}
              id={optionId(j.code)}
              role="option"
              aria-selected={on}
              data-journey-option={j.code}
              onClick={() => {
                onChoose(j.code);
                box.current?.focus();
              }}
              className={cn(
                'flex cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2.5',
                on ? 'border-accent-edge bg-selected' : 'border-transparent hover:bg-hover',
              )}
            >
              <span className={cn('text-base text-fg', on ? 'font-semibold' : 'font-medium')}>{j.title}</span>
              <span className={cn('text-sm', j.gaps.length > 0 ? 'font-medium text-accent-text' : 'text-fg-2')}>
                {summaryOf(j)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function JourneyView({ projectId, journey: j }: { projectId: string; journey: Journey }) {
  const defined = j.paths.length;
  const gaps = j.gaps.length;
  return (
    <article aria-labelledby="journey-title" data-journey={j.code} className="flex min-w-0 flex-1 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h2 id="journey-title" className="text-xl font-semibold text-fg">
          {j.title}
        </h2>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-2">
          <Certainty status={j.epistemic_status} />
          <span>
            From the behavior and the checks of{' '}
            <Link
              to="/p/$projectId/records/$code"
              params={{ projectId, code: j.code }}
              search={{ v: j.version }}
              className="font-medium text-accent-text underline-offset-2 hover:underline"
            >
              {j.code} v{j.version}
            </Link>
          </span>
        </p>
      </header>

      <Section id="journey-steps" title="Steps" note={plural(j.steps.length, 'step', 'steps')}>
        {j.steps.length === 0 ? (
          <p className="text-sm text-fg-2">Its behavior has no numbered steps yet.</p>
        ) : (
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {j.steps.map((s) => (
              <Step key={s.n} step={s} total={j.steps.length} />
            ))}
          </ol>
        )}
      </Section>

      <Section
        id="journey-paths"
        title="Paths"
        note={`${plural(defined, 'path', 'paths')} defined${gaps > 0 ? ` · ${plural(gaps, 'gap', 'gaps')} not defined yet` : ''}`}
      >
        {defined + gaps === 0 ? (
          <p className="text-sm text-fg-2">No paths written yet: they come from the feature's checks.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {j.paths.map((p) => (
              <li key={p.code} data-path={p.code} className="flex flex-col gap-1.5 rounded-lg border border-edge bg-panel p-4">
                <span className="text-sm text-fg-2">{p.given ? `If ${p.given}` : p.title}</span>
                {p.when ? <span className="text-sm text-fg">When {p.when}</span> : null}
                <span className="text-base font-medium text-fg">→ {p.outcome}</span>
                <span className="mt-auto flex items-center gap-2 border-t border-edge-subtle pt-2 text-xs text-fg-2">
                  <ChecksIcon size={13} className="shrink-0 text-fg-3" />
                  <span className="min-w-0 flex-1">
                    {p.title} · {p.verification === 'manual' ? 'You check it' : 'Checked automatically'}
                  </span>
                  <Code className="shrink-0">{p.code}</Code>
                </span>
              </li>
            ))}
            {j.gaps.map((g) => (
              <li
                key={g.id}
                data-gap={g.id}
                className="flex flex-col gap-1.5 rounded-lg border border-dashed border-accent-edge bg-accent-soft p-4"
              >
                <span className="text-sm font-medium text-accent-text">Not defined yet</span>
                <span className="text-base font-medium text-fg">{g.question}</span>
                <span className="text-sm text-fg-2">Waiting on your answer in its thread.</span>
                <Link
                  to="/p/$projectId/threads/$explorationId"
                  params={{ projectId, explorationId: g.exploration_id }}
                  aria-label={`Answer: ${g.question}`}
                  className={buttonClass({ variant: 'secondary', size: 'sm', className: 'mt-auto self-start' })}
                >
                  Answer
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <footer
        data-journey-summary
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-lg border border-edge bg-sunken px-5 py-4"
      >
        <dl className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <Figure n={defined + gaps} label="paths in this journey" />
          <Figure n={defined} label="defined" />
          <Figure n={gaps} label="waiting on you" accent={gaps > 0} />
          <Figure n={j.steps.length} label="steps" />
        </dl>
        {gaps > 0 && j.origin_exploration ? (
          <Link
            to="/p/$projectId/threads/$explorationId"
            params={{ projectId, explorationId: j.origin_exploration }}
            className={buttonClass({ variant: 'primary' })}
          >
            Answer {plural(gaps, 'question', 'questions')}
            <ArrowRightIcon size={15} />
          </Link>
        ) : null}
      </footer>
    </article>
  );
}

const SHOWN_DETAILS = 4;

/** A step: its title and every detail; past four, "Show all n details" opens the rest in place. */
function Step({ step: s, total }: { step: Journey['steps'][number]; total: number }) {
  const [all, setAll] = useState(false);
  const id = useId();
  const extra = s.detail.length - SHOWN_DETAILS;
  const shown = all ? s.detail : s.detail.slice(0, SHOWN_DETAILS);
  return (
    <li data-step={s.n} className="flex flex-col gap-2 rounded-lg border border-edge bg-panel p-4">
      <span className="text-xs font-medium text-fg-3 tabular-nums">
        Step {s.n} of {total}
      </span>
      <strong className="text-base font-semibold text-fg">{s.title}</strong>
      {s.detail.length > 0 ? (
        <ul id={`${id}-details`} className="flex list-disc flex-col gap-1 pl-4 text-sm text-fg-2">
          {shown.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
      {extra > 0 ? (
        <button
          type="button"
          aria-expanded={all}
          aria-controls={`${id}-details`}
          onClick={() => setAll((v) => !v)}
          className="inline-flex min-h-6 cursor-pointer items-center gap-1 self-start rounded-xs text-sm font-medium text-accent-text hover:underline"
        >
          {all ? 'Show fewer' : `Show all ${s.detail.length} details`}
          <ChevronDownIcon size={14} className={cn('transition-transform', all && 'rotate-180')} />
        </button>
      ) : null}
    </li>
  );
}

function Figure({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs text-fg-2">{label}</dt>
      <dd className={cn('text-xl font-semibold tabular-nums', accent ? 'text-accent-text' : 'text-fg')}>{n}</dd>
    </div>
  );
}

function JourneysSkeleton() {
  return (
    <Skeleton label="Loading the journeys" className="flex flex-col gap-8 lg:flex-row">
      <div className="flex w-full flex-col gap-2 lg:w-72">
        {[0, 1, 2].map((i) => (
          <Bone key={i} className="h-14 w-full rounded-md" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Bone className="h-6 w-2/3" />
        <Bone className="h-3 w-1/3" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Bone className="h-28 w-full rounded-lg" />
          <Bone className="h-28 w-full rounded-lg" />
        </div>
      </div>
    </Skeleton>
  );
}
