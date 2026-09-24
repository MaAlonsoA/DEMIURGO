// Acción exploration_chat: conversación de exploración. El constructor recopila de forma
// determinista lo declarado; el aplicador convierte la salida validada en mensajes, preguntas,
// inferencias y un lote de propuestas. Nada de esto toca la autoridad.

import { ErrorDominio, sistema } from '@demiurgo/domain';
import { registrarConstructor } from '../contexto/construir.ts';
import { conocimientoParaContexto } from '../contexto/conocimiento.ts';
import { registrarAplicador } from './aplicadores.ts';

const PRESUPUESTO = { mensajes: 12_000, decisiones: 4_000, fuentes: 6_000, conocimiento: 4_000 };

function recortarPorPresupuesto<T>(elementos: T[], tamaño: (e: T) => number, presupuesto: number): T[] {
  const elegidos: T[] = [];
  let usado = 0;
  for (const e of elementos) {
    const t = tamaño(e);
    if (usado + t > presupuesto) break;
    elegidos.push(e);
    usado += t;
  }
  return elegidos;
}

registrarConstructor('exploration_chat', async ({ trx, proyectoId, alcance, entrada, versionGrafo }) => {
  const exploracion = await trx
    .selectFrom('explorations')
    .selectAll()
    .where('id', '=', alcance.id ?? '')
    .where('project_id', '=', proyectoId)
    .executeTakeFirst();
  if (!exploracion) throw new ErrorDominio('no_encontrado', 'La exploración no existe.');
  // Mensajes más recientes primero para el presupuesto; en el pack van en orden cronológico.
  const mensajes = await trx
    .selectFrom('messages')
    .select(['id', 'author', 'kind', 'body', 'question_id'])
    .where('exploration_id', '=', exploracion.id)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(60)
    .execute();
  const elegidos = recortarPorPresupuesto(mensajes, (m) => m.body.length, PRESUPUESTO.mensajes).toReversed();
  const preguntas = await trx
    .selectFrom('questions')
    .select(['id', 'question', 'state', 'conclusion', 'impact'])
    .where('exploration_id', '=', exploracion.id)
    .where('state', '<>', 'discarded')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const decisiones = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'record_versions.n', 'record_versions.title', 'record_versions.sections'])
    .where('records.project_id', '=', proyectoId)
    .where('records.type', '=', 'decision')
    .where('record_versions.state', '=', 'approved')
    .orderBy('records.code')
    .execute();
  const resumenDecisiones = recortarPorPresupuesto(
    decisiones.map((d) => {
      const secciones = d.sections as { titulo: string; contenido: string }[];
      return {
        codigo: d.code,
        version: d.n,
        titulo: d.title,
        decision: secciones.find((s) => s.titulo === 'Decisión')?.contenido.slice(0, 400) ?? '',
      };
    }),
    (d) => d.titulo.length + d.decision.length,
    PRESUPUESTO.decisiones,
  );
  const fuentes = await trx
    .selectFrom('sources')
    .select(['id', 'name', 'content', 'registered_by'])
    .where('project_id', '=', proyectoId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(5)
    .execute();
  const fuentesElegidas = recortarPorPresupuesto(
    fuentes.map((f) => ({ nombre: f.name, registrada_por: f.registered_by, extracto: f.content.slice(0, 2000) })),
    (f) => f.extracto.length,
    PRESUPUESTO.fuentes,
  );
  const conocimiento = await conocimientoParaContexto(
    trx,
    proyectoId,
    `${exploracion.purpose} ${elegidos.map((m) => m.body).join(' ')}`,
    PRESUPUESTO.conocimiento,
  );
  return {
    rol: 'explorar',
    constructor: 'exploration_chat@1',
    presupuesto: PRESUPUESTO,
    version_grafo: versionGrafo,
    dependencias: [
      { tipo: 'exploration', id: exploracion.id, version: null },
      ...resumenDecisiones.map((d) => {
        const r = decisiones.find((x) => x.code === d.codigo);
        return { tipo: 'record', id: r?.recordId ?? '', version: d.version };
      }),
      ...conocimiento.dependencias,
    ],
    contenido: {
      proposito: exploracion.purpose,
      pregunta_en_curso: typeof entrada.pregunta_id === 'string' ? entrada.pregunta_id : null,
      mensajes: elegidos.map((m) => ({ autor: m.author, tipo: m.kind, pregunta: m.question_id, texto: m.body })),
      preguntas: preguntas.map((q) => ({
        id: q.id,
        pregunta: q.question,
        estado: q.state,
        conclusion: q.conclusion,
        impacto: q.impact,
      })),
      decisiones_confirmadas: resumenDecisiones,
      fuentes_no_confiables: fuentesElegidas,
      conocimiento: conocimiento.nodos,
    },
  };
});

registrarAplicador('exploration_chat', async ({ trx, ejecutar, run, salida }) => {
  const actor = { tipo: 'agent_run' as const, run: run.id };
  const alcance = run.scope as { id: string };
  const pack = await trx
    .selectFrom('context_packs')
    .select(['content'])
    .where('id', '=', run.context_pack_id ?? '')
    .executeTakeFirstOrThrow();
  const contenido = pack.content as { pregunta_en_curso: string | null; preguntas: { id: string; estado: string }[] };
  const preguntaId = contenido.pregunta_en_curso ?? undefined;
  const base = { proyectoId: run.project_id };
  await ejecutar({
    ...base,
    comando: 'message.post',
    actor,
    datos: {
      exploracion_id: alcance.id,
      ...(preguntaId ? { pregunta_id: preguntaId } : {}),
      texto: salida.reply,
      responder: false,
    },
  });
  for (const o of salida.observaciones) {
    await ejecutar({
      ...base,
      comando: 'message.post',
      actor,
      datos: { exploracion_id: alcance.id, texto: o.texto, tipo: o.tipo, responder: false },
    });
  }
  for (const q of salida.preguntas) {
    await ejecutar({
      ...base,
      comando: 'question.raise',
      actor: sistema('exploracion'),
      datos: { exploracion_id: alcance.id, pregunta: q.pregunta, motivo: q.motivo, impacto: q.impacto },
    });
  }
  // Solo se infieren preguntas pendientes que estaban en el context pack de esta ejecución.
  const pendientes = new Set(contenido.preguntas.filter((q) => q.estado === 'pending').map((q) => q.id));
  for (const inf of salida.inferencias) {
    if (!pendientes.has(inf.pregunta_id)) continue;
    const q = await trx.selectFrom('questions').select('state').where('id', '=', inf.pregunta_id).executeTakeFirst();
    if (q?.state !== 'pending') continue;
    await ejecutar({
      ...base,
      comando: 'question.infer',
      actor: sistema('exploracion'),
      entidadId: inf.pregunta_id,
      datos: { conclusion: inf.conclusion, razonamiento: inf.razonamiento },
    });
  }
  if (salida.propuestas.length > 0) {
    await ejecutar({
      ...base,
      comando: 'batch.submit',
      actor,
      datos: {
        resumen: `Propuestas de la conversación de exploración (${salida.propuestas.length}).`,
        tipo_lote: 'agent',
        resolucion: 'item',
        run_id: run.id,
        context_pack_id: run.context_pack_id ?? undefined,
        propuestas: salida.propuestas.map(({ tipo, ...carga }) => ({ tipo, carga })),
      },
    });
  }
});
