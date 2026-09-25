// The Rebuild tab (DESIGN.md §3.8, INV-KNOW-26): the fingerprint of the live graph and that of the
// graph rebuilt from what the person approved, with the saved classifications. Equal means the
// knowledge has not drifted; different says so in words, with the drift the server reports.

import { useQuery } from '@tanstack/react-query';
import { knowledgeQuery, rebuildQuery } from '../../api/queries.ts';
import { Button } from '../../components/Button.tsx';
import { Card } from '../../components/Card.tsx';
import { RefreshIcon } from '../../components/icons.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { StatusBadge } from '../../components/status.tsx';

export function RebuildTab({ projectId }: { projectId: string }) {
  const rebuild = useQuery(rebuildQuery(projectId));
  const version = useQuery(knowledgeQuery(projectId)).data?.graph_version;
  const r = rebuild.data;
  return (
    <Card className="flex max-w-3xl flex-col gap-5" padding="none">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
        <div className="flex max-w-xl flex-col gap-1">
          <h2 className="text-base font-semibold text-fg">Rebuild from what you approved</h2>
          <p className="text-sm text-fg-2">
            DEMIURGO can rebuild its knowledge from the records and the saved classifications, without asking the classifier
            again. If both fingerprints are the same, the graph has not drifted.
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshIcon size={15} />}
          onClick={() => void rebuild.refetch()}
          pending={rebuild.isFetching}
          pendingLabel="Rebuilding…"
        >
          Rebuild again
        </Button>
      </div>
      <div className="px-5 pb-5">
        {rebuild.error ? (
          <ErrorNotice error={rebuild.error} onRetry={() => void rebuild.refetch()} />
        ) : !r ? (
          <Skeleton label="Rebuilding" className="flex flex-col gap-3">
            <Bone className="h-10 w-full" />
            <Bone className="h-10 w-full" />
          </Skeleton>
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-y border-edge-subtle py-4 sm:grid-cols-[minmax(160px,auto)_minmax(0,1fr)]">
              <dt className="text-sm text-fg-2">
                Live graph
                {version !== undefined ? <span className="text-fg-3"> · version {version}</span> : null}
              </dt>
              <dd className="min-w-0">
                <code data-fingerprint="live" className="font-code text-xs break-all text-fg">
                  {r.live}
                </code>
              </dd>
              <dt className="text-sm text-fg-2">Rebuilt from what you approved</dt>
              <dd className="min-w-0">
                {r.rebuilt ? (
                  <code data-fingerprint="rebuilt" className="font-code text-xs break-all text-fg">
                    {r.rebuilt}
                  </code>
                ) : (
                  <span className="text-sm text-danger-text">It could not be rebuilt.</span>
                )}
              </dd>
            </dl>
            {r.equal ? (
              <div className="flex flex-col gap-1.5">
                <StatusBadge kind="confirmed" word="They match" size="md" className="self-start" />
                <p className="text-sm text-fg-2">The graph is exactly what your records and its saved classifications give.</p>
              </div>
            ) : (
              <Notice tone="danger" title="They don't match">
                {r.drift ?? 'The live graph differs from what your records and its saved classifications give.'}
              </Notice>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
