// Pruebas generadas desde las tablas de design/datos/: 403 por la matriz de capacidades,
// 409 por las tablas de transiciones y la propiedad «decisivo solo humano» (I1).

import { randomUUID } from 'node:crypto';
import {
  type Actor,
  NOMBRES_COMANDO,
  NOMBRES_ENTIDAD,
  type NombreComando,
  TIPOS_ACTOR,
  definicionComando,
  definicionEntidad,
  esCreacion,
  esDecisivo,
  humano,
  implementadaEn,
} from '@demiurgo/domain';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { ejecutarComando } from '../../src/bus/bus.ts';
import { usarEntorno } from '../soporte/entorno.ts';
import { ACTOR_DE_TIPO, RECETAS, actorPermitido, incrementoActual, llevarA } from '../soporte/fabrica.ts';
import '../soporte/recetas.ts';

const entorno = usarEntorno();
let proyectoId = '';

beforeAll(async () => {
  const r = await ejecutarComando(entorno().servicios, {
    comando: 'project.create',
    actor: humano('ana'),
    datos: { nombre: 'Tablas' },
  });
  proyectoId = r.proyectoId;
});

async function numeroDeEventos(): Promise<number> {
  const r = await entorno()
    .servicios.db.selectFrom('events')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

const casos403 = NOMBRES_COMANDO.flatMap((comando) => {
  const permitido = definicionComando(comando).permitido;
  const actores: Actor[] = TIPOS_ACTOR.filter((t) => !permitido.includes(t)).map((t) => ACTOR_DE_TIPO[t]);
  actores.push({ tipo: 'unknown' });
  return actores.map((actor) => ({ comando, actor }));
});

describe('AC-ESQ-001-02 403 generado desde la matriz de capacidades', () => {
  it.each(casos403)('AC-ESQ-001-02 $comando con $actor.tipo se rechaza sin efectos', async ({ comando, actor }) => {
    const antes = await numeroDeEventos();
    const p = ejecutarComando(entorno().servicios, { comando, actor, proyectoId, entidadId: randomUUID(), datos: {} });
    await expect(p).rejects.toMatchObject({ tipo: 'prohibido' });
    expect(await numeroDeEventos()).toBe(antes);
  });
});

const incremento = incrementoActual();
const casos409 = NOMBRES_ENTIDAD.filter((e) => implementadaEn(e, incremento)).flatMap((entidad) => {
  const def = definicionEntidad(entidad);
  const comandos = [...new Set(def.transiciones.map((t) => t.comando as NombreComando))].filter((c) => !esCreacion(c));
  return Object.keys(def.estados).flatMap((estado) =>
    comandos
      .filter((c) => !def.transiciones.some((t) => t.comando === c && t.desde !== 'nuevo' && t.desde.includes(estado)))
      .map((comando) => ({ entidad, estado, comando })),
  );
});

describe('AC-ESQ-001-03 409 generado desde las tablas de transiciones', () => {
  it('AC-ESQ-001-03 hay recetas para todas las entidades implementadas', () => {
    const sinReceta = NOMBRES_ENTIDAD.filter((e) => implementadaEn(e, incremento) && !RECETAS[e]);
    expect(sinReceta).toEqual([]);
    expect(casos409.length).toBeGreaterThan(0);
  });

  it.each(casos409)(
    'AC-ESQ-001-03 $comando sobre $entidad en «$estado» se rechaza sin efectos',
    async ({ entidad, estado, comando }) => {
      const s = entorno().servicios;
      const id = await llevarA(s, proyectoId, entidad, estado);
      const pid = entidad === 'project' ? id : proyectoId;
      const antes = await numeroDeEventos();
      const receta = RECETAS[entidad];
      const datos = (await receta?.datos?.[comando]?.({ s, proyectoId: pid, entidadId: id })) ?? {};
      const p = ejecutarComando(s, { comando, actor: actorPermitido(comando), proyectoId: pid, entidadId: id, datos });
      await expect(p).rejects.toMatchObject({ tipo: 'transicion_invalida' });
      expect(await numeroDeEventos()).toBe(antes);
    },
  );
});

describe('AC-DIS-001-04 propiedad: todo comando decisivo con actor no humano se rechaza sin efectos', () => {
  const decisivos = NOMBRES_COMANDO.filter(esDecisivo);
  const noHumanos: Actor[] = [ACTOR_DE_TIPO.agent_external, ACTOR_DE_TIPO.agent_run, ACTOR_DE_TIPO.system, { tipo: 'unknown' }];

  it('AC-DIS-001-04 hay comandos decisivos y todos alcanzan un estado de autoridad', () => {
    expect(decisivos.length).toBeGreaterThanOrEqual(8);
  });

  it('AC-DIS-001-04 para cualquier comando decisivo, actor no humano y datos arbitrarios', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...decisivos),
        fc.constantFrom(...noHumanos),
        fc.anything(),
        fc.uuid(),
        async (comando, actor, datos, entidadId) => {
          const antes = await numeroDeEventos();
          const p = ejecutarComando(entorno().servicios, { comando, actor, proyectoId, entidadId, datos });
          await expect(p).rejects.toMatchObject({ tipo: 'prohibido' });
          expect(await numeroDeEventos()).toBe(antes);
        },
      ),
      { numRuns: 200 },
    );
  });
});
