import { useMessages } from '../i18n/define.ts';
import { KNOWLEDGE_WAIT } from './words.i18n.ts';

/** Shown after the server queued a run request: it starts by itself once knowledge is up to date. */
export function QueuedNotice({ queued }: { queued: boolean }) {
  const w = useMessages(KNOWLEDGE_WAIT);
  return queued ? (
    <p className="text-sm text-fg-2" role="status" data-queued>
      {w.queued}
    </p>
  ) : null;
}
