import { OUTPUT_SCHEMAS, type AgentRequest, jsonSchemaOf, human } from '@demiurgo/domain';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCRIPTS, createSimulatedAgent } from '../src/agents/simulated.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { useEnvironment } from './support/env.ts';

// Los guiones devuelven una salida fuera de esquema cuando el texto pide «invalida». En
// exploration_chat el aplicador sí tiene efectos (mensajes, preguntas y lote): así se ve que
// una salida inválida no produce ninguno.
const receivedSchemas: Record<string, unknown>[] = [];
const environment = useEnvironment({
  durable: true,
  agent: () =>
    createSimulatedAgent({
      scripts: {
        echo: (p) => {
          receivedSchemas.push(p.outputSchema);
          const text = (p.context.content as { input: { text: string } }).input.text;
          return text === 'invalid' ? { reply: 42, extra: true } : { reply: `Eco: ${text}` };
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
    content: { purpose: 'Socios', messages: [{ author: 'human:ana', text }], questions: [] },
  },
  budget: { timeMs: 1000 },
});

describe('ejecuciones con el motor durable', () => {
  it('AC-ESQ-001-08 una salida fuera de esquema deja la ejecución en failed/invalid_output sin efectos', async () => {
    const s = environment().services;
    const ana = human('ana');
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Inválida' } });
    const e = await executeCommand(s, { command: 'exploration.open', actor: ana, projectId, data: { purpose: 'Test' } });
    await executeCommand(s, {
      command: 'message.post',
      actor: ana,
      projectId,
      data: { exploration_id: e.entityId, text: 'Quiero que sea invalida', respond: false },
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

  it('AC-ESQ-001-08 la misma acción con salida válida sí produce sus efectos', async () => {
    const s = environment().services;
    const ana = human('ana');
    const { projectId } = await executeCommand(s, {
      command: 'project.create',
      actor: ana,
      data: { name: 'Válida con efectos' },
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

  it('una salida válida completa la ejecución y guarda la salida validada', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, {
      command: 'project.create',
      actor: human('ana'),
      data: { name: 'Válida' },
    });
    const { runId, state } = await requestEcho(projectId, 'hello');
    expect(state).toBe('completed');
    const run = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    expect(run.output).toEqual({ reply: 'Eco: hola' });
    expect(run.provider).toBe('simulated');
  });

  it('AC-ESQ-001-09 el simulador da la misma salida para la misma acción y el mismo context pack', async () => {
    const agent = createSimulatedAgent();
    const a = await agent.execute(chatRequest('Quiero gestionar las cuotas'));
    const b = await agent.execute(chatRequest('Quiero gestionar las cuotas'));
    const c = await agent.execute(chatRequest('No sé por dónde empezar'));
    expect(a.state).toBe('ok');
    if (a.state !== 'ok' || b.state !== 'ok' || c.state !== 'ok') throw new Error('unexpected');
    expect(b.rawOutput).toEqual(a.rawOutput);
    expect(c.rawOutput).not.toEqual(a.rawOutput);
  });

  it('AC-ESQ-001-09 dos ejecuciones con el mismo context pack dan la misma salida', async () => {
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

  it('AC-ESQ-001-10 el esquema que recibe el agente es el mismo con el que se valida su salida', async () => {
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

  it('AC-STK-001-04 dominio, diario, motor durable y grafo viven en el mismo PostgreSQL 18', async () => {
    const { services: s } = environment();
    const { sql } = await import('kysely');
    const version = await sql<{ v: string }>`select current_setting('server_version_num') as v`.execute(s.db);
    expect(Number(version.rows[0]?.v)).toBeGreaterThanOrEqual(180000);
    const schemas = await sql<{ schema: string; table: string }>`
      select table_schema as esquema, table_name as tabla from information_schema.tables
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
