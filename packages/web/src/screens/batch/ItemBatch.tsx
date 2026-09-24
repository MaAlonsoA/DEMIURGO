// A batch resolved item by item (canvas S7B): an agent's, DEMIURGO's from a conversation, or the
// reviews knowledge suggests. One proposal at a time with its author visible, Previous and Next,
// and the whole batch on the right. Never an "accept all".

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { inboxQuery, stateQuery } from '../../api/queries.ts';
import type { BatchDetail, InboxProposal, ProductRow } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { dayTime } from '../../lib/time.ts';
import { stateWord, whoOf } from '../../words.ts';
import { Button } from '../../ui/Button.tsx';
import { ChevronLeft, ChevronRight } from '../../ui/icons.tsx';
import { Breadcrumbs, Page } from '../../ui/layout.tsx';
import { Mark } from '../../ui/marks.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { proposalTitle, PROPOSAL_TYPE_WORDS } from './model.ts';
import { Eyebrow } from './parts.tsx';
import { NextButton, ProposalCard, type ProposalView } from './ProposalCard.tsx';

function heading(producer: string, n: number): { eyebrow: string; title: string } {
  const who = whoOf(producer);
  const changes = n === 1 ? 'change' : 'changes';
  if (who.kind === 'agent')
    return { eyebrow: `${n} ${n === 1 ? 'proposal' : 'proposals'} from an agent`, title: `${who.name} proposes ${n} ${changes}` };
  if (who.kind === 'demiurgo')
    return { eyebrow: `${n} ${n === 1 ? 'proposal' : 'proposals'} from DEMIURGO`, title: `DEMIURGO proposes ${n} ${changes}` };
  return {
    eyebrow: `${n} ${n === 1 ? 'review' : 'reviews'} from knowledge`,
    title: `DEMIURGO's knowledge asks you to review ${n === 1 ? 'a record' : `${n} records`}`,
  };
}

/** The batch's proposals with what the inbox adds to the pending ones: the idea check and the warnings. */
export function withInbox(batch: BatchDetail, inbox: InboxProposal[]): ProposalView[] {
  const extra = new Map(inbox.map((p) => [p.id, p]));
  return batch.proposals.map((p) => {
    const i = extra.get(p.id);
    return { ...p, obsolescence: i?.obsolescence ?? [], assessment: i?.assessment ?? null };
  });
}

export function ItemBatch({ projectId, batch }: { projectId: string; batch: BatchDetail }) {
  const inbox = useQuery(inboxQuery(projectId)).data;
  const state = useQuery(stateQuery(projectId)).data;
  const rows: ProductRow[] = state ? [...state.decisions, ...state.designs] : [];
  const proposals = withInbox(batch, inbox?.batches.find((b) => b.id === batch.id)?.proposals ?? []);
  const firstPending = Math.max(
    0,
    proposals.findIndex((p) => p.state === 'pending'),
  );
  const [chosen, setChosen] = useState<number | null>(null);
  // The page stays on the proposal it opened with: what gets resolved meanwhile doesn't move it.
  useEffect(() => {
    if (chosen === null && batch.proposals.length > 0) setChosen(firstPending);
  }, [chosen, batch.proposals.length, firstPending]);
  const index = Math.min(chosen ?? firstPending, Math.max(0, proposals.length - 1));
  const current = proposals[index];
  const n = proposals.length;
  const { eyebrow, title } = heading(batch.producer, n);
  const left = proposals.filter((p) => p.state === 'pending').length;
  const nextPending = proposals.findIndex((p, i) => i > index && p.state === 'pending');
  const go = (i: number) => setChosen(Math.max(0, Math.min(n - 1, i)));

  return (
    <Page
      className="pt-4"
      aside={
        <>
          <section className="flex flex-col gap-2" aria-label="In this batch">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold">In this batch</h2>
              <span className="text-xs text-muted">{left === 0 ? 'All decided' : `${left} to decide`}</span>
            </div>
            <ol className="flex flex-col gap-0.5">
              {proposals.map((p, i) => {
                const w = stateWord('proposal', p.state);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-current={i === index ? 'step' : undefined}
                      onClick={() => go(i)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left hover:bg-paper',
                        i === index && 'bg-needs-bg hover:bg-needs-bg',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[11px] font-bold',
                          i === index ? 'border-needs bg-needs text-white' : 'border-line-strong text-ink-2',
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-xs text-muted">{PROPOSAL_TYPE_WORDS[p.type] ?? p.type}</span>
                        <strong className="truncate text-[13px] font-semibold">{proposalTitle(p)}</strong>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                        <Mark kind={w.mark} label={w.word} />
                        {w.word}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
          <section className="flex items-start gap-3 rounded-xl border border-line px-3.5 py-3" aria-label="Who proposes">
            <WhoMark actor={batch.producer} size={28} />
            <div className="flex flex-col text-[13px]">
              <strong className="font-semibold">
                {whoOf(batch.producer).kind === 'automatic' ? "DEMIURGO's knowledge" : whoOf(batch.producer).name}
              </strong>
              <span className="text-xs text-muted">
                {whoOf(batch.producer).kind === 'agent'
                  ? 'An agent from outside. It only proposes: nothing changes until you accept.'
                  : whoOf(batch.producer).kind === 'automatic'
                    ? 'It found these while taking in a change. It only proposes: nothing changes until you accept.'
                    : 'It only proposes: nothing changes until you accept.'}
              </span>
            </div>
          </section>
        </>
      }
    >
      <Breadcrumbs items={[{ label: 'Needs you', to: '/p/$projectId/needs-you', params: { projectId } }, { label: title }]} />
      <div className="mb-4 flex max-w-[860px] items-start gap-3.5">
        <WhoMark actor={batch.producer} size={40} />
        <div className="flex flex-col gap-0.5">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="text-2xl leading-tight font-semibold">{title}</h1>
          <p className="text-sm text-ink-3">
            {dayTime(batch.created_at)}
            {batch.summary ? ` · ${batch.summary}` : ''} Nothing changes until you accept. Decide each one: accept it, change it
            or reject it.
          </p>
        </div>
      </div>

      {current && (
        <ProposalCard
          key={current.id}
          projectId={projectId}
          proposal={current}
          position={index + 1}
          count={n}
          producer={batch.producer}
          createdAt={batch.created_at}
          rows={rows}
          className="max-w-[860px]"
          footer={
            nextPending >= 0 ? (
              <NextButton onClick={() => go(nextPending)} />
            ) : index < n - 1 ? (
              <NextButton onClick={() => go(index + 1)} />
            ) : null
          }
        />
      )}

      <nav aria-label="Proposals" className="mt-3 flex max-w-[860px] items-center justify-between">
        <Button variant="ghost" aria-label="Previous proposal" disabled={index === 0} onClick={() => go(index - 1)}>
          <ChevronLeft size={14} /> Previous
        </Button>
        <span className="text-xs text-muted">
          {index + 1} of {n}
        </span>
        <Button variant="ghost" aria-label="Next proposal" disabled={index >= n - 1} onClick={() => go(index + 1)}>
          Next <ChevronRight size={14} />
        </Button>
      </nav>
    </Page>
  );
}
