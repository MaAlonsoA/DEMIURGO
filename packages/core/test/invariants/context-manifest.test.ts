// Invariant of the context manifest (spec §9.2, §16): every registered builder returns a manifest
// next to its pack, the manifest names the builder with its version and counts every candidate, and
// what entered each section stays within the budget the pack declares for it.

import { AGENT_ACTIONS, type AgentAction, FRAGMENT_DECISIONS, human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSimulatedProvider } from '../../src/agents/simulated.ts';
import { executeCommand } from '../../src/bus/bus.ts';
import { BUILDERS, type Built, type Scope, buildContext } from '../../src/context/build.ts';
import { graphVersion } from '../../src/context/graph.ts';
import { waitForRun } from '../../src/engine/engine.ts';
import { waitForKnowledge } from '../../src/knowledge/workflows.ts';
import { recordDetail } from '../../src/queries/read.ts';
import '../../src/commands/index.ts';
import { useEnvironment } from '../support/env.ts';

// Durable: the seeding runs the drafting agents (simulated) to reach an approved epic, feature and task.
const environment = useEnvironment({ durable: true, providers: () => [createSimulatedProvider()] });
const ana = human('ana');
let projectId = '';
/** The scope and input each builder is exercised with, on the seeded project. A new builder needs its entry. */
const cases: Partial<Record<AgentAction, { scope: Scope; input: Record<string, unknown> }>> = {};

const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown, entityId?: string) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });

async function approvedDecision(title: string, text: string): Promise<string> {
  const r = await cmd('record.create', {
    type: 'decision',
    domain: 'fees',
    title,
    sections: [
      { title: 'Context', content: 'The association needs income. '.repeat(120) },
      { title: 'Decision', content: text },
      { title: 'Consequences', content: 'A receipt is issued. '.repeat(120) },
    ],
  });
  const { versionId } = r.result as { versionId: string };
  await cmd('record_version.approve', {}, versionId);
  return versionId;
}


/** Runs an agent action (simulated) to completion and returns the proposal ids it left. */
async function draft(action: string, scope: { type: string; id: string }): Promise<{ proposals: { id: string; batchId: string }[] }> {
  await waitForKnowledge(environment().services, projectId, 15_000);
  const r = await cmd('run.request', { action, scope });
  await waitForRun(r.entityId);
  const proposals = await environment()
    .services.db.selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .select(['proposals.id', 'proposal_batches.id as batchId'])
    .where('proposal_batches.run_id', '=', r.entityId)
    .orderBy('proposals.position')
    .execute();
  return { proposals };
}

