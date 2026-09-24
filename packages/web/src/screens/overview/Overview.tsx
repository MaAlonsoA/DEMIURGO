// Overview (spec §4.3, canvas B1): the product at a glance. Features as cards, decisions and tech
// decisions as nodes, threads with open questions; on the right what needs the person and what is
// ready to build.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useId } from 'react';
import { inboxQuery, stateQuery } from '../../api/queries.ts';
import type { ExplorationSummary, Inbox, ProductRow, ProductState } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { Node } from '../../ui/Card.tsx';
import { CardSkeleton, EmptyState, Page, PageTitle, Skeleton } from '../../ui/layout.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { Mark } from '../../ui/marks.tsx';
import { TYPE_WORDS_PLURAL } from '../../words.ts';
import { waitingFor } from '../record/logic.ts';
import { ProductTabs } from '../shell/Header.tsx';
import { NeedsColumn } from './NeedsColumn.tsx';
import { FeatureCard, type LensMark, RecordNode, UNDIM } from './RecordCard.tsx';

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mb-8">
      <h2 id={id} className="mb-2.5 text-xs font-semibold text-muted">
        {title} <span className="font-normal">· {count}</span>
      </h2>
      {children}
    </section>
  );
}

const NO_LENS: LensMark = { dimmed: false, changed: false, note: null, since: null };

function Summary({ state, inbox }: { state: ProductState; inbox: Inbox | undefined }) {
  const features = state.designs.filter((r) => r.type === 'fdr');
  const ready = features.filter((r) => state.ready_to_build.includes(r.code)).length;
  const needs = inbox?.total ?? state.inbox.total;
  return (
    <span className="text-[14px] text-ink-3">
      <span className="font-semibold text-ink">
        Ready to build: {ready} of {features.length} {features.length === 1 ? 'feature' : 'features'}
      </span>
      {needs > 0 && (
        <>
          <span className="text-inactive-light"> · </span>
          {needs} {needs === 1 ? 'thing needs' : 'things need'} you
        </>
      )}
    </span>
  );
}

function ThreadNode({
  projectId,
  thread,
  waiting,
  lens,
}: {
  projectId: string;
  thread: ExplorationSummary;
  waiting: number;
  lens: LensMark;
}) {
  const open = thread.open_questions;
  return (
    <Link
      to="/p/$projectId/threads/$explorationId"
      params={{ projectId, explorationId: thread.id }}
      data-thread={thread.id}
      data-dimmed={lens.dimmed ? 'true' : undefined}
      className={cn('block min-w-0 rounded-[10px] hover:[&>[data-card]]:border-line-strong', lens.dimmed && UNDIM)}
    >
      <Node
        icon="thread"
        type="Thread"
        title={thread.purpose}
        line={lens.changed && lens.note ? `Since ${lens.since ?? 'your last visit'}: ${lens.note}` : undefined}
        status={
          <span className="flex items-center gap-1.5 text-xs text-ink-2">
            <Mark kind="open" label={`${open} open ${open === 1 ? 'question' : 'questions'}`} />
            {open} {open === 1 ? 'question' : 'questions'}
          </span>
        }
        needs={waiting}
        dimmed={lens.dimmed}
        changed={lens.changed}
        className="h-full"
      />
    </Link>
  );
}

function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading the product" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-1/4" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-11 rounded-[10px]" />
        <Skeleton className="h-11 rounded-[10px]" />
        <Skeleton className="h-11 rounded-[10px]" />
        <Skeleton className="h-11 rounded-[10px]" />
      </div>
    </div>
  );
}

export function OverviewScreen() {
  const projectId = useProjectId();
  return <Overview key={projectId} projectId={projectId} />;
}

function Overview({ projectId }: { projectId: string }) {
  const state = useQuery(stateQuery(projectId));
  const inbox = useQuery(inboxQuery(projectId));
  const aside = <NeedsColumn projectId={projectId} state={state.data} inbox={inbox.data} />;

  if (!state.data) {
    return <Page aside={aside}>{state.error ? <Reasons error={state.error} /> : <OverviewSkeleton />}</Page>;
  }
  const s = state.data;
  const threads = new Map(s.explorations.map((e) => [e.id, e.purpose]));
  const features = s.designs.filter((r) => r.type === 'fdr');
  const bugs = s.designs.filter((r) => r.type === 'bug');
  const decisions = [...s.decisions, ...s.designs.filter((r) => r.type === 'adr')];
  const open = s.explorations.filter((e) => e.open_questions > 0);
  const props = (row: ProductRow) => ({
    projectId,
    row,
    waiting: waitingFor(row.code, inbox.data, row.origin_exploration),
    thread: row.origin_exploration ? (threads.get(row.origin_exploration) ?? null) : null,
    lens: NO_LENS,
  });
  const empty = features.length + decisions.length + bugs.length === 0;

  return (
    <Page aside={aside}>
      <PageTitle
        eyebrow="The product"
        title={s.project.name}
        subtitle={empty ? undefined : <Summary state={s} inbox={inbox.data} />}
        className="mb-4"
      />
      <ProductTabs active="overview" />

      {empty && (
        <EmptyState className="mb-8">
          Nothing here yet. Import design/ or open a thread to start designing.{' '}
          <Link to="/p/$projectId/threads" params={{ projectId }} className="font-semibold text-needs hover:text-needs-hover">
            Go to Threads
          </Link>
        </EmptyState>
      )}

      {features.length > 0 && (
        <Section title={TYPE_WORDS_PLURAL.fdr} count={features.length}>
          <div className="grid grid-cols-4 gap-4 max-[1439px]:grid-cols-3">
            {features.map((row) => (
              <FeatureCard key={row.code} {...props(row)} />
            ))}
          </div>
        </Section>
      )}

      {decisions.length > 0 && (
        <Section title="Decisions and tech decisions" count={decisions.length}>
          <div className="grid grid-cols-2 gap-2.5">
            {decisions.map((row) => (
              <RecordNode key={row.code} {...props(row)} />
            ))}
          </div>
        </Section>
      )}

      {bugs.length > 0 && (
        <Section title={TYPE_WORDS_PLURAL.bug} count={bugs.length}>
          <div className="grid grid-cols-2 gap-2.5">
            {bugs.map((row) => (
              <RecordNode key={row.code} {...props(row)} />
            ))}
          </div>
        </Section>
      )}

      {open.length > 0 && (
        <Section title="Threads with open questions" count={open.length}>
          <div className="grid grid-cols-2 gap-2.5">
            {open.map((t) => (
              <ThreadNode
                key={t.id}
                projectId={projectId}
                thread={t}
                waiting={
                  inbox.data
                    ? [...inbox.data.open_questions, ...inbox.data.questions_to_confirm].filter((q) => q.exploration_id === t.id)
                        .length
                    : 0
                }
                lens={NO_LENS}
              />
            ))}
          </div>
        </Section>
      )}
    </Page>
  );
}
