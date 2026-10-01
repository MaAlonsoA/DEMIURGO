// A batch of proposals (DESIGN.md §3.2): the same route for an import of design/ and a package from
// DEMIURGO (both decided whole) and a batch decided item by item (an agent's, DEMIURGO's from a
// conversation, or the reviews knowledge asks for). The breadcrumb says where the person came
// from — Needs you, Catch up or a thread — and "Needs you" when the page is opened directly
// (INVENTORY Part D §3, UX problem).

import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { batchQuery, explorationsQuery, projectsQuery } from '../../api/queries.ts';
import { useAllows } from '../../components/actions.tsx';
import { buttonClass } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { PackageIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { type Crumb, PageBody, PageHeader, usePageTitle } from '../../components/Page.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { isNotFound } from '../../components/explain.ts';
import { useMessages } from '../../i18n/define.ts';
import { useRouteParams } from '../../lib/hooks.ts';
import { threadTitle } from '../../lib/thread-title.ts';
import { DemiurgoPackage } from './DemiurgoPackage.tsx';
import { ImportPackage } from './ImportPackage.tsx';
import { ItemBatch } from './ItemBatch.tsx';
import { batchView } from './model.ts';
import { batchTitle } from './proposal.ts';
import { BATCH } from './words.i18n.ts';

export type Origin = { kind: 'needs' } | { kind: 'catch-up' } | { kind: 'thread'; threadId: string };

/** Where a path came from, among the places that open a batch. */
export function originOf(pathname: string | undefined, search: Record<string, unknown> | undefined): Origin {
  const thread = /^\/p\/[^/]+\/threads\/([^/]+)/.exec(pathname ?? '');
  if (thread?.[1]) return { kind: 'thread', threadId: thread[1] };
  if (/^\/p\/[^/]+\/needs-you\/?$/.test(pathname ?? '') && search?.['catch-up']) return { kind: 'catch-up' };
  return { kind: 'needs' };
}

const OriginContext = createContext<Origin>({ kind: 'needs' });

/**
 * The page the person was on before this one: the router still holds it while the route's
 * component first renders (before the batch has loaded), so it is read then, once, and kept.
 */
function useOrigin(): Origin {
  const previous = useRouterState({ select: (s) => s.resolvedLocation });
  const [origin] = useState(() => originOf(previous?.pathname, previous?.search as Record<string, unknown> | undefined));
  return origin;
}

/** The breadcrumb of a batch page, ending in its own name. */
export function useBatchCrumbs(projectId: string, current: string): Crumb[] {
  const t = useMessages(BATCH);
  const origin = useContext(OriginContext);
  const threads = useQuery({ ...explorationsQuery(projectId), enabled: origin.kind === 'thread' }).data;
  const needs: Crumb = { label: t.needsYou, link: { to: '/p/$projectId/needs-you', params: { projectId } } };
  if (origin.kind === 'catch-up')
    return [
      needs,
      { label: t.catchingUp, link: { to: '/p/$projectId/needs-you', params: { projectId }, search: { 'catch-up': 1 } } },
      { label: current },
    ];
  if (origin.kind === 'thread') {
    const thread = threads?.find((th) => th.id === origin.threadId);
    return [
      { label: t.threads, link: { to: '/p/$projectId/threads', params: { projectId } } },
      {
        label: thread ? threadTitle(thread.purpose) : t.thread,
        link: { to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId: origin.threadId } },
      },
      { label: current },
    ];
  }
  return [needs, { label: current }];
}

export function BatchScreen() {
  const t = useMessages(BATCH);
  const { projectId, batchId = '' } = useRouteParams();
  const batch = useQuery(batchQuery(projectId, batchId));
  const origin = useOrigin();
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  // One title for the tab, set here only (a child's would be overwritten by this one).
  usePageTitle([batch.data ? batchTitle(batch.data) : isNotFound(batch.error) ? t.notFound : t.proposals, project?.name]);
  // Attention measurement: the first time a person displays a pending batch, the server records it (`batch.show`).
  const command = useCommand(projectId);
  const allowsShow = useAllows('batch', batch.data?.state)('batch.show');
  const shownSent = useRef<string | null>(null);
  const { mutate } = command;
  const pendingShow = batch.data && batch.data.state === 'pending' && !batch.data.shown_at ? batch.data.id : null;
  useEffect(() => {
    if (!pendingShow || !allowsShow || shownSent.current === pendingShow) return;
    shownSent.current = pendingShow;
    mutate({ command: 'batch.show', entityId: pendingShow, data: {} });
  }, [pendingShow, allowsShow, mutate]);
  if (isNotFound(batch.error)) return <Missing projectId={projectId} />;
  if (batch.error) {
    return (
      <>
        <PageHeader
          crumbs={[{ label: t.needsYou, link: { to: '/p/$projectId/needs-you', params: { projectId } } }]}
          title={t.proposals}
        />
        <PageBody width="reading">
          <ErrorNotice error={batch.error} onRetry={() => void batch.refetch()} />
        </PageBody>
      </>
    );
  }
  if (!batch.data) return <BatchSkeleton projectId={projectId} />;
  const view = batchView(batch.data);
  return (
    <OriginContext.Provider value={origin}>
      {view === 'import' ? (
        <ImportPackage projectId={projectId} batch={batch.data} />
      ) : view === 'package' ? (
        <DemiurgoPackage projectId={projectId} batch={batch.data} />
      ) : (
        <ItemBatch projectId={projectId} batch={batch.data} />
      )}
    </OriginContext.Provider>
  );
}

function Missing({ projectId }: { projectId: string }) {
  const t = useMessages(BATCH);
  return (
    <>
      <PageHeader
        crumbs={[{ label: t.needsYou, link: { to: '/p/$projectId/needs-you', params: { projectId } } }]}
        title={t.notFound}
      />
      <PageBody width="reading">
        <EmptyState
          size="spacious"
          icon={<PackageIcon size={28} />}
          title={t.missingTitle}
          action={
            <>
              <Link to="/p/$projectId/needs-you" params={{ projectId }} className={buttonClass({ variant: 'primary' })}>
                {t.backToNeedsYou}
              </Link>
              <Link to="/p/$projectId" params={{ projectId }} className={buttonClass({ variant: 'quiet' })}>
                {t.backToProduct}
              </Link>
            </>
          }
        >
          {t.missingBody}
        </EmptyState>
      </PageBody>
    </>
  );
}

function BatchSkeleton({ projectId }: { projectId: string }) {
  const t = useMessages(BATCH);
  return (
    <>
      <PageHeader
        crumbs={[{ label: t.needsYou, link: { to: '/p/$projectId/needs-you', params: { projectId } } }, { label: t.proposals }]}
        title={t.proposals}
      />
      <PageBody>
        <Skeleton label={t.loadingProposals} className="flex flex-col gap-6 xl:flex-row">
          <div className="flex flex-col gap-2 xl:w-72">
            {[0, 1, 2].map((i) => (
              <Bone key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Bone className="h-3 w-48" />
            <Bone className="h-6 w-3/5" />
            <Bone className="h-24 w-full rounded-lg" />
            <Bone className="h-9 w-72" />
          </div>
        </Skeleton>
      </PageBody>
    </>
  );
}
