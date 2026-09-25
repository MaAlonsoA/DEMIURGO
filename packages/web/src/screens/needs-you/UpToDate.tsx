// "You're up to date" (canvas S6C): when nothing needs the person (Needs you empty, or the end of
// Catch up). What they did today, told with the lines of the lens in the design system's WhileAway
// ("Show everything" opens Activity); where the product is; what DEMIURGO is still doing, in amber;
// and that they can close DEMIURGO: everything is saved.

import { WhileAway } from '@demiurgo/design-system';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useId } from 'react';
import { changesQuery, runsQuery, stateQuery } from '../../api/queries.ts';
import { Code } from '../../ui/Card.tsx';
import { Page, PageTitle, Skeleton } from '../../ui/layout.tsx';
import { Mark } from '../../ui/marks.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { PRODUCT_WORDS, whoOf } from '../../words.ts';
import { ProgressLine, RunningNow } from '../overview/Blueprint.tsx';
import { draftingRuns, productProgress, workingRuns } from '../overview/progress.ts';
import { useNow } from '../run/hooks.ts';
import { todayLines } from './today.ts';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function UpToDate({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const state = useQuery(stateQuery(projectId)).data;
  const changes = useQuery({ ...changesQuery(projectId, '0'), staleTime: 0 });
  const all = useQuery(runsQuery(projectId)).data ?? [];
  const runs = workingRuns(all);
  const now = useNow(runs.length > 0);
  const rows = [...(state?.designs ?? []), ...(state?.decisions ?? [])];
  const records: Record<string, { title: string; checks: number }> = {};
  for (const r of rows) records[r.code] = { title: r.title, checks: r.checks };
  // Nothing waits for the person here: where the product is, from its readiness and its runs.
  const progress = productProgress(rows, () => 0, all, draftingRuns(all).length);
  const productId = useId();
  const lines = changes.data ? todayLines(changes.data, new Date(now), { records }) : null;
  const threads = new Map((state?.explorations ?? []).map((e) => [e.id, e.purpose]));
  const id = useId();
  const today = new Date(now);
  const n = lines?.length ?? 0;

  return (
    <Page
      aside={<RunningNow projectId={projectId} runs={runs} threads={threads} now={now} title="In progress" />}
      asideFooter={
        <div data-close className="flex flex-col gap-1.5 rounded-card-md bg-surface-soft px-4 py-3.5">
          <strong className="dm-text-small font-semibold">{PRODUCT_WORDS.nothingNeedsYou}</strong>
          <span className="dm-text-small text-ink-3">
            Everything is saved. When you come back, I'll show you what changed while you were away.
          </span>
        </div>
      }
    >
      <PageTitle
        eyebrow={`${today.toLocaleDateString('en-GB', { weekday: 'long' }).toUpperCase()} · ${time(today.toISOString())}`}
        title="You're up to date"
        subtitle={
          lines === null
            ? undefined
            : `${n === 0 ? 'Nothing done yet today.' : `${n} ${n === 1 ? 'thing' : 'things'} done today.`} Nothing waits for you.`
        }
        className="mb-5 [&_h1]:leading-tight"
      />
      <section aria-labelledby={id} className="max-w-[1000px]">
        {lines === null ? (
          <div className="dm-panel">
            <strong id={id} className="dm-text-heading">
              Today
            </strong>
            <div className="flex flex-col gap-2 py-1" aria-hidden="true">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ) : (
          <WhileAway
            width="100%"
            title={
              <span id={id}>
                Today
                {lines[0] && <span className="font-normal text-muted"> · since {time(lines[0].at)}</span>}
              </span>
            }
            onShowAll={() => void navigate({ to: '/p/$projectId/activity', params: { projectId } })}
            items={lines.map((l) => ({
              id: l.id,
              time: time(l.at),
              who: whoOf(l.actor).kind,
              whoMark: <WhoMark actor={l.actor} size={18} />,
              text: l.segments.map((s, i) =>
                typeof s === 'string' ? (
                  <span key={i}>{s}</span>
                ) : (
                  <strong key={i} className="font-semibold">
                    {s.strong}
                  </strong>
                ),
              ),
              trailing:
                l.problem || l.codes.length > 0 ? (
                  <span className="flex items-center gap-2">
                    {l.problem && <Mark kind="conflict" label="A problem" />}
                    {l.codes.map((c) => (
                      <Code key={c}>{c}</Code>
                    ))}
                  </span>
                ) : undefined,
            }))}
            note={lines.length === 0 ? 'Nothing yet today. What you do here is kept and shown next time.' : undefined}
          />
        )}
      </section>
      {state && (
        <section aria-labelledby={productId} className="mt-7 flex max-w-[1000px] flex-col gap-1">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id={productId} className="dm-text-caption font-semibold text-muted">
              The product · {state.project.name}
            </h2>
            <Link
              to="/p/$projectId"
              params={{ projectId }}
              className="dm-text-caption font-semibold text-needs-strong hover:underline"
            >
              See the product
            </Link>
          </div>
          <ProgressLine progress={progress} />
        </section>
      )}
    </Page>
  );
}
