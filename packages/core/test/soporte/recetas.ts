// Recetas de la fábrica para las entidades de S1: cómo crear cada una y, cuando una guarda lo
// exige, cómo llegar a ciertos estados.

import { randomUUID } from 'node:crypto';
import { humano, sistema } from '@demiurgo/domain';
import { sql } from 'kysely';
import { ejecutarComando } from '../../src/bus/bus.ts';
import type { Servicios } from '../../src/servicios.ts';
import { registrarReceta, unico } from './fabrica.ts';

const ana = humano('ana');
const sis = sistema('prueba');

export async function nuevaExploracion(s: Servicios, proyectoId: string): Promise<string> {
  const r = await ejecutarComando(s, {
    comando: 'exploration.open',
    actor: ana,
    proyectoId,
    datos: { proposito: unico('Explorar') },
  });
  return r.entidadId;
}

const seccionesDecision = [
  { titulo: 'Contexto', contenido: 'Contexto de prueba.' },
  { titulo: 'Decisión', contenido: 'Decisión de prueba.' },
  { titulo: 'Consecuencias', contenido: 'Consecuencias de prueba.' },
];

export async function nuevaDecision(
  s: Servicios,
  proyectoId: string,
  aprobar = false,
): Promise<{ recordId: string; versionId: string; codigo: string }> {
  const r = await ejecutarComando(s, {
    comando: 'record.create',
    actor: ana,
    proyectoId,
    datos: { tipo: 'decision', dominio: 'prueba', titulo: unico('Decisión'), secciones: seccionesDecision },
  });
  const res = r.resultado as { recordId: string; versionId: string; codigo: string };
  if (aprobar)
    await ejecutarComando(s, { comando: 'record_version.approve', actor: ana, proyectoId, entidadId: res.versionId, datos: {} });
  return res;
}

const cargaDecision = () => ({ titulo: unico('Propuesta'), contexto: 'c', decision: 'd', consecuencias: 'k' });

export async function nuevoLote(
  s: Servicios,
  proyectoId: string,
  paquete: boolean,
  n = 1,
): Promise<{ loteId: string; propuestas: string[] }> {
  const r = await ejecutarComando(s, {
    comando: 'batch.submit',
    actor: sis,
    proyectoId,
    datos: {
      tipo_lote: paquete ? 'system_package' : 'agent',
      resolucion: paquete ? 'package' : 'item',
      propuestas: Array.from({ length: n }, () => ({ tipo: 'decision', carga: cargaDecision() })),
    },
  });
  return r.resultado as { loteId: string; propuestas: string[] };
}

registrarReceta('agent_token', {
  async crear(s, proyectoId) {
    const r = await ejecutarComando(s, { comando: 'agent_token.issue', actor: ana, proyectoId, datos: { nombre: 'bot' } });
    return r.entidadId;
  },
});

registrarReceta('exploration', {
  crear: nuevaExploracion,
  datos: { 'exploration.set_aside': () => ({ motivo: 'Apartada en la prueba.' }) },
});

registrarReceta('message', {
  async crear(s, proyectoId) {
    const exploracion = await nuevaExploracion(s, proyectoId);
    const r = await ejecutarComando(s, {
      comando: 'message.post',
      actor: ana,
      proyectoId,
      datos: { exploracion_id: exploracion, texto: 'Hola', responder: false },
    });
    return r.entidadId;
  },
});

registrarReceta('source', {
  async crear(s, proyectoId) {
    const r = await ejecutarComando(s, {
      comando: 'source.register',
      actor: ana,
      proyectoId,
      datos: { nombre: 'VISION.md', contenido: unico('x') },
    });
    return r.entidadId;
  },
});

registrarReceta('question', {
  async crear(s, proyectoId) {
    const exploracion = await nuevaExploracion(s, proyectoId);
    const r = await ejecutarComando(s, {
      comando: 'question.raise',
      actor: ana,
      proyectoId,
      datos: { exploracion_id: exploracion, pregunta: '¿Quién usará el producto?' },
    });
    return r.entidadId;
  },
  datos: {
    'question.infer': () => ({ conclusion: 'Los socios.', razonamiento: 'Lo dijo la persona.' }),
    'question.confirm': () => ({ conclusion: 'Los socios.' }),
    'question.postpone': () => ({ motivo: 'Más adelante.' }),
    'question.discard': () => ({ motivo: 'No aplica.' }),
  },
});

