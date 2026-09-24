// Integración del conocimiento con el resto del núcleo: selección para los context packs,
// evaluación de ideas tras cada lote de un agente y la parte de la bandeja que le toca.

import { seleccionarParaContexto } from '@demiurgo/domain';
import { registrarExtensionBandeja } from '../consultas/lectura.ts';
import { registrarSeleccionadorDeConocimiento } from '../contexto/conocimiento.ts';
import { cargarGrafo } from './grafo-pg.ts';

registrarSeleccionadorDeConocimiento(async (trx, proyectoId, consulta, presupuesto) => {
  const g = await cargarGrafo(trx, proyectoId);
  const elegidos = seleccionarParaContexto(g, consulta, presupuesto);
  return {
    nodos: elegidos.map(({ nodo, motivo }) => ({
      ref: nodo.ref,
      tipo: nodo.tipo,
      titulo: nodo.etiqueta,
      texto: nodo.texto.slice(0, 600),
      motivo,
    })),
    dependencias: elegidos.map(({ nodo }) => ({ tipo: 'knowledge_node', id: nodo.ref, version: g.version })),
  };
});

registrarExtensionBandeja({
  async evaluacion(db, propuestaId) {
    const e = await db
      .selectFrom('idea_assessments')
      .select(['findings', 'graph_version', 'classifier'])
      .where('proposal_id', '=', propuestaId)
      .executeTakeFirst();
    return e
      ? { hallazgos: e.findings, version_grafo: Number(e.graph_version), clasificador: e.classifier }
      : { pendiente: true };
  },
  async pendientes(db, proyectoId) {
    const clasificaciones = await db
      .selectFrom('classifications')
      .select(['id', 'node_ref', 'axis', 'category', 'confidence', 'justification', 'classifier'])
      .where('project_id', '=', proyectoId)
      .where('state', '=', 'pending_review')
      .orderBy('created_at')
      .execute();
    const rechazadas = await db
      .selectFrom('knowledge_updates')
      .select(['id', 'trigger', 'failure', 'created_at'])
      .where('project_id', '=', proyectoId)
      .where('state', '=', 'rejected')
      .orderBy('created_at')
      .execute();
    return {
      total: clasificaciones.length + rechazadas.length,
      secciones: {
        clasificaciones_por_revisar: clasificaciones.map((c) => ({ ...c, estado_epistemico: 'pendiente' })),
        actualizaciones_rechazadas: rechazadas.map((u) => ({ ...u, estado_epistemico: 'pendiente' })),
      },
    };
  },
});
