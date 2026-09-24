// Modelos de lectura del Pilar 1: estado del producto, bandeja, exploraciones, registros con
// su readiness y lotes. Son funciones derivadas: no se almacenan (§4 del plan).

import {
  type Dependencia,
  type EntradaReadiness,
  ErrorDominio,
  type Readiness,
  type TipoRegistro,
  epistemicoDeObservacion,
  epistemicoDePregunta,
  epistemicoDePropuesta,
  epistemicoDeVersion,
  readiness,
} from '@demiurgo/domain';
import type { Bd } from '../db/conexion.ts';
import { dependenciasCaducadas } from '../comandos/propuestas.ts';

type Dep = { tipo: string; id: string; codigo?: string; version: number };

async function vigenteDe(db: Bd, recordId: string): Promise<number | null> {
  const v = await db
    .selectFrom('record_versions')
    .select('n')
    .where('record_id', '=', recordId)
    .where('state', '=', 'approved')
    .orderBy('n', 'desc')
    .executeTakeFirst();
  return v?.n ?? null;
}

/** Exploración de origen de una versión: se sigue su origen (propuesta → lote → ejecución → alcance). */
export async function exploracionDeOrigen(db: Bd, versionId: string, saltos = 6): Promise<string | null> {
  let actual: { tipo: string; id: string } | null = { tipo: 'record_version', id: versionId };
  for (let i = 0; i < saltos && actual; i++) {
    if (actual.tipo === 'exploration') return actual.id;
    if (actual.tipo === 'record_version') {
      const v = await db.selectFrom('record_versions').select('origin').where('id', '=', actual.id).executeTakeFirst();
      actual = (v?.origin as { tipo: string; id: string } | null) ?? null;
    } else if (actual.tipo === 'proposal') {
      const p = await db
        .selectFrom('proposals')
        .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
        .select(['proposal_batches.run_id'])
        .where('proposals.id', '=', actual.id)
        .executeTakeFirst();
      if (!p?.run_id) return null;
      const run = await db.selectFrom('ai_runs').select('scope').where('id', '=', p.run_id).executeTakeFirst();
      const scope = run?.scope as { tipo: string; id?: string } | undefined;
      actual = scope?.id ? { tipo: scope.tipo, id: scope.id } : null;
    } else {
      return null;
    }
  }
  return null;
}

export async function readinessDeVersion(db: Bd, proyectoId: string, versionId: string): Promise<Readiness> {
  const v = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'records.type', 'record_versions.n', 'record_versions.state'])
    .where('record_versions.id', '=', versionId)
    .where('records.project_id', '=', proyectoId)
    .executeTakeFirst();
  if (!v) throw new ErrorDominio('no_encontrado', 'La versión no existe.');
  const criterios = await db
    .selectFrom('criteria')
    .select(['code', 'verification', 'check_text', 'statement'])
    .where('record_version_id', '=', versionId)
    .orderBy('position')
    .execute();
  const enlaces = await db
    .selectFrom('links')
    .innerJoin('record_versions as destino', 'destino.id', 'links.to_id')
    .innerJoin('records as rd', 'rd.id', 'destino.record_id')
    .select([
      'links.type',
      'links.state',
      'rd.id as recordId',
      'rd.code',
      'rd.type as tipoDestino',
      'destino.n',
      'destino.state as estadoDestino',
    ])
    .where('links.from_id', '=', versionId)
    .execute();
  const basadoEn: EntradaReadiness['basadoEn'] = [];
  const enlacesEnRevision: string[] = [];
  for (const e of enlaces) {
    if (e.type === 'based_on' && e.tipoDestino === 'decision') {
      basadoEn.push({
        codigo: e.code,
        version: e.n,
        estadoVersion: e.estadoDestino,
        vigente: await vigenteDe(db, e.recordId),
        estadoEnlace: e.state,
      });
    } else if (e.state === 'needs_review') {
      enlacesEnRevision.push(`${e.code} v${e.n}`);
    }
  }
  const origen = await exploracionDeOrigen(db, versionId);
  const preguntasAbiertas = origen
    ? await db
        .selectFrom('questions')
        .select(['question as pregunta', 'state as estado'])
        .where('exploration_id', '=', origen)
        .where('state', 'in', ['pending', 'postponed'])
        .execute()
    : [];
  const pendientes = await db
    .selectFrom('proposals')
    .select('dependencies')
    .where('project_id', '=', proyectoId)
    .where('state', '=', 'pending')
    .execute();
  const propuestasPendientes = pendientes.filter((p) =>
    ((p.dependencies ?? []) as Dep[]).some((d) => d.id === v.recordId),
  ).length;
  return readiness({
    codigo: v.code,
    tipo: v.type as TipoRegistro,
    version: { n: v.n, estado: v.state },
    vigente: await vigenteDe(db, v.recordId),
    criterios: criterios.map((c) => ({
      codigo: c.code,
      verificacion: c.verification,
      comprobacion: c.check_text,
      enunciado: c.statement,
    })),
    basadoEn,
    enlacesEnRevision,
    preguntasAbiertas,
    propuestasPendientes,
  });
}

