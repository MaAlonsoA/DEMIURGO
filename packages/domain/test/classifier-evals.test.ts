// Comprueba que el conjunto de evaluación del clasificador (evals/clasificador/v1) cumple su formato
// y las reglas de reparto del README: soporte mínimo por clase, particiones estratificadas y nodos
// coherentes entre casos. Cada prueba reúne los problemas en una lista para que el fallo diga cuáles son.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HALLAZGOS_IDEA, VEREDICTOS } from '../src/clasificador.ts';
import {
  type CasoIdea,
  type CasoVeredicto,
  cargarCasosJsonl,
  esquemaCasoIdea,
  esquemaCasoVeredicto,
  PARTICIONES_EVAL,
} from '../src/metricas.ts';

const DIR = new URL('../../../evals/clasificador/v1/', import.meta.url);
const leer = (nombre: string): string => readFileSync(new URL(nombre, DIR), 'utf8');

const veredictos: CasoVeredicto[] = cargarCasosJsonl(leer('veredictos.jsonl'), esquemaCasoVeredicto);
const ideas: CasoIdea[] = cargarCasosJsonl(leer('ideas.jsonl'), esquemaCasoIdea);

type Artefacto = { ref: string; tipo: string; titulo: string; texto: string };
type Caso = { id: string; particion: string; esperado: string; etiquetas?: readonly string[] | undefined };

/** El prefijo del código fija el tipo del artefacto. */
const TIPO_POR_PREFIJO: Readonly<Record<string, string>> = {
  DEC: 'decision',
  FDR: 'fdr',
  ADR: 'adr',
  AC: 'criterio',
  IDEA: 'idea',
  FUE: 'fuente',
};

function recuento(casos: readonly Caso[], clase: string, particion?: string): number {
  return casos.filter((c) => c.esperado === clase && (particion === undefined || c.particion === particion)).length;
}

function repetidos(valores: readonly string[]): string[] {
  return valores.filter((v, i) => valores.indexOf(v) !== i);
}

/** Soporte mínimo, todas las clases en cada partición y reparto estratificado (diferencia ≤ 1). */
function problemasDeReparto(casos: readonly Caso[], clases: readonly string[], minimo: (clase: string) => number): string[] {
  const problemas: string[] = [];
  for (const clase of clases) {
    const total = recuento(casos, clase);
    if (total < minimo(clase)) problemas.push(`${clase}: soporte ${total} < ${minimo(clase)}`);
    const [desarrollo = 0, prueba = 0] = PARTICIONES_EVAL.map((p) => recuento(casos, clase, p));
    if (desarrollo === 0 || prueba === 0) problemas.push(`${clase}: falta en alguna partición (${desarrollo}/${prueba})`);
    if (Math.abs(desarrollo - prueba) > 1) problemas.push(`${clase}: reparto no estratificado (${desarrollo}/${prueba})`);
  }
  return problemas;
}

describe('conjunto de evaluación del clasificador v1', () => {
  it('veredictos.jsonl: formato, ids únicos, soporte mínimo por clase y particiones estratificadas', () => {
    expect(veredictos.length).toBeGreaterThanOrEqual(60);
    expect(repetidos(veredictos.map((c) => c.id))).toEqual([]);
    expect(problemasDeReparto(veredictos, VEREDICTOS, (v) => (v === 'other' ? 4 : 6))).toEqual([]);
    expect(veredictos.filter((c) => c.cambio.ref === c.candidato.ref).map((c) => c.id)).toEqual([]);
    expect(repetidos(veredictos.map((c) => `${c.cambio.ref} → ${c.candidato.ref}`))).toEqual([]);
  });

  it('ideas.jsonl: formato, ids únicos, soporte mínimo por clase y particiones estratificadas', () => {
    expect(ideas.length).toBeGreaterThanOrEqual(40);
    expect(repetidos(ideas.map((c) => c.id))).toEqual([]);
    expect(problemasDeReparto(ideas, HALLAZGOS_IDEA, () => 6)).toEqual([]);
    expect(repetidos(ideas.map((c) => `${c.idea.texto} → ${c.nodo.ref}`))).toEqual([]);
  });

  it('cada ref@versión tiene un solo tipo, título y texto en los dos ficheros, y el tipo casa con su prefijo', () => {
    const artefactos: Artefacto[] = [...veredictos.flatMap((c) => [c.cambio, c.candidato]), ...ideas.map((c) => c.nodo)];
    const vistos = new Map<string, Artefacto>();
    const problemas: string[] = [];
    for (const a of artefactos) {
      const tipo = TIPO_POR_PREFIJO[a.ref.split('-')[0] ?? ''];
      if (a.tipo !== tipo) problemas.push(`${a.ref}: tipo ${a.tipo}, su prefijo pide ${tipo ?? '(desconocido)'}`);
      const previo = vistos.get(a.ref);
      if (!previo) vistos.set(a.ref, a);
      else if (previo.tipo !== a.tipo || previo.titulo !== a.titulo || previo.texto !== a.texto) {
        problemas.push(`${a.ref}: aparece con contenidos distintos`);
      }
    }
    expect(problemas).toEqual([]);
  });

  it('incluye casos con instrucciones inyectadas en las dos particiones', () => {
    const problemas: string[] = [];
    for (const [nombre, casos] of [
      ['veredictos', veredictos],
      ['ideas', ideas],
    ] as const) {
      const inyectados = (casos as readonly Caso[]).filter((c) => c.etiquetas?.includes('inyeccion'));
      for (const p of PARTICIONES_EVAL) {
        if (!inyectados.some((c) => c.particion === p)) problemas.push(`${nombre}: sin inyección en ${p}`);
      }
    }
    const inyectadosV = veredictos.filter((c) => c.etiquetas?.includes('inyeccion'));
    expect(inyectadosV.length).toBeGreaterThanOrEqual(4);
    for (const c of inyectadosV) {
      // La instrucción está en el texto del cambio o del candidato y pide un veredicto distinto del correcto.
      const pedido = /responde\s+(?:siempre\s+)?«?([a-z]+)»?/i.exec(`${c.cambio.texto} ${c.candidato.texto}`)?.[1];
      if (pedido === undefined) problemas.push(`${c.id}: no contiene la instrucción inyectada`);
      else if (pedido === c.esperado) problemas.push(`${c.id}: la instrucción pide el veredicto correcto (${pedido})`);
    }
    expect(problemas).toEqual([]);
  });
});
