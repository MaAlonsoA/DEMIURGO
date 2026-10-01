// The header of a record (DESIGN.md §3.6, INV-REC-03…09): "Product / Features / title", what it is
// (type, code and version, the version's state, current, readiness), who wrote and approved it, and
// its actions in the order that matters — Approve first (primary), Discard (quiet), New version and
// the version picker (INVENTORY INV-REC, UX problem: button order). The section tabs close it.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { explorationsQuery, keys, readinessQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { RecordDetail, RecordType, RecordVersion } from '../../api/types.ts';
import { ActionButtons, useActions } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { ConfirmDialog, PromptDialog } from '../../components/Dialog.tsx';
import { MoreIcon, PencilIcon } from '../../components/icons.tsx';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../../components/Menu.tsx';
import { Readiness } from '../../components/Meter.tsx';
import { type Crumb, PageHeader } from '../../components/Page.tsx';
import { EntityState } from '../../components/status.tsx';
import { DayTime } from '../../components/Time.tsx';
import { TypeIcon } from '../../components/types.tsx';
import { Who, whoName } from '../../components/Who.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useTables } from '../../lib/hooks.ts';
import { TYPE_WORDS_PLURAL, stateWord, whoOf } from '../../words.ts';
import { RecordKind } from '../../components/AspectTag.tsx';
import { aspectOfRecord } from '../../aspects.ts';
import { RecordTabs } from '../blueprint/Sections.tsx';
import type { RecordTab } from '../blueprint/tabs.ts';
import { isEarlierDraft, versionStage } from './logic.ts';
import { useReturnFocus } from './returnFocus.ts';
import { VersionPicker } from './VersionPicker.tsx';
import { StatusWord, type Status } from './Delivery.tsx';
import { DELIVERY, HEADER } from './words.i18n.ts';

type Dialog = null | 'approve' | 'discard';

/** The overview section each type of record is listed in (its heading's id), for the breadcrumb. */
function sectionOf(record: { type: string; aspect?: string | null }): string {
  if (record.type === 'fdr') return 'features-title';
  if (record.type === 'product_definition') return 'definition-title';
  return `aspect-${aspectOfRecord(record) ?? 'none'}-title`;
}

/** A record above another one in the hierarchy (its epic, its feature): a step of the breadcrumb. */
export type CrumbAncestor = { code: string; title: string; type: RecordType; aspect?: string | null };

