// A record (DESIGN.md §3.6, INV-REC-*, INV-BP-*): the records navigator on the left, then the page
// of one version — its header with Approve first, its notices stacked, the guided review of a
// draft, its sections as written, its checks and annexes — and beside it what it needs before it
// can be built, where it comes from, its versions and "Ask DEMIURGO about this". The Questions,
// Checks and History tabs keep the same side column, with "If you confirm" on top in Questions.
// The side column moves beside the content when the content area is wide enough for both.

import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { type ReactNode, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { inboxQuery, readinessQuery, recordQuery, stateQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { Inbox, ProductState, RecordDetail, RecordVersion } from '../../api/types.ts';
import { AskBox, type AskBoxHandle } from '../../components/AskBox.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageHeader, usePageTitle } from '../../components/Page.tsx';
import { PageSkeleton } from '../../components/Spinner.tsx';
import { useAllows } from '../../components/actions.tsx';
import { useRouteParams, useTables } from '../../lib/hooks.ts';
import { HistoryTab } from '../blueprint/HistoryTab.tsx';
import { RecordsNavigator } from '../blueprint/Navigator.tsx';
import { IfYouConfirm, QuestionsList, useQuestions } from '../blueprint/QuestionsTab.tsx';
import { hasChecks, useRecordTab } from '../blueprint/Sections.tsx';
import { NotFound } from '../not-found/NotFound.tsx';
import { needsItems } from '../overview/needs.ts';
import { Checks } from './Checks.tsx';
import { FeatureJourney } from './FeatureJourney.tsx';
import { RecordHeader } from './Header.tsx';
import { isEarlierDraft, selectVersion, versionIndex, versionStage } from './logic.ts';
import { RecordNotices } from './Notices.tsx';
import { ContextPanel, ReadinessPanel, VersionsPanel } from './RecordAside.tsx';
import { ReviewArea, ReviewBand, ReviewProvider, ReviewSections, useReview } from './Review.tsx';
import { canReview } from './review.ts';
import { takeSaveWarnings } from './saved.ts';

/** The navigator beside the page; the page is a size container, so its columns follow its own width. */
function Frame({ projectId, code, children }: { projectId: string; code: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col lg:flex-row">
      <RecordsNavigator projectId={projectId} code={code} />
      <div className="@container min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Main content and its side column: stacked, then side by side from a 56rem wide content area. */
function Columns({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <div className="flex flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 @4xl:flex-row @4xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-8">{main}</div>
      <aside
        aria-label="About this record"
        className="flex w-full shrink-0 flex-col gap-8 @4xl:sticky @4xl:top-3 @4xl:w-80 @6xl:w-96"
      >
        {aside}
      </aside>
    </div>
  );
}

export function RecordScreen() {
  const { projectId, code = '' } = useRouteParams();
  const search = useSearch({ strict: false }) as { v?: number };
  const record = useQuery(recordQuery(projectId, code));
  const state = useQuery(stateQuery(projectId));
  const inbox = useQuery(inboxQuery(projectId));
  usePageTitle([record.data ? (selectVersion(record.data, search.v)?.title ?? code) : code, state.data?.project.name]);

  if (record.error instanceof ApiError && record.error.status === 404) return <NotFound thing={`the record ${code}`} />;
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
            <PageSkeleton label="Loading the record" />
          </div>
        )}
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
  version,
  state,
  inbox,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  state: ProductState | undefined;
  inbox: Inbox | undefined;
}) {
  const tab = useRecordTab();
  const tables = useTables();
  const readinessQ = useQuery({ ...readinessQuery(projectId, version.id), enabled: record.type !== 'decision' });
  const ready = record.type === 'decision' ? null : (readinessQ.data ?? version.readiness);
  const stage = versionStage(version, ready);
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
  const [approved, setApproved] = useState<string | null>(null);
  // What the save of this version said, shown once on its page.
  const [saved] = useState(() => ({ n: version.n, warnings: takeSaveWarnings(record.code, version.n) }));
  const shownWarnings = approved === null && saved.n === version.n ? saved.warnings : [];

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
      }}
      className="border-t border-edge pt-6"
    />
  );
  const readinessPanel = <ReadinessPanel projectId={projectId} version={version} readiness={ready} stage={stage} />;
  const aside =
    tab === 'questions' ? (
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
    <RecordHeader projectId={projectId} record={record} version={version} tab={tab} onApproved={() => setApproved(version.id)} />
  );

  if (tab === 'questions' || tab === 'history' || tab === 'checks') {
    return (
      <>
        {header}
        <Columns
          aside={aside}
          main={
            tab === 'questions' ? (
              <QuestionsList projectId={projectId} questions={questions} />
            ) : tab === 'history' ? (
              <HistoryTab projectId={projectId} record={record} />
            ) : hasChecks(record, version) ? (
              <Checks criteria={version.criteria} readiness={ready} />
            ) : (
              <p className="text-sm text-fg-2">A decision without checks has no Checks section.</p>
            )
          }
        />
      </>
    );
  }

  return (
    <ReviewProvider review={review}>
      {header}
      <Columns
        aside={aside}
        main={
          <>
            <RecordNotices
              projectId={projectId}
              record={record}
              version={version}
              readiness={ready}
              next={next}
              justApproved={approved === version.id}
              warnings={shownWarnings}
            />
            {reviewable ? (
              <ReviewBand
                projectId={projectId}
                record={record}
                version={version}
                review={review}
                ask={ask}
                canNewVersion={!!tables && canCreate(tables, 'record_version.create')}
                onApproved={() => setApproved(version.id)}
              />
            ) : null}
            {record.type === 'fdr' ? <FeatureJourney version={version} readiness={ready} /> : null}
            <article aria-label={`${version.title}, as written`} className="flex flex-col gap-8">
              <ReviewSections sections={version.sections} parts={review.parts}>
                {(s) => (
                  <section key={s.title} className="flex flex-col gap-2">
                    <h2 className="text-lg font-semibold text-fg">{s.title}</h2>
                    <Markdown className="max-w-3xl">{s.content}</Markdown>
                  </section>
                )}
              </ReviewSections>
            </article>
            {hasChecks(record, version) ? (
              <ReviewArea part="checks">
                <Checks criteria={version.criteria} readiness={ready} />
              </ReviewArea>
            ) : null}
            {version.annexes.length > 0 ? <Annexes annexes={version.annexes} /> : null}
          </>
        }
      />
    </ReviewProvider>
  );
}

function Annexes({ annexes }: { annexes: RecordVersion['annexes'] }) {
  return (
    <section aria-labelledby="annexes-title" className="flex flex-col gap-3">
      <h2 id="annexes-title" className="text-lg font-semibold text-fg">
        Annexes <span className="font-normal text-fg-2">· {annexes.length}</span>
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