registrarReceta('record', {
  async crear(s, proyectoId) {
    return (await nuevaDecision(s, proyectoId)).recordId;
  },
});

registrarReceta('record_version', {
  async crear(s, proyectoId) {
    return (await nuevaDecision(s, proyectoId)).versionId;
  },
});

registrarReceta('criterion', {
  async crear(s, proyectoId) {
    const r = await ejecutarComando(s, {
      comando: 'record.create',
      actor: ana,
      proyectoId,
      datos: {
        tipo: 'fdr',
        dominio: 'prueba',
        titulo: unico('FDR'),
        secciones: [
          { titulo: 'Objetivo', contenido: 'o' },
          { titulo: 'Alcance', contenido: 'a' },
          { titulo: 'Fuera de alcance', contenido: 'f' },
          { titulo: 'Comportamiento', contenido: 'c' },
        ],
        criterios: [
          {
            arrastre: 'new',
            titulo: 'T',
            enunciado: 'Cuando x, entonces y.',
            verificacion: 'automatic',
            comprobacion: 'Prueba.',
          },
        ],
      },
    });
    const versionId = (r.resultado as { versionId: string }).versionId;
    const c = await s.db.selectFrom('criteria').select('id').where('record_version_id', '=', versionId).executeTakeFirstOrThrow();
    return c.id;
  },
});

registrarReceta('link', {
  async crear(s, proyectoId) {
    const a = await nuevaDecision(s, proyectoId);
    const b = await nuevaDecision(s, proyectoId);
    const r = await ejecutarComando(s, {
      comando: 'link.create',
      actor: ana,
      proyectoId,
      datos: {
        tipo: 'derived_from',
        desde: { tipo: 'record_version', id: a.versionId },
        hacia: { tipo: 'record_version', id: b.versionId },
      },
    });
    return r.entidadId;
  },
  datos: { 'link.flag_review': () => ({ motivo: 'Cambió el destino.' }) },
});

registrarReceta('batch', {
  // Por defecto, un paquete: así «aceptar el paquete» y «rechazarlo» tienen camino legal.
  async crear(s, proyectoId) {
    return (await nuevoLote(s, proyectoId, true)).loteId;
  },
  datos: { 'batch.supersede': () => ({ motivo: 'Obsoleto.' }) },
  estados: {
    // «resolved» exige un lote por elementos con todo resuelto: se rechaza su única propuesta.
    async resolved(s, proyectoId) {
      const { loteId, propuestas } = await nuevoLote(s, proyectoId, false);
      await ejecutarComando(s, { comando: 'proposal.reject', actor: ana, proyectoId, entidadId: propuestas[0] ?? '', datos: {} });
      return loteId;
    },
  },
});

registrarReceta('proposal', {
  async crear(s, proyectoId) {
    return (await nuevoLote(s, proyectoId, false)).propuestas[0] ?? '';
  },
  datos: {
    'proposal.accept_edited': () => ({ edicion: cargaDecision() }),
    'proposal.supersede': () => ({ motivo: 'Obsoleta.' }),
  },
});

// Recetas de S2.

const ejesPrueba = [
  {
    codigo: 'area',
    nombre: 'Área',
    categorias: [
      { codigo: 'socios', nombre: 'Socios', descripcion: 'Datos de los socios.' },
      { codigo: 'otra', nombre: 'Otra', descripcion: 'Nada de lo anterior.' },
    ],
  },
];

async function nuevaTaxonomia(s: Servicios, proyectoId: string, aprobar: boolean): Promise<string> {
  const previa = await s.db
    .selectFrom('taxonomies')
    .select('version')
    .where('project_id', '=', proyectoId)
    .where('code', '=', 'TAX-009')
    .orderBy('version', 'desc')
    .executeTakeFirst();
  const r = await ejecutarComando(s, {
    comando: 'taxonomy.propose',
    actor: ana,
    proyectoId,
    datos: { codigo: 'TAX-009', titulo: unico('Taxonomía'), ejes: ejesPrueba, version: (previa?.version ?? 0) + 1 },
  });
  if (aprobar)
    await ejecutarComando(s, { comando: 'taxonomy.approve', actor: ana, proyectoId, entidadId: r.entidadId, datos: {} });
  return r.entidadId;
}

registrarReceta('taxonomy', {
  crear: (s, proyectoId) => nuevaTaxonomia(s, proyectoId, false),
});

