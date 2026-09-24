// The person's last visit to each project in this browser (spec §4.3): the last event id seen and
// when. The baseline is read once, when the app starts, before the event stream moves it; from
// then on every event that arrives and leaving the page keep the stored value up to date.

import { latestEventId, onLatestEvent } from '../../../api/stream.ts';

export const VISITS_KEY = 'demiurgo:visits';

export type Visit = { event: string; at: string };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function read(storage: StorageLike | null): Record<string, Visit> {
  try {
    const raw = JSON.parse(storage?.getItem(VISITS_KEY) ?? '{}') as Record<string, Partial<Visit>>;
    const out: Record<string, Visit> = {};
    for (const [project, v] of Object.entries(raw)) {
      if (typeof v?.event === 'string' && /^\d+$/.test(v.event))
        out[project] = { event: v.event, at: typeof v.at === 'string' ? v.at : '' };
    }
    return out;
  } catch {
    return {};
  }
}

export function createVisits(storage: StorageLike | null, now: () => string = () => new Date().toISOString()) {
  const baseline = read(storage);
  let forgotten = false;
  return {
    /** The visit before this app started, or null on the first one. */
    baseline(projectId: string): Visit | null {
      return baseline[projectId] ?? null;
    },
    /** Remembers that the person has seen the project up to this event. */
    remember(projectId: string, eventId: string): void {
      if (forgotten || !/^\d+$/.test(eventId)) return;
      const all = read(storage);
      const known = all[projectId];
      if (known && BigInt(known.event) > BigInt(eventId)) return;
      all[projectId] = { event: eventId, at: now() };
      try {
        storage?.setItem(VISITS_KEY, JSON.stringify(all));
      } catch {
        // Without storage the lens simply has nothing to compare with next time.
      }
    },
    /**
     * Forgets every visit and stops remembering until the page reloads: after the dev tools
     * restore an earlier database, the stored events would be ahead of the log.
     */
    forget(): void {
      forgotten = true;
      try {
        storage?.setItem(VISITS_KEY, '{}');
      } catch {
        // Nothing stored, nothing to forget.
      }
    },
  };
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export const visits = createVisits(browserStorage());

/** The project of the page the person is on, from its address. */
export function projectOfPath(pathname: string): string | null {
  return /^\/p\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

function rememberHere(): void {
  if (typeof location === 'undefined') return;
  const projectId = projectOfPath(location.pathname);
  const id = projectId ? latestEventId(projectId) : null;
  if (projectId && id) visits.remember(projectId, id);
}

if (typeof window !== 'undefined') {
  onLatestEvent(rememberHere);
  window.addEventListener('pagehide', rememberHere);
}
