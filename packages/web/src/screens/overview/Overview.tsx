// Overview (spec §4.3, canvas B1 and S6A): the product at a glance. The progress line under the
// title, features as cards with where each one is (and those DEMIURGO drafts, the parked ideas and
// capturing a new one), decisions and tech decisions as nodes, threads with open questions; on the
// right what needs the person, what runs and what was decided; at the bottom, "Ask DEMIURGO"
// about the whole product. Coming back, the "What changed" lens dims what did not change.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useId } from 'react';
import { explorationsQuery, inboxQuery, runsQuery, stateQuery } from '../../api/queries.ts';
import type { ExplorationSummary, ProductRow } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { Node } from '../../ui/Card.tsx';
import { EyeIcon } from '../../ui/icons.tsx';
import { CardSkeleton, EmptyState, Page, PageTitle, Skeleton } from '../../ui/layout.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { Mark } from '../../ui/marks.tsx';
import { AskBar } from '../../ui/AskBar.tsx';
import { Button } from '../../ui/Button.tsx';
import { TYPE_WORDS_PLURAL } from '../../words.ts';
import { versionIndex, waitingCount, waitingFor } from '../record/logic.ts';
import { useNow } from '../run/hooks.ts';
import { ProductTabs } from '../shell/Header.tsx';
import { useLens, type Lens } from './lens/useLens.ts';
import { WhileAway } from './lens/WhileAway.tsx';
import { NeedsColumn } from './NeedsColumn.tsx';
import { CaptureIdea, DraftingCard, LaterRows, ParkedCard, ProgressLine } from './Blueprint.tsx';
import { draftingRuns, featureStatus, productProgress, workingRuns } from './progress.ts';
import { FeatureCard, type LensMark, RecordNode, UNDIM } from './RecordCard.tsx';

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mb-8">
      <h2 id={id} className="mb-2.5 text-xs font-semibold text-muted">
        {title}
        {count > 0 && <span className="font-normal"> · {count}</span>}
      </h2>
      {children}
    </section>
  );
}

function lensOf(lens: Lens, changed: Map<string, string | null>, key: string): LensMark {
  if (!lens.on) return { dimmed: false, changed: false, note: null, since: null };
  const is = changed.has(key);
  return { dimmed: !is, changed: is, note: changed.get(key) ?? null, since: lens.since };
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
  const runs = useQuery(runsQuery(projectId)).data ?? [];
  const explorations = useQuery(explorationsQuery(projectId)).data ?? [];
  const lens = useLens(projectId, state.data);
  const working = workingRuns(runs);
  const now = useNow(working.length > 0);
  const aside = <NeedsColumn projectId={projectId} state={state.data} inbox={inbox.data} runs={working} now={now} />;

  if (!state.data) {
    return <Page aside={aside}>{state.error ? <Reasons error={state.error} /> : <OverviewSkeleton />}</Page>;
  }
  const s = state.data;
  const threads = new Map(s.explorations.map((e) => [e.id, e.purpose]));
  const features = s.designs.filter((r) => r.type === 'fdr');
  const bugs = s.designs.filter((r) => r.type === 'bug');
  const decisions = [...s.decisions, ...s.designs.filter((r) => r.type === 'adr')];
  const open = s.explorations.filter((e) => e.open_questions > 0);
  const parked = explorations.filter((e) => e.state === 'set_aside');
  const drafting = draftingRuns(runs);
  const versions = versionIndex(s);
  const rows = [...s.designs, ...s.decisions];
  const waitingOf = (row: ProductRow) => waitingFor(row.code, inbox.data, row.origin_exploration);
  const props = (row: ProductRow) => ({
    projectId,
    row,
    waiting: waitingOf(row),
    thread: row.origin_exploration ? (threads.get(row.origin_exploration) ?? null) : null,
    lens: lensOf(lens, lens.records, row.code),
  });
  const waitingByCode = new Map(rows.map((r) => [r.code, waitingCount(waitingOf(r))]));
  const progress = productProgress(rows, (code) => waitingByCode.get(code) ?? 0, runs, drafting.length);
  const empty = features.length + decisions.length + bugs.length === 0;

  return (
    <Page aside={aside} className="flex flex-col pb-0">
      <div>
        <PageTitle
          eyebrow="The product"
          title={s.project.name}
          subtitle={empty ? undefined : <ProgressLine progress={progress} />}
          className="mb-4"
          actions={
            lens.available && !lens.on ? (
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => lens.setOn(true)}>
                <EyeIcon size={14} />
                Show what changed · {lens.lines.length}
              </Button>
            ) : undefined
          }
        />
        <ProductTabs active="overview" />
        {lens.on && <WhileAway lens={lens} />}
        <LaterRows />

        {empty && (
          <EmptyState className="mb-8">
            Nothing here yet. Import design/ or open a thread to start designing.{' '}
            <Link to="/p/$projectId/threads" params={{ projectId }} className="font-semibold text-needs hover:text-needs-hover">
              Go to Threads
            </Link>
          </EmptyState>
        )}

        <Section title={TYPE_WORDS_PLURAL.fdr} count={features.length}>
          <div className="grid grid-cols-4 gap-4 max-[1439px]:grid-cols-3">
            {features.map((row) => (
              <FeatureCard
                key={row.code}
                {...props(row)}
                status={featureStatus(row, waitingByCode.get(row.code) ?? 0, runs)}
                now={now}
              />
            ))}
            {drafting.map((run) => {
              const from = run.scope.id ? versions.get(run.scope.id) : undefined;
              return (
                <DraftingCard
                  key={run.id}
                  projectId={projectId}
                  run={run}
                  from={from ? rows.find((r) => r.code === from.code) : undefined}
                  now={now}
                />
              );
            })}
            {parked.map((t) => (
              <ParkedCard key={t.id} projectId={projectId} thread={t} dimmed={lens.on && !lens.threads.has(t.id)} />
            ))}
            <CaptureIdea projectId={projectId} />
          </div>
        </Section>

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
                      ? [...inbox.data.open_questions, ...inbox.data.questions_to_confirm].filter(
                          (q) => q.exploration_id === t.id,
                        ).length
                      : 0
                  }
                  lens={lensOf(lens, lens.threads, t.id)}
                />
              ))}
            </div>
          </Section>
        )}
      </div>
      {/* Room below for the legend's ⓘ, which lives in the bottom-left corner. */}
      <div className="sticky bottom-0 z-10 mt-auto -mx-10 bg-linear-to-t from-paper from-75% to-transparent px-10 pt-8 pb-[60px]">
        <AskBar projectId={projectId} subject={{ kind: 'product', name: s.project.name }} />
      </div>
    </Page>
  );
}
