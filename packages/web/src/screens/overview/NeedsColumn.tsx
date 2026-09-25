// Right column of the overview (canvas B1 and S6A): what needs the person, in the order "Catch
// up" walks it and about how long it takes, what DEMIURGO is running now, the features ready to
// build and what was decided most recently.

import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import type { Inbox, ProductState, RunListItem } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { buttonClass } from '../../ui/Button.tsx';
import { Skeleton } from '../../ui/layout.tsx';
import { Mark } from '../../ui/marks.tsx';
import { NeedsBubble, StageBars } from '../../ui/signals.tsx';
import { PRODUCT_WORDS } from '../../words.ts';
import { minutesOf, needsOf } from '../needs-you/order.ts';
import { RecentlyDecided, RunningNow } from './Blueprint.tsx';
import { type NeedsItem, justRatified, needsItems } from './needs.ts';
import { recentlyDecided } from './progress.ts';

const SHOWN = 4;

function Item({ projectId, item, index }: { projectId: string; item: NeedsItem; index: number }) {
  return (
    <li>
      <Link
        to={item.target.to}
        params={{ projectId, ...item.target.params } as never}
        search={('search' in item.target ? item.target.search : undefined) as never}
        data-needs-item={item.kind}
        className="flex flex-col gap-0.5 rounded-card-md border border-needs-line bg-surface px-3 py-2.5 text-ink hover:border-needs focus-visible:border-needs"
      >
        <span className="dm-label flex items-center gap-1.5">
          <span className="tabular-nums">{index + 1}</span>
          <span className="dm-sep" aria-hidden="true">
            ·
          </span>
          <Mark kind={item.mark} />
          <span className={item.mark === 'conflict' || item.mark === 'problem' ? 'text-problem' : ''}>{item.label}</span>
        </span>
        <strong className="dm-text-body line-clamp-2 leading-snug font-semibold">{item.title}</strong>
        <span className="dm-text-caption truncate text-ink-3">{item.from}</span>
      </Link>
    </li>
  );
}

export function NeedsColumn({
  projectId,
  state,
  inbox,
  runs,
  now,
}: {
  projectId: string;
  state: ProductState | undefined;
  inbox: Inbox | undefined;
  /** Runs working now. */
  runs: RunListItem[];
  now: number;
}) {
  const needsId = useId();
  const readyId = useId();
  const items = inbox ? needsItems(inbox, state) : [];
  const ratified = justRatified(state, inbox);
  const firstVersion = inbox?.versions_to_approve.find((v) => v.approvable);
  const total = inbox?.total ?? 0;
  const ready = [...(state?.designs ?? [])].filter((r) => r.type === 'fdr' && state?.ready_to_build.includes(r.code));
  const rows = [...(state?.designs ?? []), ...(state?.decisions ?? [])];
  const minutes = inbox ? minutesOf(needsOf(inbox, rows)) : 0;
  const threads = new Map((state?.explorations ?? []).map((e) => [e.id, e.purpose]));

  return (
    <>
      {/* What needs you sits on its band (needs-soft, needs-line); with nothing waiting it is plain. */}
      <section
        aria-labelledby={needsId}
        className={cn('flex flex-col gap-2.5', total > 0 && 'rounded-card border border-needs-line bg-needs-soft p-4')}
      >
        <div className="flex flex-col gap-0.5">
          <h2 className="dm-text-heading flex items-center gap-2 font-semibold">
            <span id={needsId}>{PRODUCT_WORDS.needsYou}</span>
            <NeedsBubble count={total} />
          </h2>
          {total > 0 && (
            <span className="dm-text-caption text-muted" data-needs-summary>
              {total} {total === 1 ? 'item' : 'items'} · about {minutes} {minutes === 1 ? 'minute' : 'minutes'}
            </span>
          )}
        </div>
        {!inbox ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-16 w-full rounded-card-md" />
            <Skeleton className="h-16 w-full rounded-card-md" />
          </div>
        ) : total === 0 ? (
          <p className="dm-text-small text-ink-2">{PRODUCT_WORDS.nothingNeedsYou}</p>
        ) : (
          <>
            {ratified ? (
              <p className="dm-text-small text-ink-3">
                Everything is proposed: nothing is approved yet. Start with what you agree with.
              </p>
            ) : (
              <p className="dm-text-small text-ink-3">In this order: what blocks more goes first.</p>
            )}
            <ol className="flex flex-col gap-2">
              {items.slice(0, SHOWN).map((item, i) => (
                <Item key={`${item.kind}-${item.id}`} projectId={projectId} item={item} index={i} />
              ))}
            </ol>
            {items.length > SHOWN && (
              <Link
                to="/p/$projectId/needs-you"
                params={{ projectId }}
                className="dm-text-caption font-semibold text-needs-strong hover:underline"
              >
                And {items.length - SHOWN} more in Needs you
              </Link>
            )}
            {ratified && firstVersion ? (
              <>
                <Link
                  to="/p/$projectId/records/$code"
                  params={{ projectId, code: firstVersion.code }}
                  search={{ v: firstVersion.n }}
                  className={buttonClass('primary')}
                >
                  Start with the versions to approve
                </Link>
                <Link
                  to="/p/$projectId/needs-you"
                  params={{ projectId }}
                  search={{ 'catch-up': 1 }}
                  className="dm-text-caption text-center font-semibold text-needs-strong hover:underline"
                >
                  Or catch up with everything, one at a time
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/p/$projectId/needs-you"
                  params={{ projectId }}
                  search={{ 'catch-up': 1 }}
                  className={buttonClass('primary')}
                >
                  Catch up
                </Link>
                <p className="dm-text-caption text-center text-muted">One at a time. What you skip stays here.</p>
              </>
            )}
          </>
        )}
      </section>

      <RunningNow projectId={projectId} runs={runs} threads={threads} now={now} />

      <section aria-labelledby={readyId} className="flex flex-col gap-2">
        <h2 id={readyId} className="dm-text-caption font-semibold text-muted">
          {PRODUCT_WORDS.readyToBuild}
        </h2>
        {ready.length === 0 ? (
          <p className="dm-text-small text-ink-3">Nothing is ready to build yet.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {ready.map((r) => (
              <li key={r.code}>
                <Link
                  to="/p/$projectId/records/$code"
                  params={{ projectId, code: r.code }}
                  className="dm-text-small -mx-2 flex items-center gap-2.5 rounded-control px-2 py-1.5 hover:bg-line-soft"
                >
                  <Mark kind="confirmed" />
                  <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                  <StageBars stage="ready" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RecentlyDecided projectId={projectId} rows={recentlyDecided(rows)} />
    </>
  );
}
