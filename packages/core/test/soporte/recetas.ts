// Recetas de la fábrica para las entidades de S1: cómo crear cada una y, cuando una guarda lo
// exige, cómo llegar a ciertos estados.

import { humano, sistema } from '@demiurgo/domain';
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
