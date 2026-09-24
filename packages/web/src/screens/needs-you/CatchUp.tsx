// Catch up (canvas S6B, FDR-INT-001 behavior 10): Needs you one thing at a time, full width, in the
// defined order, with Skip and Leave. What is skipped stays in Needs you; the right column says what
// the current thing unblocks. Resolving a thing moves on to the next one.

import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { ProductRow } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { PRODUCT_WORDS, TYPE_WORDS } from '../../words.ts';
import { Button, buttonStyles } from '../../ui/Button.tsx';
import { Code } from '../../ui/Card.tsx';
import { RECORD_ICON, TypeIcon } from '../../ui/icons.tsx';
import { Breadcrumbs, Page, Skeleton } from '../../ui/layout.tsx';
import { EpistemicMark } from '../../ui/marks.tsx';
import { type Stage, StageBars } from '../../ui/signals.tsx';
import { KIND_WORDS, type NeedContext } from './frame.tsx';
import { catchUpOrder, minutesOf, type NeedItem } from './order.ts';
import { NeedView, needTitle } from './NeedView.tsx';
import { UpToDate } from './UpToDate.tsx';

type Seen = { key: string; kind: NeedItem['kind']; title: string };

export function CatchUp({ ctx, items }: { ctx: NeedContext; items: NeedItem[] | null }) {
  const navigate = useNavigate();
  const ordered = items ? catchUpOrder(items) : [];
  const present = new Set(ordered.map((i) => i.key));
  // The walk keeps every thing seen since Catch up started, so what gets resolved still counts.
  const [walk, setWalk] = useState<Seen[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const fresh = ordered.filter((i) => !walk.some((w) => w.key === i.key));
  const freshKeys = fresh.map((i) => i.key).join(' ');
  useEffect(() => {
    if (!freshKeys) return;
    setWalk((w) => [
      ...w,
      ...fresh
        .filter((i) => !w.some((x) => x.key === i.key))
        .map((i) => ({ key: i.key, kind: i.kind, title: needTitle(i, ctx.rows) })),
    ]);
    // Keyed by the new things only: the list itself is rebuilt on every render.
  }, [freshKeys]);

  const remaining = ordered.filter((i) => !skipped.includes(i.key));
  const current = remaining[0];
  const handled = walk.filter((w) => skipped.includes(w.key) || !present.has(w.key)).length;
  const total = Math.max(walk.length, ordered.length);
  const position = Math.min(handled + 1, total);
  const leave = () => void navigate({ to: '/p/$projectId/needs-you', params: { projectId: ctx.projectId } });

  // Everything resolved (or nothing to start with): you're up to date (canvas S6C).
  if (items && ordered.length === 0) return <UpToDate projectId={ctx.projectId} />;

  return (
    <Page
      className="pt-4"
      aside={
        <div className="flex min-h-[calc(100vh-140px)] flex-col gap-6">
          <InOrder walk={walk} present={present} skipped={skipped} current={current?.key} remaining={remaining} />
          {current && <WhatItUnblocks ctx={ctx} item={current} />}
          <div className="mt-auto flex flex-col gap-1 rounded-xl bg-surface-2 px-4 py-3">
            <strong className="text-[13px] font-semibold">Stop whenever you like</strong>
            <span className="text-[13px] text-ink-3">What you skip stays in Needs you, in the same order.</span>
          </div>
        </div>
      }
    >
      <Breadcrumbs
        items={[
          { label: 'Needs you', to: '/p/$projectId/needs-you', params: { projectId: ctx.projectId } },
          { label: 'Catching up' },
        ]}
      />
      <section
        aria-label="Catching up"
        className="mb-6 flex max-w-[1000px] items-center gap-4 rounded-[14px] border border-needs-ring bg-needs-bg py-3 pr-3.5 pl-[18px]"
      >
        <Steps walk={walk} present={present} skipped={skipped} current={current?.key} />
        <span className="w-px self-stretch bg-needs-ring" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col" aria-live="polite">
          <span className="text-xs font-semibold text-needs-hover" data-progress>
            {current ? `${position} of ${total} · about ${current.minutes} min` : items ? 'Done' : 'Getting ready…'}
          </span>
          <strong className="truncate text-[15px] font-semibold">
            {current ? needTitle(current, ctx.rows) : items ? 'You went through everything' : ''}
          </strong>
        </div>
        <Button variant="ghost" onClick={leave}>
          Leave
        </Button>
        {current && (
          <Button variant="outline" size="lg" onClick={() => setSkipped((s) => [...s, current.key])}>
            Skip
          </Button>
        )}
      </section>

      {!items ? (
        <div role="status" aria-label="Loading" className="flex max-w-[860px] flex-col gap-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : current ? (
        <NeedView key={current.key} item={current} ctx={ctx} mode="focus" />
      ) : (
        <Finished projectId={ctx.projectId} skipped={skipped.filter((k) => present.has(k)).length} />
      )}
    </Page>
  );
}

function stepState(key: string, present: Set<string>, skipped: string[], current: string | undefined) {
  if (key === current) return 'now';
  if (!present.has(key)) return 'done';
  if (skipped.includes(key)) return 'skipped';
  return 'next';
}

const STEP_WORDS = { now: 'Now', done: 'Done', skipped: 'Skipped', next: 'Next' } as const;

function Circle({ n, state }: { n: number; state: keyof typeof STEP_WORDS }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] text-xs font-bold',
        state === 'now' && 'border-needs bg-needs text-white',
        state === 'done' && 'border-ink bg-ink text-white',
        state === 'skipped' && 'border-dashed border-inactive bg-surface text-muted',
        state === 'next' && 'border-line-strong bg-surface text-ink-2',
      )}
    >
      {state === 'done' ? (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6.5l2.3 2.3L9.5 3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : (
        n
      )}
    </span>
  );
}

