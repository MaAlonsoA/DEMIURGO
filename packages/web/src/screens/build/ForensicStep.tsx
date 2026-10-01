// The last step of a build request in the Path view: «Forensic analysis». Done (with its outcome and a link to the task's
// Lessons learned) when a post-mortem of the task came from this request; pending when the request ended and none exists
// yet; nothing while the request still runs. The per-task endpoint sends `request_ids` (the requests an analysis covers) but
// not `trigger_request_id`, so the match uses the trigger when present, then `request_ids`, then the first analysis written
// after the request ended.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TimelineRequest } from '../../api/types.ts';
import { DayTime } from '../../components/Time.tsx';
import { useMessages } from '../../i18n/define.ts';
import { LESSONS } from '../lessons/lessons.i18n.ts';
import { taskForensicsQuery } from '../lessons/queries.ts';
import type { TaskForensic } from '../lessons/types.ts';

export type ForensicStepState = { kind: 'done'; forensic: TaskForensic } | { kind: 'pending' } | null;

/** `forensics` come newest first. */
export function forensicStepOf(request: Pick<TimelineRequest, 'id' | 'running' | 'end'>, forensics: TaskForensic[]): ForensicStepState {
  if (request.running) return null;
  const ended = Date.parse(request.end);
  const match =
    forensics.find((f) => f.trigger_request_id === request.id) ??
    forensics.find((f) => f.request_ids?.includes(request.id)) ??
    forensics.find((f) => Date.parse(f.created_at) >= ended);
  return match ? { kind: 'done', forensic: match } : { kind: 'pending' };
}

export function ForensicStepView({ projectId, taskCode, state }: { projectId: string; taskCode: string; state: ForensicStepState }) {
  const t = useMessages(LESSONS);
  if (!state) return null;
  return (
    <section className="flex flex-col gap-1" aria-label={t.fnTitle} data-forensic-step={state.kind}>
      <h4 className="text-xs font-medium text-fg-3">{t.fnTitle}</h4>
      {state.kind === 'pending' ? (
        <p className="text-sm text-fg-2">{t.fnPending}</p>
      ) : (
        <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
          <span className="text-fg">{t.fnDone(t.outcome(state.forensic.analysis.outcome))}</span>
          <span className="text-xs text-fg-3">
            <DayTime iso={state.forensic.created_at} />
          </span>
          <Link to="/p/$projectId/records/$code" params={{ projectId, code: taskCode }} hash={t.sectionAnchor} className="text-accent-text hover:underline">
            {t.fnRead}
          </Link>
        </p>
      )}
    </section>
  );
}

/** Loads the forensics of the request's task; shows nothing while loading, on an error or while the request runs. */
export function ForensicStep({ projectId, request }: { projectId: string; request: TimelineRequest }) {
  const q = useQuery({ ...taskForensicsQuery(projectId, request.task_code), enabled: !request.running });
  if (!q.data) return null;
  return <ForensicStepView projectId={projectId} taskCode={request.task_code} state={forensicStepOf(request, q.data.forensics)} />;
}
