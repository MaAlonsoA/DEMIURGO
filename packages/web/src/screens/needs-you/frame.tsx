// The frame every thing of Needs you shares, in two sizes (a row of the list and the focus of Catch
// up): what it is, its title and one line, where it comes from, what it unblocks, and its actions.

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Exploration, ProductRow, Taxonomy } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { Code } from '../../ui/Card.tsx';
import { type IconKind, RECORD_ICON, TypeIcon, WarningIcon } from '../../ui/icons.tsx';
import { rowOf } from '../batch/model.ts';
import { Dot } from '../batch/parts.tsx';
import type { NeedItem } from './order.ts';

export type Mode = 'row' | 'focus';

export type NeedContext = {
  projectId: string;
  rows: readonly ProductRow[];
  threads: readonly Exploration[];
  taxonomies: readonly Taxonomy[];
};

/** The words of each kind of thing, as its eyebrow says it. */
export const KIND_WORDS: Record<NeedItem['kind'], { word: string; icon: IconKind }> = {
  conflict: { word: 'Conflict', icon: 'knowledge' },
  question: { word: 'Question', icon: 'question' },
  package: { word: 'Package', icon: 'package' },
  proposal: { word: 'Proposal', icon: 'idea' },
  version: { word: 'Version to approve', icon: 'feature' },
  link: { word: 'Link to review', icon: 'link' },
  classification: { word: 'Classification', icon: 'taxonomy' },
  update: { word: 'Knowledge update', icon: 'knowledge' },
};

/** "Unblocks": the records whose readiness waits for this, names first. */
export function Unblocks({
  projectId,
  codes,
  rows,
  className,
}: {
  projectId: string;
  codes: string[];
  rows: readonly ProductRow[];
  className?: string;
}) {
  if (codes.length === 0) return null;
  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3', className)}
      data-unblocks={codes.join(' ')}
    >
      <span>Unblocks</span>
      {codes.map((code) => {
        const row = rowOf(rows, code);
        return (
          <Link
            key={code}
            to="/p/$projectId/records/$code"
            params={{ projectId, code }}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-1.5 py-px font-semibold text-ink hover:border-line-strong"
          >
            {row && <TypeIcon kind={RECORD_ICON[row.type] ?? 'feature'} size={12} />}
            {row?.title ?? code}
            <Code>{code}</Code>
          </Link>
        );
      })}
    </div>
  );
}

/** The frame both sizes share: eyebrow, title, one line, where it comes from, what it unblocks, actions. */
export function Frame({
  mode,
  item,
  ctx,
  eyebrow,
  title,
  code,
  line,
  from,
  children,
}: {
  mode: Mode;
  item: NeedItem;
  ctx: NeedContext;
  eyebrow: ReactNode;
  title: string;
  code?: string | undefined;
  line?: ReactNode;
  from?: ReactNode;
  children?: ReactNode;
}) {
  const kind = KIND_WORDS[item.kind];
  const Title = mode === 'focus' ? 'h1' : 'h3';
  return (
    <div
      data-need={item.key}
      data-kind={item.kind}
      className={cn('flex flex-col', mode === 'row' ? 'gap-1 px-[18px] py-3.5' : 'max-w-[860px] gap-3.5')}
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
          {item.kind === 'conflict' ? (
            <span className="inline-flex items-center gap-1.5 text-problem">
              <WarningIcon size={13} />
              {kind.word}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <TypeIcon kind={kind.icon} size={13} />
              {kind.word}
            </span>
          )}
          {eyebrow && (
            <>
              <Dot />
              <span className="inline-flex items-center gap-1.5 tracking-normal normal-case">{eyebrow}</span>
            </>
          )}
        </div>
        <div className="flex min-w-0 items-baseline gap-2">
          <Title className={cn('font-semibold', mode === 'focus' ? 'text-2xl leading-tight' : 'text-[14.5px] leading-snug')}>
            {title}
          </Title>
          {code && <Code className="shrink-0">{code}</Code>}
        </div>
        {line && (
          <div className={cn(mode === 'focus' ? 'text-sm text-ink-2' : 'line-clamp-2 text-[13px] text-ink-3')}>{line}</div>
        )}
      </div>
      {from && <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">{from}</div>}
      {mode === 'row' && <Unblocks projectId={ctx.projectId} codes={item.unblocks} rows={ctx.rows} />}
      {children && <div className={mode === 'row' ? 'mt-1.5' : ''}>{children}</div>}
    </div>
  );
}
