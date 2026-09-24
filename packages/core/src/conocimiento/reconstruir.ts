// Reconstrucción del grafo desde la autoridad con las clasificaciones guardadas (I10,
// AC-CON-001-06). Reproduce, en el mismo orden, las actualizaciones procesadas con las mismas
// funciones puras que la actualización incremental; los veredictos salen de la caché por
// input_hash, sin volver a llamar al clasificador.

import {
  type Clasificador,
  type Grafo,
  aplicarPlan,
  grafoVacio,
  huellaGrafo,
  planVacio,
  planificar,
  verificarVeredictos,
} from '@demiurgo/domain';
import type { Bd } from '../db/conexion.ts';
import { type Eje, categoriasAplicables, clasificarCambio } from './actualizar.ts';
import { type ObjetoAutoridad, derivarCambio } from './derivar.ts';
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

export async function reconstruirGrafo(db: Bd, proyectoId: string): Promise<Grafo> {
  const actualizaciones = await db
    .selectFrom('knowledge_updates')
    .select(['id', 'trigger', 'state', 'classifier', 'verdicts', 'input_hash'])
    .where('project_id', '=', proyectoId)
    .where('state', 'in', ['applied', 'rejected'])
    .orderBy('trigger_seq')
    .orderBy('id')
    .execute();
  let g = grafoVacio();
  for (const u of actualizaciones) {
    const cambio = await derivarCambio(db, u.trigger as ObjetoAutoridad);
    if (!cambio || !u.classifier) continue;
    const guardado = (u.verdicts ?? {}) as { taxonomia?: { id: string; codigo: string; version: number } | null };
    let taxonomia = null;
    if (guardado.taxonomia) {
      const t = await db
        .selectFrom('taxonomies')
        .select(['axes'])
        .where('id', '=', guardado.taxonomia.id)
        .executeTakeFirstOrThrow();
      taxonomia = { ...guardado.taxonomia, ejes: t.axes as Eje[] };
    }
    const d = await clasificarCambio(db, soloCache(u.classifier), g, cambio, taxonomia);
    if (d.hashVeredictos !== u.input_hash) {
      throw new Error(`La reconstrucción diverge en la actualización ${u.id}: los candidatos no coinciden.`);
    }
    if (!verificarVeredictos(g, d.candidatos, d.veredictos).ok) continue;
    const plan = planificar(g, cambio, categoriasAplicables(d.categorias), d.veredictos, g.version + 1);
    if (!planVacio(plan)) g = aplicarPlan(g, plan, g.version + 1);
  }
  return g;
}

export async function compararReconstruccion(
  db: Bd,
  proyectoId: string,
): Promise<{ vivo: string; reconstruido: string; iguales: boolean }> {
  const vivo = huellaGrafo(await cargarGrafo(db, proyectoId));
  const reconstruido = huellaGrafo(await reconstruirGrafo(db, proyectoId));
  return { vivo, reconstruido, iguales: vivo === reconstruido };
}
