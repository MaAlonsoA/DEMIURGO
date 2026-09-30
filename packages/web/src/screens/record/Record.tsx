// A record (DESIGN.md §3.6, INV-REC-*, INV-BP-*): the records navigator on the left, then the page
// of one version — its header with Approve first, its notices stacked, the guided review of a
// draft, its sections as written, its checks and annexes — and beside it what it needs before it
// can be built, where it comes from, its versions and "Ask DEMIURGO about this". The Questions,
// Checks and History tabs keep the same side column, with "If you confirm" on top in Questions.
// The side column moves beside the content when the content area is wide enough for both.

import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { isBuildRunningOf } from './AgentBuild.tsx';
import { inboxQuery, readinessQuery, recordQuery, stagesQuery, stateQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { Inbox, ProductState, RecordDetail, RecordVersion } from '../../api/types.ts';
import { AskBox, type AskBoxHandle } from '../../components/AskBox.tsx';
import { SectionContent, stepCount, BEHAVIOR_TITLE } from '../../components/BehaviorSteps.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageHeader, usePageTitle } from '../../components/Page.tsx';
import { PageSkeleton } from '../../components/Spinner.tsx';
import { useAllows } from '../../components/actions.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useReading } from '../../i18n/reading.tsx';
import { useRouteParams, useTables } from '../../lib/hooks.ts';
import { HistoryTab } from '../blueprint/HistoryTab.tsx';
import { IfYouConfirm, QuestionsList, useQuestions } from '../blueprint/QuestionsTab.tsx';
import { hasChecks, useRecordTab } from '../blueprint/Sections.tsx';
import { NotFound } from '../not-found/NotFound.tsx';
import { needsItems } from '../overview/needs.ts';
import { Checks } from './Checks.tsx';
import { ChangesSince } from './Changes.tsx';
import { BriefCard } from './CopyBrief.tsx';
import { EpicBody, useEpicPlan } from './EpicBoard.tsx';
import { epicStatus, featureEpicThread } from '../epics/logic.ts';
import { TaskSizePanel } from './TaskSize.tsx';
import {
  DeliveryBanner,
  FeatureBody,
  PrimaryAction,
  Rail,
  TaskBody,
  deliveryOf,
  useDraftTasks,
} from './Delivery.tsx';
import { pendingProposalBatches, proposalTargetCode } from '../../lib/attention.ts';
import { stateWord } from '../../words.ts';
import { RecordHeader } from './Header.tsx';
import { Columns, Frame } from './Layout.tsx';
import { TaskPage } from './TaskPage.tsx';
import { ScreenDesignPage } from './ScreenDesignPage.tsx';
import { ScreensTab } from './ScreensTab.tsx';
import { TasksTab } from './TasksTab.tsx';
import { ancestorsOf } from './hierarchy.ts';
import { PendingProposals } from './PendingProposals.tsx';
import { PlannedFeaturePage } from './PlannedFeature.tsx';
import { isEarlierDraft, selectVersion, versionIndex, versionStage } from './logic.ts';
import { RecordNotices } from './Notices.tsx';
import { ContextPanel, ReadinessPanel, VersionsPanel } from './RecordAside.tsx';
import { ReviewArea, ReviewBand, ReviewProvider, ReviewSections, useReview } from './Review.tsx';
import { canReview } from './review.ts';
import { takeSaveWarnings } from './saved.ts';
import { DELIVERY, RECORD } from './words.i18n.ts';

export function RecordScreen() {
  const t = useMessages(RECORD);
  const { projectId, code = '' } = useRouteParams();
  const search = useSearch({ strict: false }) as { v?: number };
  // While an automatic build runs the server moves on its own: look again every 10 s.
  const record = useQuery({
    ...recordQuery(projectId, code),
    refetchInterval: (q) => (isBuildRunningOf(q.state.data) ? 10_000 : false),
  });
  const state = useQuery(stateQuery(projectId));
  const inbox = useQuery(inboxQuery(projectId));
  usePageTitle([
    record.data
      ? (selectVersion(record.data, search.v)?.title ?? code)
      : (state.data?.planned?.find((p) => p.code === code)?.name ?? code),
    state.data?.project.name,
  ]);

  if (record.error instanceof ApiError && record.error.status === 404) {
    // A feature its epic lists and nobody has designed yet: its code is reserved, and this is its page.
    const planned = state.data?.planned?.find((p) => p.code === code);
    if (planned && state.data) {
      return (
        <Frame projectId={projectId} code={code}>
          <PlannedFeaturePage projectId={projectId} planned={planned} state={state.data} inbox={inbox.data} />
        </Frame>
      );
    }
    if (state.isPending) {
      return (
        <Frame projectId={projectId} code={code}>
          <div className="px-4 py-6 sm:px-6 lg:px-8">
            <PageSkeleton label={t.loadingRecord} />
          </div>
        </Frame>
      );
    }
    return <NotFound thing={t.notFoundRecord(code)} />;
  }
  const r = record.data;
  const version = r ? selectVersion(r, search.v) : undefined;
  if (!r || !version) {
    return (
      <Frame projectId={projectId} code={code}>
        {record.error ? (
          <>
            <PageHeader title={code} />
            <div className="px-4 py-6 sm:px-6 lg:px-8">
              <ErrorNotice error={record.error} onRetry={() => void record.refetch()} />
            </div>
          </>
        ) : (
          <div className="px-4 py-6 sm:px-6 lg:px-8">
            <PageSkeleton label={t.loadingRecord} />
          </div>
        )}
      </Frame>
    );
  }
  if (r.type === 'task' && r.task) {
    // A task is the last link of the hierarchy and has its own page (the same one its draft has).
    return (
      <Frame projectId={projectId} code={code}>
        <TaskPage key={r.code} projectId={projectId} task={r.task} record={r} version={version} state={state.data} inbox={inbox.data} />
      </Frame>
    );
  }
  if (r.type === 'screen_design') {
    return (
      <Frame projectId={projectId} code={code}>
        <ScreenDesignPage key={r.code} projectId={projectId} record={r} version={version} state={state.data} inbox={inbox.data} />
      </Frame>
    );
  }
  return (
    <Frame projectId={projectId} code={code}>
      <RecordPage key={r.code} projectId={projectId} record={r} version={version} state={state.data} inbox={inbox.data} />
    </Frame>
  );
}

function RecordPage({
  projectId,
  record,
  version: stored,
  state,
  inbox,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  state: ProductState | undefined;
  inbox: Inbox | undefined;
}) {
  const t = useMessages(RECORD);
  const deliveryWords = useMessages(DELIVERY);
  // The version read in the person's language; the actions act on the English one (same id).
  const reading = useReading(projectId, 'record_version', stored.id);
  const version = readVersion(stored, reading.text);
  // The Screens and Tasks tabs are a feature's: on any other record the address falls back to the Overview.
  const rawTab = useRecordTab();
  const tab = (rawTab === 'tasks' || rawTab === 'screens') && record.type !== 'fdr' ? 'overview' : rawTab;
  const tables = useTables();
  const readinessQ = useQuery({ ...readinessQuery(projectId, version.id), enabled: record.type !== 'decision' });
  const ready = record.type === 'decision' ? null : (readinessQ.data ?? version.readiness);
  const stage = versionStage(version, ready);
  // Evidence is recorded on the checks of the current approved version, once built.
  const recording =
    version.state === 'approved' && version.n === record.current && !!tables && canCreate(tables, 'evidence.record_manual')
      ? { projectId, version: version.n }
      : null;
  const thread = version.origin_exploration
    ? (state?.explorations.find((e) => e.id === version.origin_exploration)?.purpose ?? null)
    : null;
  // The first thing that waits for the person, in Catch up's order, that is not this record.
  const next = inbox ? needsItems(inbox, state).find((i) => i.code !== record.code) : undefined;
  const allows = useAllows('record_version', version.state);
  const reviewable = canReview(record.type, version.state, allows('record_version.approve'), isEarlierDraft(record, version));
  const review = useReview(record, version, reviewable);
  const questions = useQuestions(projectId, version);
  const ask = useRef<AskBoxHandle>(null);
  // The product definition is worked out in its stage's thread: asking about it goes on there.
  const stages = useQuery({ ...stagesQuery(projectId), enabled: record.type === 'product_definition' }).data;
  const stageThread = stages?.find((s) => s.key === 'requirements')?.exploration_id ?? null;
  const [approved, setApproved] = useState<string | null>(null);
  // What the save of this version said, shown once on its page.
  const [saved] = useState(() => ({ n: version.n, warnings: takeSaveWarnings(record.code, version.n) }));
  const shownWarnings = approved === null && saved.n === version.n ? saved.warnings : [];

  // The delivery pages (epic, feature, task): status word, primary action, one banner, a rail.
  const lean = record.type === 'fdr' || record.type === 'epic' || record.type === 'task';
  const epicFound = useEpicPlan(state, record);
  const wanted = new Set([record.code, ...(epicFound?.plan.lines.map((l) => l.code) ?? [])]);
  const pendingCodes = pendingProposalBatches(inbox)
    .flatMap((b) => b.proposals.filter((p) => p.state === 'pending').map((p) => proposalTargetCode(p)))
    .filter((c): c is string => !!c && wanted.has(c));
  const draftTasks = useDraftTasks(projectId, record.versions.find((v) => v.n === record.current)?.id ?? version.id);
  const delivery = lean
    ? deliveryOf({
        t: deliveryWords,
        record,
        version,
        ready,
        pending: pendingCodes,
        epic: epicFound ? { status: epicStatus(epicFound.plan), next: epicFound.plan.next, ref: epicFound.ref } : null,
        canRequestBuild: !!tables && canCreate(tables, 'build_request.request'),
        stateWord: stateWord('record_version', version.state).word,
      })
    : null;
  const leanOverview = lean && delivery !== null && tab === 'overview' && review.step === 0;

  const askBox = (
    <AskBox
      key={record.code}
      ref={ask}
      projectId={projectId}
      subject={{
        kind: 'record',
        type: record.type,
        title: version.title,
        versionIds: record.versions.map((v) => v.id),
        versionId: version.id,
        threadId: stageThread,
        parentId: record.type === 'fdr' && state ? featureEpicThread(state, record.code) : null,
      }}
      className="border-t border-edge pt-6"
    />
  );
  const readinessPanel = <ReadinessPanel projectId={projectId} version={version} readiness={ready} stage={stage} />;
  const railed = delivery !== null && (leanOverview || tab === 'tasks' || tab === 'screens');
  const aside = railed ? (
    <Rail
      projectId={projectId}
      record={record}
      version={version}
      ready={ready}
      status={delivery.status}
      extra={
        <>
          {record.type === 'task' ? <TaskSizePanel projectId={projectId} record={record} /> : null}
          <VersionsPanel projectId={projectId} record={record} shown={version} />
          <ContextPanel
            projectId={projectId}
            code={record.code}
            version={version}
            thread={thread}
            targets={state ? versionIndex(state, inbox) : undefined}
            incoming={record.incoming}
          />
        </>
      }
    />
  ) : tab === 'questions' ? (
      <>
        {questions.selected ? <IfYouConfirm question={questions.selected} version={version} readiness={ready} /> : null}
        {readinessPanel}
        {askBox}
      </>
    ) : (
      <>
        {readinessPanel}
        <ReviewArea part="context">
          <ContextPanel
            projectId={projectId}
            code={record.code}
            version={version}
            thread={thread}
            targets={state ? versionIndex(state, inbox) : undefined}
            incoming={record.incoming}
          />
        </ReviewArea>
        <VersionsPanel projectId={projectId} record={record} shown={version} />
        {askBox}
      </>
    );

  const header = (
    <>
      <RecordHeader
        projectId={projectId}
        record={record}
        version={version}
        tab={tab}
        onApproved={() => setApproved(version.id)}
        ancestors={ancestorsOf(state, record.code)}
        {...(delivery
          ? {
              lean: {
                status: delivery.status,
                primary: delivery.primary ? (
                  <PrimaryAction projectId={projectId} primary={delivery.primary} draft={draftTasks} />
                ) : null,
                reviewable,
              },
            }
          : {})}
      />
      {reading.mark ? <div className="-mt-2 mb-4">{reading.mark}</div> : null}
    </>
  );

  if (tab === 'questions' || tab === 'history' || tab === 'checks' || tab === 'tasks' || tab === 'screens') {
    return (
      <>
        {header}
        <Columns
          aside={aside}
          main={
            tab === 'questions' ? (
              <QuestionsList projectId={projectId} questions={questions} />
            ) : tab === 'screens' ? (
              <ScreensTab projectId={projectId} record={record} version={version} state={state} />
            ) : tab === 'tasks' ? (
              <TasksTab projectId={projectId} record={record} draft={draftTasks} />
            ) : tab === 'history' ? (
              <HistoryTab projectId={projectId} record={record} />
            ) : hasChecks(record, version) ? (
              <Checks criteria={version.criteria} readiness={ready} recording={recording} steps={stepCount(behaviorOf(version))} />
            ) : (
              <p className="text-sm text-fg-2">{t.noChecksSection}</p>
            )
          }
        />
      </>
    );
  }

  const banner = leanOverview && delivery.banner ? <DeliveryBanner projectId={projectId} banner={delivery.banner} /> : null;
  const proposals = (
    <PendingProposals projectId={projectId} code={record.code} inbox={inbox} rows={state ? [...state.designs, ...state.decisions] : []} />
  );
  const recordingFor = recording;

  return (
    <ReviewProvider review={review}>
      {header}
      <Columns
        aside={aside}
        asideFirst={leanOverview}
        main={
          <>
            {banner}
            {proposals}
            {banner || (leanOverview && reviewable) ? null : (
              <RecordNotices
                projectId={projectId}
                record={record}
                version={version}
                readiness={ready}
                next={next}
                justApproved={approved === version.id}
                warnings={shownWarnings}
                lean={lean}
              />
            )}
            {reviewable && !(banner && review.step === 0) ? (
              <ReviewBand
                projectId={projectId}
                record={record}
                version={version}
                review={review}
                ask={ask}
                canNewVersion={!!tables && canCreate(tables, 'record_version.create')}
                onApproved={() => setApproved(version.id)}
              />
            ) : version.state === 'draft' ? (
              <ChangesSince record={record} version={version} />
            ) : null}
            {leanOverview ? (
              <>
                {record.type === 'fdr' ? (
                  <FeatureBody
                    projectId={projectId}
                    record={record}
                    version={version}
                    recording={recordingFor}
                    primaryIsDraft={delivery.primary?.kind === 'draft_tasks'}
                  />
                ) : record.type === 'epic' ? (
                  <EpicBody projectId={projectId} record={record} version={version} state={state} recording={recordingFor} />
                ) : (
                  <TaskBody projectId={projectId} record={record} version={version} recording={recordingFor} />
                )}
                {version.annexes.length > 0 ? <Annexes annexes={version.annexes} /> : null}
                {record.type === 'fdr' && version.n === record.current && ready?.ready ? (
                  <BriefCard projectId={projectId} code={record.code} />
                ) : null}
                {askBox}
              </>
            ) : (
              <>
                {(record.type === 'fdr' || record.type === 'adr' || record.type === 'task') &&
                version.n === record.current &&
                ready?.ready ? (
                  <BriefCard projectId={projectId} code={record.code} />
                ) : null}
                {record.type === 'task' ? <TaskSizePanel projectId={projectId} record={record} /> : null}
                <article aria-label={t.asWritten(version.title)} className="flex flex-col gap-8">
                  <ReviewSections sections={version.sections} parts={review.parts}>
                    {(s) => (
                      <section key={s.title} className="flex flex-col gap-2">
                        <h2 className="text-lg font-semibold text-fg">{s.title}</h2>
                        <SectionContent title={s.title} text={s.content} className="max-w-prose" criteria={version.criteria} />
                      </section>
                    )}
                  </ReviewSections>
                </article>
                {hasChecks(record, version) ? (
                  <ReviewArea part="checks">
                    <Checks criteria={version.criteria} readiness={ready} recording={recording} steps={stepCount(behaviorOf(version))} />
                  </ReviewArea>
                ) : null}
                {version.annexes.length > 0 ? <Annexes annexes={version.annexes} /> : null}
              </>
            )}
          </>
        }
      />
    </ReviewProvider>
  );
}

/** The text of a version's Behavior section ('' when it has none). */
const behaviorOf = (v: { sections: { title: string; content: string }[] }) =>
  v.sections.find((s) => s.title === BEHAVIOR_TITLE)?.content ?? '';

/** A version with its prose in the language shown: title, section contents and criteria. */
function readVersion(v: RecordVersion, text: (key: string, original: string) => string): RecordVersion {
  return {
    ...v,
    title: text('title', v.title),
    sections: v.sections.map((s, i) => ({ ...s, content: text(`sections.${i}.content`, s.content) })),
    criteria: v.criteria.map((c) => ({
      ...c,
      title: text(`criteria.${c.code}.title`, c.title),
      statement: text(`criteria.${c.code}.statement`, c.statement),
      check: text(`criteria.${c.code}.check`, c.check),
    })),
  };
}

function Annexes({ annexes }: { annexes: RecordVersion['annexes'] }) {
  const t = useMessages(RECORD);
  return (
    <section aria-labelledby="annexes-title" className="flex flex-col gap-3">
      <h2 id="annexes-title" className="text-lg font-semibold text-fg">
        {t.annexesTitle} <span className="font-normal text-fg-2">· {annexes.length}</span>
      </h2>
      {annexes.map((a) => (
        <details key={a.path} className="rounded-lg border border-edge bg-panel px-4 py-2.5">
          <summary className="cursor-pointer font-code text-sm text-fg-2">{a.path}</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-sunken p-3 font-code text-sm leading-5 text-fg">
            {a.content}
          </pre>
        </details>
      ))}
    </section>
  );
}