async function approvedFeature(thread: string, name: string, code: string, epic: { versionId: string }, epicThread: string) {
  const featureThread = (
    await cmd('exploration.open', {
      purpose: `Design "${name}" (${code}): Walk the whole thing`,
      parent_id: epicThread,
      origin: { type: 'record_version', id: epic.versionId },
    })
  ).entityId;
  void thread;
  const { proposals } = await draft('feature_design', { type: 'exploration', id: featureThread });
  const feature = (await cmd('proposal.accept', { approve: false }, proposals[0]?.id)).result as { versionId: string };
  await cmd('record_version.approve', {}, feature.versionId);
  return feature.versionId;
}

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Builders' } })).projectId;
  const thread = (await cmd('exploration.open', { purpose: 'Membership fee policy for the partners' })).entityId;
  for (let i = 1; i <= 8; i++) {
    await cmd('message.post', {
      exploration_id: thread,
      text: `Message ${i} about the membership fee. `.repeat(40),
      respond: false,
    });
  }
  await cmd('question.raise', { exploration_id: thread, question: 'Who pays the membership fee?' });
  const version = await approvedDecision(
    'Membership fee of the partners',
    'The partners pay a yearly membership fee. '.repeat(100),
  );
  await approvedDecision('Membership fee receipt', 'The membership fee is collected with a receipt. '.repeat(80));
  for (let i = 1; i <= 3; i++)
    await cmd('source.register', { name: `Source ${i}`, content: 'Membership fee source text. '.repeat(120) });
  cases.echo = { scope: { type: 'echo' }, input: { text: 'x'.repeat(5000) } };
  cases.exploration_chat = { scope: { type: 'exploration', id: thread }, input: {} };
  cases.design_proposal = { scope: { type: 'record_version', id: version }, input: {} };

  // Epic -> feature -> tasks, each accepted and approved as a person would; the drafting agents are simulated.
  const epicThread = (await cmd('exploration.open', { purpose: 'Share recipes with friends' })).entityId;
  await cmd('message.post', { exploration_id: epicThread, text: 'People should share recipes end to end.', respond: false });
  const epicRun = await draft('epic_plan', { type: 'exploration', id: epicThread });
  const epic = (await cmd('proposal.accept', { approve: false }, epicRun.proposals[0]?.id)).result as { recordId: string; versionId: string };
  await cmd('record_version.approve', {}, epic.versionId);
  const planned = await environment()
    .services.db.selectFrom('planned_features')
    .select(['code', 'name'])
    .where('project_id', '=', projectId)
    .orderBy('position')
    .execute();
  const first = planned[0];
  const second = planned[1];
  if (!first || !second) throw new Error('The epic did not plan its features.');
  const featureVersion = await approvedFeature(epicThread, first.name, first.code, epic, epicThread);
  // The second planned feature stays planned: its thread is what feature_design builds from.
  const secondThread = (
    await cmd('exploration.open', {
      purpose: `Design "${second.name}" (${second.code}): Walk the whole thing`,
      parent_id: epicThread,
      origin: { type: 'record_version', id: epic.versionId },
    })
  ).entityId;
  // A thread with nothing drafted from it yet, for epic_plan.
  const freshThread = (await cmd('exploration.open', { purpose: 'Plan the yearly newsletter' })).entityId;
  await cmd('message.post', { exploration_id: freshThread, text: 'A newsletter goes out once a year.', respond: false });
  // The design-system thread: directions shown, one chosen.
  const designThread = (await cmd('exploration.open', { purpose: 'Design system: start from Carbon' })).entityId;
  await cmd('message.post', { exploration_id: designThread, text: 'Design system: start from Carbon', respond: false });
  await draft('design_directions', { type: 'exploration', id: designThread });
  await cmd('message.post', { exploration_id: designThread, text: 'I choose direction: Bold', respond: false });
  // The approved task and a build request over it (a fixture with the columns the command fills in).
  const taskRun = await draft('task_plan', { type: 'record_version', id: featureVersion });
  for (const p of taskRun.proposals) await cmd('proposal.accept', { approve: true }, p.id);
  const db = environment().services.db;
  const task = (await recordDetail(db, projectId, first.code)).tasks?.[0];
  const taskRow = await db.selectFrom('records').select('id').where('project_id', '=', projectId).where('code', '=', task?.code ?? '').executeTakeFirstOrThrow();
  const taskVersion = await db.selectFrom('record_versions').select('id').where('record_id', '=', taskRow.id).where('state', '=', 'approved').executeTakeFirstOrThrow();
  const buildRequest = await db
    .insertInto('build_requests')
    .values({
      project_id: projectId,
      task_id: taskRow.id,
      task_version_id: taskVersion.id,
      feature_version_id: featureVersion,
      brief: `Build ${task?.code}.`,
      requested_by: 'human:ana',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const codes = task?.covers ?? [];
  // The approved design system, which screen_design draws from.
  const dsy = await draft('design_system_plan', { type: 'exploration', id: designThread });
  const dsyVersion = (await cmd('proposal.accept', { approve: false }, dsy.proposals[0]?.id)).result as { versionId: string };
  await cmd('record_version.approve', {}, dsyVersion.versionId);
  // Its screens, approved: with a design system the tasks are planned from them (task_plan needs them).
  const screens = await draft('screen_design', { type: 'record_version', id: featureVersion });
  const screenVersion = (await cmd('proposal.accept', { approve: false }, screens.proposals[0]?.id)).result as { versionId: string };
  await cmd('record_version.approve', {}, screenVersion.versionId);
  cases.coherence_review = { scope: { type: 'record', id: epic.recordId }, input: {} };
  cases.epic_plan = { scope: { type: 'exploration', id: freshThread }, input: {} };
  cases.feature_design = { scope: { type: 'exploration', id: secondThread }, input: {} };
  cases.task_plan = { scope: { type: 'record_version', id: featureVersion }, input: {} };
  cases.screen_design = { scope: { type: 'record_version', id: featureVersion }, input: {} };
  cases.design_directions = { scope: { type: 'exploration', id: designThread }, input: {} };
  cases.design_system_plan = { scope: { type: 'exploration', id: designThread }, input: {} };
  cases.pr_review = {
    scope: { type: 'build_request', id: buildRequest.id },
    input: {
      diff: `diff --git a/tests/x.test.ts b/tests/x.test.ts\n+++ b/tests/x.test.ts\n${codes.map((c) => `+it('${c} does what it says', () => {});`).join('\n')}\n`,
      pr_url: 'https://github.com/acme/recipes/pull/1',
      ci: { conclusion: 'success', tests: codes.map((code) => ({ code, result: 'pass' })) },
    },
  };
});

