// One-off repair of evidence that DEMIURGO itself misread: until 02-10-2026 the JUnit ingest only took a criterion code
// at the very start of a case name, but Vitest and Playwright put the enclosing suites first («suite > AC-… title»), so
// passing tests of tasks already merged were stored with no criterion and their Definition of Done showed «not yet».
// At startup, every request whose stored cases have a code after a suite separator and none recorded for that test is
// ingested again from its CI artifact by the build system (the evidence is CI's, not anybody's decision). Idempotent:
// once its cases carry their codes, a request is never picked again.

import { executeCommand } from '../bus/bus.ts';
import { system } from '@demiurgo/domain';
import { criterionCodeOf } from '../commands/evidence.ts';
import { registerReconciler } from '../engine/registry.ts';
import * as github from '../github/client.ts';
import { automaticCriteriaOf, taskCoversOf } from '../queries/sizes.ts';
import type { Services } from '../services.ts';

const BUILD = system('build', '1');

/** The (request, attempt, head) whose stored cases have a criterion code only after a suite separator. */
async function misread(s: Services): Promise<{ requestId: string; projectId: string; taskId: string; attempt: number; headSha: string; prUrl: string }[]> {
  const rows = await s.db
    .selectFrom('test_runs as t')
    .innerJoin('build_requests as b', 'b.id', 't.build_request_id')
    .select(['t.build_request_id', 't.attempt', 't.head_sha', 't.test_name', 't.criterion_code', 'b.project_id', 'b.task_id', 'b.pr_url'])
    .where('t.test_name', '~', '\\s[>›]\\s+AC-[A-Z]{3}-\\d{3}-\\d{2}')
    .execute();
  const byKey = new Map<string, { requestId: string; projectId: string; taskId: string; attempt: number; headSha: string; prUrl: string; fixed: boolean }>();
  for (const r of rows) {
    if (!r.build_request_id || r.attempt === null || !r.head_sha || !r.pr_url) continue;
    const key = `${r.build_request_id}:${r.attempt}:${r.head_sha}`;
    const entry = byKey.get(key) ?? { requestId: r.build_request_id, projectId: r.project_id, taskId: r.task_id, attempt: r.attempt, headSha: r.head_sha, prUrl: r.pr_url, fixed: false };
    if (r.criterion_code && r.criterion_code === criterionCodeOf(r.test_name)) entry.fixed = true;
    byKey.set(key, entry);
  }
  return [...byKey.values()].filter((e) => !e.fixed);
}

export async function backfillMisreadEvidence(s: Services): Promise<number> {
  const cfg = github.githubConfig();
  if (!cfg) return 0;
  let repaired = 0;
  for (const e of await misread(s)) {
    const repo = /github\.com\/([^/]+)\/([^/]+)\/pull\//.exec(e.prUrl);
    if (!repo) continue;
    const junit = await github.junitArtifactFor(cfg, repo[1] as string, repo[2] as string, e.headSha).catch(() => null);
    if (!junit) continue;
    const covers = (await automaticCriteriaOf(s.db, e.projectId, await taskCoversOf(s.db, e.taskId))).automatic;
    await executeCommand(s, {
      command: 'evidence.ingest_junit',
      actor: BUILD,
      projectId: e.projectId,
      data: { junit, pr_url: e.prUrl, reference: e.headSha, expected: covers, build_request_id: e.requestId, attempt: e.attempt },
    });
    repaired++;
    s.logger.info('Evidence ingested again (criterion codes after suite names)', { build_request_id: e.requestId, attempt: e.attempt });
  }
  return repaired;
}

registerReconciler(async (s) => {
  void backfillMisreadEvidence(s).catch((err: unknown) => s.logger.error('Evidence backfill failed', { error: String(err) }));
}, 'evidence-backfill');
