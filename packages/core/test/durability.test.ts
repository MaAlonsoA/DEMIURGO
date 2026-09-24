import { type ChildProcess, spawn } from 'node:child_process';
import { human, system } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const SCRIPT = 'packages/core/test/support/engine-process.ts';

function launch(args: string[]): {
  child: ChildProcess;
  output: () => string;
  wait: (marker: string, ms: number) => Promise<void>;
} {
  const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', (d: Buffer) => {
    output += d.toString();
  });
  child.stderr?.on('data', (d: Buffer) => {
    output += d.toString();
  });
  return {
    child,
    output: () => output,
    wait: (marker, ms) =>
      new Promise((resolve, reject) => {
        const t0 = Date.now();
        const tick = setInterval(() => {
          if (output.includes(marker)) {
            clearInterval(tick);
            resolve();
          } else if (Date.now() - t0 > ms || child.exitCode !== null) {
            clearInterval(tick);
            reject(new Error(`"${marker}" never appeared. Output:\n${output}`));
          }
        }, 50);
      }),
  };
}

const childOutput = (h: ChildProcess) => new Promise<void>((r) => (h.exitCode !== null ? r() : h.once('exit', () => r())));

describe('durable engine', () => {
  it('AC-ESQ-001-07 killing the process during a run resumes it and its effect happens only once', async () => {
    const { services: s, url } = environment();
    const { projectId } = await executeCommand(s, {
      command: 'project.create',
      actor: human('ana'),
      data: { name: 'Durable' },
    });
    const run = await executeCommand(s, {
      command: 'run.request',
      actor: human('ana'),
      projectId,
      data: { action: 'echo', scope: { type: 'project' }, input: { text: 'survives' } },
    });

    const first = launch([url, 'start', projectId, run.entityId]);
    await first.wait('INVOKING', 60_000);
    first.child.kill('SIGKILL');
    await childOutput(first.child);
    const partial = await s.db.selectFrom('ai_runs').select('state').where('id', '=', run.entityId).executeTakeFirstOrThrow();
    expect(partial.state).toBe('running');

    const second = launch([url, 'recover', run.entityId]);
    await second.wait('RESULT', 90_000);
    await childOutput(second.child);
    expect(second.output()).toContain('INVOKING_AGAIN');
    expect(second.output()).toContain('RESULTADO completed');

    const final = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', run.entityId).executeTakeFirstOrThrow();
    expect(final.state).toBe('completed');
    expect(final.output).toEqual({ reply: 'Echo: survives' });
    const byCommand = await s.db
      .selectFrom('events')
      .select(['command', (eb) => eb.fn.countAll<string>().as('n')])
      .where('entity_id', '=', run.entityId)
      .groupBy('command')
      .execute();
    const counts = Object.fromEntries(byCommand.map((r) => [r.command, Number(r.n)]));
    expect(counts).toEqual({ 'run.request': 1, 'run.begin': 1, 'run.complete': 1 });
    const logs = await s.db.selectFrom('ai_run_logs').select('id').where('run_id', '=', run.entityId).execute();
    expect(logs).toHaveLength(1);
  });

  it('AC-ESQ-001-07 a cut right after confirming "apply" does not repeat its effect on resume', async () => {
    const { services: s, url } = environment();
    const ana = human('ana');
    const { projectId } = await executeCommand(s, {
      command: 'project.create',
      actor: ana,
      data: { name: 'Cut after apply' },
    });
    const e = await executeCommand(s, { command: 'exploration.open', actor: ana, projectId, data: { purpose: 'Dues' } });
    await executeCommand(s, {
      command: 'message.post',
      actor: ana,
      projectId,
      data: { exploration_id: e.entityId, text: 'Quiero cuotas anuales', respond: false },
    });
    const run = await executeCommand(s, {
      command: 'run.request',
      actor: ana,
      projectId,
      data: { action: 'exploration_chat', scope: { type: 'exploration', id: e.entityId } },
    });
    const first = launch([url, 'cortar-tras-aplicar', projectId, run.entityId]);
    await first.wait('APPLIED', 60_000);
    await childOutput(first.child);
    const after = await s.db.selectFrom('ai_runs').select('state').where('id', '=', run.entityId).executeTakeFirstOrThrow();
    expect(after.state).toBe('completed');

    const second = launch([url, 'recover', run.entityId]);
    await second.wait('RESULT', 90_000);
    await childOutput(second.child);
    expect(second.output()).toContain('RESULTADO completed');
    // The agent isn't invoked again, and the effects (messages and batch) exist only once.
    expect(second.output()).not.toContain('INVOKING_AGAIN');
    const messages = await s.db.selectFrom('messages').select('id').where('run_id', '=', run.entityId).execute();
    const batches = await s.db.selectFrom('proposal_batches').select('id').where('run_id', '=', run.entityId).execute();
    const completed = await s.db
      .selectFrom('events')
      .select('id')
      .where('entity_id', '=', run.entityId)
      .where('command', '=', 'run.complete')
      .execute();
    expect({ messages: messages.length, batches: batches.length, completed: completed.length }).toEqual({
      messages: 2,
      batches: 1,
      completed: 1,
    });
  });

  it('AC-ESQ-001-07 on startup, a run in progress with no recoverable workflow is left interrupted and a queued one runs', async () => {
    const { services: s, url } = environment();
    const ana = human('ana');
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Reconcile' } });
    const request = (text: string) =>
      executeCommand(s, {
        command: 'run.request',
        actor: ana,
        projectId,
        data: { action: 'echo', scope: { type: 'project' }, input: { text } },
      });
    // A run was left "in progress" with no workflow (e.g. a cut with a different code version).
    const orphan = await request('orphan');
    await executeCommand(s, {
      command: 'run.begin',
      actor: system('engine'),
      projectId,
      entityId: orphan.entityId,
      data: {},
    });
    // And another was left queued without anyone starting its workflow.
    const queued = await request('queued');
    const child = launch([url, 'reconcile']);
    await child.wait('RECONCILED', 90_000);
    await childOutput(child.child);
    const states = await s.db
      .selectFrom('ai_runs')
      .select(['id', 'state', 'failure_kind'])
      .where('id', 'in', [orphan.entityId, queued.entityId])
      .execute();
    const byId = Object.fromEntries(states.map((r) => [r.id, r]));
    expect(byId[orphan.entityId]).toMatchObject({ state: 'interrupted', failure_kind: 'infra' });
    expect(byId[queued.entityId]).toMatchObject({ state: 'completed' });
    // The interrupted one is retried with the same context pack.
    const r = await executeCommand(s, { command: 'run.retry', actor: ana, projectId, data: { run_id: orphan.entityId } });
    expect(r.state).toBe('queued');
  });
});
