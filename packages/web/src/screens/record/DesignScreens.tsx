// "Design the screens" of an approved feature in one click: it starts the same run the thread's
// composer starts (`screen_design` on the feature's current version) and goes to the thread to watch it.
// With a screens run already working or a screens proposal waiting, it only goes to the thread.

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useCommand } from '../../api/commands.ts';
import { runsQuery } from '../../api/queries.ts';
import type { Inbox, ProductState, RecordDetail, RecordVersion } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { QueuedNotice } from '../../components/QueuedNotice.tsx';
import { KNOWLEDGE_WAIT } from '../../components/words.i18n.ts';
import { useMessages } from '../../i18n/define.ts';
import { pendingProposalBatches } from '../../lib/attention.ts';
import { featureEpicThread } from '../epics/logic.ts';
import { COMPOSER } from '../thread/words.i18n.ts';
import { isScreensOf } from './PendingProposals.tsx';
import { DELIVERY } from './words.i18n.ts';

export type DesignScreensContext = {
  record: RecordDetail;
  version: RecordVersion;
  state: ProductState | undefined;
  inbox?: Inbox | undefined;
};

export function useDesignScreens(projectId: string, { record, version, state, inbox }: DesignScreensContext) {
  const t = useMessages(COMPOSER);
  const command = useCommand(projectId);
  const navigate = useNavigate();
  const runs = useQuery(runsQuery(projectId));
  const thread = version.origin_exploration ?? (state ? featureEpicThread(state, record.code) : null);
  const matches = isScreensOf(record.code);
  const proposed = pendingProposalBatches(inbox).some((b) => b.proposals.some((p) => p.state === 'pending' && matches(p)));
  const working = (runs.data ?? []).some(
    (r) => r.action === 'screen_design' && (r.state === 'queued' || r.state === 'running') && r.scope.id === version.id,
  );
  const go = () => {
    if (thread) void navigate({ to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId: thread } });
  };
  const run = () => {
    if (command.isPending || !thread) return;
    if (proposed || working) {
      go();
      return;
    }
    command.mutate(
      { command: 'run.request', data: { action: 'screen_design', scope: { type: 'record_version', id: version.id } } },
      {
        onSuccess: () => {
          announce(t.draftStarted);
          go();
        },
      },
    );
  };
  return { run, thread, pending: command.isPending, waiting: command.waiting, queued: command.queued, error: command.error };
}

/** The one-click button; without a thread to show the work in, `fallback` stands in. */
export function DesignScreensButton({
  projectId,
  context,
  label,
  variant = 'secondary',
  size,
  fallback,
  dataAttr,
}: {
  projectId: string;
  context: DesignScreensContext;
  label: ReactNode;
  variant?: 'primary' | 'secondary';
  size?: 'sm';
  fallback?: { search: 'screens' };
  dataAttr: string;
}) {
  const d = useDesignScreens(projectId, context);
  const w = useMessages(DELIVERY);
  const wait = useMessages(KNOWLEDGE_WAIT);
  if (!d.thread)
    return fallback ? (
      <Link
        to="/p/$projectId/records/$code"
        params={{ projectId, code: context.record.code }}
        search={{ tab: fallback.search } as never}
        className={buttonClass({ variant, ...(size ? { size } : {}) })}
        {...{ [dataAttr]: '' }}
      >
        {label}
      </Link>
    ) : null;
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant={variant}
        {...(size ? { size } : {})}
        pending={d.pending}
        pendingLabel={d.waiting ? wait.waiting : w.drafting}
        onClick={d.run}
        {...{ [dataAttr]: '' }}
      >
        {label}
      </Button>
      <QueuedNotice queued={d.queued} />
      {d.error ? <ErrorNotice error={d.error} compact /> : null}
    </div>
  );
}
