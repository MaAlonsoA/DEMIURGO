// Clasificador guionizado para las pruebas: delega en el simulado y permite forzar respuestas
// por tarea (veredictos, categorías o ideas) y contar las llamadas.

import type { Clasificador, ItemChoice, RespuestaChoice } from '@demiurgo/domain';
import { crearClasificadorSimulado } from '../../src/clasificador/simulado.ts';

type Tarea = 'veredicto' | 'categoria' | 'idea';
type Guion = (items: readonly ItemChoice[], normal: RespuestaChoice[]) => RespuestaChoice[];

export type ClasificadorGuionizado = Clasificador & {
  guiones: Partial<Record<Tarea, Guion>>;
  llamadas: Record<Tarea | 'otra', number>;
  reiniciar(): void;
};

const tareaDe = (i: ItemChoice): Tarea | 'otra' => {
  const t = (i.estado as { tarea?: string }).tarea;
  return t === 'veredicto' || t === 'categoria' || t === 'idea' ? t : 'otra';
};

export function crearClasificadorGuionizado(): ClasificadorGuionizado {
  const base = crearClasificadorSimulado();
  const c: ClasificadorGuionizado = {
    id: 'guionizado@1',
    guiones: {},
    llamadas: { veredicto: 0, categoria: 0, idea: 0, otra: 0 },
    reiniciar() {
      c.guiones = {};
      c.llamadas = { veredicto: 0, categoria: 0, idea: 0, otra: 0 };
    },
    async choice(items) {
      const tarea = items[0] ? tareaDe(items[0]) : 'otra';
      c.llamadas[tarea] += 1;
      const normales = await base.choice(items);
      const guion = tarea === 'otra' ? undefined : c.guiones[tarea];
      return guion ? guion(items, normales) : normales;
    },
    score: (items) => base.score(items),
    noul: (items) => base.noul(items),
  };
  return c;
}

export const respuesta = (
  id: string,
  eleccion: string,
  confianza: number,
  justificacion = 'guion de prueba',
): RespuestaChoice => ({
  id,
  eleccion,
  distribucion: { [eleccion]: confianza },
  confianza,
  justificacion,
});
