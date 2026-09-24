// Needs you (spec §4.8): everything that waits for the person, grouped in the order Catch up walks
// it, each thing resolved in place. With ?catch-up=1 it becomes Catch up: one thing at a time.

import { useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useId } from 'react';
import { explorationsQuery, inboxQuery, stateQuery, taxonomiesQuery } from '../../api/queries.ts';
import type { ProductRow } from '../../api/types.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { buttonStyles } from '../../ui/Button.tsx';
import { WarningIcon } from '../../ui/icons.tsx';
import { Page, PageTitle, Skeleton } from '../../ui/layout.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { NeedsBubble } from '../../ui/signals.tsx';
import { CatchUp } from './CatchUp.tsx';
import { KIND_WORDS, type NeedContext } from './frame.tsx';
import { catchUpOrder, type Group, type GroupKey, groupsOf, minutesOf, type NeedItem, needsOf } from './order.ts';
import { NeedView, needTitle } from './NeedView.tsx';
import { UpToDate } from './UpToDate.tsx';

const HINTS: Record<GroupKey, string> = {
  conflicts: 'Knowledge found them. DEMIURGO recommends; you decide.',
  questions: 'The ones that block something come first.',
  proposals: 'A package is decided whole; a batch, one proposal at a time.',
  versions: "Approving doesn't create a new version.",
  links: 'What they point to has a newer version.',
  classifications: "DEMIURGO wasn't sure where they go.",
  updates: 'Until they are taken in, the knowledge is behind.',
};

export function NeedsYouScreen() {
  const projectId = useProjectId();
  const search = useSearch({ strict: false }) as { 'catch-up'?: number };
  const inbox = useQuery(inboxQuery(projectId));
  const state = useQuery(stateQuery(projectId));
  const threads = useQuery(explorationsQuery(projectId)).data ?? [];
  const taxonomies = useQuery(taxonomiesQuery(projectId)).data ?? [];
  const rows: ProductRow[] = state.data ? [...state.data.decisions, ...state.data.designs] : [];
  const ctx: NeedContext = { projectId, rows, threads, taxonomies };
  const error = inbox.error ?? state.error;
  if (error) {
    return (
      <Page>
        <PageTitle title="Needs you" />
        <Reasons error={error} />
      </Page>
    );
  }
  const items = inbox.data && state.data ? needsOf(inbox.data, rows) : null;
  if (search['catch-up']) return <CatchUp ctx={ctx} items={items} />;
  return <NeedsList ctx={ctx} items={items} total={inbox.data?.total ?? 0} />;
}

function NeedsList({ ctx, items, total }: { ctx: NeedContext; items: NeedItem[] | null; total: number }) {
  const groups = items ? groupsOf(items) : [];
  // Nothing left: you're up to date (canvas S6C).
  if (items && items.length === 0) return <UpToDate projectId={ctx.projectId} />;
  return (
    <Page aside={items && items.length > 0 ? <InOrder ctx={ctx} items={items} /> : undefined}>
      <PageTitle
        title={
          <span className="flex items-center gap-3">
            Needs you
            <NeedsBubble count={total} />
          </span>
        }
        subtitle="Everything that waits for you. Each thing is resolved here, in place."
      />
      {!items ? (
        <ListSkeleton />
      ) : (
        <div className="flex max-w-[980px] flex-col gap-8">
          {groups.map((g) => (
            <GroupSection key={g.key} group={g} ctx={ctx} />
          ))}
        </div>
      )}
    </Page>
  );
}

function GroupSection({ group, ctx }: { group: Group; ctx: NeedContext }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-group={group.key}>
      <div className="mb-2.5 flex items-baseline justify-between gap-4">
        <h2 id={id} className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
          {group.key === 'conflicts' && <WarningIcon size={13} className="text-problem" />}
          {group.title}
          <span className="font-normal text-muted">({group.items.length})</span>
        </h2>
        <span className="text-xs text-muted">{HINTS[group.key]}</span>
      </div>
      <ul className="flex flex-col divide-y divide-line-soft rounded-[var(--radius-panel)] border border-line bg-surface">
        {group.items.map((item) => (
          <li key={item.key}>
            <NeedView item={item} ctx={ctx} mode="row" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The right column: the first things in Catch up order, the time it takes, and Catch up. */
function InOrder({ ctx, items }: { ctx: NeedContext; items: NeedItem[] }) {
  const ordered = catchUpOrder(items);
  const first = ordered.slice(0, 4);
  const more = ordered.length - first.length;
  return (
    <section aria-label="Catch up" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">In this order</h2>
        <span className="text-xs text-muted">about {minutesOf(items)} min in all</span>
      </div>
      <p className="text-[13px] text-ink-3">What unblocks the most comes first.</p>
      <ol className="flex flex-col gap-2">
        {first.map((item, i) => (
          <li
            key={item.key}
            className="flex flex-col gap-0.5 rounded-xl border border-needs-ring bg-needs-bg px-[13px] py-2.5"
            data-order={item.key}
          >
            <span className="flex items-center justify-between text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
              <span className={item.kind === 'conflict' ? 'text-problem' : ''}>
                {i + 1} · {KIND_WORDS[item.kind].word}
              </span>
              <span className="font-medium tracking-normal normal-case">{item.minutes} min</span>
            </span>
            <strong className="line-clamp-2 text-[14px] leading-snug font-semibold">{needTitle(item, ctx.rows)}</strong>
            {item.unblocks.length > 0 && (
              <span className="truncate text-xs text-ink-3">
                Unblocks: {item.unblocks.map((c) => ctx.rows.find((r) => r.code === c)?.title ?? c).join(', ')}
              </span>
            )}
          </li>
        ))}
      </ol>
      {more > 0 && <p className="text-xs text-muted">and {more} more</p>}
      <Link
        to="/p/$projectId/needs-you"
        params={{ projectId: ctx.projectId }}
        search={{ 'catch-up': 1 }}
        className={buttonStyles({ variant: 'needs', size: 'lg', className: 'mt-1 w-full' })}
      >
        Catch up
      </Link>
      <p className="text-center text-xs text-muted">One at a time, in this order. What you skip stays here.</p>
    </section>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading what needs you" className="flex max-w-[980px] flex-col gap-8">
      {[3, 2].map((n) => (
        <div key={n} className="flex flex-col gap-2.5">
          <Skeleton className="h-3 w-40" />
          <div className="flex flex-col divide-y divide-line-soft rounded-[var(--radius-panel)] border border-line bg-surface">
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className="flex flex-col gap-2 px-[18px] py-3.5">
                <Skeleton className="h-2.5 w-32" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="mt-1 h-8 w-56" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
