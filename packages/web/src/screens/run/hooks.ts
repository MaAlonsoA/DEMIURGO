// The clock of a run in progress (the timer ticks locally; the stream brings the rest) and the
// events of a run.

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

/** Events of a run: its own and those it caused (GET …/events?entity=), and the building of its context pack. */
export const runEventsQuery = (projectId: string, run: Pick<Run, 'id' | 'context_pack_id'>) =>
  queryOptions({
    queryKey: [...keys.run(projectId, run.id), 'events', run.context_pack_id] as const,
    queryFn: async () => {
      const own = await get<EventRow[]>(`/api/projects/${projectId}/events?entity=${run.id}`);
      const pack = run.context_pack_id
        ? await get<EventRow[]>(`/api/projects/${projectId}/events?entity=${run.context_pack_id}`)
        : [];
      const all = new Map([...own, ...pack].map((e) => [e.id, e]));
      return runEvents(
        [...all.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)),
        run,
      );
    },
  });
