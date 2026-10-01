// Build pipeline: the retry breaker (the same guard failing with the same finding on 3 attempts in a row sends the
// request to the person) and the task's own files computed against the merge-base with main.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { human } from '@demiurgo/domain';
import { afterAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { BREAKER_ATTEMPTS, normaliseFinding, tripped } from '../src/build/breaker.ts';
import { retryDesign } from '../src/build/orchestrator.ts';
import { ownFilesSince } from '../src/build/workspace.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment({ durable: true });
const ana = human('ana');

async function newRequest(name: string) {
  const s = environment().services;
  const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name } });
  const made = await executeCommand(s, {
    command: 'record.create',
    actor: ana,
    projectId,
    data: {
      type: 'fdr',
      domain: 'brk',
      title: `Feature ${name}`,
      sections: [
        { title: 'Goal', content: 'A goal.' },
        { title: 'Scope', content: 'Scope.' },
        { title: 'Out of scope', content: 'Nothing.' },
        { title: 'Behavior', content: '1. It works.' },
      ],
      criteria: [{ carry: 'new', title: 'One', statement: 'Given a, when b, then c.', verification: 'automatic', check: 'A test.' }],
    },
  });
  const row = await s.db
    .insertInto('build_requests')
    .values({ project_id: projectId, task_id: made.entityId, task_version_id: (made.result as { versionId: string }).versionId, feature_version_id: null, brief: 'brief', requested_by: 'human:ana' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { projectId, requestId: row.id };
}

async function designFailure(p: { projectId: string; requestId: string }, attempt: number, error: string) {
  await environment()
    .services.db.insertInto('build_steps')
    .values({ project_id: p.projectId, build_request_id: p.requestId, attempt, stage: 'design', outcome: 'failed', detail: JSON.stringify({ error }) })
    .execute();
}

const duplicate = (line: number) => `1 duplicate test: AC-X-001-01 at test/a.test.ts:${line} duplicates test/b.test.ts:${line + 10}`;

describe('retry breaker', () => {
  it('normalises line numbers and timestamps away', () => {
    expect(normaliseFinding(duplicate(12))).toBe(normaliseFinding(duplicate(40)));
    expect(normaliseFinding('failed at 2026-10-01T22:00:01Z on line 7')).toBe(normaliseFinding('failed at 2026-10-02T01:15:00Z on line 99'));
    expect(normaliseFinding('missing token a')).not.toBe(normaliseFinding('missing token b'));
  });

  it(`${BREAKER_ATTEMPTS} identical failures in a row: no retry, the request goes to the person with the breaker detail`, async () => {
    const s = environment().services;
    const p = await newRequest('Breaker trips');
    await designFailure(p, 1, duplicate(10));
    await designFailure(p, 2, duplicate(20));
    await designFailure(p, 3, duplicate(30));
    expect(await retryDesign(s, { ...p, attempt: 3 }, 10)).toBeNull();
    const last = await s.db
      .selectFrom('build_steps')
      .select(['stage', 'outcome', 'detail'])
      .where('build_request_id', '=', p.requestId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(last).toMatchObject({ stage: 'design', outcome: 'failed' });
    expect(last.detail).toMatchObject({ needs_you: true, breaker: { guard: 'test-guard', attempts: 3 } });
    const detail = last.detail as { reason: string; breaker: { finding: string } };
    expect(detail.breaker.finding).toContain('duplicate test');
    expect(detail.reason).toContain('test-guard');
    // No automatic next attempt was started.
    const started = await s.db.selectFrom('build_steps').select('attempt').where('build_request_id', '=', p.requestId).where('stage', '=', 'repo').execute();
    expect(started).toEqual([]);
  });

  it('2 identical failures and a different one: it keeps retrying', async () => {
    const s = environment().services;
    const p = await newRequest('Breaker open');
    await designFailure(p, 1, duplicate(10));
    await designFailure(p, 2, duplicate(20));
    await designFailure(p, 3, '1 ownership violation: src/x.ts belongs to FDR-OTH-001');
    expect(await retryDesign(s, { ...p, attempt: 3 }, 10)).toBe(4);
    const started = await s.db.selectFrom('build_steps').select(['attempt', 'detail']).where('build_request_id', '=', p.requestId).where('stage', '=', 'repo').execute();
    expect(started).toMatchObject([{ attempt: 4, detail: { automatic: true } }]);
    expect(tripped([{ attempt: 1, error: 'a' }, { attempt: 2, error: 'a' }], 2)).toBeNull();
  });
});

describe('own files against the merge-base', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmg-own-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
  const commit = (file: string, message: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), `${message}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };

  it('files that arrived from main with a rework are never the task own files', async () => {
    git('init', '-q', '-b', 'main');
    commit('base.txt', 'base');
    git('checkout', '-q', '-b', 'task/x');
    const first = commit('src/own-1.ts', 'attempt 1');
    expect(await ownFilesSince(dir, null, first)).toEqual(['src/own-1.ts']);
    // Other tasks merge into main; the rework brings them into the branch (a merge commit) and adds the task's own change.
    git('checkout', '-q', 'main');
    commit('src/other-1.ts', 'other task 1');
    commit('src/other-2.ts', 'other task 2');
    git('checkout', '-q', 'task/x');
    git('merge', '-q', '--no-edit', 'main');
    const second = commit('src/own-2.ts', 'attempt 2');
    // The plain diff between the two attempts carries the files of other tasks; the merge-base one does not.
    expect(git('diff', '--name-only', first, second).split('\n').sort()).toEqual(['src/other-1.ts', 'src/other-2.ts', 'src/own-2.ts']);
    expect(await ownFilesSince(dir, first, second)).toEqual(['src/own-2.ts']);
  });
});
