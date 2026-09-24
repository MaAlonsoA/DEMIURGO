// Evaluación del clasificador con el conjunto propio (§7.9, AC-CON-001-11): precisión y
// cobertura por veredicto y por hallazgo, matriz de confusión y curva por umbral. El resultado
// se registra en un archivo y en la tabla classifier_evaluations.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type CasoIdea,
  type CasoVeredicto,
  type Clasificador,
  HALLAZGOS_IDEA,
  type ItemChoice,
  type ResultadoEvaluacion,
  VEREDICTOS,
  cargarCasosJsonl,
  esquemaCasoIdea,
  esquemaCasoVeredicto,
  evaluarClasificacion,
} from '@demiurgo/domain';
import type { Bd } from '../db/conexion.ts';

export type Particion = 'desarrollo' | 'prueba' | 'todas';

export type InformeEvaluacion = {
  clasificador: string;
  fecha: string;
  dataset: string;
  particion: Particion;
  duracionMs: number;
  veredictos: ResultadoEvaluacion<string>;
  ideas: ResultadoEvaluacion<string>;
  respuestas: { id: string; tarea: string; esperado: string; obtenido: string; confianza: number; justificacion: string }[];
  archivo?: string;
};

const PREGUNTA_VEREDICTO =
  'Con este cambio aprobado, ¿qué le pasa al candidato: sigue igual, se relaciona, hay que actualizarlo, queda invalidado, hay que añadirle algo u otra cosa?';
const PREGUNTA_IDEA =
  '¿Qué relación tiene la idea con este conocimiento: la duplica, lo contradice, es incoherente, se relaciona o ninguna?';

function itemsVeredicto(casos: readonly CasoVeredicto[]): ItemChoice[] {
  return casos.map((c) => ({
    id: c.id,
    estado: { tarea: 'veredicto', cambio: c.cambio, candidato: c.candidato },
    pregunta: PREGUNTA_VEREDICTO,
    opciones: VEREDICTOS,
  }));
}

function itemsIdea(casos: readonly CasoIdea[]): ItemChoice[] {
  return casos.map((c) => ({
    id: c.id,
    estado: { tarea: 'idea', idea: c.idea, nodo: c.nodo },
    pregunta: PREGUNTA_IDEA,
    opciones: HALLAZGOS_IDEA,
  }));
}

async function responderPorTandas(clasificador: Clasificador, items: readonly ItemChoice[], tanda: number) {
  const respuestas = [];
  for (let i = 0; i < items.length; i += tanda) respuestas.push(...(await clasificador.choice(items.slice(i, i + tanda))));
  return new Map(respuestas.map((r) => [r.id, r]));
}

export async function evaluarClasificador(opciones: {
  clasificador: Clasificador;
  dir?: string;
  particion?: Particion;
  /** Ítems por llamada al clasificador (la referencia por CLI agrupa cada tanda en una llamada). */
  tanda?: number;
  db?: Bd;
  salida?: string;
}): Promise<InformeEvaluacion> {
  const dir = opciones.dir ?? 'evals/clasificador/v1';
  const particion = opciones.particion ?? 'prueba';
  const filtrar = <T extends { particion: string }>(casos: T[]) =>
    particion === 'todas' ? casos : casos.filter((c) => c.particion === particion);
  const veredictos = filtrar(cargarCasosJsonl(await readFile(join(dir, 'veredictos.jsonl'), 'utf8'), esquemaCasoVeredicto));
  const ideas = filtrar(cargarCasosJsonl(await readFile(join(dir, 'ideas.jsonl'), 'utf8'), esquemaCasoIdea));
  const inicio = Date.now();
  const tanda = opciones.tanda ?? 50;
  const rv = await responderPorTandas(opciones.clasificador, itemsVeredicto(veredictos), tanda);
  const ri = await responderPorTandas(opciones.clasificador, itemsIdea(ideas), tanda);
  const duracionMs = Date.now() - inicio;
  const respuestas: InformeEvaluacion['respuestas'] = [];
  const casos = <C extends string>(
    lista: readonly { id: string; esperado: C }[],
    mapa: Map<string, { eleccion: string; confianza: number; justificacion: string }>,
    tarea: string,
    clases: readonly C[],
  ) =>
    lista.map((c) => {
      const r = mapa.get(c.id);
      // Una respuesta que falta o fuera de las clases cuenta como fallo (se registra como «other»/«none»).
      const obtenido = (r && (clases as readonly string[]).includes(r.eleccion) ? r.eleccion : clases[clases.length - 1]) as C;
      respuestas.push({
        id: c.id,
        tarea,
        esperado: c.esperado,
        obtenido,
        confianza: r?.confianza ?? 0,
        justificacion: r?.justificacion ?? 'sin respuesta',
      });
      return { esperado: c.esperado, obtenido, confianza: r?.confianza ?? 0 };
    });
  const informe: InformeEvaluacion = {
    clasificador: opciones.clasificador.id,
    fecha: new Date().toISOString(),
    dataset: dir,
    particion,
    duracionMs,
    veredictos: evaluarClasificacion({ clases: VEREDICTOS, casos: casos(veredictos, rv, 'veredicto', VEREDICTOS) }),
    ideas: evaluarClasificacion({ clases: HALLAZGOS_IDEA, casos: casos(ideas, ri, 'idea', HALLAZGOS_IDEA) }),
    respuestas,
  };
  if (opciones.salida) {
    await mkdir(opciones.salida, { recursive: true });
    const nombre = `${opciones.clasificador.id.replace(/[^a-z0-9-]+/gi, '_')}-${particion}-${informe.fecha.slice(0, 19).replace(/[:T]/g, '-')}.json`;
    informe.archivo = join(opciones.salida, nombre).split('\\').join('/');
    await writeFile(informe.archivo, `${JSON.stringify(informe, null, 2)}\n`, 'utf8');
  }
  if (opciones.db) {
    for (const [tarea, metricas] of [
      ['veredictos', informe.veredictos],
      ['ideas', informe.ideas],
    ] as const) {
      await opciones.db
        .insertInto('classifier_evaluations')
        .values({
          classifier: informe.clasificador,
          dataset: dir,
          partition: particion,
          task: tarea,
          metrics: JSON.stringify(metricas),
          file: informe.archivo ?? null,
        })
        .execute();
    }
  }
  return informe;
}

function tabla(titulo: string, r: ResultadoEvaluacion<string>): string {
  return [
    `${titulo}: exactitud ${(r.exactitud * 100).toFixed(1)} % (${r.aciertos}/${r.total})`,
    ...Object.entries(r.porClase).map(
      ([c, m]) =>
        `  ${c.padEnd(12)} precisión ${(m.precision * 100).toFixed(0).padStart(3)} %  cobertura ${(m.cobertura * 100).toFixed(0).padStart(3)} %  (${m.aciertos}/${m.soporte})`,
    ),
  ].join('\n');
}

/** Resumen legible: precisión y cobertura por clase. */
export function resumenEvaluacion(i: InformeEvaluacion): string {
  return `${i.clasificador} · ${i.particion} · ${i.duracionMs} ms\n${tabla('Veredictos', i.veredictos)}\n${tabla('Ideas', i.ideas)}`;
}
