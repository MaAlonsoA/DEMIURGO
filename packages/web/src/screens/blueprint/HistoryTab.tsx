// The History of a record (DESIGN.md §3.6, INV-BP-26/27, INV-REC-30/31): what happened to each of
// its versions, from the event journal (one query per version, live for these versions), as a
// timeline "who · what · when"; then every version with who wrote it, who approved it and what it
// changed, each opening that version.

import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { entityEventsQuery } from '../../api/queries.ts';
import { onProjectEvent } from '../../api/stream.ts';
import type { RecordDetail } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { Timeline } from '../../components/Card.tsx';
import { ArrowRightIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Section } from '../../components/Page.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { EntityState } from '../../components/status.tsx';
import { DayTime } from '../../components/Time.tsx';
import { WhoAvatar, whoName } from '../../components/Who.tsx';
import { whoOf } from '../../words.ts';
import { historyLines } from './history.ts';

function by(actor: string): string {
  const who = whoOf(actor);
  return who.kind === 'you' ? 'you' : whoName(who);
}

export function HistoryTab({ projectId, record }: { projectId: string; record: RecordDetail }) {
  const client = useQueryClient();
  const results = useQueries({ queries: record.versions.map((v) => entityEventsQuery(projectId, v.id)) });
  const ids = record.versions.map((v) => v.id).join(',');

  // What happens to these versions elsewhere (another tab, an agent, the system) comes in at once.
  useEffect(() => {
    const mine = new Set(ids.split(','));
    return onProjectEvent((e) => {
      if (!mine.has(e.entity_id)) return;
      void client.invalidateQueries({ queryKey: entityEventsQuery(projectId, e.entity_id).queryKey });
    });
  }, [client, projectId, ids]);

  const failed = results.find((r) => r.error);
  const loading = results.some((r) => !r.data);
  const lines = historyLines(
    record.versions,
    results.map((r) => r.data ?? []),
  );

  return (
    <div className="flex flex-col gap-10">
      <Section id="what-happened" title="What happened">
        {failed ? (
          <ErrorNotice error={failed.error} onRetry={() => void Promise.all(results.map((r) => r.refetch()))} />
        ) : loading ? (
          <RowsSkeleton label="Loading the history" rows={4} />
        ) : (
          <Timeline
            label="What happened"
            items={lines.map((l) => {
              const who = whoOf(l.actor);
              return {
                key: l.id,
                icon: <WhoAvatar kind={who.kind} size={18} />,
                body: (
                  <span data-history-line className="flex flex-wrap items-baseline gap-x-2">
                    <span data-who={who.kind} className="text-fg-2">
                      {whoName(who)}
                    </span>
                    <span className="font-medium text-fg">{l.words}</span>
                  </span>
                ),
                meta: <DayTime iso={l.at} />,
              };
            })}
          />
        )}
      </Section>

      <Section id="every-version" title="Every version">
        <ol className="flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge bg-panel">
          {record.versions.toReversed().map((v) => (
            <li key={v.id} data-history-version={v.n} className="flex flex-col gap-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Code className="font-semibold text-fg">v{v.n}</Code>
                <EntityState entity="record_version" state={v.state} />
                {v.current ? <span className="text-sm text-fg-2">current</span> : null}
                <Link
                  to="/p/$projectId/records/$code"
                  params={{ projectId, code: record.code }}
                  search={{ v: v.n }}
                  className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
                >
                  Open v{v.n} <ArrowRightIcon size={12} />
                </Link>
              </div>
              <p className="text-sm text-fg">{v.change_note ?? (v.n === 1 ? 'The first version.' : 'No change note.')}</p>
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-2">
                <span className="inline-flex items-center gap-1.5">
                  <WhoAvatar kind={whoOf(v.author).kind} size={16} />
                  Written by {by(v.author)} · <DayTime iso={v.created_at} />
                </span>
                {v.approved_by ? (
                  <span className="inline-flex items-center gap-1.5">
                    <WhoAvatar kind={whoOf(v.approved_by).kind} size={16} />
                    Approved by {by(v.approved_by)} · <DayTime iso={v.approved_at} />
                  </span>
                ) : null}
              </p>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
