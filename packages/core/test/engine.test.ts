import { ESQUEMAS_SALIDA, type PeticionAgente, esquemaJsonDe, humano } from '@demiurgo/domain';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { GUIONES_POR_DEFECTO, crearAgenteSimulado } from '../src/agentes/simulado.ts';
import { ejecutarComando } from '../src/bus/bus.ts';
import { esperarRun } from '../src/motor/motor.ts';
import { usarEntorno } from './soporte/entorno.ts';

// Los guiones devuelven una salida fuera de esquema cuando el texto pide «invalida». En
// exploration_chat el aplicador sí tiene efectos (mensajes, preguntas y lote): así se ve que
// una salida inválida no produce ninguno.
const esquemasRecibidos: Record<string, unknown>[] = [];
const entorno = usarEntorno({
  durable: true,
  agente: () =>
    crearAgenteSimulado({
      guiones: {
        eco: (p) => {
          esquemasRecibidos.push(p.esquemaSalida);
          const texto = (p.contexto.contenido as { entrada: { texto: string } }).entrada.texto;
          return texto === 'invalida' ? { reply: 42, extra: true } : { reply: `Eco: ${texto}` };
        },
        exploration_chat: (p) => {
          const c = p.contexto.contenido as { mensajes: { texto: string }[] };
          if (c.mensajes.some((m) => m.texto.includes('invalida'))) {
            return {
              reply: 'Respuesta',
              observaciones: [],
              preguntas: [{ pregunta: '¿?' }],
              inferencias: [],
              propuestas: [],
              sobra: 1,
            };
          }
          return GUIONES_POR_DEFECTO.exploration_chat(p);
        },
      },
    }),
});

async function pedirEco(proyectoId: string, texto: string) {
  const r = await ejecutarComando(entorno().servicios, {
    comando: 'run.request',
    actor: humano('ana'),
    proyectoId,
    datos: { accion: 'eco', alcance: { tipo: 'proyecto' }, entrada: { texto } },
  });
  return { runId: r.entidadId, estado: await esperarRun(r.entidadId) };
}

const peticionChat = (texto: string): PeticionAgente => ({
  runId: 'r',
  accion: 'exploration_chat',
  metodo: { version: 'exploration_chat@v1', texto: 'm' },
  esquemaSalida: esquemaJsonDe('exploration_chat'),
  contexto: {
    hash: `h-${texto}`,
    contenido: { proposito: 'Socios', mensajes: [{ autor: 'human:ana', texto }], preguntas: [] },
  },
  presupuesto: { tiempoMs: 1000 },
});