export async function bandeja(db: Bd, proyectoId: string) {
  const lotes = await db
    .selectFrom('proposal_batches')
    .selectAll()
    .where('project_id', '=', proyectoId)
    .where('state', '=', 'pending')
    .orderBy('created_at')
    .execute();
  const itemsLotes = [];
  for (const l of lotes) {
    const propuestas = await db
      .selectFrom('proposals')
      .selectAll()
      .where('batch_id', '=', l.id)
      .where('state', '=', 'pending')
      .orderBy('position')
      .execute();
    const conAviso = [];
    for (const p of propuestas) {
      const deps = [...((l.dependencies ?? []) as Dependencia[]), ...((p.dependencies ?? []) as Dependencia[])];
      const avisos = await dependenciasCaducadas(db, deps);
      conAviso.push({
        id: p.id,
        tipo: p.type,
        carga: p.payload,
        estado: p.state,
        estado_epistemico: epistemicoDePropuesta(p.state),
        obsolescencia: avisos,
        evaluacion: await evaluacionDe(db, p.id),
      });
    }
    itemsLotes.push({
      id: l.id,
      tipo: l.kind,
      productor: l.producer,
      resolucion: l.resolution_mode,
      resumen: l.summary,
      run_id: l.run_id,
      creado: l.created_at,
      propuestas: conAviso,
    });
  }
  const preguntas = await db
    .selectFrom('questions')
    .select(['id', 'exploration_id', 'question', 'state', 'conclusion', 'reasoning', 'raised_by'])
    .where('project_id', '=', proyectoId)
    .where('state', '=', 'inferred')
    .orderBy('created_at')
    .execute();
  const enlaces = await db
    .selectFrom('links')
    .selectAll()
    .where('project_id', '=', proyectoId)
    .where('state', '=', 'needs_review')
    .execute();
  const extra = await pendientesDeConocimiento(db, proyectoId);
  const total = itemsLotes.reduce((n, l) => n + l.propuestas.length, 0) + preguntas.length + enlaces.length + extra.total;
  return {
    total,
    lotes: itemsLotes,
    preguntas_por_confirmar: preguntas.map((q) => ({ ...q, estado_epistemico: epistemicoDePregunta(q.state) })),
    enlaces_en_revision: enlaces.map((e) => ({ ...e, estado_epistemico: 'pendiente' as const })),
    ...extra.secciones,
  };
}

// S2 amplía la bandeja con la evaluación de ideas y los pendientes del conocimiento.
type ExtensionBandeja = {
  evaluacion(db: Bd, propuestaId: string): Promise<unknown>;
  pendientes(db: Bd, proyectoId: string): Promise<{ total: number; secciones: Record<string, unknown> }>;
};
let extension: ExtensionBandeja = { evaluacion: async () => null, pendientes: async () => ({ total: 0, secciones: {} }) };
export function registrarExtensionBandeja(e: ExtensionBandeja): void {
  extension = e;
}
const evaluacionDe = (db: Bd, id: string) => extension.evaluacion(db, id);
const pendientesDeConocimiento = (db: Bd, id: string) => extension.pendientes(db, id);

export async function detalleRegistro(db: Bd, proyectoId: string, codigo: string) {
  const r = await db
    .selectFrom('records')
    .selectAll()
    .where('project_id', '=', proyectoId)
    .where('code', '=', codigo)
    .executeTakeFirst();
  if (!r) throw new ErrorDominio('no_encontrado', `No existe el registro ${codigo}.`);
  const versiones = await db.selectFrom('record_versions').selectAll().where('record_id', '=', r.id).orderBy('n').execute();
  const vigente = await vigenteDe(db, r.id);
  const detalle = [];
  for (const v of versiones) {
    const criterios = await db
      .selectFrom('criteria')
      .selectAll()
      .where('record_version_id', '=', v.id)
      .orderBy('position')
      .execute();
    const enlaces = await db.selectFrom('links').selectAll().where('from_id', '=', v.id).execute();
    detalle.push({
      id: v.id,
      n: v.n,
      estado: v.state,
      estado_epistemico: epistemicoDeVersion(v.state),
      vigente: v.n === vigente,
      titulo: v.title,
      secciones: v.sections,
      anexos: v.annexes,
      nota_de_cambio: v.change_note,
      origen: v.origin,
      autor: v.author,
      aprobada_por: v.approved_by,
      criterios: criterios.map((c) => ({
        id: c.id,
        codigo: c.code,
        titulo: c.title,
        enunciado: c.statement,
        verificacion: c.verification,
        comprobacion: c.check_text,
        arrastre: c.carry,
      })),
      enlaces,
      readiness: r.type === 'decision' ? null : await readinessDeVersion(db, proyectoId, v.id),
    });
  }
  return {
    id: r.id,
    codigo: r.code,
    tipo: r.type,
    dominio: r.domain,
    vigente,
    realizacion: 'sin implementar',
    versiones: detalle,
  };
}

