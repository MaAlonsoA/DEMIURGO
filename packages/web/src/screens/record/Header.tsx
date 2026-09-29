// The header of a record (DESIGN.md §3.6, INV-REC-03…09): "Product / Features / title", what it is
// (type, code and version, the version's state, current, readiness), who wrote and approved it, and
// its actions in the order that matters — Approve first (primary), Discard (quiet), New version and
// the version picker (INVENTORY INV-REC, UX problem: button order). The section tabs close it.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { keys, readinessQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { RecordDetail, RecordVersion } from '../../api/types.ts';
import { ActionButtons, useActions } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { buttonClass } from '../../components/Button.tsx';
import { ConfirmDialog, PromptDialog } from '../../components/Dialog.tsx';
import { PencilIcon } from '../../components/icons.tsx';
import { Readiness } from '../../components/Meter.tsx';
import { type Crumb, PageHeader } from '../../components/Page.tsx';
import { EntityState } from '../../components/status.tsx';
import { DayTime } from '../../components/Time.tsx';
import { TypeIcon } from '../../components/types.tsx';
import { Who, whoName } from '../../components/Who.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useTables } from '../../lib/hooks.ts';
import { TYPE_WORDS_PLURAL, whoOf } from '../../words.ts';
import { RecordKind } from '../../components/AspectTag.tsx';
import { aspectOfRecord } from '../../aspects.ts';
import { RecordTabs } from '../blueprint/Sections.tsx';
import type { RecordTab } from '../blueprint/tabs.ts';
import { isEarlierDraft, versionStage } from './logic.ts';
import { useReturnFocus } from './returnFocus.ts';
import { VersionPicker } from './VersionPicker.tsx';
import { HEADER } from './words.i18n.ts';

type Dialog = null | 'approve' | 'discard';

/** The overview section each type of record is listed in (its heading's id), for the breadcrumb. */
const SECTION_OF: Record<string, string> = {
  fdr: 'features-title',
  decision: 'decisions-title',
  adr: 'decisions-title',
  bug: 'bugs-title',
  requirement: 'stage-records-title',
  quality_requirement: 'stage-records-title',
  threat_model: 'stage-records-title',
  production_readiness: 'stage-records-title',
  product_definition: 'definition-title',
};

export function recordCrumbs(
  projectId: string,
  record: RecordDetail,
  title: string,
  more: Crumb[] = [],
  words: (typeof HEADER)['en'] = HEADER.en,
): Crumb[] {
  return [
    { label: words.product, link: { to: '/p/$projectId', params: { projectId } } },
    {
      label: TYPE_WORDS_PLURAL[record.type],
      link: { to: '/p/$projectId', params: { projectId }, hash: SECTION_OF[record.type] ?? '' },
    },
    more.length > 0
      ? { label: title, link: { to: '/p/$projectId/records/$code', params: { projectId, code: record.code } } }
      : { label: title },
    ...more,
  ];
}

