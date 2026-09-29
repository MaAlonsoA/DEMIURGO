// A batch decided one proposal at a time (DESIGN.md §3.2). On the left, every proposal with its state and
// how many are left to decide; in the middle, the one being read, in full, with its decision at
// the bottom. Previous and Next move through them; after a decision the page goes to the next one
// still to decide, puts the focus on its title and says so (R13, R80). Moving away from unsaved
// "Change" edits asks first. Never an "accept all" (INV-PROP-21).

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { inboxQuery, stateQuery } from '../../api/queries.ts';
import type { BatchDetail, InboxProposal, ProductRow } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons.tsx';
import { Meter } from '../../components/Meter.tsx';
import { PageBody, PageHeader } from '../../components/Page.tsx';
import { EntityState, StatusBadge } from '../../components/status.tsx';
import { DayTime } from '../../components/Time.tsx';
import { cn } from '../../lib/cn.ts';
import { useLocale } from '../../i18n/locale.ts';
import { useMessages } from '../../i18n/define.ts';
import { useBatchCrumbs } from './Batch.tsx';
import { EditGuard, useEditGuard } from './guard.tsx';
import { proposalTitle } from './model.ts';
import { ProposalKind } from '../../components/AspectTag.tsx';
import { batchHeading, type ProposalView as ProposalData } from './proposal.ts';
import { ProposalView } from './ProposalView.tsx';
import { ITEM_BATCH } from './words.i18n.ts';

/** The batch's proposals with what the inbox adds to the pending ones: the idea check and the warnings. */
export function withInbox(batch: BatchDetail, inbox: InboxProposal[]): ProposalData[] {
  const extra = new Map(inbox.map((p) => [p.id, p]));
  return batch.proposals.map((p) => {
    const i = extra.get(p.id);
    return { ...p, obsolescence: i?.obsolescence ?? [], assessment: i?.assessment ?? null };
  });
}

export function ItemBatch({ projectId, batch }: { projectId: string; batch: BatchDetail }) {
  return (
    <EditGuard>
      <ItemBatchPage projectId={projectId} batch={batch} />
    </EditGuard>
  );
}

