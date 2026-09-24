// Right column of the overview (canvas S6A): what needs the person, in the order "Catch up"
// walks it, and the features ready to build.

import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import type { Inbox, ProductState } from '../../api/types.ts';
import { buttonStyles } from '../../ui/Button.tsx';
import { Skeleton } from '../../ui/layout.tsx';
import { Mark } from '../../ui/marks.tsx';
import { NeedsBubble, StageBars } from '../../ui/signals.tsx';
import { PRODUCT_WORDS } from '../../words.ts';
import { type NeedsItem, justRatified, needsItems } from './needs.ts';

const SHOWN = 4;

function Item({ projectId, item, index }: { projectId: string; item: NeedsItem; index: number }) {
  return (
    <li>
      <Link
        to={item.target.to}
        params={{ projectId, ...item.target.params } as never}
        search={('search' in item.target ? item.target.search : undefined) as never}
        data-needs-item={item.kind}
        className="flex flex-col gap-0.5 rounded-[var(--radius-card)] border border-transparent bg-needs-bg px-3 py-2.5 text-ink hover:border-needs-ring focus-visible:border-needs"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
          <span className="tabular-nums">{index + 1}</span>
          <span className="text-inactive-light" aria-hidden="true">
            ·
          </span>
          <Mark kind={item.mark} size={9} />
          <span className={item.mark === 'conflict' || item.mark === 'problem' ? 'text-problem' : ''}>{item.label}</span>
        </span>
        <strong className="line-clamp-2 text-[14px] leading-snug font-semibold">{item.title}</strong>
        <span className="truncate text-xs text-ink-3">{item.from}</span>
      </Link>
    </li>
  );
}

export function NeedsColumn({
  projectId,
  state,
  inbox,
}: {
  projectId: string;
  state: ProductState | undefined;
  inbox: Inbox | undefined;
}) {
  const needsId = useId();
  const readyId = useId();
  const items = inbox ? needsItems(inbox, state) : [];
  const ratified = justRatified(state, inbox);
  const firstVersion = inbox?.versions_to_approve.find((v) => v.approvable);
  const total = inbox?.total ?? 0;
  const ready = [...(state?.designs ?? [])].filter((r) => r.type === 'fdr' && state?.ready_to_build.includes(r.code));

  return (
    <>
      <section aria-labelledby={needsId} className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <span id={needsId}>{PRODUCT_WORDS.needsYou}</span>
            <NeedsBubble count={total} />
          </h2>
          {total > SHOWN && <span className="text-xs text-muted">{total} in all</span>}
        </div>
        {!inbox ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-16 w-full rounded-[var(--radius-card)]" />
            <Skeleton className="h-16 w-full rounded-[var(--radius-card)]" />
          </div>
        ) : total === 0 ? (
          <p className="text-[13px] text-ink-2">{PRODUCT_WORDS.nothingNeedsYou}</p>
        ) : (
          <>
            {ratified ? (
              <p className="text-[13px] text-ink-3">
                Everything is proposed: nothing is approved yet. Start with what you agree with.
              </p>
            ) : (
              <p className="text-[13px] text-ink-3">In this order: what blocks more goes first.</p>
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
                className="text-xs font-semibold text-needs hover:text-needs-hover"
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
                  className={buttonStyles({ variant: 'needs', size: 'lg', className: 'mt-1 w-full' })}
                >
                  Start with the versions to approve
                </Link>
                <Link
                  to="/p/$projectId/needs-you"
                  params={{ projectId }}
                  search={{ 'catch-up': 1 }}
                  className="text-center text-xs font-semibold text-needs hover:text-needs-hover"
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
                  className={buttonStyles({ variant: 'needs', size: 'lg', className: 'mt-1 w-full' })}
                >
                  Catch up
                </Link>
                <p className="text-center text-xs text-muted">One at a time. What you skip stays here.</p>
              </>
            )}
          </>
        )}
      </section>

      <section aria-labelledby={readyId} className="flex flex-col gap-2">
        <h2 id={readyId} className="text-xs font-semibold text-muted">
          {PRODUCT_WORDS.readyToBuild}
        </h2>
        {ready.length === 0 ? (
          <p className="text-[13px] text-ink-3">Nothing is ready to build yet.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {ready.map((r) => (
              <li key={r.code}>
                <Link
                  to="/p/$projectId/records/$code"
                  params={{ projectId, code: r.code }}
                  className="-mx-2 flex items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 text-[13px] hover:bg-line-soft"
                >
                  <Mark kind="confirmed" size={9} />
                  <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                  <StageBars stage="ready" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