export async function estadoProducto(db: Bd, proyectoId: string) {
  const proyecto = await db
    .selectFrom('projects')
    .select(['id', 'name', 'state'])
    .where('id', '=', proyectoId)
    .executeTakeFirst();
  if (!proyecto) throw new ErrorDominio('no_encontrado', 'El proyecto no existe.');
  const registros = await db.selectFrom('records').selectAll().where('project_id', '=', proyectoId).orderBy('code').execute();
  const filas = [];
  for (const r of registros) {
    const ultima = await db
      .selectFrom('record_versions')
      .select(['id', 'n', 'state', 'title'])
      .where('record_id', '=', r.id)
      .orderBy('n', 'desc')
      .executeTakeFirstOrThrow();
    const vigente = await vigenteDe(db, r.id);
    const idVigente =
      vigente === null
        ? null
        : (
            await db
              .selectFrom('record_versions')
              .select('id')
              .where('record_id', '=', r.id)
              .where('n', '=', vigente)
              .executeTakeFirstOrThrow()
          ).id;
    filas.push({
      codigo: r.code,
      tipo: r.type,
      dominio: r.domain,
      titulo: ultima.title,
      vigente,
      ultima: { n: ultima.n, estado: ultima.state },
      estado_epistemico: vigente !== null ? 'confirmado' : epistemicoDeVersion(ultima.state),
      readiness: r.type === 'decision' ? null : await readinessDeVersion(db, proyectoId, idVigente ?? ultima.id),
      realizacion: 'sin implementar',
    });
  }
  const exploraciones = await db
    .selectFrom('explorations')
    .select(['id', 'purpose', 'state', 'parent_id', 'origin_type', 'origin_id'])
    .where('project_id', '=', proyectoId)
    .orderBy('created_at')
    .execute();
  const abiertas = await db
    .selectFrom('questions')
    .select(['exploration_id', (eb) => eb.fn.countAll<string>().as('n')])
    .where('project_id', '=', proyectoId)
    .where('state', 'in', ['pending', 'postponed', 'inferred'])
    .groupBy('exploration_id')
    .execute();
  const b = await bandeja(db, proyectoId);
  return {
    proyecto: { id: proyecto.id, nombre: proyecto.name, estado: proyecto.state },
    decisiones: filas.filter((f) => f.tipo === 'decision'),
    disenos: filas.filter((f) => f.tipo !== 'decision'),
    listos_para_construir: filas.filter((f) => f.readiness?.listo).map((f) => f.codigo),
    exploraciones: exploraciones.map((e) => ({
      ...e,
      preguntas_abiertas: Number(abiertas.find((a) => a.exploration_id === e.id)?.n ?? 0),
    })),
    bandeja: { total: b.total },
  };
}

export async function detalleExploracion(db: Bd, proyectoId: string, id: string) {
  const e = await db
    .selectFrom('explorations')
    .selectAll()
    .where('project_id', '=', proyectoId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!e) throw new ErrorDominio('no_encontrado', 'La exploración no existe.');
  const mensajes = await db
    .selectFrom('messages')
    .selectAll()
    .where('exploration_id', '=', id)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const preguntas = await db.selectFrom('questions').selectAll().where('exploration_id', '=', id).orderBy('created_at').execute();
  const hijas = await db.selectFrom('explorations').select(['id', 'purpose', 'state']).where('parent_id', '=', id).execute();
  return {
    ...e,
    mensajes: mensajes.map((m) => ({
      ...m,
      estado_epistemico: m.author.startsWith('human:') ? null : epistemicoDeObservacion(m.kind),
    })),
    preguntas: preguntas.map((q) => ({ ...q, estado_epistemico: epistemicoDePregunta(q.state) })),
    hijas,
  };
}

export async function detalleLote(db: Bd, proyectoId: string, id: string) {
  const l = await db
    .selectFrom('proposal_batches')
    .selectAll()
    .where('project_id', '=', proyectoId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!l) throw new ErrorDominio('no_encontrado', 'El lote no existe.');
  const propuestas = await db.selectFrom('proposals').selectAll().where('batch_id', '=', id).orderBy('position').execute();
  return { ...l, propuestas: propuestas.map((p) => ({ ...p, estado_epistemico: epistemicoDePropuesta(p.state) })) };
}
