// A batch decided one proposal at a time (DESIGN.md §3.2): an agent's, DEMIURGO's from a
// conversation, or the reviews knowledge asks for. On the left, every proposal with its state and
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
import { WhoAvatar } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { whoOf } from '../../words.ts';
import { useBatchCrumbs } from './Batch.tsx';
import { EditGuard, useEditGuard } from './guard.tsx';
import { PROPOSAL_TYPE_WORDS, proposalTitle } from './model.ts';
import { batchHeading, type ProposalView as ProposalData } from './proposal.ts';
import { ProposalView, producerName } from './ProposalView.tsx';

/** The batch's proposals with what the inbox adds to the pending ones: the idea check and the warnings. */
export function withInbox(batch: BatchDetail, inbox: InboxProposal[]): ProposalData[] {
  const extra = new Map(inbox.map((p) => [p.id, p]));
  return batch.proposals.map((p) => {
    const i = extra.get(p.id);
    return { ...p, obsolescence: i?.obsolescence ?? [], assessment: i?.assessment ?? null };
  });
}

const WHO_EXPLAINS: Record<string, string> = {
  agent: 'An agent from outside. It only proposes: nothing changes until you accept.',
  automatic: 'It found these while taking in a change. It only proposes: nothing changes until you accept.',
  demiurgo: 'It only proposes: nothing changes until you accept.',
  you: 'Nothing changes until you accept.',
};

export function ItemBatch({ projectId, batch }: { projectId: string; batch: BatchDetail }) {
  return (
    <EditGuard>
      <ItemBatchPage projectId={projectId} batch={batch} />
    </EditGuard>
  );
}

function ItemBatchPage({ projectId, batch }: { projectId: string; batch: BatchDetail }) {
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
  const { eyebrow, title } = batchHeading(batch.producer, n);
  const who = whoOf(batch.producer);
  const crumbs = useBatchCrumbs(projectId, title);
  const guard = useEditGuard();
  const titleId = useId();
  const focusTitle = useRef(false);

  useEffect(() => {
    if (!focusTitle.current) return;
    focusTitle.current = false;
    // After the dialog has closed and given its focus back.
    const t = setTimeout(() => document.getElementById(titleId)?.focus(), 60);
    return () => clearTimeout(t);
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
    announce(`${said} ${remaining === 0 ? 'All decided.' : `${remaining} to decide.`}`);
    focusTitle.current = true;
    if (next >= 0) setChosen(next);
  };

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <WhoAvatar kind={who.kind} size={18} />
            {eyebrow}
          </span>
        }
        title={title}
        meta={
          <>
            <DayTime iso={batch.created_at} />
            {batch.summary ? <span>{batch.summary}</span> : null}
            <span>Nothing changes until you accept. Decide each one: accept it, change it or reject it.</span>
          </>
        }
      >
        <Meter
          value={decided}
          max={n}
          label={`${decided} of ${n} decided${stale > 0 ? ` · ${stale} out of date` : ''}`}
          tone={left === 0 && stale === 0 ? 'success' : 'accent'}
          className="max-w-md"
        />
      </PageHeader>
      <PageBody>
        <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
          <div className="flex w-full shrink-0 flex-col gap-6 xl:sticky xl:top-4 xl:w-80">
            <nav aria-label="Proposals in this batch" className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-base font-semibold text-fg">In this batch</h2>
                <span className="text-sm text-fg-2" data-left={left}>
                  {left > 0 ? `${left} to decide` : stale > 0 ? 'Nothing left to decide' : 'All decided'}
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
                        <span className="text-xs text-fg-2">{PROPOSAL_TYPE_WORDS[p.type] ?? 'Proposal'}</span>
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
            <section aria-label="Who proposes" className="flex items-start gap-3 rounded-lg border border-edge px-3.5 py-3">
              <WhoAvatar kind={who.kind} size={28} />
              <div className="flex flex-col gap-0.5 text-sm">
                <p className="font-medium text-fg">{producerName(batch.producer)}</p>
                <p className="text-fg-2">{WHO_EXPLAINS[who.kind]}</p>
              </div>
            </section>
          </div>

          <div className="flex min-w-0 max-w-3xl flex-1 flex-col gap-4">
            <nav aria-label="Move between proposals" className="flex items-center justify-between gap-3">
              <Button
                variant="quiet"
                size="sm"
                aria-label="Previous proposal"
                icon={<ChevronLeftIcon size={14} />}
                disabled={index === 0}
                onClick={() => go(index - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-fg-2 tabular-nums">
                {index + 1} of {n}
              </span>
              <Button
                variant="quiet"
                size="sm"
                aria-label="Next proposal"
                trailing={<ChevronRightIcon size={14} />}
                disabled={index >= n - 1}
                onClick={() => go(index + 1)}
              >
                Next
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
                      Back to Needs you
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
                      Next to decide
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
