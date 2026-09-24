import { OUTPUT_SCHEMAS, type AgentRequest, jsonSchemaOf, human } from '@demiurgo/domain';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCRIPTS, createSimulatedAgent } from '../src/agents/simulated.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { useEnvironment } from './support/env.ts';

// The scripts return an out-of-schema output when the text asks for "invalid". In
// exploration_chat the applier does have effects (messages, questions and batch): this way
// we can see that an invalid output produces none of them.
const receivedSchemas: Record<string, unknown>[] = [];
const environment = useEnvironment({
  durable: true,
  agent: () =>
    createSimulatedAgent({
      scripts: {
        echo: (p) => {
          receivedSchemas.push(p.outputSchema);
          const text = (p.context.content as { input: { text: string } }).input.text;
          return text === 'invalid' ? { reply: 42, extra: true } : { reply: `Echo: ${text}` };
        },
        exploration_chat: (p) => {
          const c = p.context.content as { messages: { text: string }[] };
          if (c.messages.some((m) => m.text.includes('invalid'))) {
            return {
              reply: 'Response',
              observations: [],
              questions: [{ question: '¿?' }],
              inferences: [],
              proposals: [],
              extra: 1,
            };
          }
          return DEFAULT_SCRIPTS.exploration_chat(p);
        },
      },
    }),
});

async function requestEcho(projectId: string, text: string) {
  const r = await executeCommand(environment().services, {
    command: 'run.request',
    actor: human('ana'),
    projectId,
    data: { action: 'echo', scope: { type: 'project' }, input: { text } },
  });
  return { runId: r.entityId, state: await waitForRun(r.entityId) };
}

const chatRequest = (text: string): AgentRequest => ({
  runId: 'r',
  action: 'exploration_chat',
  method: { version: 'exploration_chat@v1', text: 'm' },
  outputSchema: jsonSchemaOf('exploration_chat'),
  context: {
    hash: `h-${text}`,
    content: { purpose: 'Partners', messages: [{ author: 'human:ana', text }], questions: [] },
  },
  budget: { timeMs: 1000 },
});

