// Product overview (DESIGN.md §3.5, INV-OVW-*, INV-LENS-*): an operational dashboard of where the
// product stands. The header says how many features are ready to build, with a bar and its text
// legend; coming back, "While you were away" tells what changed, as links, and marks the changed
// things. Then the design stages, one section per kind of thing (every title opens it, Preview
// shows its facts beside the page), and on the side what needs you in Catch up's order, what runs,
// what is ready and what was decided — with "Ask DEMIURGO about the whole product" at the bottom.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { explorationsQuery, inboxQuery, projectsQuery, runsQuery, stateQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { ExplorationSummary, ProductRow } from '../../api/types.ts';
import { AskBox } from '../../components/AskBox.tsx';
import { buttonClass } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { EyeIcon, PlusIcon, ProductIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, usePageTitle, WithAside } from '../../components/Page.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { Tag } from '../../components/Badge.tsx';
import { cn } from '../../lib/cn.ts';
import { useProjectId, useTables } from '../../lib/hooks.ts';
import { TYPE_WORDS_PLURAL } from '../../words.ts';
import { ProductTabs } from '../../shell/ProductTabs.tsx';
import { TaxonomyHint } from '../knowledge/TaxonomyHint.tsx';
import { versionIndex, waitingFor } from '../record/logic.ts';
import { ProgressLine, ReadyToBuild, RecentlyDecided, RunningNow } from './Blueprint.tsx';
import { type ChangeMark, DraftingCard, FeatureCard, ParkedIdeas, RecordRow, RowList, ThreadRow, UNCHANGED } from './Cards.tsx';
import { type Lens, useLens } from './lens/useLens.ts';
import { WhileAway } from './lens/WhileAway.tsx';
import { NeedsSummary } from './NeedsColumn.tsx';
import { DraftPreview, type PreviewTarget, RecordPreview } from './Previews.tsx';
import { draftingRuns, featureStatus, productProgress, recentlyDecided, workingRuns } from './progress.ts';
import { DesignStages } from './Stages.tsx';
import { useReturnFocus } from '../record/returnFocus.ts';

const STAGE_RECORD_TYPES = new Set(['requirement', 'quality_requirement', 'threat_model', 'production_readiness']);

function changeOf(lens: Lens, changed: Map<string, string | null>, key: string): ChangeMark {
  if (!lens.on || !changed.has(key)) return UNCHANGED;
  return { changed: true, note: changed.get(key) ?? null, since: lens.since };
}

function Count({ n }: { n: number }) {
  return n > 0 ? <span className="font-normal text-fg-2"> · {n}</span> : null;
}

export function OverviewScreen() {
  const projectId = useProjectId();
  return <Overview key={projectId} projectId={projectId} />;
}

function OverviewSkeleton() {
  return (
    <Skeleton label="Loading the product" className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Bone key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <Bone className="h-5 w-40" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Bone key={i} className="h-44 rounded-lg" />
        ))}
      </div>
      <Bone className="h-5 w-56" />
      <Bone className="h-32 w-full rounded-lg" />
    </Skeleton>
  );
}

