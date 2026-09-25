// The queue of Needs you (DESIGN.md §3.1): a single-select listbox, in groups that keep their fixed
// order and hints (INV-NEED-02). Each row says what the thing is, its title, why it is here, its
// state, what it unblocks and how long it has waited. Arrow keys, Home and End move the selection;
// Enter goes into the detail (R93). Rows hold no buttons: every action is in the detail.

import { type KeyboardEvent, useId } from 'react';
import { Tag } from '../../components/Badge.tsx';
import { StatusBadge, EntityState } from '../../components/status.tsx';
import { RelativeTime } from '../../components/Time.tsx';
import { cn } from '../../lib/cn.ts';
import { type NeedContext, kindIcon } from './frame.tsx';
import type { Group, GroupKey, NeedItem } from './order.ts';
import { KIND_WORDS, needReason, needSince, needTitle } from './titles.ts';

export const GROUP_HINTS: Record<GroupKey, string> = {
  conflicts: 'Knowledge found them. DEMIURGO recommends; you decide.',
  questions: 'The ones that block something come first.',
  proposals: 'A package is decided whole; a batch, one proposal at a time.',
  versions: "Approving doesn't create a new version.",
  links: 'What they point to has a newer version.',
  classifications: "DEMIURGO wasn't sure where they go.",
  updates: 'Until they are taken in, the knowledge is behind.',
};

/** The id of a row, for focus and aria-activedescendant-free roving. */
export const optionId = (key: string) => `need-option-${key}`;

/** The state of a thing as its row shows it. */
function RowState({ item }: { item: NeedItem }) {
  switch (item.kind) {
    case 'conflict':
      return <StatusBadge kind="conflict" word="Conflict" />;
    case 'question':
      return <EntityState entity="question" state={item.question.state} />;
    case 'package':
    case 'proposal':
      return <StatusBadge kind="proposed" word="Proposed" />;
    case 'version':
      return <StatusBadge kind="proposed" word={`v${item.version.n} Draft`} />;
    case 'link':
      return <EntityState entity="link" state={item.link.state} />;
    case 'classification':
      return <EntityState entity="classification" state="pending_review" />;
    case 'update':
      return <EntityState entity="knowledge_update" state="rejected" />;
  }
}

function Row({
  item,
  ctx,
  selected,
  onSelect,
  onKey,
}: {
  item: NeedItem;
  ctx: NeedContext;
  selected: boolean;
  onSelect: () => void;
  onKey: (e: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const Icon = kindIcon(item);
  const titleId = `${optionId(item.key)}-title`;
  const metaId = `${optionId(item.key)}-meta`;
  const since = needSince(item);
  return (
    <div
      role="option"
      id={optionId(item.key)}
      aria-selected={selected}
      aria-labelledby={titleId}
      aria-describedby={metaId}
      tabIndex={selected ? 0 : -1}
      data-need={item.key}
      data-kind={item.kind}
      data-question={item.kind === 'question' ? item.question.id : undefined}
      onClick={onSelect}
      onKeyDown={onKey}
      className={cn(
        'relative flex cursor-pointer gap-3 rounded-md border px-3 py-2.5 outline-offset-0 transition-colors duration-[var(--m-fast)]',
        selected ? 'border-accent-edge bg-selected' : 'border-transparent hover:bg-hover',
      )}
    >
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
        <span id={titleId} className="line-clamp-2 text-base font-medium text-fg">
          {needTitle(item, ctx.rows)}
        </span>
        <span id={metaId} className="flex flex-col gap-1.5">
          <span className="line-clamp-2 text-sm text-fg-2">
            <span className="sr-only">{KIND_WORDS[item.kind]}. </span>
            {needReason(item, ctx)}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-2">
            <RowState item={item} />
            {item.unblocks.length > 0 ? <Tag>Unblocks {item.unblocks.length}</Tag> : null}
            {since ? <RelativeTime iso={since} prefix="waiting since" className="text-fg-3" /> : null}
          </span>
        </span>
      </span>
    </div>
  );
}

export function Queue({
  groups,
  ctx,
  selected,
  onSelect,
  onPick,
  onEnter,
  className,
}: {
  groups: Group[];
  ctx: NeedContext;
  selected: string | undefined;
  /** The arrow keys moved the selection (the focus follows it). */
  onSelect: (key: string, focus: boolean) => void;
  /** A click on a row. */
  onPick: (key: string) => void;
  /** Enter or Space on a row: into its detail. */
  onEnter: (key: string) => void;
  className?: string;
}) {
  const base = useId();
  const flat = groups.flatMap((g) => g.items.map((i) => i.key));
  const onKey = (key: string) => (e: KeyboardEvent<HTMLDivElement>) => {
    const at = flat.indexOf(key);
    let to: string | undefined;
    if (e.key === 'ArrowDown') to = flat[Math.min(flat.length - 1, at + 1)];
    else if (e.key === 'ArrowUp') to = flat[Math.max(0, at - 1)];
    else if (e.key === 'Home') to = flat[0];
    else if (e.key === 'End') to = flat.at(-1);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onEnter(key);
      return;
    } else return;
    e.preventDefault();
    if (to && to !== key) onSelect(to, true);
  };
  return (
    <div role="listbox" aria-label="What needs you" aria-orientation="vertical" className={cn('flex flex-col gap-5', className)}>
      {groups.map((g) => (
        <div key={g.key} role="group" aria-labelledby={`${base}-${g.key}`} data-group={g.key} className="flex flex-col gap-1">
          <div role="presentation" id={`${base}-${g.key}`} className="flex flex-col px-1 pb-1">
            <span className="text-sm font-semibold text-fg">
              {g.title} <span className="font-normal text-fg-2 tabular-nums">({g.items.length})</span>
            </span>
            <span className="text-xs text-fg-2">{GROUP_HINTS[g.key]}</span>
          </div>
          {g.items.map((item) => (
            <Row
              key={item.key}
              item={item}
              ctx={ctx}
              selected={item.key === selected}
              onSelect={() => onPick(item.key)}
              onKey={onKey(item.key)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
