// Issues: a bug a person reports, and the review escalation DEMIURGO opens by itself. Lifecycle
// open -> resolved (with its fix) | closed (with a reason) -> reopened.

import { human, system } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { openIssuesOf, issueDetail, issuesList } from '../src/queries/issues.ts';
import { inbox } from '../src/queries/read.ts';
import { useEnvironment } from './support/env.ts';
import { newDecision } from './support/recipes.ts';

const environment = useEnvironment();
const ana = human('ana');
const bot = system('build');
let projectId = '';
const s = () => environment().services;
type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown, entityId?: string, actor = ana) =>
  executeCommand(s(), { command, actor, projectId, data, ...(entityId ? { entityId } : {}) });

type Made = { recordId: string; versionId: string; code: string };
const SECTIONS = [
  { title: 'Goal', content: 'Do it.' },
  { title: 'Scope', content: 'Just that.' },
  { title: 'Out of scope', content: 'Nothing else.' },
  { title: 'Behavior', content: 'The person does it and sees the result.' },
];

async function task(title: string): Promise<Made> {
  const basis = await newDecision(s(), projectId, true);
  const feature = (
    await cmd('record.create', {
      type: 'fdr',
      domain: 'iss',
      title: `Feature ${title}`,
      sections: SECTIONS,
      criteria: [
        { carry: 'new', title: 'a', statement: 'Given a person, when she does it, then she sees it.', verification: 'automatic', check: 'E2E.' },
      ],
      links: [{ type: 'based_on', target: { code: basis.code, version: 1 } }],
    })
  ).result as Made;
  await cmd('record_version.approve', {}, feature.versionId);
  const made = (
    await cmd('record.create', {
      type: 'task',
      domain: 'iss',
      title,
      sections: SECTIONS.slice(0, 2),
      size: 'S',
      criteria: [],
      links: [{ type: 'based_on', target: { code: feature.code, version: 1 } }],
    })
  ).result as Made;
  await cmd('record_version.approve', {}, made.versionId);
  return made;
}

beforeAll(async () => {
  projectId = (await executeCommand(s(), { command: 'project.create', actor: ana, data: { name: 'Issues' } })).projectId;
});