/** What comes later (INV-OVW-09): quiet, at the end, so it doesn't take the space of what can be done now. */
function LaterRows() {
  return (
    <section aria-labelledby="later-title" data-later className="flex flex-col gap-2">
      <h2 id="later-title" className="text-base font-semibold text-fg">
        Coming later
      </h2>
      <ul className="flex flex-col gap-1.5 rounded-lg border border-dashed border-edge-strong px-4 py-3 text-sm text-fg-2">
        {['Who uses it', 'Rules for the whole product'].map((t) => (
          <li key={t} className="flex flex-wrap items-center gap-2">
            <Tag>Later</Tag>
            <span className="font-medium text-fg">{t}</span>
            <span>In a later increment, DEMIURGO will read them from your idea.</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Overview({ projectId }: { projectId: string }) {
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  const state = useQuery(stateQuery(projectId));
  const inbox = useQuery(inboxQuery(projectId));
  const runsQ = useQuery(runsQuery(projectId));
  const explorationsQ = useQuery(explorationsQuery(projectId));
  const tables = useTables();
  const lens = useLens(projectId, state.data);
  const [preview, setPreviewState] = useState<PreviewTarget>(null);
  const focus = useReturnFocus();
  const setPreview = (t: PreviewTarget) => {
    if (t) focus.capture();
    setPreviewState(t);
  };
  const closePreview = (o: boolean) => {
    if (o) return;
    setPreviewState(null);
    focus.restore();
  };
  const name = state.data?.project.name ?? project?.name ?? 'The product';
  usePageTitle(['Product', name]);

  const runs = runsQ.data ?? [];
  const working = workingRuns(runs);
  const drafting = draftingRuns(runs);
  const s = state.data;
  const rows: ProductRow[] = s ? [...s.designs, ...s.decisions] : [];
  const threads = new Map((s?.explorations ?? []).map((e) => [e.id, e.purpose]));
  const waitingOf = (row: ProductRow) => waitingFor(row.code, inbox.data, row.origin_exploration);
  const waitingByCode = new Map(rows.map((r) => [r.code, waitingOf(r)]));
  const countOf = (code: string) => {
    const w = waitingByCode.get(code);
    return w ? w.versions + w.proposals + w.links + w.questions : 0;
  };
  const progress = productProgress(rows, countOf, runs, drafting.length);
  const empty = !!s && rows.length === 0;
  const versions = s ? versionIndex(s) : new Map();
  const newRecord = !!tables && canCreate(tables, 'record.create');

  const actions: ReactNode = (
    <>
      {lens.available ? (
        <button
          type="button"
          aria-pressed={lens.on}
          onClick={() => lens.setOn(!lens.on)}
          className={cn(buttonClass(), lens.on && 'border-accent-edge bg-accent-soft text-accent-text hover:bg-accent-soft')}
        >
          <EyeIcon size={15} />
          What changed · {lens.lines.length}
        </button>
      ) : null}
      {newRecord ? (
        <Link to="/p/$projectId/records/new" params={{ projectId }} className={buttonClass({ variant: 'secondary' })}>
          <PlusIcon size={15} />
          New record
        </Link>
      ) : null}
    </>
  );

  const previewRow = preview?.kind === 'record' ? rows.find((r) => r.code === preview.code) : undefined;
  const previewRun = preview?.kind === 'draft' ? runs.find((r) => r.id === preview.runId) : undefined;
  const previewFrom = previewRun?.scope.id ? versions.get(previewRun.scope.id) : undefined;

  const aside = (
    <>
      <NeedsSummary projectId={projectId} state={s} inbox={inbox} />
      <RunningNow
        projectId={projectId}
        runs={working}
        threads={threads}
        error={runsQ.error}
        onRetry={() => void runsQ.refetch()}
      />
      <ReadyToBuild projectId={projectId} rows={(s?.designs ?? []).filter((r) => s?.ready_to_build.includes(r.code))} />
      <RecentlyDecided projectId={projectId} rows={recentlyDecided(rows)} />
      <TaxonomyHint projectId={projectId} />
      <AskBox projectId={projectId} subject={{ kind: 'product', name }} className="border-t border-edge pt-5" />
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <ProductIcon size={15} className="text-fg-3" />
            The product
          </>
        }
        title={name}
        actions={actions}
        tabs={<ProductTabs active="overview" />}
      >
        {s && !empty ? <ProgressLine progress={progress} drafting={drafting.length} /> : null}
      </PageHeader>
      <PageBody>
        <WithAside aside={aside} asideLabel="What needs you and what runs" asideWidth="md">
          {!s ? (
            state.error ? (
              <ErrorNotice error={state.error} onRetry={() => void state.refetch()} />
            ) : (
              <OverviewSkeleton />
            )
          ) : (
            <div className="flex flex-col gap-10">
              {lens.on ? <WhileAway projectId={projectId} lens={lens} /> : null}
              <DesignStages projectId={projectId} />
              {empty ? (
                <EmptyState
                  title="Nothing here yet"
                  action={
                    <>
                      <Link to="/p/$projectId/threads" params={{ projectId }} className={buttonClass({ variant: 'primary' })}>
                        Go to Threads
                      </Link>
                      {newRecord ? (
                        <Link to="/p/$projectId/records/new" params={{ projectId }} className={buttonClass()}>
                          New record
                        </Link>
                      ) : null}
                    </>
                  }
                >
                  Write a record yourself or open a thread to design it with DEMIURGO.
                </EmptyState>
              ) : (
                <ProductSections
                  projectId={projectId}
                  rows={rows}
                  lens={lens}
                  waitingOf={(r) => waitingByCode.get(r.code) ?? waitingOf(r)}
                  statusOf={(r) => featureStatus(r, countOf(r.code), runs)}
                  onPreview={setPreview}
                  explorations={s.explorations}
                  questionsWaiting={(id) =>
                    inbox.data
                      ? [...inbox.data.open_questions, ...inbox.data.questions_to_confirm].filter((q) => q.exploration_id === id)
                          .length
                      : 0
                  }
                />
              )}
              {drafting.length > 0 ? (
                <Section
                  id="drafting"
                  title={
                    <>
                      Being drafted
                      <Count n={drafting.length} />
                    </>
                  }
                  note="Features DEMIURGO is writing from an approved decision."
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    {drafting.map((run) => {
                      const from = run.scope.id ? versions.get(run.scope.id) : undefined;
                      return (
                        <DraftingCard
                          key={run.id}
                          projectId={projectId}
                          run={run}
                          from={from ? rows.find((r) => r.code === from.code) : undefined}
                          onPreview={() => setPreview({ kind: 'draft', runId: run.id })}
                        />
                      );
                    })}
                  </div>
                </Section>
              ) : null}
              {explorationsQ.error ? (
                <ErrorNotice error={explorationsQ.error} compact focus={false} onRetry={() => void explorationsQ.refetch()} />
              ) : (
                <ParkedIdeas
                  projectId={projectId}
                  threads={(explorationsQ.data ?? []).filter((e) => e.state === 'set_aside')}
                  changeOf={(id) => changeOf(lens, lens.threads, id)}
                />
              )}
              <LaterRows />
            </div>
          )}
        </WithAside>
      </PageBody>
      <RecordPreview
        projectId={projectId}
        row={previewRow}
        waiting={previewRow ? waitingOf(previewRow) : { versions: 0, proposals: 0, links: 0, questions: 0 }}
        thread={previewRow?.origin_exploration ? (threads.get(previewRow.origin_exploration) ?? null) : null}
        open={preview?.kind === 'record'}
        onOpenChange={closePreview}
      />
      <DraftPreview
        projectId={projectId}
        run={previewRun}
        from={previewFrom ? rows.find((r) => r.code === previewFrom.code) : undefined}
        open={preview?.kind === 'draft'}
        onOpenChange={closePreview}
      />
    </>
  );
}

/** One section per kind of record, and the threads with open questions (INV-OVW-11…19). */
function ProductSections({
  projectId,
  rows,
  lens,
  waitingOf,
  statusOf,
  onPreview,
  explorations,
  questionsWaiting,
}: {
  projectId: string;
  rows: ProductRow[];
  lens: Lens;
  waitingOf: (row: ProductRow) => ReturnType<typeof waitingFor>;
  statusOf: (row: ProductRow) => ReturnType<typeof featureStatus>;
  onPreview: (t: PreviewTarget) => void;
  explorations: ExplorationSummary[];
  questionsWaiting: (threadId: string) => number;
}) {
  const features = rows.filter((r) => r.type === 'fdr');
  const decisions = rows.filter((r) => r.type === 'decision' || r.type === 'adr');
  const stageRecords = rows.filter((r) => STAGE_RECORD_TYPES.has(r.type));
  const bugs = rows.filter((r) => r.type === 'bug');
  const open = explorations.filter((e) => e.open_questions > 0);
  const recordRow = (row: ProductRow) => (
    <RecordRow
      key={row.code}
      projectId={projectId}
      row={row}
      waiting={waitingOf(row)}
      change={changeOf(lens, lens.records, row.code)}
      onPreview={() => onPreview({ kind: 'record', code: row.code })}
    />
  );
  return (
    <>
      <Section
        id="features"
        title={
          <>
            {TYPE_WORDS_PLURAL.fdr}
            <Count n={features.length} />
          </>
        }
      >
        {features.length === 0 ? (
          <p className="text-sm text-fg-2">
            No features yet. DEMIURGO drafts one from an approved decision, or you can write one yourself.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {features.map((row) => (
              <FeatureCard
                key={row.code}
                projectId={projectId}
                row={row}
                waiting={waitingOf(row)}
                status={statusOf(row)}
                change={changeOf(lens, lens.records, row.code)}
                onPreview={() => onPreview({ kind: 'record', code: row.code })}
              />
            ))}
          </div>
        )}
      </Section>
      {decisions.length > 0 ? (
        <Section
          id="decisions"
          title={
            <>
              Decisions and tech decisions
              <Count n={decisions.length} />
            </>
          }
        >
          <RowList label="Decisions and tech decisions">{decisions.map(recordRow)}</RowList>
        </Section>
      ) : null}
      {stageRecords.length > 0 ? (
        <Section
          id="stage-records"
          title={
            <>
              Requirements, quality, security and production
              <Count n={stageRecords.length} />
            </>
          }
        >
          <RowList label="Requirements, quality, security and production">{stageRecords.map(recordRow)}</RowList>
        </Section>
      ) : null}
      {bugs.length > 0 ? (
        <Section
          id="bugs"
          title={
            <>
              {TYPE_WORDS_PLURAL.bug}
              <Count n={bugs.length} />
            </>
          }
        >
          <RowList label={TYPE_WORDS_PLURAL.bug}>{bugs.map(recordRow)}</RowList>
        </Section>
      ) : null}
      {open.length > 0 ? (
        <Section
          id="open-threads"
          title={
            <>
              Threads with open questions
              <Count n={open.length} />
            </>
          }
        >
          <RowList label="Threads with open questions">
            {open.map((t) => (
              <ThreadRow
                key={t.id}
                projectId={projectId}
                thread={t}
                waiting={questionsWaiting(t.id)}
                change={changeOf(lens, lens.threads, t.id)}
              />
            ))}
          </RowList>
        </Section>
      ) : null}
    </>
  );
}
