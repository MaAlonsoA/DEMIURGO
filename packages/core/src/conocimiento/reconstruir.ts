// Reconstrucción del grafo desde la autoridad con las clasificaciones guardadas (I10,
// AC-CON-001-06). Reproduce las actualizaciones aplicadas en el orden en que se aplicaron (su
// evento `knowledge_update.apply` en el diario), con las mismas funciones puras que la
// actualización incremental; los veredictos salen de la caché por input_hash, sin volver a
// llamar al clasificador. Las rechazadas no tuvieron efectos y no cuentan.

import {
  type Clasificador,
  type Grafo,
  type Plan,
  aplicarPlan,
  grafoVacio,
  huellaGrafo,
  planRetirada,
  planVacio,
  planificar,
} from '@demiurgo/domain';
import type { Bd } from '../db/conexion.ts';
import { type Eje, categoriasAplicables, clasificarCambio, motivosDeVerificacion } from './actualizar.ts';
import { DISPARO_DESCARTE, type ObjetoAutoridad, derivarCambio, derivarRetirada } from './derivar.ts';
import { cargarGrafo } from './grafo-pg.ts';

const sinVeredictoGuardado = (): Promise<never> =>
  Promise.reject(new Error('La reconstrucción no tiene veredictos guardados para una entrada: el grafo ha derivado.'));

/** Clasificador que solo responde desde la caché: si falta algo, la reconstrucción falla. */
const soloCache = (id: string): Clasificador => ({
  id,
  choice: sinVeredictoGuardado,
  score: sinVeredictoGuardado,
  noul: sinVeredictoGuardado,
});

type TaxonomiaGuardada = { id: string; codigo: string; version: number; contenido?: string } | null;

export async function reconstruirGrafo(db: Bd, proyectoId: string): Promise<Grafo> {
  const actualizaciones = await db
    .selectFrom('knowledge_updates as u')
    .innerJoin('events as e', (j) => j.onRef('e.entity_id', '=', 'u.id').on('e.command', '=', 'knowledge_update.apply'))
    .select(['u.id', 'u.trigger', 'u.classifier', 'u.verdicts', 'u.input_hash', 'e.seq'])
    .where('u.project_id', '=', proyectoId)
    .where('e.project_id', '=', proyectoId)
    .where('u.state', '=', 'applied')
    .orderBy('e.seq')
    .execute();
  let g = grafoVacio();
  for (const u of actualizaciones) {
    const disparo = u.trigger as ObjetoAutoridad;
    let plan: Plan;
    if (disparo.tipo === DISPARO_DESCARTE) {
      plan = planRetirada(g, await derivarRetirada(db, disparo));
    } else {
      const cambio = await derivarCambio(db, disparo);
      if (!cambio || !u.classifier) continue;
      const guardado = ((u.verdicts ?? {}) as { taxonomia?: TaxonomiaGuardada }).taxonomia ?? null;
      let taxonomia = null;
      if (guardado) {
        const t = await db
          .selectFrom('taxonomies')
          .select(['axes', 'content_hash'])
          .where('id', '=', guardado.id)
          .executeTakeFirstOrThrow();
        taxonomia = { ...guardado, contenido: t.content_hash, ejes: t.axes as Eje[] };
      }
      const d = await clasificarCambio(db, soloCache(u.classifier), g, cambio, taxonomia);
      if (d.hashVeredictos !== u.input_hash) {
        throw new Error(`La reconstrucción diverge en la actualización ${u.id}: los candidatos no coinciden.`);
      }
      const motivos = motivosDeVerificacion(g, d);
      if (motivos.length > 0) {
        throw new Error(`La reconstrucción diverge en la actualización ${u.id}: ${motivos.join(' ')}`);
      }
      plan = planificar(g, cambio, categoriasAplicables(d.categorias), d.veredictos, g.version + 1);
    }
    if (!planVacio(plan)) g = aplicarPlan(g, plan, g.version + 1);
  }
  return g;
}

export type ComparacionReconstruccion = {
  vivo: string;
  reconstruido: string | null;
  iguales: boolean;
  /** Por qué no coinciden (vacío si coinciden). Nunca lanza: informa de la deriva. */
  deriva: string | null;
};

export async function compararReconstruccion(db: Bd, proyectoId: string): Promise<ComparacionReconstruccion> {
  const vivo = huellaGrafo(await cargarGrafo(db, proyectoId));
  try {
    const reconstruido = huellaGrafo(await reconstruirGrafo(db, proyectoId));
    const iguales = vivo === reconstruido;
    return {
      vivo,
      reconstruido,
      iguales,
      deriva: iguales ? null : 'La huella del grafo reconstruido no coincide con la del grafo vivo.',
    };
  } catch (e) {
    return { vivo, reconstruido: null, iguales: false, deriva: e instanceof Error ? e.message : String(e) };
  }
}