describe('runs with the durable engine', () => {
  it('AC-ESQ-001-08 an out-of-schema output leaves the run in failed/invalid_output with no effects', async () => {
    const s = environment().services;
    const ana = human('ana');
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Invalid' } });
    const e = await executeCommand(s, { command: 'exploration.open', actor: ana, projectId, data: { purpose: 'Test' } });
    await executeCommand(s, {
      command: 'message.post',
      actor: ana,
      projectId,
      data: { exploration_id: e.entityId, text: 'I want it to be invalid', respond: false },
    });
    const request = await executeCommand(s, {
      command: 'run.request',
      actor: ana,
      projectId,
      data: { action: 'exploration_chat', scope: { type: 'exploration', id: e.entityId } },
    });
    expect(await waitForRun(request.entityId)).toBe('failed');
    const run = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', request.entityId).executeTakeFirstOrThrow();
    expect(run.failure_kind).toBe('invalid_output');
    expect(run.output).toBeNull();
    const commands = await s.db
      .selectFrom('events')
      .select('command')
      .where('project_id', '=', projectId)
      .orderBy('seq')
      .execute();
    expect(commands.map((c) => c.command)).toEqual([
      'project.create',
      'exploration.open',
      'message.post',
      'context_pack.build',
      'run.request',
      'run.begin',
      'run.fail',
    ]);
    const runMessages = await s.db.selectFrom('messages').select('id').where('run_id', '=', request.entityId).execute();
    const questions = await s.db.selectFrom('questions').select('id').where('project_id', '=', projectId).execute();
    const batches = await s.db.selectFrom('proposal_batches').select('id').where('project_id', '=', projectId).execute();
    expect({ messages: runMessages.length, questions: questions.length, batches: batches.length }).toEqual({
      messages: 0,
      questions: 0,
      batches: 0,
    });
  });

  it('AC-ESQ-001-08 the same action with a valid output does produce its effects', async () => {
    const s = environment().services;
    const ana = human('ana');
    const { projectId } = await executeCommand(s, {
      command: 'project.create',
      actor: ana,
      data: { name: 'Valid with effects' },
    });
    const e = await executeCommand(s, { command: 'exploration.open', actor: ana, projectId, data: { purpose: 'Test' } });
    await executeCommand(s, {
      command: 'message.post',
      actor: ana,
      projectId,
      data: { exploration_id: e.entityId, text: 'Quiero cuotas anuales', respond: false },
    });
    const request = await executeCommand(s, {
      command: 'run.request',
      actor: ana,
      projectId,
      data: { action: 'exploration_chat', scope: { type: 'exploration', id: e.entityId } },
    });
    expect(await waitForRun(request.entityId)).toBe('completed');
    const runMessages = await s.db.selectFrom('messages').select('id').where('run_id', '=', request.entityId).execute();
    const batches = await s.db.selectFrom('proposal_batches').select('id').where('run_id', '=', request.entityId).execute();
    expect({ messages: runMessages.length, batches: batches.length }).toEqual({ messages: 2, batches: 1 });
  });

  it('a valid output completes the run and stores the validated output', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, {
      command: 'project.create',
      actor: human('ana'),
      data: { name: 'Valid' },
    });
    const { runId, state } = await requestEcho(projectId, 'hello');
    expect(state).toBe('completed');
    const run = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    expect(run.output).toEqual({ reply: 'Echo: hello' });
    expect(run.provider).toBe('simulated');
  });

  it('AC-ESQ-001-09 the simulator gives the same output for the same action and the same context pack', async () => {
    const agent = createSimulatedAgent();
    const a = await agent.execute(chatRequest('Quiero gestionar las cuotas'));
    const b = await agent.execute(chatRequest('Quiero gestionar las cuotas'));
    const c = await agent.execute(chatRequest('No sé por dónde empezar'));
    expect(a.state).toBe('ok');
    if (a.state !== 'ok' || b.state !== 'ok' || c.state !== 'ok') throw new Error('unexpected');
    expect(b.rawOutput).toEqual(a.rawOutput);
    expect(c.rawOutput).not.toEqual(a.rawOutput);
  });

  it('AC-ESQ-001-09 two runs with the same context pack give the same output', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, {
      command: 'project.create',
      actor: human('ana'),
      data: { name: 'Deterministic' },
    });
    const one = await requestEcho(projectId, 'equal');
    const two = await requestEcho(projectId, 'equal');
    const runs = await s.db
      .selectFrom('ai_runs')
      .select(['output', 'context_pack_id'])
      .where('id', 'in', [one.runId, two.runId])
      .execute();
    expect(runs[0]?.context_pack_id).toBe(runs[1]?.context_pack_id);
    expect(runs[0]?.output).toEqual(runs[1]?.output);
  });

  it('AC-ESQ-001-10 the schema the agent receives is the same one its output is validated against', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, {
      command: 'project.create',
      actor: human('ana'),
      data: { name: 'Schema' },
    });
    receivedSchemas.length = 0;
    await requestEcho(projectId, 'schema');
    expect(receivedSchemas).toHaveLength(1);
    expect(receivedSchemas[0]).toEqual(z.toJSONSchema(OUTPUT_SCHEMAS.echo, { target: 'draft-7' }));
    expect(receivedSchemas[0]).toMatchObject({ type: 'object', required: ['reply'], additionalProperties: false });
  });

  it('AC-STK-001-04 domain, event log, durable engine and graph all live in the same PostgreSQL 18', async () => {
    const { services: s } = environment();
    const { sql } = await import('kysely');
    const version = await sql<{ v: string }>`select current_setting('server_version_num') as v`.execute(s.db);
    expect(Number(version.rows[0]?.v)).toBeGreaterThanOrEqual(180000);
    const schemas = await sql<{ schema: string; table: string }>`
      select table_schema as schema, table_name as "table" from information_schema.tables
      where (table_schema = 'public' and table_name in ('events', 'projects', 'record_versions'))
         or (table_schema = 'public' and table_name in ('knowledge_nodes', 'knowledge_edges'))
        or (table_schema = 'dbos' and table_name = 'workflow_status')`.execute(s.db);
    expect(schemas.rows.map((r) => `${r.schema}.${r.table}`).sort()).toEqual([
      'dbos.workflow_status',
      'public.events',
      'public.knowledge_edges',
      'public.knowledge_nodes',
      'public.projects',
      'public.record_versions',
    ]);
  });
});
