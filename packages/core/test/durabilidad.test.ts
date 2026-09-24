import { type ChildProcess, spawn } from 'node:child_process';
import { humano } from '@demiurgo/domain';
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
});
