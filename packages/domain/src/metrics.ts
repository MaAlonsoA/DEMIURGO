// Métricas del conjunto de evaluación del clasificador (§7.9 del plan y §8 de la investigación de
// stack) y formato de sus casos. Todo es puro: recibe casos ya clasificados (o el texto de un JSONL)
// y devuelve números. Quién llama al clasificador y dónde se registran los resultados queda fuera.

import { z } from 'zod';
import { HALLAZGOS_IDEA, VEREDICTOS } from './clasificador.ts';

// ─── Métricas ────────────────────────────────────────────────────────────────────────────────────

export type CasoClasificado<C extends string> = {
  esperado: C;
  obtenido: C;
  /** Confianza que el clasificador da a `obtenido`, en [0, 1]. */
  confianza?: number;
};

export type MetricasClase = {
  /** Casos cuya clase esperada es esta. */
  soporte: number;
  /** Casos en los que el clasificador eligió esta clase. */
  predichos: number;
  /** Casos de esta clase que el clasificador acertó. */
  aciertos: number;
  /** aciertos / predichos; 0 si nadie eligió la clase (ver `sinPredicciones`). */
  precision: number;
  /** Recall: aciertos / soporte; 0 si no hay casos de la clase (ver `sinSoporte`). */
  cobertura: number;
  /** Media armónica de precisión y cobertura; 0 si las dos son 0. */
  f1: number;
  /** Nadie eligió la clase: la precisión vale 0 por convenio, no porque se equivocara. */
  sinPredicciones: boolean;
  /** No hay casos esperados de la clase: la cobertura vale 0 por convenio. */
  sinSoporte: boolean;
};

export type PuntoCurva = {
  umbral: number;
  /** Casos con confianza ≥ umbral: los que la cascada aplicaría sin revisión. */
  casos: number;
  /** Cobertura de la curva: casos / total. */
  proporcion: number;
  aciertos: number;
  /** Exactitud sobre esos casos; null si no queda ninguno. */
  exactitud: number | null;
};

export type ResultadoEvaluacion<C extends string> = {
  total: number;
  aciertos: number;
  exactitud: number;
  porClase: Record<C, MetricasClase>;
  /**
   * Media sin ponderar sobre las clases que aparecen como esperadas u obtenidas. Una clase que
   * ni se espera ni se predice no dice nada del clasificador y se deja fuera.
   */
  macro: { clases: C[]; precision: number; cobertura: number; f1: number };
  /** `matriz[esperado][obtenido]` = número de casos. */
  matriz: Record<C, Record<C, number>>;
  /** Curva cobertura–precisión por umbral de confianza; null si los casos no traen confianza. */
  curva: PuntoCurva[] | null;
};

/** Incluye los umbrales de `UMBRALES_POR_DEFECTO` (0,55 y 0,8) para ver cómo rinde la cascada actual. */
export const UMBRALES_CURVA_POR_DEFECTO: readonly number[] = [0, 0.5, 0.55, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];