export function RecordHeader({
  projectId,
  record,
  version,
  tab,
  onApproved,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  tab: RecordTab;
  onApproved: () => void;
}) {
  const t = useMessages(HEADER);
  const tables = useTables();
  const client = useQueryClient();
  const actions = useActions('record_version', version.state);
  const command = useCommand(projectId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const focus = useReturnFocus();
  const earlier = isEarlierDraft(record, version);
  const readiness = useQuery({ ...readinessQuery(projectId, version.id), enabled: record.type !== 'decision' });
  const ready = record.type === 'decision' ? null : (readiness.data ?? version.readiness);
  const stage = versionStage(version, ready);
  const newVersion = !earlier && record.versions.length > 0 && !!tables && canCreate(tables, 'record_version.create');

  const open = (d: Dialog) => {
    command.reset();
    focus.capture();
    setDialog(d);
  };
  const close = (o: boolean) => {
    if (o) return;
    // After a 409 what is on screen is out of date: fetch it again (INV-PROP-05).
    if (command.error instanceof ApiError && command.error.status === 409)
      void client.invalidateQueries({ queryKey: keys.project(projectId) });
    setDialog(null);
    focus.restore();
  };
  const run = (name: string, data: Record<string, unknown>, said: string, then?: () => void) =>
    command.mutate(
      { command: name, entityId: version.id, data },
      {
        onSuccess: () => {
          setDialog(null);
          // The button that opened it is going away: the title, which now says the new state, takes the focus.
          setTimeout(() => document.getElementById('page-title')?.focus({ preventScroll: true }), 50);
          announce(said);
          then?.();
        },
      },
    );

  return (
    <div data-record-header>
      <PageHeader
        crumbs={recordCrumbs(projectId, record, version.title, [], t)}
        eyebrow={
          <>
            <span className="inline-flex items-center gap-1.5">
              <TypeIcon type={record.type} size={15} className="text-fg-3" />
              <RecordKind aspect={aspectOfRecord(record)} draft={version.state === 'draft'} />
            </span>
            <Code>
              {record.code} · v{version.n}
            </Code>
            <span data-version-state className="inline-flex">
              {version.state === 'draft' || version.state === 'approved' ? (
                <span className="sr-only">
                  <EntityState entity="record_version" state={version.state} />
                </span>
              ) : (
                <EntityState entity="record_version" state={version.state} />
              )}
            </span>
            {version.current ? <span className="text-sm text-fg-2">{t.current}</span> : null}
            {ready ? <Readiness stage={stage} blocking={ready.reasons.length} /> : null}
          </>
        }
        title={version.title}
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Who actor={version.author} size={16} showName={false} />
              {t.writtenBy}
              {whoWord(version.author, t)} · <DayTime iso={version.created_at} />
            </span>
            {version.approved_by ? (
              <span className="inline-flex items-center gap-1.5">
                <Who actor={version.approved_by} size={16} showName={false} />
                {t.approvedBy}
                {whoWord(version.approved_by, t)} · <DayTime iso={version.approved_at} />
              </span>
            ) : null}
          </>
        }
        actions={
          <div data-record-actions className="flex flex-wrap items-center gap-2">
            <ActionButtons
              actions={actions}
              handlers={{
                // A draft older than the current version can only be discarded (the server says so in its readiness).
                'record_version.approve': earlier ? undefined : { run: () => open('approve'), variant: 'primary' },
                'record_version.discard': { run: () => open('discard'), variant: 'quiet-danger' },
              }}
            >
              {newVersion ? (
                <Link
                  to="/p/$projectId/records/$code/new-version"
                  params={{ projectId, code: record.code }}
                  className={buttonClass()}
                >
                  <PencilIcon size={14} />
                  {t.newVersion}
                </Link>
              ) : null}
              <VersionPicker projectId={projectId} record={record} shown={version} />
            </ActionButtons>
          </div>
        }
        tabs={<RecordTabs projectId={projectId} record={record} version={version} tab={tab} />}
      />

      <ConfirmDialog
        open={dialog === 'approve'}
        onOpenChange={close}
        title={t.approveTitle(version.n, version.title)}
        description={t.approveDescription(record.current, version.n)}
        confirm={t.approve}
        pendingLabel={t.approving}
        pending={command.isPending}
        error={dialog === 'approve' ? command.error : null}
        onConfirm={() => run('record_version.approve', {}, t.approvedAnnounce(version.n), onApproved)}
      />
      <PromptDialog
        open={dialog === 'discard'}
        onOpenChange={close}
        title={t.discardTitle(version.n)}
        description={t.discardDescription}
        label={t.reason}
        submit={t.discard}
        pendingLabel={t.discarding}
        tone="danger"
        maxLength={1000}
        pending={command.isPending}
        error={dialog === 'discard' ? command.error : null}
        onSubmit={(text) => run('record_version.discard', text ? { reason: text } : {}, t.discardedAnnounce(version.n))}
      />
    </div>
  );
}

function whoWord(actor: string, words: (typeof HEADER)['en']): string {
  const who = whoOf(actor);
  return who.kind === 'you' ? words.you : whoName(who);
}