function Steps({
  walk,
  present,
  skipped,
  current,
}: {
  walk: Seen[];
  present: Set<string>;
  skipped: string[];
  current: string | undefined;
}) {
  const shown = walk.slice(0, 12);
  return (
    <ol aria-label="Steps" className="flex items-center gap-1.5">
      {shown.map((w, i) => {
        const s = stepState(w.key, present, skipped, current);
        return (
          <li key={w.key} aria-current={s === 'now' ? 'step' : undefined} title={`${w.title} · ${STEP_WORDS[s]}`}>
            <Circle n={i + 1} state={s} />
            <span className="sr-only">
              {i + 1}: {w.title}, {STEP_WORDS[s]}
            </span>
          </li>
        );
      })}
      {walk.length > shown.length && <li className="text-xs text-muted">+{walk.length - shown.length}</li>}
    </ol>
  );
}

function InOrder({
  walk,
  present,
  skipped,
  current,
  remaining,
}: {
  walk: Seen[];
  present: Set<string>;
  skipped: string[];
  current: string | undefined;
  remaining: NeedItem[];
}) {
  return (
    <section aria-label="In order" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">In order</h2>
        <span className="text-xs text-muted">
          {remaining.length === 0 ? 'Nothing left' : `${remaining.length} left · about ${minutesOf(remaining)} min`}
        </span>
      </div>
      <ol className="flex flex-col gap-0.5">
        {walk.map((w, i) => {
          const s = stepState(w.key, present, skipped, current);
          return (
            <li
              key={w.key}
              aria-current={s === 'now' ? 'step' : undefined}
              className={cn('flex items-center gap-2.5 rounded-[10px] px-2.5 py-2', s === 'now' && 'bg-needs-bg')}
            >
              <Circle n={i + 1} state={s} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn('text-xs text-muted', w.kind === 'conflict' && 'text-problem')}>
                  {KIND_WORDS[w.kind].word}
                </span>
                <strong className={cn('truncate text-[13px] font-semibold', s === 'done' && 'text-muted line-through')}>
                  {w.title}
                </strong>
              </span>
              <span className="shrink-0 text-xs text-muted">{STEP_WORDS[s]}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function stageOf(row: ProductRow): Stage {
  if (row.readiness?.ready) return 'ready';
  return row.current !== null ? 'doubt' : 'not-ready';
}

/** What the current thing unblocks: the records whose readiness waits for it, with what they still need. */
function WhatItUnblocks({ ctx, item }: { ctx: NeedContext; item: NeedItem }) {
  const rows = item.unblocks.flatMap((c) => ctx.rows.filter((r) => r.code === c));
  return (
    <section aria-label="What it unblocks" className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold text-muted">What it unblocks</h2>
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-3">Nothing waits for it directly.</p>
      ) : (
        rows.map((r) => {
          const left = r.readiness?.reasons.length ?? 0;
          return (
            <Link
              key={r.code}
              to="/p/$projectId/records/$code"
              params={{ projectId: ctx.projectId, code: r.code }}
              className="flex flex-col gap-0.5 rounded-[10px] border border-line px-2.5 py-2 hover:border-line-strong"
            >
              <span className="flex items-center gap-2">
                <EpistemicMark status={r.epistemic_status} />
                <TypeIcon kind={RECORD_ICON[r.type] ?? 'feature'} size={12} />
                <strong className="min-w-0 flex-1 truncate text-[13px] font-semibold">{r.title}</strong>
                {r.type === 'fdr' && <StageBars stage={stageOf(r)} />}
              </span>
              <span className="pl-[17px] text-xs text-muted">
                {TYPE_WORDS[r.type]} <Code>{r.code}</Code> ·{' '}
                {left === 0 ? PRODUCT_WORDS.readyToBuild : `${left} ${left === 1 ? 'thing' : 'things'} before it can be built`}
              </span>
            </Link>
          );
        })
      )}
    </section>
  );
}

/** The end of the walk with things skipped: they stay in Needs you (with nothing left, it is "You're up to date"). */
function Finished({ projectId, skipped }: { projectId: string; skipped: number }) {
  return (
    <section className="flex max-w-[860px] flex-col gap-2" data-finished>
      <h1 className="text-2xl leading-tight font-semibold">You went through everything</h1>
      <p className="text-sm text-ink-2">
        {`${skipped} ${skipped === 1 ? 'thing you skipped stays' : 'things you skipped stay'} in Needs you, in the same order.`}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <Link to="/p/$projectId/needs-you" params={{ projectId }} className={buttonStyles({ variant: 'ink', size: 'lg' })}>
          Back to Needs you
        </Link>
        <Link to="/p/$projectId" params={{ projectId }} className="text-[13px] font-semibold text-needs hover:text-needs-hover">
          See the product
        </Link>
      </div>
    </section>
  );
}