async function build(action: AgentAction): Promise<Built> {
  const c = cases[action];
  if (!c) throw new Error(`No scope for the builder of "${action}": add it to this invariant.`);
  return environment()
    .services.db.transaction()
    .execute(async (trx) => buildContext(trx, projectId, action, c.scope, c.input, await graphVersion(trx, projectId)));
}

describe('every registered builder returns a manifest and respects its budgets', () => {
  it('every agent action has a builder', () => {
    expect(Object.keys(BUILDERS).sort()).toEqual([...AGENT_ACTIONS].sort());
  });

  for (const action of AGENT_ACTIONS) {
    it(`${action}: the manifest names the builder, counts every candidate and keeps each section within budget`, async () => {
      const { pack, manifest } = await build(action);
      expect(manifest.builder).toMatch(/^[a-z_]+@\d+$/);
      expect(manifest.builder).toBe(pack.constructor);
      expect(manifest.graphVersion).toBe(pack.graph_version);
      expect(manifest.budget).toEqual(pack.budget);
      expect(manifest.fragments.length).toBeGreaterThan(0);
      expect(manifest.candidates).toBe(manifest.fragments.length);
      expect(manifest.fragments.map((f) => f.seq)).toEqual(manifest.fragments.map((_, i) => i + 1));
      for (const f of manifest.fragments) {
        expect(FRAGMENT_DECISIONS).toContain(f.decision);
        expect(f.reason).not.toBe('');
        expect(f.textHash).toMatch(/^[0-9a-f]{64}$/);
        expect(f.chars).toBeLessThanOrEqual(f.originalChars);
        expect(f.source.type).not.toBe('');
        expect(f.position === null).toBe(f.decision === 'dropped');
      }
      // A cut fragment was really cut.
      expect(manifest.fragments.filter((f) => f.decision === 'truncated' && f.originalChars <= f.chars)).toEqual([]);
      const positions = manifest.fragments.filter((f) => f.decision !== 'dropped').map((f) => f.position);
      expect(positions).toEqual(positions.map((_, i) => i));
      const filled: Record<string, number> = {};
      for (const f of manifest.fragments) if (f.decision !== 'dropped') filled[f.section] = (filled[f.section] ?? 0) + f.chars;
      const keys = Object.keys(manifest.budget);
      const budgeted = keys.filter((section) => section in filled);
      // Each budget bounds its section; a single budget that names no section (echo's
      // `characters`) bounds the whole pack.
      const limits =
        budgeted.length === 0 && keys.length === 1
          ? [
              {
                name: keys[0] ?? '',
                used: Object.values(filled).reduce((acc, n) => acc + n, 0),
                max: manifest.budget[keys[0] ?? ''] ?? 0,
              },
            ]
          : budgeted.map((section) => ({ name: section, used: filled[section] ?? 0, max: manifest.budget[section] ?? 0 }));
      expect(limits.length).toBeGreaterThan(0);
      expect(limits.filter((l) => l.used > l.max)).toEqual([]);
    });
  }
});
