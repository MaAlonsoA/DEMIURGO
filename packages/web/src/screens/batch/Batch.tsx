// A package or a batch (spec §4.2): the same page for the import of design/, a package from
// DEMIURGO (both resolved whole) and a batch resolved item by item (an agent's, DEMIURGO's from a
// conversation, or the reviews knowledge suggests).

import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../api/client.ts';
import { batchQuery } from '../../api/queries.ts';
import { useRouteParams } from '../../lib/hooks.ts';
import { Breadcrumbs, Page, Skeleton } from '../../ui/layout.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { NotFound } from '../not-found/NotFound.tsx';
import { DemiurgoPackage } from './DemiurgoPackage.tsx';
import { ImportPackage } from './ImportPackage.tsx';
import { ItemBatch } from './ItemBatch.tsx';
import { batchView } from './model.ts';

export function BatchScreen() {
  const { projectId, batchId = '' } = useRouteParams();
  const batch = useQuery(batchQuery(projectId, batchId));
  if (batch.error instanceof ApiError && batch.error.status === 404) return <NotFound thing="this package" />;
  if (batch.error) {
    return (
      <Page>
        <Reasons error={batch.error} />
      </Page>
    );
  }
  if (!batch.data) return <BatchSkeleton projectId={projectId} />;
  switch (batchView(batch.data)) {
    case 'import':
      return <ImportPackage projectId={projectId} batch={batch.data} />;
    case 'package':
      return <DemiurgoPackage projectId={projectId} batch={batch.data} />;
    case 'items':
      return <ItemBatch projectId={projectId} batch={batch.data} />;
  }
}

function BatchSkeleton({ projectId }: { projectId: string }) {
  return (
    <Page className="pt-4">
      <Breadcrumbs items={[{ label: 'Needs you', to: '/p/$projectId/needs-you', params: { projectId } }, { label: 'Package' }]} />
      <div role="status" aria-label="Loading the package" className="flex max-w-[860px] flex-col gap-4">
        <div className="flex items-start gap-3.5">
          <Skeleton className="h-10 w-10 rounded-control" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        {/* The shape of the design system's Proposal: its panel. */}
        <div className="dm-panel">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-6 w-3/5" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-9 w-72" />
        </div>
      </div>
    </Page>
  );
}
