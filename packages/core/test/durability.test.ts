import { type ChildProcess, spawn } from 'node:child_process';
import { humano, sistema } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { ejecutarComando } from '../src/bus/bus.ts';
import { usarEntorno } from './soporte/entorno.ts';

const entorno = usarEntorno();
const SCRIPT = 'packages/core/test/soporte/proceso-motor.ts';

function lanzar(args: string[]): {
  hijo: ChildProcess;
  salida: () => string;
  espera: (marca: string, ms: number) => Promise<void>;
} {
  const hijo = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = '';
  hijo.stdout?.on('data', (d: Buffer) => {
    salida += d.toString();
  });
  hijo.stderr?.on('data', (d: Buffer) => {
    salida += d.toString();
  });
  return {
    hijo,
    salida: () => salida,
    espera: (marca, ms) =>
      new Promise((resolver, rechazar) => {
        const t0 = Date.now();
        const tic = setInterval(() => {
          if (salida.includes(marca)) {
            clearInterval(tic);
            resolver();
          } else if (Date.now() - t0 > ms || hijo.exitCode !== null) {
            clearInterval(tic);
            rechazar(new Error(`No apareció «${marca}». Salida:\n${salida}`));
          }
        }, 50);
      }),
  };
}

const salidaDelHijo = (h: ChildProcess) => new Promise<void>((r) => (h.exitCode !== null ? r() : h.once('exit', () => r())));

