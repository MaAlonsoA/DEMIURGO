// Rebuild (spec §4.10): the fingerprint of the live graph and that of the graph rebuilt from the
// authority with the saved classifications. Equal means the knowledge has not drifted.

import { useQuery } from '@tanstack/react-query';
import { knowledgeQuery, rebuildQuery } from '../../api/queries.ts';
import { Button } from '../../ui/Button.tsx';
import { WarningIcon } from '../../ui/icons.tsx';
import { Panel, Skeleton } from '../../ui/layout.tsx';
import { MarkWord } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';

export function RebuildTab({ projectId }: { projectId: string }) {
  const rebuild = useQuery(rebuildQuery(projectId));
  const version = useQuery(knowledgeQuery(projectId)).data?.graph_version;
  const r = rebuild.data;
  return (
    <Panel className="flex max-w-[860px] flex-col gap-5">
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h3 className="text-[15px] font-semibold">Rebuild from what you approved</h3>
          <p className="text-[13px] text-ink-3">
            DEMIURGO can rebuild its knowledge from the records and the saved classifications, without asking the classifier
            again. If both fingerprints are the same, the graph has not drifted.
          </p>
        </div>
        <Button variant="outline" onClick={() => void rebuild.refetch()} disabled={rebuild.isFetching} className="shrink-0">
          {rebuild.isFetching ? 'Rebuilding…' : 'Rebuild again'}
        </Button>
      </div>
      {rebuild.error ? (
        <Reasons error={rebuild.error} />
      ) : !r ? (
        <div role="status" aria-label="Rebuilding" className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-[220px_minmax(0,1fr)] gap-x-4 gap-y-3 border-y border-line-soft py-4">
            <dt className="text-[13px] text-ink-2">
              Live graph
              {version !== undefined && <span className="text-muted"> · version {version}</span>}
            </dt>
            <dd data-fingerprint="live" className="font-mono text-[12px] break-all text-ink">
              {r.live}
            </dd>
            <dt className="text-[13px] text-ink-2">Rebuilt from what you approved</dt>
            <dd data-fingerprint="rebuilt" className="font-mono text-[12px] break-all text-ink">
              {r.rebuilt ?? <span className="font-sans text-muted">It could not be rebuilt.</span>}
            </dd>
          </dl>
          {r.equal ? (
            <div className="flex flex-col gap-1">
              <MarkWord kind="confirmed" word="They match" className="text-[14px]" />
              <p className="text-[13px] text-ink-3">The graph is exactly what your records and its saved classifications give.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-problem-line bg-problem-bg px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[14px] font-semibold text-problem">
                <WarningIcon size={14} />
                They don’t match
              </p>
              {r.drift && <p className="text-[13px] text-problem">{r.drift}</p>}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
