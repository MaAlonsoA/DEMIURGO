// Catch up (DESIGN.md §3.1, INV-CATCH-*): the same page in focus mode. The queue becomes the walk,
// in the order that unblocks the most, each step saying Done, Skipped, Now or Next in words (the
// old steps were borders only). The current thing is shown in full with its decision; its step,
// Skip and Leave sit right above it (they used to be far from the item). The walk is kept in
// sessionStorage, so opening a package and coming back keeps the place and the skips.

import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { announce } from '../../components/announce.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { CheckIcon } from '../../components/icons.tsx';
import { PageBody, PageHeader } from '../../components/Page.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { useEditGuard } from '../batch/guard.tsx';
import { NeedDetail } from './Detail.tsx';
import type { NeedContext } from './frame.tsx';
import { catchUpOrder, type NeedItem } from './order.ts';
import { needTitle } from './titles.ts';
import {
  clearWalk,
  currentStep,
  emptyWalk,
  extendWalk,
  loadWalk,
  type StepState,
  saveWalk,
  skip,
  stepState,
  stepsLeft,
  type Walk,
  walkProgress,
} from './walk.ts';
import { CATCH_UP, TITLES, WALK } from './words.i18n.ts';

export const DETAIL_TITLE = 'need-detail-title';

function StepMark({ n, state }: { n: number; state: StepState }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
        state === 'now' && 'bg-accent text-on-accent',
        state === 'done' && 'bg-success-soft text-success-text',
        state === 'skipped' && 'border border-dashed border-edge-control text-fg-2',
        state === 'next' && 'border border-edge-strong text-fg-2',
      )}
    >
      {state === 'done' ? <CheckIcon size={13} /> : n}
    </span>
  );
}

const STATE_TEXT: Record<StepState, string> = {
  now: 'font-semibold text-accent-text',
  done: 'text-success-text',
  skipped: 'text-fg-2',
  next: 'text-fg-3',
};