describe('motor durable', () => {
  it('AC-ESQ-001-07 al matar el proceso con una ejecución en curso se reanuda y su efecto ocurre una sola vez', async () => {
    const { servicios: s, url } = entorno();
    const { proyectoId } = await ejecutarComando(s, {
      comando: 'project.create',
      actor: humano('ana'),
      datos: { nombre: 'Durable' },
    });
    const run = await ejecutarComando(s, {
      comando: 'run.request',
      actor: humano('ana'),
      proyectoId,
      datos: { accion: 'eco', alcance: { tipo: 'proyecto' }, entrada: { texto: 'sobrevive' } },
    });

    const primero = lanzar([url, 'iniciar', proyectoId, run.entidadId]);
    await primero.espera('INVOCANDO', 60_000);
    primero.hijo.kill('SIGKILL');
    await salidaDelHijo(primero.hijo);
    const aMedias = await s.db.selectFrom('ai_runs').select('state').where('id', '=', run.entidadId).executeTakeFirstOrThrow();
    expect(aMedias.state).toBe('running');

    const segundo = lanzar([url, 'recuperar', run.entidadId]);
    await segundo.espera('RESULTADO', 90_000);
    await salidaDelHijo(segundo.hijo);
    expect(segundo.salida()).toContain('INVOCANDO_DE_NUEVO');
    expect(segundo.salida()).toContain('RESULTADO completed');

    const final = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', run.entidadId).executeTakeFirstOrThrow();
    expect(final.state).toBe('completed');
    expect(final.output).toEqual({ reply: 'Eco: sobrevive' });
    const porComando = await s.db
      .selectFrom('events')
      .select(['command', (eb) => eb.fn.countAll<string>().as('n')])
      .where('entity_id', '=', run.entidadId)
      .groupBy('command')
      .execute();
    const cuenta = Object.fromEntries(porComando.map((r) => [r.command, Number(r.n)]));
    expect(cuenta).toEqual({ 'run.request': 1, 'run.begin': 1, 'run.complete': 1 });
    const logs = await s.db.selectFrom('ai_run_logs').select('id').where('run_id', '=', run.entidadId).execute();
    expect(logs).toHaveLength(1);
  });

  it('AC-ESQ-001-07 un corte justo después de confirmar «aplicar» no repite su efecto al reanudar', async () => {
    const { servicios: s, url } = entorno();
    const ana = humano('ana');
    const { proyectoId } = await ejecutarComando(s, {
      comando: 'project.create',
      actor: ana,
      datos: { nombre: 'Corte tras aplicar' },
    });
    const e = await ejecutarComando(s, { comando: 'exploration.open', actor: ana, proyectoId, datos: { proposito: 'Cuotas' } });
    await ejecutarComando(s, {
      comando: 'message.post',
      actor: ana,
      proyectoId,
      datos: { exploracion_id: e.entidadId, texto: 'Quiero cuotas anuales', responder: false },
    });
    const run = await ejecutarComando(s, {
      comando: 'run.request',
      actor: ana,
      proyectoId,
      datos: { accion: 'exploration_chat', alcance: { tipo: 'exploration', id: e.entidadId } },
    });
    const primero = lanzar([url, 'cortar-tras-aplicar', proyectoId, run.entidadId]);
    await primero.espera('APLICADO', 60_000);
    await salidaDelHijo(primero.hijo);
    const tras = await s.db.selectFrom('ai_runs').select('state').where('id', '=', run.entidadId).executeTakeFirstOrThrow();
    expect(tras.state).toBe('completed');

    const segundo = lanzar([url, 'recuperar', run.entidadId]);
    await segundo.espera('RESULTADO', 90_000);
    await salidaDelHijo(segundo.hijo);
    expect(segundo.salida()).toContain('RESULTADO completed');
    // El agente no se vuelve a invocar y los efectos (mensajes y lote) existen una sola vez.
    expect(segundo.salida()).not.toContain('INVOCANDO_DE_NUEVO');
    const mensajes = await s.db.selectFrom('messages').select('id').where('run_id', '=', run.entidadId).execute();
    const lotes = await s.db.selectFrom('proposal_batches').select('id').where('run_id', '=', run.entidadId).execute();
    const completados = await s.db
      .selectFrom('events')
      .select('id')
      .where('entity_id', '=', run.entidadId)
      .where('command', '=', 'run.complete')
      .execute();
    expect({ mensajes: mensajes.length, lotes: lotes.length, completados: completados.length }).toEqual({
      mensajes: 2,
      lotes: 1,
      completados: 1,
    });
  });

  it('AC-ESQ-001-07 al arrancar, una ejecución en curso sin flujo recuperable queda interrumpida y una encolada se ejecuta', async () => {
    const { servicios: s, url } = entorno();
    const ana = humano('ana');
    const { proyectoId } = await ejecutarComando(s, { comando: 'project.create', actor: ana, datos: { nombre: 'Conciliar' } });
    const pedir = (texto: string) =>
      ejecutarComando(s, {
        comando: 'run.request',
        actor: ana,
        proyectoId,
        datos: { accion: 'eco', alcance: { tipo: 'proyecto' }, entrada: { texto } },
      });
    // Una ejecución quedó «en curso» sin flujo (p. ej. un corte con otra versión del código).
    const huerfana = await pedir('huérfana');
    await ejecutarComando(s, {
      comando: 'run.begin',
      actor: sistema('motor'),
      proyectoId,
      entidadId: huerfana.entidadId,
      datos: {},
    });
    // Y otra quedó en cola sin que nadie arrancara su flujo.
    const encolada = await pedir('encolada');
    const hijo = lanzar([url, 'conciliar']);
    await hijo.espera('CONCILIADO', 90_000);
    await salidaDelHijo(hijo.hijo);
    const estados = await s.db
      .selectFrom('ai_runs')
      .select(['id', 'state', 'failure_kind'])
      .where('id', 'in', [huerfana.entidadId, encolada.entidadId])
      .execute();
    const porId = Object.fromEntries(estados.map((r) => [r.id, r]));
    expect(porId[huerfana.entidadId]).toMatchObject({ state: 'interrupted', failure_kind: 'infra' });
    expect(porId[encolada.entidadId]).toMatchObject({ state: 'completed' });
    // La interrumpida se reintenta con el mismo context pack.
    const r = await ejecutarComando(s, { comando: 'run.retry', actor: ana, proyectoId, datos: { run_id: huerfana.entidadId } });
    expect(r.estado).toBe('queued');
  });
});
