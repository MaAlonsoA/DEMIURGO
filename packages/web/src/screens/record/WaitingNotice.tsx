// Information after approving a feature that others wait for and that has no task plan yet: the approve
// command answers with `waiting_without_plan`. The approval dialog closes with it, so the count is kept
// (by version) outside the dialog and shown on the record page.

import { useSyncExternalStore } from 'react';
import { Notice } from '../../components/Notice.tsx';
import { useMessages } from '../../i18n/define.ts';
import { WAITING_NOTICE } from './waitingNotice.i18n.ts';

const counts = new Map<string, number>();
const listeners = new Set<() => void>();

/** Keeps what the approve command answered; call it with the command's response. */
export function rememberWaitingNotice(versionId: string, response: unknown): void {
  const n = (response as { result?: { waiting_without_plan?: unknown } } | undefined)?.result?.waiting_without_plan;
  if (typeof n !== 'number' || n <= 0) return;
  counts.set(versionId, n);
  for (const l of listeners) l();
}

export function WaitingNotice({ versionId }: { versionId: string }) {
  const t = useMessages(WAITING_NOTICE);
  const n = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => counts.get(versionId) ?? 0,
  );
  if (n === 0) return null;
  return (
    <Notice tone="info" title={t.title} role="status">
      <p>{t.body(n)}</p>
    </Notice>
  );
}
