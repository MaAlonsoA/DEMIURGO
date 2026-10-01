// The automatic forensic: when a build request ends (merged, failed or withdrawn) the task's forensic runs by itself.
// The build orchestrator is a durable workflow and is not touched; the post-mortems of the harness are triggered by a
// level-triggered sweep every 60 s (harness/register.ts: Kubernetes documentation, «Controllers»: a control loop keeps
// re-reading the state), and this follows the same pattern. A task is due when its latest ended build request has
// activity newer than its latest forensic; `runTaskForensic` still skips the run when the evidence hash is the same.
// It spends the subscription's quota only when a person has assigned an engine to the agent (without one the run is
// refused and the sweep stops quietly) and never while the drain flag is up, like the build queue.

import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';
import { isDraining } from '../drain.ts';
import { endedOutcome, loadInputs } from '../harness/postmortem.ts';
import type { Services } from '../services.ts';
import { type TaskResult, runTaskForensic } from './run.ts';

/** How often the sweep looks (our convention, the same as the harness post-mortems and the build queue). */
export const FORENSICS_SWEEP_MS = 60_000;
/** Forensics one sweep starts at most; each waits for its run (the engine is a person's subscription: serial on purpose). */
export const FORENSICS_PER_SWEEP = 3;
/**
 * Only build requests whose activity ends after this instant are analysed unattended: the automatic forensic arrived
 * with the error vault (01-10-2026, 23:00 UTC), and older builds of other projects (dogfood, evals) must not spend a subscription
 * on their own (our convention). Older tasks are analysed on purpose with `forensics run`.
 */
export const FORENSICS_AUTO_SINCE = '2026-10-01T23:00:00Z';

export type ForensicDue = { project_id: string; task_id: string; code: string; request_id: string; outcome: 'merged' | 'withdrawn' | 'failed'; activity_at: string };

/** The tasks whose latest ended build request is newer than their latest forensic and that have no analysis running or failed since. */
export async function dueForensics(db: Db, since: string = FORENSICS_AUTO_SINCE): Promise<ForensicDue[]> {
  const rows = await sql<{ id: string; project_id: string; task_id: string; code: string; activity_at: Date }>`
    select b.id, b.project_id, b.task_id, r.code,
      greatest(
        b.requested_at,
        coalesce((select max(s.created_at) from build_steps s where s.build_request_id = b.id), 'epoch'),
        coalesce((select max(p.created_at) from pr_reviews p where p.build_request_id = b.id), 'epoch'),
        coalesce(b.done_at, 'epoch'),
        coalesce(b.withdrawn_at, 'epoch')) as activity_at
    from build_requests b
    join records r on r.id = b.task_id
    where b.state in ('done', 'withdrawn') or exists (select 1 from build_steps s where s.build_request_id = b.id)
    order by activity_at, b.id`.execute(db);
  // The latest request of each task is the one whose end counts.
  const latestOf = new Map<string, (typeof rows.rows)[number]>();
  for (const r of rows.rows) latestOf.set(r.task_id, r);
  const due: ForensicDue[] = [];
  for (const r of [...latestOf.values()].toSorted((a, b) => new Date(a.activity_at).getTime() - new Date(b.activity_at).getTime())) {
    const activity = new Date(r.activity_at);
    const forensic = await db.selectFrom('task_forensics').select('created_at').where('task_id', '=', r.task_id).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    if (activity.getTime() < Date.parse(since)) continue;
    if (forensic && new Date(forensic.created_at as unknown as Date).getTime() >= activity.getTime()) continue;
    // An analysis already running, or one that failed after the activity: a person retries it (`forensics run --force`), the sweep does not loop on it.
    const attempt = await sql<{ n: number }>`
      select count(*)::int as n from ai_runs
      where action = 'task_forensics' and scope->>'id' = ${r.task_id} and created_at >= ${activity.toISOString()}::timestamptz and state <> 'completed'`.execute(db);
    if ((attempt.rows[0]?.n ?? 0) > 0) continue;
    const outcome = endedOutcome(await loadInputs(db, r.id));
    if (outcome === 'merged' || outcome === 'withdrawn' || outcome === 'failed') due.push({ project_id: r.project_id, task_id: r.task_id, code: r.code, request_id: r.id, outcome, activity_at: activity.toISOString() });
  }
  return due;
}

export type SweepResult = { due: number; results: (TaskResult & { project_id: string; request_id: string; outcome: string })[]; stopped: 'draining' | 'refused' | null };

/** One sweep: the due forensics, oldest first, up to `limit`. Never throws for a refusal (no engine assigned): it stops quietly. */
export async function sweepForensics(services: Services, opts: { limit?: number; since?: string } = {}): Promise<SweepResult> {
  const out: SweepResult = { due: 0, results: [], stopped: null };
  if (isDraining()) return { ...out, stopped: 'draining' };
  const due = await dueForensics(services.db, opts.since);
  out.due = due.length;
  let started = 0;
  for (const d of due) {
    if (started >= (opts.limit ?? FORENSICS_PER_SWEEP)) break;
    if (isDraining()) {
      out.stopped = 'draining';
      break;
    }
    const r = await runTaskForensic(services, d.project_id, { id: d.task_id, code: d.code }, { triggerRequestId: d.request_id, actor: 'forensics-sweeper' });
    out.results.push({ ...r, project_id: d.project_id, request_id: d.request_id, outcome: d.outcome });
    if (r.status === 'refused') {
      out.stopped = 'refused';
      break;
    }
    if (r.status === 'skipped') continue;
    started++;
    if (r.status === 'failed') services.logger.error('The automatic task forensic failed', { task: d.code, request: d.request_id, reason: r.reason ?? '' });
  }
  return out;
}