function cociente(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function media(valores: readonly number[]): number {
  return cociente(
    valores.reduce((s, v) => s + v, 0),
    valores.length,
  );
}

function esProbabilidad(x: number): boolean {
  return Number.isFinite(x) && x >= 0 && x <= 1;
}

export function evaluarClasificacion<C extends string>(entrada: {
  clases: readonly C[];
  casos: readonly CasoClasificado<C>[];
  /** Umbrales de la curva; se ordenan y se quitan repetidos. Por defecto, `UMBRALES_CURVA_POR_DEFECTO`. */
  umbrales?: readonly number[];
}): ResultadoEvaluacion<C> {
  const { clases, casos } = entrada;
  if (clases.length === 0) throw new Error('Hace falta al menos una clase.');
  if (new Set(clases).size !== clases.length) throw new Error('Las clases no pueden repetirse.');
  if (casos.length === 0) throw new Error('No hay casos que evaluar.');

  const umbrales = [...new Set(entrada.umbrales ?? UMBRALES_CURVA_POR_DEFECTO)].toSorted((a, b) => a - b);
  for (const u of umbrales) {
    if (!esProbabilidad(u)) throw new Error(`El umbral ${u} no está entre 0 y 1.`);
  }

  // Matriz de conteos por posición de clase: cuenta[esperado][obtenido].
  const posicion = new Map<string, number>(clases.map((c, i) => [c, i]));
  const cuenta = clases.map(() => clases.map(() => 0));
  let conConfianza = 0;
  for (const [i, caso] of casos.entries()) {
    const e = posicion.get(caso.esperado);
    const o = posicion.get(caso.obtenido);
    if (e === undefined) throw new Error(`El caso ${i + 1} usa una clase desconocida: «${caso.esperado}».`);
    if (o === undefined) throw new Error(`El caso ${i + 1} usa una clase desconocida: «${caso.obtenido}».`);
    if (caso.confianza !== undefined) {
      if (!esProbabilidad(caso.confianza)) throw new Error(`La confianza del caso ${i + 1} no está entre 0 y 1.`);
      conConfianza += 1;
    }
    const fila = cuenta[e];
    if (fila) fila[o] = (fila[o] ?? 0) + 1;
  }
  if (conConfianza > 0 && conConfianza < casos.length) {
    throw new Error(`Faltan confianzas: ${casos.length - conConfianza} de ${casos.length} casos no la traen.`);
  }

  const celda = (e: number, o: number): number => cuenta[e]?.[o] ?? 0;
  const porClase = {} as Record<C, MetricasClase>;
  const matriz = {} as Record<C, Record<C, number>>;
  let aciertos = 0;
  for (const [e, clase] of clases.entries()) {
    const acertados = celda(e, e);
    const soporte = clases.reduce((s, _, o) => s + celda(e, o), 0);
    const predichos = clases.reduce((s, _, f) => s + celda(f, e), 0);
    const precision = cociente(acertados, predichos);
    const cobertura = cociente(acertados, soporte);
    porClase[clase] = {
      soporte,
      predichos,
      aciertos: acertados,
      precision,
      cobertura,
      f1: cociente(2 * precision * cobertura, precision + cobertura),
      sinPredicciones: predichos === 0,
      sinSoporte: soporte === 0,
    };
    matriz[clase] = Object.fromEntries(clases.map((o, j) => [o, celda(e, j)])) as Record<C, number>;
    aciertos += acertados;
  }

  const presentes = clases.filter((c) => !(porClase[c].sinSoporte && porClase[c].sinPredicciones));
  const macro = {
    clases: presentes,
    precision: media(presentes.map((c) => porClase[c].precision)),
    cobertura: media(presentes.map((c) => porClase[c].cobertura)),
    f1: media(presentes.map((c) => porClase[c].f1)),
  };

  const curva =
    conConfianza === 0
      ? null
      : umbrales.map((umbral): PuntoCurva => {
          const cubiertos = casos.filter((c) => (c.confianza ?? 0) >= umbral);
          const bien = cubiertos.filter((c) => c.esperado === c.obtenido).length;
          return {
            umbral,
            casos: cubiertos.length,
            proporcion: cubiertos.length / casos.length,
            aciertos: bien,
            exactitud: cubiertos.length === 0 ? null : bien / cubiertos.length,
          };
        });

  return { total: casos.length, aciertos, exactitud: aciertos / casos.length, porClase, macro, matriz, curva };
}

// ─── Casos en JSONL ──────────────────────────────────────────────────────────────────────────────

/**
 * Lee un JSONL (un caso por línea; las líneas en blanco se ignoran) y valida cada caso con `esquema`.
 * Si alguna línea falla, lanza un único error con todas las líneas y sus motivos.
 */
export function cargarCasosJsonl<E extends z.ZodType>(texto: string, esquema: E): z.output<E>[] {
  const casos: z.output<E>[] = [];
  const errores: string[] = [];
  for (const [i, linea] of texto.split(/\r?\n/).entries()) {
    if (linea.trim() === '') continue;
    let valor: unknown;
    try {
      valor = JSON.parse(linea);
    } catch (e) {
      errores.push(`línea ${i + 1}: JSON no válido (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    const r = esquema.safeParse(valor);
    if (r.success) casos.push(r.data);
    else {
      for (const p of r.error.issues) {
        errores.push(`línea ${i + 1}: ${p.path.map(String).join('.') || '(raíz)'}: ${p.message}`);
      }
    }
  }
  if (errores.length > 0) throw new Error(`El JSONL no cumple el formato:\n${errores.join('\n')}`);
  return casos;
}

// ─── Formato de los conjuntos de evaluación del clasificador (evals/clasificador/v1) ─────────────

export const PARTICIONES_EVAL = ['desarrollo', 'prueba'] as const;
export type ParticionEval = (typeof PARTICIONES_EVAL)[number];

/** Tipos de artefacto con autoridad que disparan «Actualizar conocimiento». */
export const TIPOS_CAMBIO_EVAL = ['decision', 'fdr', 'adr', 'criterio'] as const;
/** Tipos de nodo del conocimiento que pueden ser candidatos. */
export const TIPOS_NODO_EVAL = ['decision', 'fdr', 'adr', 'criterio', 'idea', 'fuente'] as const;

/** Marcas opcionales de dificultad, para medir por separado los casos difíciles (ablaciones). */
export const ETIQUETAS_CASO_EVAL = [
  'inyeccion',
  'palabras_compartidas',
  'sustitucion_implicita',
  'negacion',
  'sinonimos',
] as const;

/** `CODIGO@version`, por ejemplo `DEC-USU-002@2` o `AC-CUO-002-01@1`. */
const RE_REF = /^[A-Z]+(?:-[A-Z0-9]+)+@[1-9][0-9]*$/;
const textoNoVacio = z.string().regex(/\S/, 'No puede estar vacío.');

function esquemaArtefacto<const T extends readonly [string, ...string[]]>(tipos: T) {
  return z
    .object({
      ref: z.string().regex(RE_REF, 'Debe tener la forma CODIGO@version.'),
      tipo: z.enum(tipos),
      titulo: textoNoVacio,
      texto: textoNoVacio,
    })
    .strict();
}

const comunes = {
  particion: z.enum(PARTICIONES_EVAL),
  nota: textoNoVacio,
  etiquetas: z.array(z.enum(ETIQUETAS_CASO_EVAL)).min(1).optional(),
};

/** Caso de `veredictos.jsonl`: veredicto esperado para el par (cambio, candidato). */
export const esquemaCasoVeredicto = z
  .object({
    id: z.string().regex(/^V[0-9]{3,}$/),
    particion: comunes.particion,
    cambio: esquemaArtefacto(TIPOS_CAMBIO_EVAL),
    candidato: esquemaArtefacto(TIPOS_NODO_EVAL),
    esperado: z.enum(VEREDICTOS),
    nota: comunes.nota,
    etiquetas: comunes.etiquetas,
  })
  .strict();
export type CasoVeredicto = z.infer<typeof esquemaCasoVeredicto>;

/** Caso de `ideas.jsonl`: hallazgo esperado para el par (idea, nodo). */
export const esquemaCasoIdea = z
  .object({
    id: z.string().regex(/^I[0-9]{3,}$/),
    particion: comunes.particion,
    idea: z.object({ texto: textoNoVacio }).strict(),
    nodo: esquemaArtefacto(TIPOS_NODO_EVAL),
    esperado: z.enum(HALLAZGOS_IDEA),
    nota: comunes.nota,
    etiquetas: comunes.etiquetas,
  })
  .strict();
export type CasoIdea = z.infer<typeof esquemaCasoIdea>;
