import { ESQUEMAS_SALIDA, type PeticionAgente, esquemaJsonDe, humano } from '@demiurgo/domain';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { crearAgenteSimulado } from '../src/agentes/simulado.ts';
import { ejecutarComando } from '../src/bus/bus.ts';
import { esperarRun } from '../src/motor/motor.ts';
import { usarEntorno } from './soporte/entorno.ts';

// El guion de «eco» devuelve una salida fuera de esquema cuando el texto pide «invalida».
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
    const { proyectoId } = await ejecutarComando(s, {
      comando: 'project.create',
      actor: humano('ana'),
      datos: { nombre: 'Inválida' },
    });
    const { runId, estado } = await pedirEco(proyectoId, 'invalida');
    expect(estado).toBe('failed');
    const run = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    expect(run.failure_kind).toBe('invalid_output');
    expect(run.output).toBeNull();
    expect(run.error).toMatch(/reply/);
    const comandos = await s.db
      .selectFrom('events')
      .select('command')
      .where('project_id', '=', proyectoId)
      .orderBy('seq')
      .execute();
    expect(comandos.map((c) => c.command)).toEqual([
      'project.create',
      'context_pack.build',
      'run.request',
      'run.begin',
      'run.fail',
    ]);
    for (const tabla of ['messages', 'questions', 'proposal_batches', 'proposals'] as const) {
      const filas = await s.db.selectFrom(tabla).select('id').where('project_id', '=', proyectoId).execute();
      expect({ tabla, n: filas.length }).toEqual({ tabla, n: 0 });
    }
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

  it('AC-STK-001-04 dominio, diario y motor durable viven en el mismo PostgreSQL 18', async () => {
    const { servicios: s } = entorno();
    const { sql } = await import('kysely');
    const version = await sql<{ v: string }>`select current_setting('server_version_num') as v`.execute(s.db);
    expect(Number(version.rows[0]?.v)).toBeGreaterThanOrEqual(180000);
    const esquemas = await sql<{ esquema: string; tabla: string }>`
      select table_schema as esquema, table_name as tabla from information_schema.tables
      where (table_schema = 'public' and table_name in ('events', 'projects', 'record_versions'))
         or (table_schema = 'dbos' and table_name = 'workflow_status')`.execute(s.db);
    expect(esquemas.rows.map((r) => `${r.esquema}.${r.tabla}`).sort()).toEqual([
      'dbos.workflow_status',
      'public.events',
      'public.projects',
      'public.record_versions',
    ]);
  });
});
