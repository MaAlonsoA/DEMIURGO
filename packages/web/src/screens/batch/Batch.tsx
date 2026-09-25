// A batch of proposals (DESIGN.md §3.2): the same route for an import of design/ and a package from
// DEMIURGO (both decided whole) and a batch decided item by item (an agent's, DEMIURGO's from a
// conversation, or the reviews knowledge asks for). The breadcrumb says where the person came
// from — Needs you, Catch up or a thread — and "Needs you" when the page is opened directly
// (INVENTORY Part D §3, UX problem).

import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { createContext, useContext, useState } from 'react';
import { batchQuery, explorationsQuery, projectsQuery } from '../../api/queries.ts';
import { buttonClass } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { PackageIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { type Crumb, PageBody, PageHeader, usePageTitle } from '../../components/Page.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { isNotFound } from '../../components/explain.ts';
import { useRouteParams } from '../../lib/hooks.ts';
import { DemiurgoPackage } from './DemiurgoPackage.tsx';
import { ImportPackage } from './ImportPackage.tsx';
import { ItemBatch } from './ItemBatch.tsx';
import { batchView } from './model.ts';
import { batchTitle } from './proposal.ts';

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
  const origin = useContext(OriginContext);
  const threads = useQuery({ ...explorationsQuery(projectId), enabled: origin.kind === 'thread' }).data;
  const needs: Crumb = { label: 'Needs you', link: { to: '/p/$projectId/needs-you', params: { projectId } } };
  if (origin.kind === 'catch-up')
    return [
      needs,
      { label: 'Catching up', link: { to: '/p/$projectId/needs-you', params: { projectId }, search: { 'catch-up': 1 } } },
      { label: current },
    ];
  if (origin.kind === 'thread') {
    const thread = threads?.find((t) => t.id === origin.threadId);
    return [
      { label: 'Threads', link: { to: '/p/$projectId/threads', params: { projectId } } },
      {
        label: thread?.purpose ?? 'Thread',
        link: { to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId: origin.threadId } },
      },
      { label: current },
    ];
  }
  return [needs, { label: current }];
}

export function BatchScreen() {
  const { projectId, batchId = '' } = useRouteParams();
  const batch = useQuery(batchQuery(projectId, batchId));
  const origin = useOrigin();
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  // One title for the tab, set here only (a child's would be overwritten by this one).
  usePageTitle([batch.data ? batchTitle(batch.data) : isNotFound(batch.error) ? 'Not found' : 'Proposals', project?.name]);
  if (isNotFound(batch.error)) return <Missing projectId={projectId} />;
  if (batch.error) {
    return (
      <>
        <PageHeader
          crumbs={[{ label: 'Needs you', link: { to: '/p/$projectId/needs-you', params: { projectId } } }]}
          title="Proposals"
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
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Needs you', link: { to: '/p/$projectId/needs-you', params: { projectId } } }]}
        title="Not found"
      />
      <PageBody width="reading">
        <EmptyState
          size="spacious"
          icon={<PackageIcon size={28} />}
          title="We couldn't find these proposals"
          action={
            <>
              <Link to="/p/$projectId/needs-you" params={{ projectId }} className={buttonClass({ variant: 'primary' })}>
                Back to Needs you
              </Link>
              <Link to="/p/$projectId" params={{ projectId }} className={buttonClass({ variant: 'quiet' })}>
                Back to the product
              </Link>
            </>
          }
        >
          They may belong to another project, or the link is wrong.
        </EmptyState>
      </PageBody>
    </>
  );
}

function BatchSkeleton({ projectId }: { projectId: string }) {
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Needs you', link: { to: '/p/$projectId/needs-you', params: { projectId } } }, { label: 'Proposals' }]}
        title="Proposals"
      />
      <PageBody>
        <Skeleton label="Loading the proposals" className="flex flex-col gap-6 xl:flex-row">
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
