// The clock of a run in progress (the timer ticks locally; the stream brings the rest) and the
// events of a run, read page by page from the project's log.

import { queryOptions } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { get } from '../../api/client.ts';
import { keys } from '../../api/queries.ts';
import type { EventRow, Run } from '../../api/types.ts';
import { runEvents } from './runs.ts';

/** Now, every second while something is running. */
export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  return now;
}

const PAGE = 1000;
const MAX_PAGES = 50;

/** Events of a run. The log has no filter by entity, so it is read in pages and filtered here. */
export const runEventsQuery = (projectId: string, run: Pick<Run, 'id' | 'context_pack_id'>) =>
  queryOptions({
    queryKey: [...keys.run(projectId, run.id), 'events', run.context_pack_id] as const,
    queryFn: async () => {
      const found: EventRow[] = [];
      let from = '0';
      for (let page = 0; page < MAX_PAGES; page++) {
        const rows = await get<EventRow[]>(`/api/projects/${projectId}/events?from=${from}`);
        found.push(...runEvents(rows, run));
        const last = rows.at(-1);
        if (rows.length < PAGE || !last) break;
        from = last.id;
      }
      return found;
    },
  });