describe('issues', () => {
  it('a person opens a bug; it gets ISS-001, then resolves it with a fix task, and reopens it', async () => {
    const fix = await task('Fix the bug');
    const opened = await cmd('issue.open', { kind: 'bug', title: 'Save does nothing', body: 'Press save: nothing happens.', task: fix.code });
    expect(opened.result).toEqual({ code: 'ISS-001' });
    expect(opened.state).toBe('open');

    await expect(cmd('issue.resolve', { fix_task: 'TSK-999' }, opened.entityId)).rejects.toMatchObject({ type: 'guard' });
    await expect(cmd('issue.resolve', { fix_task: fix.code, version: 9 }, opened.entityId)).rejects.toMatchObject({ type: 'guard' });
    await expect(cmd('issue.resolve', { fix_task: fix.code }, opened.entityId, system('x'))).rejects.toMatchObject({ type: 'forbidden' });

    const resolved = await cmd('issue.resolve', { fix_task: fix.code, version: 1 }, opened.entityId);
    expect(resolved.state).toBe('resolved');
    const detail = await issueDetail(s().db, projectId, 'ISS-001');
    expect(detail).toMatchObject({
      state: 'resolved',
      kind: 'bug',
      task: { code: fix.code },
      resolution: { task_code: fix.code, task_title: 'Fix the bug', version_n: 1 },
      resolved_by: 'human:ana',
    });
    await expect(cmd('issue.close', { reason: 'x' }, opened.entityId)).rejects.toMatchObject({ type: 'invalid_transition' });

    const reopened = await cmd('issue.reopen', {}, opened.entityId);
    expect(reopened.state).toBe('open');
    expect(await issueDetail(s().db, projectId, 'ISS-001')).toMatchObject({ state: 'open', resolution: null, resolved_at: null });
  });

  it('closing needs a reason, can be reopened, and codes follow in sequence', async () => {
    const second = await cmd('issue.open', { kind: 'bug', title: 'Typo on the home page' });
    expect(second.result).toEqual({ code: 'ISS-002' });
    await expect(cmd('issue.close', {}, second.entityId)).rejects.toMatchObject({ type: 'validation' });
    const closed = await cmd('issue.close', { reason: 'Not a bug: it is on purpose.' }, second.entityId);
    expect(closed.state).toBe('closed');
    expect(await issueDetail(s().db, projectId, 'ISS-002')).toMatchObject({ state: 'closed', close_reason: 'Not a bug: it is on purpose.', closed_by: 'human:ana' });
    await cmd('issue.reopen', { reason: 'It happens again.' }, second.entityId);
    expect((await issuesList(s().db, projectId)).issues.map((i) => i.code)).toEqual(['ISS-002', 'ISS-001']);
    // Nothing is deleted and the content cannot change.
    await expect(s().db.deleteFrom('issues').where('id', '=', second.entityId).execute()).rejects.toThrow(/cannot be deleted/);
    await expect(s().db.updateTable('issues').set({ title: 'x' }).where('id', '=', second.entityId).execute()).rejects.toThrow(/only the state/);
  });

  it('a merge step escalated to a person opens one review_escalation issue, idempotent on repeat, and Needs you counts it', async () => {
    const t = await task('Escalated task');
    const request = await s().db
      .insertInto('build_requests')
      .values({ project_id: projectId, task_id: t.recordId, task_version_id: t.versionId, feature_version_id: null, brief: 'brief', requested_by: 'human:ana' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const run = (await executeCommand(s(), { command: 'run.request', actor: ana, projectId, data: { action: 'echo', scope: { type: 'project' }, input: { text: 'x' } } })).entityId;
    await s().db
      .insertInto('pr_reviews')
      .values({
        project_id: projectId,
        build_request_id: request.id,
        run_id: run,
        verdict: 'request_changes',
        summary: 'Needs a deployment someone must do.',
        comments: JSON.stringify([
          { path: 'deploy.yml', line: 12, severity: 'blocking', needs_person: true, body: 'Set the production secret by hand.' },
          { path: 'src/a.ts', line: 3, severity: 'blocking', needs_person: false, body: 'Rename it.' },
        ]),
        criteria: JSON.stringify([]),
      })
      .execute();
    const before = (await issuesList(s().db, projectId)).issues.length;
    const total = (await inbox(s().db, projectId)).total;
    const step = {
      build_request_id: request.id,
      attempt: 1,
      stage: 'merge',
      outcome: 'changes_requested',
      detail: { reason: 'x', escalated: 'needs_person', needs_person: 1 },
    };
    await cmd('build_step.record', step, undefined, bot);
    await cmd('build_step.record', step, undefined, bot);
    const issues = (await issuesList(s().db, projectId)).issues;
    expect(issues.length).toBe(before + 1);
    const issue = issues[0];
    expect(issue).toMatchObject({
      kind: 'review_escalation',
      state: 'open',
      title: `Review escalation on ${t.code}: Set the production secret by hand.`,
      task: { code: t.code },
      attempt: 1,
      opened_by: 'system:build@1',
      review: { summary: 'Needs a deployment someone must do.' },
    });
    expect(issue?.body).toContain('deploy.yml:12 — Set the production secret by hand.');
    expect(issue?.body).not.toContain('Rename it.');
    expect(issue?.review?.comments).toHaveLength(2);

    // A non-escalated changes_requested step opens nothing.
    await cmd('build_step.record', { ...step, attempt: 2, detail: { reason: 'x' } }, undefined, bot);
    expect((await issuesList(s().db, projectId)).issues.length).toBe(before + 1);

    const open = await openIssuesOf(s().db, projectId);
    expect(open.map((i) => i.code)).toContain(issue?.code);
    const after = await inbox(s().db, projectId);
    expect(after.open_issues.length).toBe(open.length);
    expect(after.total).toBe(total + 1 - 0);
  });
  it('a quarantined flaky test opens one bug while it is open, and CI red on main opens one bug per commit', async () => {
    const t = await task('Flaky task');
    const request = await s().db
      .insertInto('build_requests')
      .values({ project_id: projectId, task_id: t.recordId, task_version_id: t.versionId, feature_version_id: null, brief: 'brief', requested_by: 'human:ana' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const before = (await issuesList(s().db, projectId)).issues.length;
    const evidence = { build_request_id: request.id, attempt: 1, stage: 'evidence', outcome: 'ok', detail: { recorded: [], flaky: ['AC-X-001-01 a'], quarantined: ['AC-X-001-01 a'] } };
    await cmd('build_step.record', evidence, undefined, bot);
    await cmd('build_step.record', { ...evidence, attempt: 2 }, undefined, bot);
    let issues = (await issuesList(s().db, projectId)).issues;
    expect(issues.length).toBe(before + 1);
    expect(issues[0]).toMatchObject({ kind: 'bug', state: 'open', title: 'Flaky test quarantined: AC-X-001-01 a', opened_by: 'system:build@1' });

    const main = { build_request_id: request.id, attempt: 2, stage: 'main', outcome: 'failed', detail: { on: 'main', sha: 'abc123def4567890', conclusion: 'failure' } };
    await cmd('build_step.record', main, undefined, bot);
    await cmd('build_step.record', main, undefined, bot);
    issues = (await issuesList(s().db, projectId)).issues;
    expect(issues.length).toBe(before + 2);
    expect(issues[0]).toMatchObject({ kind: 'bug', title: `CI on main is red after merging ${t.code}`, task: { code: t.code } });
    // A green main opens nothing.
    await cmd('build_step.record', { ...main, outcome: 'ok', detail: { on: 'main', sha: 'fff', conclusion: 'success' } }, undefined, bot);
    expect((await issuesList(s().db, projectId)).issues.length).toBe(before + 2);
  });
});
