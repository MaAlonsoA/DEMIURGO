// The History of a record: what happened to each of its versions, from the diary (one query per
// version), and every version with who wrote it, who approved it and what it changed.

import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useId } from 'react';
import { entityEventsQuery } from '../../api/queries.ts';
import { onProjectEvent } from '../../api/stream.ts';
import type { RecordDetail } from '../../api/types.ts';
import { dayTime } from '../../lib/time.ts';
import { ChevronRight } from '../../ui/icons.tsx';
import { Skeleton } from '../../ui/layout.tsx';
import { Mark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { WhoMark, whoLabel } from '../../ui/signals.tsx';
import { stateWord, whoOf } from '../../words.ts';
import { historyLines } from './history.ts';

function by(actor: string): string {
  const who = whoOf(actor);
  return who.kind === 'you' ? 'you' : whoLabel(who);
}

export function HistoryTab({ projectId, record }: { projectId: string; record: RecordDetail }) {
  const happened = useId();
  const every = useId();
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

  const error = results.find((r) => r.error)?.error;
  const loading = results.some((r) => !r.data);
  const lines = historyLines(
    record.versions,
    results.map((r) => r.data ?? []),
  );

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby={happened} className="flex flex-col gap-2.5">
        <h2 id={happened} className="dm-text-caption font-semibold text-muted">
          What happened
        </h2>
        {error ? (
          <Reasons error={error} />
        ) : loading ? (
          <div role="status" aria-label="Loading the history" className="flex flex-col gap-2">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-60" />
          </div>
        ) : (
          <ol className="flex flex-col rounded-card-md border border-line bg-surface px-4 py-1.5">
            {lines.map((l) => (
              <li
                key={l.id}
                data-history-line
                className="dm-text-small flex items-center gap-2.5 border-b border-line-soft py-2 last:border-b-0"
              >
                <WhoMark actor={l.actor} size={18} withName className="dm-text-caption font-medium" />
                <span className="font-semibold text-ink">{l.words}</span>
                <span className="text-muted">· {dayTime(l.at)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby={every} className="flex flex-col gap-2.5">
        <h2 id={every} className="dm-text-caption font-semibold text-muted">
          Every version
        </h2>
        <ol className="flex flex-col divide-y divide-line-soft rounded-card-md border border-line bg-surface">
          {record.versions.toReversed().map((v) => {
            const w = stateWord('record_version', v.state);
            return (
              <li key={v.id} data-history-version={v.n} className="flex flex-col gap-1 px-4 py-3">
                <span className="dm-text-small flex items-center gap-2">
                  <Mark kind={w.mark} size={9} label={w.word} />
                  <span className="dm-text-caption font-mono font-semibold">v{v.n}</span>
                  <span className="font-semibold">{w.word}</span>
                  {v.current && <span className="text-muted">· current</span>}
                  <Link
                    to="/p/$projectId/records/$code"
                    params={{ projectId, code: record.code }}
                    search={{ v: v.n }}
                    className="dm-text-caption ml-auto inline-flex items-center gap-1 font-semibold text-needs-strong hover:underline"
                  >
                    Open v{v.n}
                    <ChevronRight size={11} />
                  </Link>
                </span>
                <span className="dm-text-small text-ink-2">
                  {v.change_note ?? (v.n === 1 ? 'The first version.' : 'No change note.')}
                </span>
                <span className="dm-text-caption flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
                  <span className="flex items-center gap-1.5">
                    <WhoMark actor={v.author} size={16} />
                    Written by {by(v.author)} · {dayTime(v.created_at)}
                  </span>
                  {v.approved_by && (
                    <span className="flex items-center gap-1.5">
                      <WhoMark actor={v.approved_by} size={16} />
                      Approved by {by(v.approved_by)} · {dayTime(v.approved_at)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
