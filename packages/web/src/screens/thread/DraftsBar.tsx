// The drafts bar above the composer (DESIGN.md §3.3; INV-THR-38…41, INV-FORK-04): how many answers
// and thread choices are ready, that nothing is sent until the person confirms, "Discard" (which asks
// first: it drops them all) and "Confirm and send". After a send where something failed, each item
// says whether it went or why it didn't; what failed stays as a draft (INVENTORY Part C).

import { useState } from 'react';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { CheckCircleIcon, XCircleIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { useMessages } from '../../i18n/define.ts';
import type { SendDrafts } from './drafts.tsx';
import { DRAFTS_BAR } from './words.i18n.ts';

export function DraftsBar({ state, onDiscard, onSent }: { state: SendDrafts; onDiscard: () => void; onSent: () => void }) {
  const t = useMessages(DRAFTS_BAR);
  const [discarding, setDiscarding] = useState(false);
  const { answers, openShown, forks, send, sending, results, dismissResults } = state;
  if (answers + forks === 0 && !results) return null;
  const parts = [
    answers > 0 ? t.answersReady(answers, Math.max(openShown, answers)) : null,
    forks > 0 ? t.forksReady(forks) : null,
  ].filter(Boolean);
  const firstFailed = results?.find((r) => r.state === 'failed')?.key;

  return (
    <div data-drafts-bar className="flex flex-col gap-2 rounded-lg border border-accent-edge bg-accent-soft px-3 py-2.5">
      {answers + forks > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1 basis-64 text-sm text-fg">
            <span className="font-medium">
              {parts.join(t.and)}
              {t.ready}
            </span>{' '}
            <span className="text-fg-2">{t.notSentUntilConfirm}</span>
          </p>
          <Button size="sm" variant="quiet" disabled={sending} onClick={() => setDiscarding(true)}>
            {t.discard}
          </Button>
          <Button
            size="sm"
            variant="primary"
            pending={sending}
            pendingLabel={t.sending}
            onClick={() =>
              void send().then((ok) => {
                if (ok) onSent();
              })
            }
          >
            {t.confirmAndSend}
          </Button>
        </div>
      ) : null}
      {results ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm font-medium text-fg">{t.whatHappened}</p>
            <Button size="sm" variant="quiet" onClick={dismissResults}>
              {t.dismiss}
            </Button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {results.map((r) => (
              <li key={r.key} className="flex flex-col gap-1 text-sm">
                <span className="flex items-start gap-1.5">
                  {r.state === 'sent' ? (
                    <CheckCircleIcon size={14} className="mt-0.5 shrink-0 text-success-text" />
                  ) : (
                    <XCircleIcon size={14} className="mt-0.5 shrink-0 text-danger-text" />
                  )}
                  <span className="min-w-0 text-fg">
                    <span className="font-medium">{r.state === 'sent' ? t.sent : t.notSent}</span>
                    {r.label}
                  </span>
                </span>
                {r.state === 'failed' ? <ErrorNotice error={r.error} compact focus={r.key === firstFailed} /> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={t.discardTitle}
        description={<p>{t.discardDescription}</p>}
        confirm={t.discardConfirm}
        cancel={t.discardCancel}
        tone="danger"
        onConfirm={() => {
          onDiscard();
          setDiscarding(false);
          dismissResults();
          announce(t.discarded);
        }}
      />
    </div>
  );
}