const datosClasificacion = (taxonomiaId: string) => ({
  nodo_ref: unico('NODO'),
  taxonomia_id: taxonomiaId,
  eje: 'area',
  categoria: 'socios',
  confianza: 0.3,
  justificacion: 'prueba',
  clasificador: 'prueba@1',
  input_hash: unico('h'),
  update_id: null,
});

registrarReceta('classification', {
  async crear(s, proyectoId) {
    const t = await nuevaTaxonomia(s, proyectoId, true);
    return (await ejecutarComando(s, { comando: 'classification.record', actor: sis, proyectoId, datos: datosClasificacion(t) }))
      .entidadId;
  },
  datos: { 'classification.resolve': () => ({ categoria: 'socios' }) },
  estados: {
    async pending_review(s, proyectoId) {
      const t = await nuevaTaxonomia(s, proyectoId, true);
      return (await ejecutarComando(s, { comando: 'classification.hold', actor: sis, proyectoId, datos: datosClasificacion(t) }))
        .entidadId;
    },
    async resolved(s, proyectoId) {
      const t = await nuevaTaxonomia(s, proyectoId, true);
      const r = await ejecutarComando(s, {
        comando: 'classification.hold',
        actor: sis,
        proyectoId,
        datos: datosClasificacion(t),
      });
      await ejecutarComando(s, {
        comando: 'classification.resolve',
        actor: ana,
        proyectoId,
        entidadId: r.entidadId,
        datos: { categoria: 'socios' },
      });
      return r.entidadId;
    },
  },
});

// Una actualización en cola se crea directamente (sin que el motor en línea la procese al instante).
registrarReceta('knowledge_update', {
  async crear(s, proyectoId) {
    const { rows } = await sql<{ id: string }>`
      insert into knowledge_updates (project_id, trigger, trigger_seq, state)
      values (${proyectoId}::uuid, ${JSON.stringify({ tipo: 'otro', id: randomUUID(), version: null })}::jsonb, 0, 'queued') returning id`.execute(
      s.db,
    );
    return rows[0]?.id ?? '';
  },
  datos: {
    'knowledge_update.verify': () => ({
      cambio: null,
      candidatos: [],
      input_hash: 'x',
      clasificador: 'prueba@1',
      veredictos: [],
    }),
    'knowledge_update.apply': () => ({ operaciones: {}, version_antes: 0, version_despues: 0 }),
    'knowledge_update.reject': () => ({ motivos: ['prueba'] }),
  },
});

const datosNodo = () => ({
  ref: unico('NODO'),
  tipo: 'fuente',
  etiqueta: 'Nodo',
  texto: 'Texto',
  categorias: {},
  epistemico: 'desconocido',
  origen: { tipo: 'source', id: null, version: null },
  desde: 1,
  update_id: null,
});

registrarReceta('knowledge_node', {
  async crear(s, proyectoId) {
    return (await ejecutarComando(s, { comando: 'knowledge_node.project', actor: sis, proyectoId, datos: datosNodo() }))
      .entidadId;
  },
  datos: { 'knowledge_node.invalidate': () => ({ hasta: 2 }) },
});

registrarReceta('knowledge_edge', {
  async crear(s, proyectoId) {
    const a = datosNodo();
    const b = datosNodo();
    await ejecutarComando(s, { comando: 'knowledge_node.project', actor: sis, proyectoId, datos: a });
    await ejecutarComando(s, { comando: 'knowledge_node.project', actor: sis, proyectoId, datos: b });
    const r = await ejecutarComando(s, {
      comando: 'knowledge_edge.project',
      actor: sis,
      proyectoId,
      datos: { tipo: 'relacionado', desde: a.ref, hacia: b.ref, alta: 1, update_id: null },
    });
    return r.entidadId;
  },
  datos: { 'knowledge_edge.invalidate': () => ({ hasta: 2 }) },
});

registrarReceta('idea_assessment', {
  async crear(s, proyectoId) {
    const { propuestas } = await nuevoLote(s, proyectoId, true);
    const r = await ejecutarComando(s, {
      comando: 'idea_assessment.record',
      actor: sis,
      proyectoId,
      datos: {
        propuesta_id: propuestas[0] ?? '',
        hallazgos: [],
        version_grafo: 0,
        clasificador: 'prueba@1',
        input_hash: unico('h'),
      },
    });
    return r.entidadId;
  },
});
