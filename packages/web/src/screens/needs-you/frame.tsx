// The detail every thing of Needs you shares (DESIGN.md §3.1): what it is (kind, title, code), why
// it is here (who raised it, where), the evidence, what it unblocks (records with their readiness)
// and, at the bottom, the decision. It carries `data-need` and `data-kind` like the queue row, and
// its title is where the focus lands after the previous thing was decided (R13, R80).

import { Link } from '@tanstack/react-router';
import type { ComponentType, ReactNode } from 'react';
import { useId } from 'react';
import type { Exploration, ProductRow, Taxonomy } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import {
  AlertTriangleIcon,
  HelpIcon,
  type IconProps,
  KnowledgeIcon,
  LinkIcon,
  PackageIcon,
  TagIcon,
  ThreadsIcon,
} from '../../components/icons.tsx';
import { Readiness, type Stage } from '../../components/Meter.tsx';
import { Certainty } from '../../components/status.tsx';
import { iconOf, typeWord } from '../../components/types.tsx';
import { cn } from '../../lib/cn.ts';
import { rowOf } from '../batch/model.ts';
import { linkClass, RecordChip } from '../batch/parts.tsx';
import { proposalIconType } from '../batch/proposal.ts';
import type { NeedItem } from './order.ts';
import { KIND_WORDS } from './titles.ts';

export type NeedContext = {
  projectId: string;
  rows: readonly ProductRow[];
  threads: readonly Exploration[];
  taxonomies: readonly Taxonomy[];
};

/** The icon of a thing: its record or proposal type where it has one, else its kind. */
export function kindIcon(item: NeedItem): ComponentType<IconProps> {
  switch (item.kind) {
    case 'conflict':
      return AlertTriangleIcon;
    case 'question':
      return HelpIcon;
    case 'package':
      return PackageIcon;
    case 'proposal':
      return iconOf(proposalIconType(item.proposal));
    case 'version':
      return iconOf(item.version.type);
    case 'link':
      return LinkIcon;
    case 'classification':
      return TagIcon;
    case 'update':
      return KnowledgeIcon;
  }
}

/** A feature's readiness in three words (the track is decoration). */
export function stageOf(row: ProductRow): Stage {
  if (row.readiness?.ready) return 'ready';
  return row.current !== null ? 'doubt' : 'not-ready';
}

/** A link to the thread a thing was raised in, by its purpose. */
export function ThreadLink({ projectId, id, threads }: { projectId: string; id: string; threads: readonly Exploration[] }) {
  const t = threads.find((x) => x.id === id);
  return (
    <Link
      to="/p/$projectId/threads/$explorationId"
      params={{ projectId, explorationId: id }}
      className={cn(linkClass, 'inline-flex min-h-6 items-center gap-1')}
    >
      <ThreadsIcon size={13} />
      {t?.purpose ?? 'its thread'}
    </Link>
  );
}

/** "What it unblocks": the records whose readiness waits for this thing, and what they still need. */
export function Unblocks({ ctx, item }: { ctx: NeedContext; item: NeedItem }) {
  const id = useId();
  const rows = item.unblocks.flatMap((c) => {
    const r = rowOf(ctx.rows, c);
    return r ? [r] : [];
  });
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2" data-unblocks={item.unblocks.join(' ')}>
      <h3 id={id} className="text-sm font-semibold text-fg-2">
        What it unblocks
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-2">Nothing waits for it directly.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.code} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-xs text-fg-2">{typeWord(r.type)}</span>
              <RecordChip projectId={ctx.projectId} code={r.code} rows={ctx.rows} />
              {r.readiness ? (
                <Readiness stage={stageOf(r)} blocking={r.readiness.reasons.length} track={r.type === 'fdr'} />
              ) : (
                <Certainty status={r.epistemic_status} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The frame of a thing's detail: its header, its evidence, what it unblocks and its decision. */
export function DetailFrame({
  item,
  ctx,
  titleId,
  title,
  code,
  state,
  eyebrow,
  why,
  line,
  children,
  decision,
  top,
}: {
  item: NeedItem;
  ctx: NeedContext;
  titleId: string;
  title: string;
  code?: string | undefined;
  /** The state badge. */
  state?: ReactNode;
  /** More words after the kind ("with something you approved"). */
  eyebrow?: ReactNode;
  /** Who raised it and where. */
  why?: ReactNode;
  /** What it asks of the person, in a sentence. */
  line?: ReactNode;
  children?: ReactNode;
  decision?: ReactNode;
  /** Above the header: Catch up's step and its Skip and Leave. */
  top?: ReactNode;
}) {
  const Icon = kindIcon(item);
  return (
    <section
      aria-labelledby={titleId}
      data-detail
      data-need={item.key}
      data-kind={item.kind}
      data-question={item.kind === 'question' ? item.question.id : undefined}
      className="flex min-w-0 flex-col gap-5"
    >
      {top}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 font-medium',
              item.kind === 'conflict' ? 'text-danger-text' : 'text-fg-2',
            )}
          >
            <Icon size={15} className={item.kind === 'conflict' ? undefined : 'text-fg-3'} />
            {KIND_WORDS[item.kind]}
          </span>
          {eyebrow ? <span className="text-fg-2">{eyebrow}</span> : null}
          {state}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={titleId} tabIndex={-1} className="text-xl font-semibold text-fg outline-none">
            {title}
          </h2>
          {code ? <Code className="text-sm">{code}</Code> : null}
        </div>
        {why ? <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-fg-2">{why}</div> : null}
        {line ? <p className="max-w-prose text-md text-fg-2">{line}</p> : null}
      </header>
      {children}
      <Unblocks ctx={ctx} item={item} />
      {decision}
    </section>
  );
}
