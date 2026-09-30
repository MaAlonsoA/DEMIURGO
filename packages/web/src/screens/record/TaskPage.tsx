// The page of a task, approved or proposed: the last link of DEF → EPC → FDR → ADR → TSK, laid out
// like the other records. Sources for what a work item shows: Jira («View development information
// for a work item»: parent, issue links, estimate, branches, pull requests, builds) and Linear
// (issue relations, estimates, linked branches and PRs); the walking skeleton, the size and the
// task Definition of Done are our own conventions (VISION.md «Tareas»).

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { inboxQuery, readinessQuery, stateQuery, taskDraftQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { Inbox, ProductState, RecordDetail, RecordVersion, TaskView } from '../../api/types.ts';
import { AskBox } from '../../components/AskBox.tsx';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { checkAnchor } from '../../components/BehaviorSteps.tsx';
import { Button } from '../../components/Button.tsx';
import { useAllows } from '../../components/actions.tsx';
import { ConfirmDialog, PromptDialog } from '../../components/Dialog.tsx';
import { CheckCircleIcon, CircleIcon } from '../../components/icons.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageHeader, usePageTitle } from '../../components/Page.tsx';
import { PageSkeleton } from '../../components/Spinner.tsx';
import { LinkTabs } from '../../components/Tabs.tsx';
import { DayTime } from '../../components/Time.tsx';
import { Who } from '../../components/Who.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { useRouteParams, useTables } from '../../lib/hooks.ts';
import { stateWord } from '../../words.ts';
import { HistoryTab } from '../blueprint/HistoryTab.tsx';
import { NotFound } from '../not-found/NotFound.tsx';
import { BuildStepper, ConnectGithubLine } from './AgentBuild.tsx';
import { CopyBriefButton } from './CopyBrief.tsx';
import {
  BUILD_TONE,
  Block,
  CRITERION,
  DeliveryBanner,
  OtherSections,
  Prop,
  PrimaryAction,
  StatusWord,
  type Status,
  TONE_TEXT,
  deliveryOf,
  useDraftTasks,
} from './Delivery.tsx';
import { RecordHeader, recordCrumbs } from './Header.tsx';
import { ancestorsOf } from './hierarchy.ts';
import { Columns, Frame } from './Layout.tsx';
import { VersionsPanel } from './RecordAside.tsx';
import { TaskSizePanel } from './TaskSize.tsx';
import { DELIVERY, HEADER, TASK_PAGE } from './words.i18n.ts';

// ---------------------------------------------------------------- the page of a proposed task

/** `/records/<FDR>/tasks/<proposal>`: a pending proposal of the task plan, read like a task. */
export function TaskDraftScreen() {
  const t = useMessages(TASK_PAGE);
  const { projectId } = useRouteParams();
  const { code = '', proposalId = '' } = useParams({ strict: false }) as { code?: string; proposalId?: string };
  const draft = useQuery(taskDraftQuery(projectId, proposalId));
  const state = useQuery(stateQuery(projectId));
  const inbox = useQuery(inboxQuery(projectId));
  usePageTitle([draft.data?.title ?? t.proposed, state.data?.project.name]);
  if (draft.error instanceof ApiError && draft.error.status === 404) return <NotFound thing={t.notFound(proposalId)} />;
  return (
    <Frame projectId={projectId} code={draft.data?.feature.code ?? code}>
      {draft.data ? (
        <TaskPage projectId={projectId} task={draft.data} state={state.data} inbox={inbox.data} />
      ) : draft.error ? (
        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <ErrorNotice error={draft.error} onRetry={() => void draft.refetch()} />
        </div>
      ) : (
        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <PageSkeleton label={t.loading} />
        </div>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------- the page

export function TaskPage({
  projectId,
  task,
  record,
  version,
  state,
  inbox: _inbox,
}: {
  projectId: string;
  task: TaskView;
  /** The task record and its shown version: absent while it is only a proposal. */
  record?: RecordDetail;
  version?: RecordVersion;
  state: ProductState | undefined;
  inbox?: Inbox | undefined;
}) {
  const t = useMessages(TASK_PAGE);
  const d = useMessages(DELIVERY);
  const tables = useTables();
  const search = useSearch({ strict: false }) as { tab?: string };
  const tab = record && search.tab === 'history' ? 'history' : 'overview';
  const readiness = useQuery({ ...readinessQuery(projectId, version?.id ?? ''), enabled: !!version });
  const draftTasks = useDraftTasks(projectId, version?.id ?? '');
  const delivery =
    record && version
      ? deliveryOf({
          t: d,
          record,
          version,
          ready: readiness.data ?? version.readiness,
          pending: [],
          epic: null,
          canRequestBuild: !!tables && canCreate(tables, 'build_request.request'),
          stateWord: stateWord('record_version', version.state).word,
        })
      : null;
  const status: Status = delivery?.status ?? { word: proposalWord(task, t), tone: 'accent' };
  const tabs = record ? (
    <LinkTabs
      label={t.tabsLabel}
      tabs={[
        {
          key: 'overview',
          label: t.overview,
          current: tab === 'overview',
          link: { to: '/p/$projectId/records/$code', params: { projectId, code: record.code }, resetScroll: false, activeOptions: { exact: true } },
        },
        {
          key: 'history',
          label: t.history,
          current: tab === 'history',
          link: {
            to: '/p/$projectId/records/$code',
            params: { projectId, code: record.code },
            search: { tab: 'history' } as never,
            resetScroll: false,
            activeOptions: { exact: true },
          },
        },
      ]}
    />
  ) : undefined;

  const header =
    record && version ? (
      <RecordHeader
        projectId={projectId}
        record={record}
        version={version}
        tab="overview"
        onApproved={() => {}}
        ancestors={ancestorsOf(state, record.code)}
        tabs={tabs}
        lean={{
          status,
          primary: delivery?.primary ? <PrimaryAction projectId={projectId} primary={delivery.primary} draft={draftTasks} /> : null,
          reviewable: false,
        }}
      />
    ) : (
      <DraftHeader projectId={projectId} task={task} state={state} status={status} />
    );

  const aside = (
    <TaskAside projectId={projectId} task={task} status={status}>
      {record && version ? (
        <>
          <TaskSizePanel projectId={projectId} record={record} />
          <VersionsPanel projectId={projectId} record={record} shown={version} />
        </>
      ) : null}
    </TaskAside>
  );

  return (
    <>
      {header}
      <Columns
        aside={aside}
        asideFirst
        main={
          tab === 'history' && record ? (
            <HistoryTab projectId={projectId} record={record} />
          ) : (
            <>
              {delivery?.banner ? <DeliveryBanner projectId={projectId} banner={delivery.banner} /> : null}
              {task.draft ? <DraftNote task={task} /> : null}
              <TaskBody projectId={projectId} task={task} record={record} version={version} />
              {record && version ? (
                <AskBox
                  key={record.code}
                  projectId={projectId}
                  subject={{
                    kind: 'record',
                    type: record.type,
                    title: version.title,
                    versionIds: record.versions.map((v) => v.id),
                    versionId: version.id,
                    threadId: null,
                    parentId: null,
                  }}
                  className="border-t border-edge pt-6"
                />
              ) : null}
            </>
          )
        }
      />
    </>
  );
}

function proposalWord(task: TaskView, t: (typeof TASK_PAGE)['en']): string {
  if (task.draft?.state === 'accepted') return t.accepted;
  if (task.draft?.state === 'rejected') return t.rejected;
  return t.proposed;
}

// ---------------------------------------------------------------- header of a proposed task

function DraftHeader({ projectId, task, state, status }: { projectId: string; task: TaskView; state: ProductState | undefined; status: Status }) {
  const t = useMessages(TASK_PAGE);
  const h = useMessages(HEADER);
  const by = task.provenance.proposed_by;
  return (
    <PageHeader
      crumbs={recordCrumbs(
        projectId,
        { code: task.feature.code, type: 'fdr' },
        task.feature.title,
        [{ label: task.title }],
        h,
        ancestorsOf(state, task.feature.code),
      )}
      eyebrow={
        <>
          <span className="text-sm font-semibold text-fg-2">{t.proposed}</span>
          <StatusWord status={status} />
          {task.size ? <Code>{task.size}</Code> : null}
        </>
      }
      title={task.title}
      meta={
        by ? (
          <span className="inline-flex items-center gap-1.5">
            {t.proposedBy(by.agent)}
            {by.engine ? ` · ${t.withEngine(by.engine)}` : ''}
          </span>
        ) : null
      }
      actions={<DraftDecision projectId={projectId} task={task} />}
    />
  );
}

/** Accept is the one primary button; Reject asks why. A package is accepted or rejected whole. */
function DraftDecision({ projectId, task }: { projectId: string; task: TaskView }) {
  const t = useMessages(TASK_PAGE);
  const command = useCommand(projectId);
  const navigate = useNavigate();
  const allowsProposal = useAllows('proposal', 'pending');
  const allowsBatch = useAllows('batch', 'pending');
  const [dialog, setDialog] = useState<null | 'accept' | 'reject'>(null);
  const draft = task.draft;
  if (!draft || draft.state !== 'pending') return null;
  const whole = draft.resolution === 'package';
  const n = draft.siblings;
  const acceptCmd = whole ? 'batch.accept_package' : 'proposal.accept';
  const rejectCmd = whole ? 'batch.reject_package' : 'proposal.reject';
  const entityId = whole ? draft.batch_id : draft.proposal_id;
  const run = (name: string, data: Record<string, unknown>, said: string) =>
    command.mutate(
      { command: name, entityId, data },
      {
        onSuccess: () => {
          setDialog(null);
          announce(said);
          void navigate({
            to: '/p/$projectId/records/$code',
            params: { projectId, code: task.feature.code },
            search: { tab: 'tasks' } as never,
          });
        },
      },
    );
  const open = (which: 'accept' | 'reject') => {
    command.reset();
    setDialog(which);
  };
  return (
    <div data-record-actions className="flex flex-wrap items-center gap-2">
      {allowsProposal(acceptCmd) || allowsBatch(acceptCmd) ? (
        <Button variant="primary" data-command={acceptCmd} onClick={() => open('accept')}>
          {whole ? t.acceptAll(n) : t.accept}
        </Button>
      ) : null}
      {allowsProposal(rejectCmd) || allowsBatch(rejectCmd) ? (
        <Button variant="secondary" data-command={rejectCmd} onClick={() => open('reject')}>
          {whole ? t.rejectAll(n) : t.reject}
        </Button>
      ) : null}
      <ConfirmDialog
        open={dialog === 'accept'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={whole ? t.acceptAllTitle(n) : t.acceptTitle(task.title)}
        description={<p>{whole ? t.acceptAllBody(n) : t.acceptBody}</p>}
        confirm={whole ? t.acceptAll(n) : t.accept}
        pendingLabel={t.accepting}
        pending={command.isPending}
        error={dialog === 'accept' ? command.error : null}
        onConfirm={() => run(acceptCmd, {}, t.accepted2)}
      />
      <PromptDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={whole ? t.rejectAllTitle(n) : t.rejectTitle(task.title)}
        description={whole ? t.rejectAllBody : t.rejectBody}
        label={t.reason}
        required
        submit={whole ? t.rejectAll(n) : t.reject}
        pendingLabel={t.rejecting}
        tone="danger"
        pending={command.isPending}
        error={dialog === 'reject' ? command.error : null}
        onSubmit={(text) => run(rejectCmd, text ? { reason: text } : {}, t.rejected2)}
      />
    </div>
  );
}

/** One line under the header of a proposal: how it is decided, or that it already was. */
function DraftNote({ task }: { task: TaskView }) {
  const t = useMessages(TASK_PAGE);
  const draft = task.draft;
  if (!draft) return null;
  const text =
    draft.state !== 'pending'
      ? t.decidedNote(draft.state === 'accepted' ? t.accepted.toLowerCase() : t.rejected.toLowerCase())
      : draft.resolution === 'package'
        ? t.packageNote(draft.siblings)
        : t.itemNote;
  return (
    <p className="max-w-prose text-sm text-fg-2" data-draft-note>
      {text}
    </p>
  );
}

// ---------------------------------------------------------------- the body

function TaskBody({
  projectId,
  task,
  record,
  version,
}: {
  projectId: string;
  task: TaskView;
  record: RecordDetail | undefined;
  version: RecordVersion | undefined;
}) {
  const t = useMessages(TASK_PAGE);
  const prose = (title: string, text: string) =>
    text.trim() ? (
      <Block title={title}>
        <Markdown className="max-w-prose">{text}</Markdown>
      </Block>
    ) : null;
  const verified = task.covers.filter((c) => c.state === 'verified').length;
  return (
    <>
      {prose(t.goal, task.goal)}
      {prose(t.scope, task.scope)}
      {task.size === 'XL' || task.split ? (
        <Block title={t.split}>
          <p className="max-w-prose text-sm text-fg-2">{task.split ?? t.splitNote}</p>
        </Block>
      ) : null}
      {task.walking_skeleton ? (
        <Block title={t.skeleton}>
          <p className="max-w-prose text-sm text-fg-2" data-walking-skeleton>
            {t.skeletonText}
          </p>
        </Block>
      ) : null}
      <Block
        title={t.covers}
        note={task.covers.length > 0 && !task.draft ? t.verifiedOf(verified, task.covers.length) : undefined}
        id="covers"
      >
        {task.covers.length === 0 ? (
          <p className="text-sm text-fg-2">{t.noCovers}</p>
        ) : (
          <ul className="flex flex-col">
            {task.covers.map((c) => (
              <CoveredRow key={c.code} projectId={projectId} feature={task.feature.code} c={c} />
            ))}
          </ul>
        )}
      </Block>
      <Block title={t.dod} note={t.dodNote}>
        <ul className="flex flex-col gap-1.5" data-dod>
          {task.dod.map((x) => (
            <li key={x.item} className="flex items-start gap-2 text-sm" data-dod-met={x.met}>
              <span className={cn('mt-0.5 shrink-0', x.met ? 'text-success-text' : 'text-fg-3')}>
                {x.met ? <CheckCircleIcon size={16} /> : <CircleIcon size={16} />}
              </span>
              <span className={x.met ? 'text-fg' : 'text-fg-2'}>{x.item}</span>
              <span className="sr-only">{x.met ? t.dodMet : t.dodOpen}</span>
            </li>
          ))}
        </ul>
      </Block>
      <Development projectId={projectId} task={task} record={record} version={version} />
      {version ? <OtherSections version={version} used={['Goal', 'Scope', 'Split']} /> : null}
    </>
  );
}

function CoveredRow({ projectId, feature, c }: { projectId: string; feature: string; c: TaskView['covers'][number] }) {
  const t = useMessages(TASK_PAGE);
  const d = useMessages(DELIVERY);
  const s = (c.state in CRITERION ? c.state : 'not_started') as keyof typeof CRITERION;
  const meta = CRITERION[s];
  const parts =
    c.given && c.when && c.then
      ? ([['given', c.given], ['when', c.when], ['then', c.then]] as const)
      : null;
  return (
    <li
      id={checkAnchor(c.code)}
      data-check={c.code}
      data-criterion-state={s}
      className="flex scroll-mt-16 gap-2.5 border-t border-edge-subtle py-2.5 first:border-t-0"
    >
      <span className={cn('mt-0.5 shrink-0', meta.tone)}>{meta.icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link
            to="/p/$projectId/records/$code"
            params={{ projectId, code: feature }}
            search={{ tab: 'checks' } as never}
            hash={checkAnchor(c.code)}
            className="hover:underline"
          >
            <Code>{c.code}</Code>
          </Link>
          <span className="text-sm font-medium text-fg">{c.title}</span>
          <span className={cn('ml-auto text-xs font-medium', meta.tone)}>{d[`cs_${s}` as const]}</span>
        </div>
        {parts ? (
          <div className="flex flex-col gap-0.5 text-sm text-fg-2">
            {parts.map(([k, text]) => (
              <p key={k}>
                <span className="mr-1.5 text-xs font-medium text-fg-3">{d[k]}</span>
                {text}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-2">{c.statement}</p>
        )}
        {c.step ? <p className="text-xs text-fg-3">{t.checksStep(c.step)}</p> : null}
      </div>
    </li>
  );
}

/** Jira's Development panel: branch, pull request, checks, the review verdict and the evidence. */
function Development({
  projectId,
  task,
  record,
  version,
}: {
  projectId: string;
  task: TaskView;
  record: RecordDetail | undefined;
  version: RecordVersion | undefined;
}) {
  const t = useMessages(TASK_PAGE);
  const d = useMessages(DELIVERY);
  const dev = task.development;
  const build = record?.build;
  const current = !!record && !!version && version.n === record.current && version.state === 'approved';
  return (
    <Block title={t.development}>
      {!dev && !(build && current) ? <p className="max-w-prose text-sm text-fg-2">{t.noDevelopment}</p> : null}
      {dev ? (
        <dl className="grid gap-x-6 gap-y-3 text-sm @2xl:grid-cols-2" data-development>
          <Prop label={t.branch}>
            {dev.branch ? <code className="font-code text-sm">{dev.branch}</code> : <span className="text-fg-3">{t.noBranch}</span>}
          </Prop>
          <Prop label={t.pullRequest}>
            {dev.pr_url ? (
              <a href={dev.pr_url} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
                {dev.pr_number ? `#${dev.pr_number}` : dev.pr_url}
              </a>
            ) : (
              <span className="text-fg-3">—</span>
            )}
          </Prop>
          {dev.checks.length > 0 ? (
            <Prop label={t.checksLabel} wide>
              <ul className="flex flex-col gap-1">
                {dev.checks.map((c) => (
                  <li key={c.name} className="flex items-baseline gap-2" data-check-run={c.name}>
                    <code className="font-code text-sm">{c.name}</code>
                    <span className={cn('text-xs font-medium', checkTone(c.state))}>{t.checkState(c.state)}</span>
                  </li>
                ))}
              </ul>
            </Prop>
          ) : null}
          {dev.review ? (
            <Prop label={t.review} wide>
              <span className="font-medium">{dev.review.verdict === 'approve' ? t.verdictApprove : t.verdictChanges}</span>
              {dev.review.summary ? <span className="text-fg-2"> — {dev.review.summary}</span> : null}
            </Prop>
          ) : null}
          {dev.evidence.length > 0 ? (
            <Prop label={t.evidence} wide>
              <ul className="flex flex-col gap-1">
                {dev.evidence.map((e) => (
                  <li key={`${e.criterion}-${e.test_name ?? ''}`} className="flex flex-wrap items-baseline gap-x-2">
                    <Code>{e.criterion}</Code>
                    <span className="text-fg-2">{e.result}</span>
                    {e.test_name ? <code className="font-code text-xs text-fg-3">{e.test_name}</code> : null}
                  </li>
                ))}
              </ul>
            </Prop>
          ) : null}
        </dl>
      ) : null}
      {build && current ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className={cn('font-semibold', TONE_TEXT[BUILD_TONE[build.state]])}>{d[`st_${build.state}` as const]}</span>
            {build.state === 'to_do' && record ? <CopyBriefButton projectId={projectId} code={record.code} size="sm" /> : null}
          </div>
          {build.github ? <BuildStepper build={build} /> : <ConnectGithubLine />}
        </div>
      ) : null}
    </Block>
  );
}

function checkTone(state: string): string {
  if (/^(success|passed?|ok|green|verified)$/i.test(state)) return 'text-success-text';
  if (/^(fail|failed|failure|error|red)$/i.test(state)) return 'text-danger-text';
  if (/^(pending|running|queued|waiting)$/i.test(state)) return 'text-warning-text';
  return 'text-fg-2';
}

// ---------------------------------------------------------------- the side panel

function TaskAside({ projectId, task, status, children }: { projectId: string; task: TaskView; status: Status; children?: ReactNode }) {
  const t = useMessages(TASK_PAGE);
  const f = task.feature;
  const by = task.provenance.proposed_by;
  const p = task.provenance;
  return (
    <div className="flex flex-col gap-4" data-rail data-task-aside>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @4xl:grid-cols-1">
        <Prop label={t.state}>
          <StatusWord status={status} />
        </Prop>
        <Prop label={t.size}>
          {task.size ? (
            <>
              <span className="tabular-nums">{task.size}</span>
              {task.size_reason ? <span className="block text-fg-2">{task.size_reason}</span> : null}
            </>
          ) : (
            <span className="text-fg-3">{t.noSize}</span>
          )}
        </Prop>
        <Prop label={t.order}>{t.orderOf(task.order.n, task.order.of)}</Prop>
        <Prop label={t.basedOn} wide>
          <ul className="flex flex-col gap-1">
            <li>
              <Link
                to="/p/$projectId/records/$code"
                params={{ projectId, code: f.code }}
                search={{ v: f.version } as never}
                className="text-accent-text hover:underline"
              >
                <Code className="mr-1.5">
                  {f.code}@v{f.version}
                </Code>
                {f.title}
              </Link>
              {f.current_version !== f.version ? <span className="block text-fg-2">{t.latestVersion(f.current_version)}</span> : null}
            </li>
            {f.epic ? (
              <li>
                <Link to="/p/$projectId/records/$code" params={{ projectId, code: f.epic.code }} className="text-accent-text hover:underline">
                  <Code className="mr-1.5">{f.epic.code}</Code>
                  {f.epic.title}
                </Link>
              </li>
            ) : null}
          </ul>
        </Prop>
        <Prop label={t.blockedBy} wide>
          <Refs projectId={projectId} items={task.depends_on} />
        </Prop>
        <Prop label={t.blocks} wide>
          <Refs projectId={projectId} items={task.blocks} />
        </Prop>
        <Prop label={t.provenance} wide>
          <ul className="flex flex-col gap-1">
            {by ? (
              <li>
                {t.proposedByLabel} {by.agent}
                {by.engine ? <span className="text-fg-2"> · {by.engine}</span> : null}
              </li>
            ) : null}
            {p.thread ? (
              <li>
                <Link
                  to="/p/$projectId/threads/$explorationId"
                  params={{ projectId, explorationId: p.thread.id }}
                  className="text-accent-text hover:underline"
                >
                  {p.thread.title}
                </Link>
              </li>
            ) : null}
            {p.accepted_by ? (
              <li className="flex flex-wrap items-center gap-x-1.5">
                {t.acceptedBy} <Who actor={p.accepted_by} size={14} />
                {p.accepted_at ? (
                  <span className="text-fg-2">
                    · <DayTime iso={p.accepted_at} />
                  </span>
                ) : null}
              </li>
            ) : null}
            {p.approved_at ? (
              <li>
                {t.approvedAt} <DayTime iso={p.approved_at} />
              </li>
            ) : null}
          </ul>
        </Prop>
        <Prop label={t.sources} wide>
          {task.sources.length === 0 ? (
            <span className="text-fg-3">{t.noSources}</span>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {task.sources.map((s) => (
                <li key={`${s.title}-${s.url ?? ''}`} className="flex flex-col">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
                      {s.title}
                    </a>
                  ) : (
                    <span className="font-medium">{s.title}</span>
                  )}
                  {s.note ? <span className="text-fg-2">{s.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Prop>
      </dl>
      {children}
    </div>
  );
}

/** Tasks a task is blocked by or blocks: a link when it is a record, its title while it is only a proposal. */
function Refs({ projectId, items }: { projectId: string; items: TaskView['depends_on'] }) {
  const t = useMessages(TASK_PAGE);
  if (items.length === 0) return <span className="text-fg-3">{t.none}</span>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((i) => (
        <li key={i.ref}>
          {i.code ? (
            <Link to="/p/$projectId/records/$code" params={{ projectId, code: i.code }} className="text-accent-text hover:underline">
              <Code className="mr-1.5">{i.code}</Code>
              {i.title}
            </Link>
          ) : (
            <span>
              {i.title} <span className="text-fg-3">· {t.stillProposed}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