export function recordCrumbs(
  projectId: string,
  record: { code: string; type: RecordType; aspect?: string | null },
  title: string,
  more: Crumb[] = [],
  words: (typeof HEADER)['en'] = HEADER.en,
  ancestors: readonly CrumbAncestor[] = [],
): Crumb[] {
  // The list it hangs from is the top one's: a feature of an epic is under Epics, then its epic.
  const top = ancestors[0] ?? record;
  return [
    { label: words.product, link: { to: '/p/$projectId', params: { projectId } } },
    {
      label: TYPE_WORDS_PLURAL[top.type],
      // Epics have their own page; the rest are listed in the overview's sections.
      link:
        top.type === 'epic'
          ? { to: '/p/$projectId/epics', params: { projectId } }
          : { to: '/p/$projectId', params: { projectId }, hash: sectionOf(top) },
    },
    ...ancestors.map(
      (a): Crumb => ({ label: a.title, link: { to: '/p/$projectId/records/$code', params: { projectId, code: a.code } } }),
    ),
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
  ancestors = [],
  lean,
  tabs,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  tab: RecordTab;
  onApproved: () => void;
  /** Its epic and feature above it, from the top. */
  ancestors?: readonly CrumbAncestor[];
  /**
   * The delivery pages (epic, feature, task): one status word, one primary action (or none) and the
   * rest of the actions in a menu. `reviewable`: the guided review approves, not the header.
   */
  lean?: { status: Status; primary: ReactNode; reviewable: boolean };
  /** Replaces the section tabs (a task has Overview and History only). */
  tabs?: ReactNode;
}) {
  const t = useMessages(HEADER);
  const d = useMessages(DELIVERY);
  const navigate = useNavigate();
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
  const canApprove = !earlier && actions.some((a) => a.command === 'record_version.approve');
  const newVersion = !earlier && record.versions.length > 0 && !!tables && canCreate(tables, 'record_version.create');

  // Review it in a thread: a thread whose origin is the record's current version, where its agent can
  // propose the formal change. An active one is reused.
  const explorations = useQuery({ ...explorationsQuery(projectId), enabled: !!lean });
  const reviewed = record.versions.find((v) => v.current);
  const canReview = !!reviewed && !!tables && canCreate(tables, 'exploration.open');
  const reviewInThread = () => {
    if (!reviewed) return;
    const go = (explorationId: string) =>
      void navigate({ to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId } });
    const existing = explorations.data?.find(
      (e) => e.state !== 'concluded' && e.origin_type === 'record_version' && e.origin_id === reviewed.id,
    );
    if (existing) return go(existing.id);
    command.mutate(
      {
        command: 'exploration.open',
        data: {
          purpose: `Review ${record.code} v${reviewed.n}: a change the person wants to make`.slice(0, 1000),
          origin: { type: 'record_version', id: reviewed.id, version: reviewed.n },
        },
      },
      { onSuccess: (r) => go(r.entity_id) },
    );
  };

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
        crumbs={recordCrumbs(projectId, record, version.title, [], t, ancestors)}
        eyebrow={
          lean ? (
            <>
              <Code>
                {record.code} · v{version.n}
              </Code>
              <StatusWord status={lean.status} />
            </>
          ) : (
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
            {ready ? <Readiness stage={stage} blocking={ready.reasons.length} reasons={ready.reasons} /> : null}
          </>
          )
        }
        title={version.title}
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Who actor={version.author} size={16} showName={false} />
              {/* A proposal is only ever written by an agent: a version born from one was drafted by DEMIURGO and accepted by its author. */}
              {version.origin?.type === 'proposal' && whoOf(version.author).kind === 'you'
                ? t.draftedAccepted(whoWord(version.author, t))
                : `${t.writtenBy}${whoWord(version.author, t)}`}{' '}
              · <DayTime iso={version.created_at} />
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
          lean ? (
            <div data-record-actions className="flex flex-wrap items-center gap-2">
              {lean.primary ??
                (canApprove && !lean.reviewable ? (
                  <Button variant="primary" onClick={() => open('approve')} data-command="record_version.approve">
                    {t.approve}
                  </Button>
                ) : null)}
              <Menu
                align="end"
                label={d.menuLabel}
                trigger={
                  <button type="button" aria-label={d.menuLabel} className={buttonClass({ variant: 'quiet' })}>
                    <MoreIcon size={16} />
                  </button>
                }
              >
                {canApprove && (lean.primary || lean.reviewable) ? (
                  <MenuItem onSelect={() => open('approve')}>{d.approveMenu}</MenuItem>
                ) : null}
                {newVersion ? (
                  <MenuItem
                    icon={<PencilIcon size={14} />}
                    onSelect={() =>
                      void navigate({ to: '/p/$projectId/records/$code/new-version', params: { projectId, code: record.code } })
                    }
                  >
                    {t.newVersion}
                  </MenuItem>
                ) : null}
                {canReview ? (
                  <MenuItem icon={<PencilIcon size={14} />} onSelect={reviewInThread}>
                    {t.reviewInThread}
                  </MenuItem>
                ) : null}
                {actions.some((a) => a.command === 'record_version.discard') ? (
                  <MenuItem danger onSelect={() => open('discard')}>
                    {t.discard}
                  </MenuItem>
                ) : null}
                <MenuSeparator />
                <MenuLabel>{d.versionsLabel}</MenuLabel>
                {record.versions.toReversed().map((v) => (
                  <MenuItem
                    key={v.id}
                    className={v.n === version.n ? 'bg-selected' : undefined}
                    hint={v.current ? d.current : undefined}
                    onSelect={() =>
                      void navigate({
                        to: '/p/$projectId/records/$code',
                        params: { projectId, code: record.code },
                        search: { v: v.n },
                      })
                    }
                  >
                    v{v.n} · {stateWord('record_version', v.state).word}
                  </MenuItem>
                ))}
              </Menu>
            </div>
          ) : (
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
          )
        }
        tabs={tabs ?? <RecordTabs projectId={projectId} record={record} version={version} tab={tab} />}
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