export function CatchUp({ ctx, items }: { ctx: NeedContext; items: NeedItem[] }) {
  const t = useMessages(CATCH_UP);
  const kindWords = useMessages(TITLES);
  const stepWords = useMessages(WALK);
  const navigate = useNavigate();
  const guard = useEditGuard();
  const listId = useId();
  const ordered = catchUpOrder(items);
  const present = new Set(items.map((i) => i.key));
  const [stored, setStored] = useState<Walk>(() => loadWalk(ctx.projectId) ?? emptyWalk());
  // Things that arrive meanwhile join the end of the walk (INV-CATCH-12).
  const walk = extendWalk(stored, ordered, (i) => needTitle(i, ctx.rows, kindWords));
  const grew = walk.steps.length !== stored.steps.length;
  useEffect(() => {
    if (grew) setStored(walk);
  }, [grew, walk]);
  useEffect(() => saveWalk(ctx.projectId, stored), [ctx.projectId, stored]);

  const step = currentStep(walk, present);
  const current = step ? items.find((i) => i.key === step.key) : undefined;
  const { position, total } = walkProgress(walk, present);
  const left = stepsLeft(walk, present);
  const minutes = left.reduce((n, s) => n + (items.find((i) => i.key === s.key)?.minutes ?? 0), 0);
  const skipped = walk.skipped.filter((k) => present.has(k)).length;

  // Entering Catch up puts the focus on the thing to decide.
  const entered = useRef(false);
  useEffect(() => {
    if (entered.current) return;
    entered.current = true;
    const timer = setTimeout(() => document.getElementById(DETAIL_TITLE)?.focus(), 60);
    return () => clearTimeout(timer);
  }, []);

  const leave = () =>
    guard.guard(() => {
      clearWalk(ctx.projectId);
      void navigate({ to: '/p/$projectId/needs-you', params: { projectId: ctx.projectId } }).then(() =>
        setTimeout(() => document.getElementById('page-title')?.focus(), 60),
      );
    });

  const skipIt = () =>
    guard.guard(() => {
      if (!current) return;
      const next = skip(walk, current.key);
      setStored(next);
      const after = currentStep(next, present);
      announce(after ? t.announceSkippedNow(after.title) : t.announceSkippedDone);
      setTimeout(() => document.getElementById(DETAIL_TITLE)?.focus(), 60);
    });

  const bar = (
    <section
      aria-label={t.catchingUp}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent-edge bg-accent-soft px-4 py-2"
    >
      <p data-progress className="text-sm font-medium text-accent-text tabular-nums">
        {current ? t.progressCurrent(position, total, minutes) : t.progressDone(skipped)}
      </p>
      <span className="flex-1" />
      {current ? (
        <Button size="sm" variant="secondary" onClick={skipIt}>
          {t.skip}
        </Button>
      ) : null}
      <Button size="sm" variant="quiet" onClick={leave}>
        {t.leave}
      </Button>
    </section>
  );

  return (
    <>
      <PageHeader
        crumbs={[
          { label: t.needsYou, link: { to: '/p/$projectId/needs-you', params: { projectId: ctx.projectId } } },
          { label: t.catchingUp },
        ]}
        title={t.catchingUp}
        meta={<span>{t.meta}</span>}
      />
      <PageBody>
        <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
          {/* It scrolls on its own on wide screens: focusable, so the keyboard can scroll it too (WCAG 2.1.1). */}
          <section
            aria-labelledby={listId}
            tabIndex={0}
            className="order-2 flex w-full shrink-0 flex-col gap-3 xl:sticky xl:top-4 xl:order-1 xl:max-h-[calc(100vh-32px)] xl:w-80 xl:overflow-y-auto"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 id={listId} className="text-base font-semibold text-fg">
                {t.inOrder}
              </h2>
              <span className="text-sm text-fg-2 tabular-nums">
                {left.length === 0 ? t.nothingLeft : t.leftMinutes(left.length, minutes)}
              </span>
            </div>
            <ol className="flex flex-col gap-1">
              {walk.steps.map((s, i) => {
                const st = stepState(s, walk, present, current?.key);
                return (
                  <li
                    key={s.key}
                    aria-current={st === 'now' ? 'step' : undefined}
                    data-step={s.key}
                    data-step-state={st}
                    data-step-kind={s.kind}
                    className={cn(
                      'flex items-start gap-2.5 rounded-md border px-2.5 py-2',
                      st === 'now' ? 'border-accent-edge bg-selected' : 'border-transparent',
                    )}
                  >
                    <StepMark n={i + 1} state={st} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn('text-xs', s.kind === 'conflict' ? 'text-danger-text' : 'text-fg-2')}>
                        {kindWords.kindWord(s.kind)}
                      </span>
                      <span className={cn('line-clamp-2 text-sm font-medium text-fg', st === 'done' && 'text-fg-2 line-through')}>
                        {s.title}
                      </span>
                    </span>
                    <span className={cn('shrink-0 text-xs', STATE_TEXT[st])}>{stepWords.stepWord(st)}</span>
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-col gap-0.5 rounded-lg bg-sunken px-3.5 py-3 text-sm">
              <p className="font-medium text-fg">{t.stopWhenever}</p>
              <p className="text-fg-2">{t.skipStays}</p>
            </div>
          </section>

          <div className="order-1 flex min-w-0 flex-1 flex-col gap-5 xl:order-2">
            {current ? (
              <NeedDetail key={current.key} item={current} ctx={ctx} titleId={DETAIL_TITLE} top={bar} />
            ) : (
              <section aria-labelledby={DETAIL_TITLE} className="flex flex-col gap-4" data-finished>
                {bar}
                <h2 id={DETAIL_TITLE} tabIndex={-1} className="text-xl font-semibold text-fg outline-none">
                  {t.wentThroughEverything}
                </h2>
                <p className="text-md text-fg-2">{t.skippedStay(skipped)}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    to="/p/$projectId/needs-you"
                    params={{ projectId: ctx.projectId }}
                    onClick={() => clearWalk(ctx.projectId)}
                    className={buttonClass({ variant: 'primary' })}
                  >
                    {t.backToNeedsYou}
                  </Link>
                  <Link to="/p/$projectId" params={{ projectId: ctx.projectId }} className={buttonClass({ variant: 'quiet' })}>
                    {t.seeProduct}
                  </Link>
                </div>
              </section>
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}