describe('ejecuciones con el motor durable', () => {
  it('AC-ESQ-001-08 una salida fuera de esquema deja la ejecución en failed/invalid_output sin efectos', async () => {
    const s = entorno().servicios;
    const ana = humano('ana');
    const { proyectoId } = await ejecutarComando(s, { comando: 'project.create', actor: ana, datos: { nombre: 'Inválida' } });
    const e = await ejecutarComando(s, { comando: 'exploration.open', actor: ana, proyectoId, datos: { proposito: 'Probar' } });
    await ejecutarComando(s, {
      comando: 'message.post',
      actor: ana,
      proyectoId,
      datos: { exploracion_id: e.entidadId, texto: 'Quiero que sea invalida', responder: false },
    });
    const pedido = await ejecutarComando(s, {
      comando: 'run.request',
      actor: ana,
      proyectoId,
      datos: { accion: 'exploration_chat', alcance: { tipo: 'exploration', id: e.entidadId } },
    });
    expect(await esperarRun(pedido.entidadId)).toBe('failed');
    const run = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', pedido.entidadId).executeTakeFirstOrThrow();
    expect(run.failure_kind).toBe('invalid_output');
    expect(run.output).toBeNull();
    const comandos = await s.db
      .selectFrom('events')
      .select('command')
      .where('project_id', '=', proyectoId)
      .orderBy('seq')
      .execute();
    expect(comandos.map((c) => c.command)).toEqual([
      'project.create',
      'exploration.open',
      'message.post',
      'context_pack.build',
      'run.request',
      'run.begin',
      'run.fail',
    ]);
    const mensajesDelRun = await s.db.selectFrom('messages').select('id').where('run_id', '=', pedido.entidadId).execute();
    const preguntas = await s.db.selectFrom('questions').select('id').where('project_id', '=', proyectoId).execute();
    const lotes = await s.db.selectFrom('proposal_batches').select('id').where('project_id', '=', proyectoId).execute();
    expect({ mensajes: mensajesDelRun.length, preguntas: preguntas.length, lotes: lotes.length }).toEqual({
      mensajes: 0,
      preguntas: 0,
      lotes: 0,
    });
  });

  it('AC-ESQ-001-08 la misma acción con salida válida sí produce sus efectos', async () => {
    const s = entorno().servicios;
    const ana = humano('ana');
    const { proyectoId } = await ejecutarComando(s, {
      comando: 'project.create',
      actor: ana,
      datos: { nombre: 'Válida con efectos' },
    });
    const e = await ejecutarComando(s, { comando: 'exploration.open', actor: ana, proyectoId, datos: { proposito: 'Probar' } });
    await ejecutarComando(s, {
      comando: 'message.post',
      actor: ana,
      proyectoId,
      datos: { exploracion_id: e.entidadId, texto: 'Quiero cuotas anuales', responder: false },
    });
    const pedido = await ejecutarComando(s, {
      comando: 'run.request',
      actor: ana,
      proyectoId,
      datos: { accion: 'exploration_chat', alcance: { tipo: 'exploration', id: e.entidadId } },
    });
    expect(await esperarRun(pedido.entidadId)).toBe('completed');
    const mensajesDelRun = await s.db.selectFrom('messages').select('id').where('run_id', '=', pedido.entidadId).execute();
    const lotes = await s.db.selectFrom('proposal_batches').select('id').where('run_id', '=', pedido.entidadId).execute();
    expect({ mensajes: mensajesDelRun.length, lotes: lotes.length }).toEqual({ mensajes: 2, lotes: 1 });
  });

  it('una salida válida completa la ejecución y guarda la salida validada', async () => {
    const s = entorno().servicios;
    const { proyectoId } = await ejecutarComando(s, {
      comando: 'project.create',
      actor: humano('ana'),
      datos: { nombre: 'Válida' },
    });
    const { runId, estado } = await pedirEco(proyectoId, 'hola');
    expect(estado).toBe('completed');
    const run = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    expect(run.output).toEqual({ reply: 'Eco: hola' });
    expect(run.provider).toBe('simulado');
  });

  it('AC-ESQ-001-09 el simulador da la misma salida para la misma acción y el mismo context pack', async () => {
    const agente = crearAgenteSimulado();
    const a = await agente.ejecutar(peticionChat('Quiero gestionar las cuotas'));
    const b = await agente.ejecutar(peticionChat('Quiero gestionar las cuotas'));
    const c = await agente.ejecutar(peticionChat('No sé por dónde empezar'));
    expect(a.estado).toBe('ok');
    if (a.estado !== 'ok' || b.estado !== 'ok' || c.estado !== 'ok') throw new Error('inesperado');
    expect(b.salidaCruda).toEqual(a.salidaCruda);
    expect(c.salidaCruda).not.toEqual(a.salidaCruda);
  });

  it('AC-ESQ-001-09 dos ejecuciones con el mismo context pack dan la misma salida', async () => {
    const s = entorno().servicios;
    const { proyectoId } = await ejecutarComando(s, {
      comando: 'project.create',
      actor: humano('ana'),
      datos: { nombre: 'Determinista' },
    });
    const uno = await pedirEco(proyectoId, 'igual');
    const dos = await pedirEco(proyectoId, 'igual');
    const runs = await s.db
      .selectFrom('ai_runs')
      .select(['output', 'context_pack_id'])
      .where('id', 'in', [uno.runId, dos.runId])
      .execute();
    expect(runs[0]?.context_pack_id).toBe(runs[1]?.context_pack_id);
    expect(runs[0]?.output).toEqual(runs[1]?.output);
  });

  it('AC-ESQ-001-10 el esquema que recibe el agente es el mismo con el que se valida su salida', async () => {
    const s = entorno().servicios;
    const { proyectoId } = await ejecutarComando(s, {
      comando: 'project.create',
      actor: humano('ana'),
      datos: { nombre: 'Esquema' },
    });
    esquemasRecibidos.length = 0;
    await pedirEco(proyectoId, 'esquema');
    expect(esquemasRecibidos).toHaveLength(1);
    expect(esquemasRecibidos[0]).toEqual(z.toJSONSchema(ESQUEMAS_SALIDA.eco, { target: 'draft-7' }));
    expect(esquemasRecibidos[0]).toMatchObject({ type: 'object', required: ['reply'], additionalProperties: false });
  });

  it('AC-STK-001-04 dominio, diario, motor durable y grafo viven en el mismo PostgreSQL 18', async () => {
    const { servicios: s } = entorno();
    const { sql } = await import('kysely');
    const version = await sql<{ v: string }>`select current_setting('server_version_num') as v`.execute(s.db);
    expect(Number(version.rows[0]?.v)).toBeGreaterThanOrEqual(180000);
    const esquemas = await sql<{ esquema: string; tabla: string }>`
      select table_schema as esquema, table_name as tabla from information_schema.tables
      where (table_schema = 'public' and table_name in ('events', 'projects', 'record_versions'))
         or (table_schema = 'public' and table_name in ('knowledge_nodes', 'knowledge_edges'))
        or (table_schema = 'dbos' and table_name = 'workflow_status')`.execute(s.db);
    expect(esquemas.rows.map((r) => `${r.esquema}.${r.tabla}`).sort()).toEqual([
      'dbos.workflow_status',
      'public.events',
      'public.knowledge_edges',
      'public.knowledge_nodes',
      'public.projects',
      'public.record_versions',
    ]);
  });
});
