// "Check coherence" on an epic's board (FDR-KNO-056): reads the whole epic at once for contradictions
// and duplicated behaviour, on demand. Shows the last review: when it ran, what it read and left out,
// the issues it found (as reviews in Needs you), the ones dropped because their quotes were not in the
// records, and how many are still pending.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCommand } from '../../api/commands.ts';
import { coherenceQuery } from '../../api/queries.ts';
import { Button } from '../../components/Button.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { RelativeTime } from '../../components/Time.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useLocale } from '../../i18n/locale.ts';
import { failureWordFor } from '../../words.ts';
import { COHERENCE } from '../epics/words.i18n.ts';

export function CoherenceCheck({
  projectId,
  epicId,
  code,
  allDesigned,
}: {
  projectId: string;
  epicId: string;
  code: string;
  /** Every planned feature of the epic is designed and approved: the moment to check. */
  allDesigned: boolean;
}) {
  const t = useMessages(COHERENCE);
  const locale = useLocale();
  const status = useQuery({
    ...coherenceQuery(projectId, code),
    refetchInterval: (q) => (q.state.data?.run?.running ? 4000 : false),
  });
  const command = useCommand(projectId);
  const s = status.data;
  const run = s?.run ?? null;
  const running = !!run?.running;
  const start = () =>
    command.mutate(
      { command: 'run.request', data: { action: 'coherence_review', scope: { type: 'record', id: epicId } } },
      { onSuccess: () => void status.refetch() },
    );
  return (
    <section className="flex flex-col gap-1.5 border-t border-edge-subtle pt-3" data-epic-coherence>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-fg">{t.title}</h3>
        <Button
          size="sm"
          variant={allDesigned && !run ? 'primary' : 'secondary'}
          disabled={running}
          pending={command.isPending || running}
          pendingLabel={t.running}
          onClick={start}
        >
          {t.check}
        </Button>
      </div>
      <p className="max-w-prose text-sm text-fg-2">{t.note}</p>
      {allDesigned && !run ? <p className="text-sm font-medium text-fg">{t.suggest}</p> : null}
      {run ? (
        <div className="flex flex-col gap-1 text-sm text-fg-2" data-coherence-state={run.state}>
          {running ? (
            <p>
              <RelativeTime iso={run.created_at} prefix={t.startedPrefix} /> ·{' '}
              <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: run.id }} className="text-fg hover:underline">
                {t.seeRun}
              </Link>
            </p>
          ) : run.state === 'completed' ? (
            <>
              <p className="text-fg">
                {(s?.found ?? 0) === 0 ? t.noIssues : t.issues(s?.found ?? 0, s?.pending ?? 0)}{' '}
                <RelativeTime iso={run.finished_at} prefix={t.checkedPrefix} />
              </p>
              {(s?.dropped ?? 0) > 0 ? <p>{t.dropped(s?.dropped ?? 0)}</p> : null}
              {(s?.found ?? 0) > (s?.proposed ?? 0) ? <p>{t.alreadyPending((s?.found ?? 0) - (s?.proposed ?? 0))}</p> : null}
              <p>
                {t.read(s?.read?.length ?? 0, s?.read ?? [])}
                {(s?.omitted?.length ?? 0) > 0 ? ` ${t.omitted(s?.omitted ?? [])}` : ''}
              </p>
              {s?.batch ? (
                <p>
                  <Link to="/p/$projectId/batches/$batchId" params={{ projectId, batchId: s.batch }} className="text-fg hover:underline">
                    {t.seeIssues}
                  </Link>
                </p>
              ) : null}
            </>
          ) : (
            <p>
              {t.failed(failureWordFor(locale, run.failure_kind, run.state))}{' '}
              <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: run.id }} className="text-fg hover:underline">
                {t.seeRun}
              </Link>
            </p>
          )}
        </div>
      ) : null}
      {command.error ? <ErrorNotice error={command.error} compact /> : null}
    </section>
  );
}
