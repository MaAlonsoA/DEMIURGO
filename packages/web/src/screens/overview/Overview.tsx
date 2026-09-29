// Product overview (DESIGN.md §3.5, INV-OVW-*, INV-LENS-*). First, what the product is: its
// definition (Definition.tsx), with where each section comes from and its changes. Then where it
// stands: the header says how many features are ready to build, with a bar and its text legend;
// coming back, "While you were away" tells what changed, as links, and marks the changed things.
// Then the design stages, one section per kind of thing (every title opens it, Preview shows its
// facts beside the page), and on the side what needs you in Catch up's order, what runs, what is
// ready and what was decided — with "Ask DEMIURGO about the whole product" at the bottom.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { definitionQuery, explorationsQuery, inboxQuery, projectsQuery, runsQuery, stagesQuery, stateQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { ExplorationSummary, ProductRow } from '../../api/types.ts';
import { AskBox } from '../../components/AskBox.tsx';
import { buttonClass } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { EyeIcon, PlusIcon, ProductIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, usePageTitle, WithAside } from '../../components/Page.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { cn } from '../../lib/cn.ts';
import { useProjectId, useTables } from '../../lib/hooks.ts';
import { useMessages } from '../../i18n/define.ts';
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
import { DefinitionWhyPanel, ProductDefinitionSection } from './Definition.tsx';
import { DesignStages } from './Stages.tsx';
import { FirstFeature } from '../thread/StageComplete.tsx';
import { useReturnFocus } from '../record/returnFocus.ts';
import { OVERVIEW } from './words.i18n.ts';
import { ASPECT_WORDS } from '../../aspects.i18n.ts';
import { recordsByAspect } from '../../aspects.ts';

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
  const t = useMessages(OVERVIEW);
  return (
    <Skeleton label={t.loadingProduct} className="flex flex-col gap-6">
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

function Overview({ projectId }: { projectId: string }) {
  const t = useMessages(OVERVIEW);
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  const state = useQuery(stateQuery(projectId));
  const inbox = useQuery(inboxQuery(projectId));
  const runsQ = useQuery(runsQuery(projectId));
  const explorationsQ = useQuery(explorationsQuery(projectId));
  const definition = useQuery(definitionQuery(projectId));
  const tables = useTables();
  const lens = useLens(projectId, state.data);
  const [preview, setPreviewState] = useState<PreviewTarget>(null);
  const [whyOpen, setWhyOpen] = useState<string | null>(null);
  const focus = useReturnFocus();
  const setPreview = (target: PreviewTarget) => {
    if (target) focus.capture();
    setPreviewState(target);
  };
  const closePreview = (o: boolean) => {
    if (o) return;
    setPreviewState(null);
    focus.restore();
  };
  const name = state.data?.project.name ?? project?.name ?? t.theProductDefault;
  usePageTitle([t.pageTitleProduct, name]);

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
  // With its definition, the product is no longer blank even before its first feature or decision.
  const blank = empty && !definition.data?.record && !definition.data?.proposal;
  const versions = s ? versionIndex(s) : new Map();
  const newRecord = !!tables && canCreate(tables, 'record.create');
  // After the onboarding and before any feature: the invitation to design the first one, in the
  // thread that hosted the onboarding stages, wherever that thread is (even closed).
  const stages = useQuery(stagesQuery(projectId)).data;
  const onboarding = stages?.filter((x) => x.moment === 'onboarding') ?? [];
  const mainThread = onboarding.every((x) => x.state === 'passed') ? onboarding[0]?.exploration_id : null;
  const mainState = s?.explorations.find((e) => e.id === mainThread)?.state;
  const firstFeature =
    !!mainThread &&
    !!s &&
    !rows.some((r) => r.type === 'fdr' || r.type === 'epic') &&
    !s.explorations.some((e) => e.parent_id === mainThread);

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
          {t.whatChanged(lens.lines.length)}
        </button>
      ) : null}
      {newRecord ? (
        <Link to="/p/$projectId/records/new" params={{ projectId }} className={buttonClass({ variant: 'secondary' })}>
          <PlusIcon size={15} />
          {t.newRecord}
        </Link>
      ) : null}
    </>
  );

  const previewRow = preview?.kind === 'record' ? rows.find((r) => r.code === preview.code) : undefined;
  const previewRun = preview?.kind === 'draft' ? runs.find((r) => r.id === preview.runId) : undefined;
  const previewFrom = previewRun?.scope.id ? versions.get(previewRun.scope.id) : undefined;

  const aside = whyOpen ? (
    <DefinitionWhyPanel projectId={projectId} title={whyOpen} onClose={() => setWhyOpen(null)} />
  ) : (
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
            {t.theProduct}
          </>
        }
        title={name}
        actions={actions}
        tabs={<ProductTabs active="overview" />}
      >
        {s && !empty ? <ProgressLine progress={progress} drafting={drafting.length} /> : null}
      </PageHeader>
      <PageBody>
        <WithAside aside={aside} asideLabel={t.whatNeedsAndRuns} asideWidth="md">
          {!s ? (
            state.error ? (
              <ErrorNotice error={state.error} onRetry={() => void state.refetch()} />
            ) : (
              <OverviewSkeleton />
            )
          ) : (
            <div className="flex flex-col gap-10">
              {lens.on ? <WhileAway projectId={projectId} lens={lens} /> : null}
              <ProductDefinitionSection projectId={projectId} whyOpen={whyOpen} onWhy={setWhyOpen} />
              {firstFeature && mainThread ? (
                <FirstFeature projectId={projectId} explorationId={mainThread} active={mainState === 'active'} goToThread />
              ) : null}
              <DesignStages projectId={projectId} />
              {blank ? (
                <EmptyState
                  title={t.nothingHereYet}
                  action={
                    <>
                      <Link to="/p/$projectId/threads" params={{ projectId }} className={buttonClass({ variant: 'primary' })}>
                        {t.goToThreads}
                      </Link>
                      {newRecord ? (
                        <Link to="/p/$projectId/records/new" params={{ projectId }} className={buttonClass()}>
                          {t.newRecord}
                        </Link>
                      ) : null}
                    </>
                  }
                >
                  {t.writeOrOpen}
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
                      {t.beingDrafted}
                      <Count n={drafting.length} />
                    </>
                  }
                  note={t.draftingNote}
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

/** The features, one section per aspect for the other records, and the threads with open questions (INV-OVW-11…19). */
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
  const t = useMessages(OVERVIEW);
  const features = rows.filter((r) => r.type === 'fdr');
  const aspectWords = useMessages(ASPECT_WORDS);
  const aspectGroups = recordsByAspect(rows.filter((r) => r.type !== 'fdr' && r.type !== 'product_definition'));
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
          <p className="text-sm text-fg-2">{t.noFeaturesYet}</p>
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
      {aspectGroups.map((g) => (
        <Section
          key={g.key}
          id={`aspect-${g.key}`}
          title={
            <>
              {g.aspect ? aspectWords[g.aspect] : t.withoutTag}
              <Count n={g.rows.length} />
            </>
          }
        >
          <RowList label={g.aspect ? aspectWords[g.aspect] : t.withoutTag}>{g.rows.map(recordRow)}</RowList>
        </Section>
      ))}
      {open.length > 0 ? (
        <Section
          id="open-threads"
          title={
            <>
              {t.threadsWithOpen}
              <Count n={open.length} />
            </>
          }
        >
          <RowList label={t.threadsWithOpen}>
            {open.map((thread) => (
              <ThreadRow
                key={thread.id}
                projectId={projectId}
                thread={thread}
                waiting={questionsWaiting(thread.id)}
                change={changeOf(lens, lens.threads, thread.id)}
              />
            ))}
          </RowList>
        </Section>
      ) : null}
    </>
  );
}
