// A record (spec §4.5, canvas S5A and S5D): its sections as they were written, its checks, and on
// the right what it needs before it can be built, where it comes from and its versions. The
// actions of the version on screen come from the tables: Approve, New version and Discard.

import { useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { inboxQuery, readinessQuery, recordQuery, stateQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { RecordDetail, RecordVersion } from '../../api/types.ts';
import { useRouteParams, useTables } from '../../lib/hooks.ts';
import { dayTime } from '../../lib/time.ts';
import { ActionButtons, useActions } from '../../ui/ActionBar.tsx';
import { buttonStyles } from '../../ui/Button.tsx';
import { Code } from '../../ui/Card.tsx';
import { ConfirmDialog, TextDialog } from '../../ui/dialogs.tsx';
import { ChevronRight, InfoIcon, RECORD_ICON, TypeIcon } from '../../ui/icons.tsx';
import { Breadcrumbs, Page, Skeleton } from '../../ui/layout.tsx';
import { Markdown } from '../../ui/Markdown.tsx';
import { StateMark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { StageBars, WhoMark, whoLabel } from '../../ui/signals.tsx';
import { TYPE_WORDS, whoOf } from '../../words.ts';
import { NotFound } from '../not-found/NotFound.tsx';
import { type NeedsItem, needsItems } from '../overview/needs.ts';
import { Checks } from './Checks.tsx';
import { isEarlierDraft, newerDraft, selectVersion, versionIndex, versionStage } from './logic.ts';
import { ContextPanel, ReadinessPanel, VersionsPanel } from './RecordAside.tsx';
import { VersionPicker } from './VersionPicker.tsx';

type Dialog = null | 'approve' | 'discard';

function by(actor: string): string {
  const who = whoOf(actor);
  return who.kind === 'you' ? 'you' : whoLabel(who);
}

function Header({ projectId, record, version }: { projectId: string; record: RecordDetail; version: RecordVersion }) {
  const tables = useTables();
  const actions = useActions('record_version', version.state);
  const command = useCommand(projectId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const earlier = isEarlierDraft(record, version);
  const readiness = useQuery({ ...readinessQuery(projectId, version.id), enabled: record.type !== 'decision' });
  const stage = versionStage(version, readiness.data ?? version.readiness);
  const newVersion = !earlier && record.versions.length > 0 && !!tables && canCreate(tables, 'record_version.create');

  const open = (d: Dialog) => {
    command.reset();
    setDialog(d);
  };
  const run = (name: string, data: Record<string, unknown>) =>
    command.mutate({ command: name, entityId: version.id, data }, { onSuccess: () => setDialog(null) });

  return (
    <header data-record-header className="mb-5 flex items-start justify-between gap-6">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
          <TypeIcon kind={RECORD_ICON[record.type] ?? 'feature'} size={14} />
          {TYPE_WORDS[record.type]}
          <span className="text-inactive-light" aria-hidden="true">
            ·
          </span>
          <span data-status className="tracking-normal normal-case">
            <StateMark entity="record_version" state={version.state} />
          </span>
          {version.current && <span className="font-medium tracking-normal text-muted normal-case">· current</span>}
          {record.type === 'fdr' && (
            <span className="ml-1.5 flex">
              <StageBars stage={stage} />
            </span>
          )}
        </span>
        <h1 className="text-[28px] leading-tight font-semibold text-balance">{version.title}</h1>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <Code className="text-ink-3">
            {record.code} · v{version.n}
          </Code>
          <span className="h-3.5 w-px bg-line" aria-hidden="true" />
          <span className="flex items-center gap-1.5">
            <WhoMark actor={version.author} size={18} />
            Written by {by(version.author)} · {dayTime(version.created_at)}
          </span>
          {version.approved_by && (
            <span className="flex items-center gap-1.5">
              <WhoMark actor={version.approved_by} size={18} />
              Approved by {by(version.approved_by)} · {dayTime(version.approved_at)}
            </span>
          )}
        </div>
      </div>
      <div data-record-actions className="flex shrink-0 items-center gap-2 pt-5">
        <VersionPicker projectId={projectId} record={record} shown={version} />
        {newVersion && (
          <Link
            to="/p/$projectId/records/$code/new-version"
            params={{ projectId, code: record.code }}
            className={buttonStyles({ variant: 'outline' })}
          >
            New version
          </Link>
        )}
        <ActionButtons
          actions={actions}
          handlers={{
            'record_version.discard': { run: () => open('discard'), variant: 'ghost' },
            // A draft older than the current version can only be discarded (the server says so in its readiness).
            'record_version.approve': earlier ? undefined : { run: () => open('approve') },
          }}
        />
      </div>

      <ConfirmDialog
        open={dialog === 'approve'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Approve v${version.n} of ${version.title}?`}
        description={
          <>
            It becomes the current version
            {record.current !== null && record.current < version.n ? `, and v${record.current} is replaced` : ''}. Approving does
            not create a new version.
          </>
        }
        confirm="Approve"
        pending={command.isPending}
        error={dialog === 'approve' ? command.error : null}
        onConfirm={() => run('record_version.approve', {})}
      />
      <TextDialog
        open={dialog === 'discard'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Discard v${version.n}?`}
        description="The draft stays in the history, marked as discarded. Nothing else changes."
        label="Reason"
        submit="Discard"
        maxLength={1000}
        pending={command.isPending}
        error={dialog === 'discard' ? command.error : null}
        onSubmit={(text) => run('record_version.discard', text ? { reason: text } : {})}
      />
    </header>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      role="note"
      className="mb-5 flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-2"
    >
      <InfoIcon size={15} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}

/** Ready to build (canvas S5D): says so, and points at the next thing that needs the person. */
function ReadyBanner({ projectId, version, next }: { projectId: string; version: RecordVersion; next: NeedsItem | undefined }) {
  return (
    <div
      data-ready-banner
      className="mb-5 flex items-center gap-4 rounded-[var(--radius-panel)] border border-line bg-surface py-3 pr-3.5 pl-5"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <strong className="text-[15px] font-semibold">{version.title} is ready to build</strong>
        <span className="text-[13px] text-ink-3">
          Nothing is built yet. When it is, the next bar fills and each check shows when it passes.
        </span>
      </span>
      <Link to="/p/$projectId" params={{ projectId }} className={buttonStyles({ variant: 'outline' })}>
        Back to the product
      </Link>
      {next && (
        <NextLink projectId={projectId} next={next} className={buttonStyles({ variant: 'needs', className: 'max-w-72' })} />
      )}
    </div>
  );
}

function NextLink({ projectId, next, className }: { projectId: string; next: NeedsItem; className: string }) {
  return (
    <Link
      to={next.target.to}
      params={{ projectId, ...next.target.params } as never}
      search={('search' in next.target ? next.target.search : undefined) as never}
      className={className}
    >
      <span className="truncate">Next: {next.title}</span>
    </Link>
  );
}

/** Approved, and something else waits for the person: the way on, so approving one by one keeps flowing. */
function NextStrip({ projectId, next }: { projectId: string; next: NeedsItem }) {
  return (
    <p className="mb-5 flex items-center gap-2.5 rounded-[var(--radius-control)] border border-needs-ring bg-needs-bg px-3.5 py-2 text-[13px] text-ink-2">
      <span className="shrink-0">Approved. What needs you next:</span>
      <NextLink
        projectId={projectId}
        next={next}
        className="inline-flex min-w-0 items-center font-semibold text-needs hover:text-needs-hover"
      />
    </p>
  );
}

function VersionNotice({ projectId, record, version }: { projectId: string; record: RecordDetail; version: RecordVersion }) {
  const readiness = useQuery({ ...readinessQuery(projectId, version.id), enabled: isEarlierDraft(record, version) });
  const newer = newerDraft(record, version);
  const see = (n: number, label: string) => (
    <Link
      to="/p/$projectId/records/$code"
      params={{ projectId, code: record.code }}
      search={{ v: n }}
      className="inline-flex items-center gap-1 font-semibold text-needs hover:text-needs-hover"
    >
      {label}
      <ChevronRight size={11} />
    </Link>
  );
  if (isEarlierDraft(record, version)) {
    const reason = readiness.data?.reasons[0];
    return (
      <Notice>{reason ?? `This draft is older than the current version (v${record.current}): it can only be discarded.`}</Notice>
    );
  }
  if (version.state === 'superseded' && record.current !== null) {
    return (
      <Notice>
        This version was replaced. The current one is v{record.current}. {see(record.current, `See v${record.current}`)}
      </Notice>
    );
  }
  if (version.state === 'discarded') return <Notice>This draft was discarded. It stays in the history.</Notice>;
  if (newer) {
    return (
      <Notice>
        Version {newer.n} is a draft waiting for you. {see(newer.n, `See v${newer.n}`)}
      </Notice>
    );
  }
  return null;
}

function RecordSkeleton() {
  return (
    <div role="status" aria-label="Loading the record" className="flex flex-col gap-4">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-3 w-1/3" />
      <div className="mt-4 flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-6">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="mt-3 h-3 w-20" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    </div>
  );
}

export function RecordScreen() {
  const { projectId, code = '' } = useRouteParams();
  const search = useSearch({ strict: false }) as { v?: number };
  const record = useQuery(recordQuery(projectId, code));
  const state = useQuery(stateQuery(projectId));
  const inbox = useQuery(inboxQuery(projectId));

  if (record.error instanceof ApiError && record.error.status === 404) return <NotFound thing={`the record ${code}`} />;
  const r = record.data;
  const version = r ? selectVersion(r, search.v) : undefined;
  if (!r || !version) {
    return (
      <Page aside={<Skeleton className="h-40 w-full" />}>
        {record.error ? <Reasons error={record.error} /> : <RecordSkeleton />}
      </Page>
    );
  }
  return <RecordPage projectId={projectId} record={r} version={version} state={state.data} inbox={inbox.data} />;
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
  state: Parameters<typeof versionIndex>[0];
  inbox: Parameters<typeof versionIndex>[1];
}) {
  const readiness = useQuery({ ...readinessQuery(projectId, version.id), enabled: record.type !== 'decision' });
  const ready = record.type === 'decision' ? null : (readiness.data ?? version.readiness);
  const thread = version.origin_exploration
    ? (state?.explorations.find((e) => e.id === version.origin_exploration)?.purpose ?? null)
    : null;
  // The first thing that waits for the person that is not this record.
  const next = inbox
    ? needsItems(inbox, state).find((i) => !('code' in i.target.params) || i.target.params.code !== record.code)
    : undefined;
  const aside = (
    <>
      <ReadinessPanel projectId={projectId} version={version} readiness={ready} stage={versionStage(version, ready)} />
      <ContextPanel
        projectId={projectId}
        version={version}
        thread={thread}
        targets={state ? versionIndex(state, inbox) : undefined}
      />
      <VersionsPanel projectId={projectId} record={record} shown={version} />
    </>
  );
  return (
    <Page aside={aside} className="[&>*]:max-w-[900px]">
      <Breadcrumbs items={[{ label: 'Product', to: '/p/$projectId', params: { projectId } }, { label: version.title }]} />
      <Header projectId={projectId} record={record} version={version} />
      {ready?.ready && version.current ? (
        <ReadyBanner projectId={projectId} version={version} next={next} />
      ) : version.current && next && !newerDraft(record, version) ? (
        <NextStrip projectId={projectId} next={next} />
      ) : (
        <VersionNotice projectId={projectId} record={record} version={version} />
      )}
      <article className="mb-8 flex flex-col gap-6 rounded-[var(--radius-panel)] border border-line bg-surface px-7 py-6">
        {version.sections.map((s) => (
          <section key={s.title} className="flex flex-col gap-1.5">
            <h2 className="text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">{s.title}</h2>
            <Markdown>{s.content}</Markdown>
          </section>
        ))}
      </article>
      {record.type !== 'decision' || version.criteria.length > 0 ? (
        <Checks criteria={version.criteria} readiness={ready} />
      ) : null}
      {version.annexes.length > 0 && (
        <section className="mt-8 flex flex-col gap-2">
          <h2 className="text-xs font-semibold text-muted">Annexes · {version.annexes.length}</h2>
          {version.annexes.map((a) => (
            <details key={a.path} className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2.5">
              <summary className="cursor-pointer font-mono text-xs text-ink-2">{a.path}</summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-surface-2 p-3 font-mono text-[11px] leading-relaxed">
                {a.content}
              </pre>
            </details>
          ))}
        </section>
      )}
    </Page>
  );
}
