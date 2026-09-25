// Product → Journeys (FDR-INT-002; canvas S2C): how people will use what is being designed. One
// journey per feature with a written Behavior: its numbered points are the steps, its criteria are
// the paths («If … → then …»), and the open questions of its thread are the gaps that wait on the
// person. Nothing is invented: what isn't written shows as not defined yet.

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { type Journey, journeysQuery } from '../../api/views.ts';
import { cn } from '../../lib/cn.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { buttonStyles } from '../../ui/Button.tsx';
import { TypeIcon } from '../../ui/icons.tsx';
import { EmptyState, Page, Skeleton } from '../../ui/layout.tsx';
import { MarkWord } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { EPISTEMIC_MARK, MARKS } from '../../words.ts';
import { ProductTabs } from '../shell/Header.tsx';

function summaryOf(j: Journey): string {
  if (j.gaps.length > 0) return `${j.gaps.length} ${j.gaps.length === 1 ? 'path waits' : 'paths wait'} on you`;
  return j.paths.length > 0 ? 'All paths defined' : 'No paths written yet';
}

export function JourneysScreen() {
  const projectId = useProjectId();
  const journeys = useQuery(journeysQuery(projectId));
  const search = useSearch({ strict: false }) as { j?: string };
  const navigate = useNavigate();
  const list = journeys.data?.journeys ?? [];
  const current = list.find((j) => j.code === search.j) ?? list[0];
  const choose = (code: string) =>
    void navigate({ to: '/p/$projectId/journeys', params: { projectId }, search: { j: code }, replace: true });

  return (
    <Page>
      <ProductTabs active="journeys" />
      {journeys.error ? <Reasons error={journeys.error} /> : null}
      {journeys.isPending ? (
        <Skeleton className="h-[480px] w-full" />
      ) : list.length === 0 ? (
        <EmptyState>
          No journeys yet. A journey appears when a feature has its behavior written: its steps come from it, and its paths from
          its checks.
        </EmptyState>
      ) : (
        <div className="flex gap-6">
          <nav aria-label="Journeys" className="flex w-[270px] shrink-0 flex-col gap-1.5">
            <div className="flex flex-col px-2 pb-2">
              <h2 className="text-[15px] font-semibold">Journeys</h2>
              <span className="text-xs text-muted">How people will use {journeys.data?.project.name}</span>
            </div>
            {list.map((j) => {
              const active = j.code === current?.code;
              return (
                <button
                  key={j.code}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => choose(j.code)}
                  className={cn(
                    'flex flex-col gap-0.5 rounded-[10px] px-3 py-2.5 text-left',
                    active ? 'border border-needs bg-surface' : 'border border-transparent hover:bg-line-soft',
                  )}
                >
                  <span className={cn('text-[14px]', active ? 'font-semibold' : 'font-medium')}>{j.title}</span>
                  <span className={cn('text-xs', j.gaps.length > 0 ? 'font-semibold text-needs' : 'text-muted')}>
                    {summaryOf(j)}
                  </span>
                </button>
              );
            })}
          </nav>
          {current && <JourneyView projectId={projectId} journey={current} />}
        </div>
      )}
    </Page>
  );
}