function ItemBatchPage({ projectId, batch }: { projectId: string; batch: BatchDetail }) {
  const t = useMessages(ITEM_BATCH);
  const inbox = useQuery(inboxQuery(projectId)).data;
  const state = useQuery(stateQuery(projectId)).data;
  const rows: ProductRow[] = state ? [...state.decisions, ...state.designs] : [];
  const proposals = withInbox(batch, inbox?.batches.find((b) => b.id === batch.id)?.proposals ?? []);
  const n = proposals.length;
  const firstPending = Math.max(
    0,
    proposals.findIndex((p) => p.state === 'pending'),
  );
  // The page stays on the proposal it shows while others are decided elsewhere.
  const [chosen, setChosen] = useState<number | null>(null);
  useEffect(() => {
    if (chosen === null && n > 0) setChosen(firstPending);
  }, [chosen, n, firstPending]);
  const index = Math.min(chosen ?? firstPending, Math.max(0, n - 1));
  const current = proposals[index];
  const left = proposals.filter((p) => p.state === 'pending').length;
  // Out of date is not decided: it can't be accepted any more, and nobody chose that.
  const stale = proposals.filter((p) => p.state === 'superseded').length;
  const decided = n - left - stale;
  const locale = useLocale();
  const { eyebrow, title } = batchHeading(n, locale);
  const crumbs = useBatchCrumbs(projectId, title);
  const guard = useEditGuard();
  const titleId = useId();
  const focusTitle = useRef(false);

  useEffect(() => {
    if (!focusTitle.current) return;
    focusTitle.current = false;
    // After the dialog has closed and given its focus back.
    const timer = setTimeout(() => document.getElementById(titleId)?.focus(), 60);
    return () => clearTimeout(timer);
  });

  const go = (i: number, focus = false) =>
    guard.guard(() => {
      focusTitle.current = focus;
      setChosen(Math.max(0, Math.min(n - 1, i)));
    });

  /** After a decision: the next proposal still to decide, after this one and then from the start. */
  const onDone = (said: string) => {
    const after = proposals.findIndex((p, i) => i > index && p.state === 'pending' && p.id !== current?.id);
    const before = proposals.findIndex((p, i) => i < index && p.state === 'pending');
    const next = after >= 0 ? after : before;
    const remaining = Math.max(0, left - 1);
    announce(t.doneAnnounce(said, remaining));
    focusTitle.current = true;
    if (next >= 0) setChosen(next);
  };

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        eyebrow={eyebrow}
        title={title}
        meta={
          <>
            <DayTime iso={batch.created_at} />
            {batch.summary ? <span>{batch.summary}</span> : null}
            <span>{t.decideEach}</span>
          </>
        }
      >
        <Meter
          value={decided}
          max={n}
          label={t.meterLabel(decided, n, stale)}
          tone={left === 0 && stale === 0 ? 'success' : 'accent'}
          className="max-w-md"
        />
      </PageHeader>
      <PageBody>
        <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
          <div className="flex w-full shrink-0 flex-col gap-6 xl:sticky xl:top-4 xl:w-80">
            <nav aria-label={t.proposalsInBatch} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-base font-semibold text-fg">{t.inThisBatch}</h2>
                <span className="text-sm text-fg-2" data-left={left}>
                  {left > 0 ? t.toDecide(left) : stale > 0 ? t.nothingLeftToDecide : t.allDecided}
                </span>
              </div>
              <ol className="flex flex-col gap-1">
                {proposals.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-current={i === index ? 'true' : undefined}
                      onClick={() => go(i, true)}
                      data-step={p.id}
                      className={cn(
                        'flex w-full cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors duration-[var(--m-fast)]',
                        i === index ? 'border-accent-edge bg-selected' : 'border-transparent hover:bg-hover',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
                          i === index ? 'border-accent bg-accent text-on-accent' : 'border-edge-strong text-fg-2',
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <ProposalKind proposal={p} className="inline-flex items-center gap-1.5 text-xs text-fg-2" />
                        <span className="line-clamp-2 text-sm font-medium text-fg">{proposalTitle(p)}</span>
                        <span>
                          {p.state === 'superseded' ? (
                            <StatusBadge kind="stale" word="Out of date" />
                          ) : (
                            <EntityState entity="proposal" state={p.state} />
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <nav aria-label={t.moveBetween} className="flex items-center justify-between gap-3">
              <Button
                variant="quiet"
                size="sm"
                aria-label={t.previousProposal}
                icon={<ChevronLeftIcon size={14} />}
                disabled={index === 0}
                onClick={() => go(index - 1)}
              >
                {t.previous}
              </Button>
              <span className="text-sm text-fg-2 tabular-nums">{t.positionOf(index + 1, n)}</span>
              <Button
                variant="quiet"
                size="sm"
                aria-label={t.nextProposal}
                trailing={<ChevronRightIcon size={14} />}
                disabled={index >= n - 1}
                onClick={() => go(index + 1)}
              >
                {t.next}
              </Button>
            </nav>
            {current ? (
              <ProposalView
                key={current.id}
                projectId={projectId}
                proposal={current}
                position={index + 1}
                count={n}
                producer={batch.producer}
                createdAt={batch.created_at}
                runId={batch.run_id}
                rows={rows}
                titleId={titleId}
                onDone={onDone}
                footer={
                  left === 0 ? (
                    <Link to="/p/$projectId/needs-you" params={{ projectId }} className={buttonClass({ variant: 'secondary' })}>
                      {t.backToNeedsYou}
                    </Link>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        go(
                          proposals.findIndex((p) => p.state === 'pending'),
                          true,
                        )
                      }
                    >
                      {t.nextToDecide}
                    </Button>
                  )
                }
              />
            ) : null}
          </div>
        </div>
      </PageBody>
    </>
  );
}
