// "Needs you" at the top of the overview's side column (DESIGN.md §3.5, INV-OVW-22…26): how much
// waits and about how long it takes, the first four things in the same order Catch up walks them
// (one order everywhere, INVENTORY §2 #7), and the way into Catch up — or, right after ratifying,
// into the versions to approve. A failed inbox says so instead of a skeleton forever.

import { Link } from '@tanstack/react-router';
import type { UseQueryResult } from '@tanstack/react-query';
import { useId } from 'react';
import type { Inbox, ProductState } from '../../api/types.ts';
import { Count } from '../../components/Badge.tsx';
import { buttonClass } from '../../components/Button.tsx';
import { ArrowRightIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { StateText } from '../../components/status.tsx';
import { AspectTag } from '../../components/AspectTag.tsx';
import { cn } from '../../lib/cn.ts';
import { useMessages } from '../../i18n/define.ts';
import { useProductWord } from '../../words.ts';
import { minutesOf, needsOf } from '../needs-you/order.ts';
import { type NeedsItem, justRatified, needsItems, packagesNote } from './needs.ts';
import { InceptionNext, useInceptionCurrent } from './Inception.tsx';
import { NEEDS_COLUMN } from './words.i18n.ts';

const SHOWN = 4;

function Item({ projectId, item, index }: { projectId: string; item: NeedsItem; index: number }) {
  return (
    <li>
      <Link
        to={item.target.to}
        params={{ projectId, ...item.target.params } as never}
        search={('search' in item.target ? item.target.search : undefined) as never}
        data-needs-item={item.kind}
        className="flex flex-col gap-1 rounded-md border border-edge bg-panel px-3 py-2.5 transition-colors duration-[var(--m-fast)] hover:border-accent-edge"
      >
        <span className="flex items-center gap-2 text-xs">
          <span className="w-4 shrink-0 font-medium text-fg-2 tabular-nums">{index + 1}</span>
          <StateText kind={item.mark} word={item.label} className="text-xs" />
          <AspectTag aspect={item.aspect} />
        </span>
        <span className="line-clamp-2 text-sm leading-snug font-medium text-fg">{item.title}</span>
        <span className="truncate pl-6 text-xs text-fg-2">{item.from}</span>
      </Link>
    </li>
  );
}

export function NeedsSummary({
  projectId,
  state,
  inbox,
}: {
  projectId: string;
  state: ProductState | undefined;
  inbox: UseQueryResult<Inbox>;
}) {
  const t = useMessages(NEEDS_COLUMN);
  const needsYouWord = useProductWord('needsYou');
  const nothingNeedsYouWord = useProductWord('nothingNeedsYou');
  const id = useId();
  const inception = useInceptionCurrent(projectId);
  const data = inbox.data;
  const items = data ? needsItems(data, state) : [];
  // The number of distinct things listed, as Needs you and the sidebar count them.
  const total = items.length;
  const rows = [...(state?.designs ?? []), ...(state?.decisions ?? [])];
  const minutes = data ? minutesOf(needsOf(data, rows)) : 0;
  const ratified = justRatified(state, data);
  const firstVersion = data?.versions_to_approve.find((v) => v.approvable);
  const packages = data ? packagesNote(data) : null;
  const waiting = total > 0;

  return (
    <section
      aria-labelledby={id}
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-4',
        waiting ? 'border-accent-edge bg-accent-soft' : 'border-edge bg-panel',
      )}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
          <span id={id}>{needsYouWord}</span>
          <Count n={total} label={t.thingNeedsYou(total)} />
        </h2>
        {waiting ? (
          <p className="text-xs text-fg-2" data-needs-summary>
            {t.summaryThings(total)}
            {packages ? ` (${packages})` : ''} · {t.aboutMinutes(minutes)}
          </p>
        ) : null}
      </div>
      {inbox.error ? (
        <ErrorNotice error={inbox.error} compact focus={false} onRetry={() => void inbox.refetch()} />
      ) : !data ? (
        <Skeleton label={t.loadingWhatNeedsYou}>
          <div className="flex flex-col gap-2">
            <Bone className="h-16 w-full rounded-md" />
            <Bone className="h-16 w-full rounded-md" />
          </div>
        </Skeleton>
      ) : !waiting ? (
        inception ? (
        <p className="text-sm">
          <InceptionNext projectId={projectId} step={inception} />
        </p>
      ) : (
        <p className="text-sm text-fg-2">{nothingNeedsYouWord}</p>
      )
      ) : (
        <>
          <p className="text-sm text-fg-2">{ratified ? t.everythingProposed : t.inCatchUpOrder}</p>
          <ol className="flex flex-col gap-2">
            {items.slice(0, SHOWN).map((item, i) => (
              <Item key={item.key} projectId={projectId} item={item} index={i} />
            ))}
          </ol>
          {items.length > SHOWN ? (
            <Link
              to="/p/$projectId/needs-you"
              params={{ projectId }}
              className="inline-flex items-center gap-1 self-start text-sm font-medium text-accent-text hover:underline"
            >
              {t.andMoreInNeedsYou(items.length - SHOWN)} <ArrowRightIcon size={12} />
            </Link>
          ) : null}
          {ratified && firstVersion ? (
            <div className="flex flex-col gap-2">
              <Link
                to="/p/$projectId/records/$code"
                params={{ projectId, code: firstVersion.code }}
                search={{ v: firstVersion.n }}
                className={buttonClass({ variant: 'primary' })}
              >
                {t.startWithVersions}
              </Link>
              <Link
                to="/p/$projectId/needs-you"
                params={{ projectId }}
                search={{ 'catch-up': 1 }}
                className="text-center text-sm font-medium text-accent-text hover:underline"
              >
                {t.orCatchUpEverything}
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Link
                to="/p/$projectId/needs-you"
                params={{ projectId }}
                search={{ 'catch-up': 1 }}
                className={buttonClass({ variant: 'primary' })}
              >
                {t.catchUp}
              </Link>
              <p className="text-center text-xs text-fg-2">{t.oneAtATime}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
