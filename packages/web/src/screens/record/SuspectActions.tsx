// The two things a person does with a record to review after a change upstream (suspect link): review
// it in a thread (the review-thread flow of the record header: exploration.open with the record's
// current version as origin), or say it still holds (link.revalidate: the link records the newer version
// it was confirmed against; the content does not change). Shared by the record page and Needs you.

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCommand } from '../../api/commands.ts';
import { explorationsQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { SuspectInfo } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useTables } from '../../lib/hooks.ts';
import { SUSPECT } from './suspect.i18n.ts';

export function SuspectActions({
  projectId,
  linkId,
  versionId,
  code,
  n,
  suspect,
}: {
  projectId: string;
  linkId: string;
  /** The record's current version: the origin of the review thread. */
  versionId: string;
  code: string;
  n: number;
  suspect: SuspectInfo;
}) {
  const t = useMessages(SUSPECT);
  const navigate = useNavigate();
  const tables = useTables();
  const command = useCommand(projectId);
  const explorations = useQuery(explorationsQuery(projectId));
  const canReview = !!tables && canCreate(tables, 'exploration.open');
  const canRevalidate = !!tables?.capabilities.commands['link.revalidate']?.allowed.includes('human');
  const running = command.isPending ? command.variables?.command : undefined;
  const go = (explorationId: string) =>
    void navigate({ to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId } });
  const review = () => {
    const existing = explorations.data?.find((e) => e.state !== 'concluded' && e.origin_type === 'record_version' && e.origin_id === versionId);
    if (existing) return go(existing.id);
    command.mutate(
      {
        command: 'exploration.open',
        data: {
          purpose: t.purpose(code, n, suspect.upstream, suspect.from, suspect.to).slice(0, 1000),
          origin: { type: 'record_version', id: versionId, version: n },
        },
      },
      { onSuccess: (r) => go((r as { entity_id: string }).entity_id) },
    );
  };
  const stillValid = () =>
    command.mutate({ command: 'link.revalidate', entityId: linkId, data: {} }, { onSuccess: () => announce(t.confirmedStillValid) });
  return (
    <div className="flex flex-col gap-2" data-suspect-actions={code}>
      <div className="flex flex-wrap items-center gap-2">
        {canReview ? (
          <Button variant="primary" size="sm" data-command="exploration.open" disabled={command.isPending} onClick={review}>
            {running === 'exploration.open' ? t.working : t.reviewInThread}
          </Button>
        ) : null}
        {canRevalidate ? (
          <Button variant="secondary" size="sm" data-command="link.revalidate" title={t.stillValidHint} disabled={command.isPending} onClick={stillValid}>
            {running === 'link.revalidate' ? t.working : t.stillValid}
          </Button>
        ) : null}
      </div>
      {command.error ? <ErrorNotice error={command.error} compact /> : null}
    </div>
  );
}
