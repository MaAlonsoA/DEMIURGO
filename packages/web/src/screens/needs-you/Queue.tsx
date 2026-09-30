// The index of Needs you (DESIGN.md §3.1): what waits for the person, in groups that keep their
// fixed order and hints (INV-NEED-02). Each row says what the thing is, its title and where it
// lives, and is a link to that home, where it is decided. Only the things with no home yet
// (conflicts, links, classifications, failed updates) are picked to show their detail beside.

import { useId } from 'react';
import { RelativeTime } from '../../components/Time.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { type NeedContext, kindIcon } from './frame.tsx';
import { HomeLink, homeOf } from './home.tsx';
import type { Group, NeedItem } from './order.ts';
import { needReason, needSince, needTitle } from './titles.ts';
import { QUEUE, TITLES } from './words.i18n.ts';

/** The id of a row, for focus. */
export const optionId = (key: string) => `need-option-${key}`;

type QueueWords = typeof QUEUE.en;

function Row({
  item,
  ctx,
  selected,
  onPick,
  t,
  kindWords,
}: {
  item: NeedItem;
  ctx: NeedContext;
  selected: boolean;
  onPick: () => void;
  t: QueueWords;
  kindWords: typeof TITLES.en;
}) {
  const Icon = kindIcon(item);
  const since = needSince(item);
  const home = homeOf(item);
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
          item.kind === 'conflict' ? 'bg-danger-soft text-danger-text' : 'bg-sunken text-fg-2',
        )}
      >
        <Icon size={14} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 text-base font-medium text-fg">{needTitle(item, ctx.rows, kindWords)}</span>
        <span className="line-clamp-2 text-sm text-fg-2">{needReason(item, ctx, kindWords)}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-2">
          <span>{kindWords.kindWord(item.kind)}</span>
          <span aria-hidden>·</span>
          <span>{home ? t.homeWord(home.to) : t.decideHere}</span>
          {since ? <RelativeTime iso={since} prefix={t.waitingSince} className="text-fg-3" /> : null}
        </span>
      </span>
    </>
  );
  const cls = cn(
    'relative flex w-full gap-3 rounded-md border px-3 py-2.5 text-left outline-offset-0 transition-colors duration-[var(--m-fast)]',
    selected ? 'border-accent-edge bg-selected' : 'border-transparent hover:bg-hover',
  );
  return home ? (
    <HomeLink projectId={ctx.projectId} home={home} className={cls} data-need={item.key} data-kind={item.kind}>
      {body}
    </HomeLink>
  ) : (
    <button
      type="button"
      id={optionId(item.key)}
      aria-pressed={selected}
      data-need={item.key}
      data-kind={item.kind}
      onClick={onPick}
      className={cls}
    >
      {body}
    </button>
  );
}

export function Queue({
  groups,
  ctx,
  selected,
  onPick,
  className,
}: {
  groups: Group[];
  ctx: NeedContext;
  selected: string | undefined;
  /** A click on a row that is decided here. */
  onPick: (key: string) => void;
  className?: string;
}) {
  const t = useMessages(QUEUE);
  const kindWords = useMessages(TITLES);
  const base = useId();
  return (
    <nav aria-label={t.listboxLabel} className={cn('flex flex-col gap-5', className)}>
      {groups.map((g) => (
        <div key={g.key} role="group" aria-labelledby={`${base}-${g.key}`} data-group={g.key} className="flex flex-col gap-1">
          <div id={`${base}-${g.key}`} className="flex flex-col px-1 pb-1">
            <span className="text-sm font-semibold text-fg">
              {g.title} <span className="font-normal text-fg-2 tabular-nums">({g.items.length})</span>
            </span>
            <span className="text-xs text-fg-2">{t.hint(g.key)}</span>
          </div>
          {g.items.map((item) => (
            <Row
              key={item.key}
              item={item}
              ctx={ctx}
              t={t}
              kindWords={kindWords}
              selected={item.key === selected}
              onPick={() => onPick(item.key)}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}