function JourneyView({ projectId, journey: j }: { projectId: string; journey: Journey }) {
  const mark = EPISTEMIC_MARK[j.epistemic_status] ?? 'unknown';
  const defined = j.paths.length;
  return (
    <article aria-labelledby="journey-title" data-journey={j.code} className="flex min-w-0 flex-1 flex-col gap-6">
      <header className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h1 id="journey-title" className="text-[24px] leading-tight font-semibold">
            {j.title}
          </h1>
          <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            <MarkWord kind={mark} word={MARKS[mark].name} />
            <span aria-hidden="true">·</span>
            From the behavior and the checks of
            <Link
              to="/p/$projectId/records/$code"
              params={{ projectId, code: j.code }}
              search={{ v: j.version }}
              className="font-semibold text-needs hover:underline"
            >
              {j.code} v{j.version}
            </Link>
          </span>
        </div>
      </header>

      <section aria-labelledby="journey-steps">
        <h2 id="journey-steps" className="mb-2.5 text-[13px] font-semibold text-ink-2">
          Steps
        </h2>
        <ol className="flex gap-3 overflow-x-auto pb-2">
          {j.steps.map((s, i) => (
            <li key={s.n} className="flex shrink-0 items-stretch gap-3">
              <div
                data-step={s.n}
                className="flex w-[220px] flex-col gap-1.5 rounded-[var(--radius-card)] border border-line bg-surface p-3.5"
              >
                <span className="text-[11px] text-muted">Step {s.n}</span>
                <strong className="text-[14px] leading-snug font-semibold">{s.title}</strong>
                {s.detail.length > 0 && (
                  <ul className="flex flex-col gap-1 text-[12px] text-ink-3">
                    {s.detail.slice(0, 4).map((d) => (
                      <li key={d} className="line-clamp-2">
                        {d}
                      </li>
                    ))}
                    {s.detail.length > 4 && <li className="text-muted">+{s.detail.length - 4} more</li>}
                  </ul>
                )}
              </div>
              {i < j.steps.length - 1 && (
                <span aria-hidden="true" className="flex items-center text-inactive">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="journey-paths">
        <h2 id="journey-paths" className="mb-2.5 text-[13px] font-semibold text-ink-2">
          Paths
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {j.paths.map((p) => (
            <li key={p.code} data-path={p.code}>
              <PathCard
                kicker={p.given ? `If ${p.given}` : p.title}
                title={p.when ? `When ${p.when}` : null}
                outcome={p.outcome}
                foot={
                  <span className="flex items-center gap-1.5 text-[11px] text-ink-2">
                    <TypeIcon kind="check" size={12} />
                    {p.title} · {p.verification === 'manual' ? 'You check it' : 'Checked automatically'}
                    <span className="ml-auto font-mono text-muted">{p.code}</span>
                  </span>
                }
              />
            </li>
          ))}
          {j.gaps.map((g) => (
            <li key={g.id} data-gap={g.id}>
              <div className="flex h-full flex-col gap-1.5 rounded-[var(--radius-card)] border border-dashed border-needs bg-surface p-3.5">
                <span className="text-[11px] font-semibold text-needs">Not defined yet</span>
                <strong className="text-[14px] leading-snug font-semibold">{g.question}</strong>
                <span className="text-[12px] text-ink-3">Waiting on your answer in its thread.</span>
                <Link
                  to="/p/$projectId/threads/$explorationId"
                  params={{ projectId, explorationId: g.exploration_id }}
                  className={cn(buttonStyles({ variant: 'needs', size: 'sm' }), 'mt-auto self-start')}
                >
                  Answer
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <footer
        data-journey-summary
        className="flex items-center justify-between gap-6 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-3.5"
      >
        <div className="flex items-center gap-7">
          <Figure n={defined + j.gaps.length} label="paths in this journey" />
          <Figure n={defined} label="defined" />
          <Figure n={j.gaps.length} label="waiting on you" tone={j.gaps.length > 0 ? 'needs' : undefined} />
          <Figure n={j.steps.length} label="steps" />
        </div>
        {j.gaps.length > 0 && j.origin_exploration && (
          <Link
            to="/p/$projectId/threads/$explorationId"
            params={{ projectId, explorationId: j.origin_exploration }}
            className={buttonStyles({ variant: 'needs' })}
          >
            Answer {j.gaps.length} {j.gaps.length === 1 ? 'question' : 'questions'}
          </Link>
        )}
      </footer>
    </article>
  );
}

function PathCard({ kicker, title, outcome, foot }: { kicker: string; title: string | null; outcome: string; foot: ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-1.5 rounded-[var(--radius-card)] border border-line bg-surface p-3.5">
      <span className="line-clamp-2 text-[11px] text-muted">{kicker}</span>
      {title && <span className="line-clamp-2 text-[12px] text-ink-2">{title}</span>}
      <strong className="line-clamp-3 text-[14px] leading-snug font-semibold">→ {outcome}</strong>
      <span className="mt-auto border-t border-line-soft pt-2">{foot}</span>
    </div>
  );
}

function Figure({ n, label, tone }: { n: number; label: string; tone?: 'needs' }) {
  return (
    <span className="flex flex-col">
      <strong className={cn('text-[18px] font-semibold tabular-nums', tone === 'needs' && 'text-needs')}>{n}</strong>
      <span className="text-xs text-muted">{label}</span>
    </span>
  );
}
