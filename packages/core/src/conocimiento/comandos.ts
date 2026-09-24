// Comandos del motor de conocimiento. El clasificador y el actualizador (actor system) solo
// escriben conocimiento derivado, clasificaciones y propuestas; nunca un estado de autoridad
// (I10). La taxonomía sí es autoridad: la propone y la aprueba una persona.

import { ErrorDominio, formatearActor, huella, sistema } from '@demiurgo/domain';
import { sql } from 'kysely';
import { z } from 'zod';
import { cadena, campo, registrarGuardas } from '../bus/guardas.ts';
import { manejador, registrarManejadores } from '../bus/manejadores.ts';
import type { ContextoComando } from '../bus/tipos.ts';
import { registrarReaccionDeAutoridad } from '../comandos/reacciones.ts';

export const ACTUALIZADOR = sistema('conocimiento');

const esquemaEjes = z
  .array(
    z
      .object({
        codigo: z.string().regex(/^[a-z][a-z0-9_]*$/),
        nombre: z.string().min(1),
        categorias: z
          .array(
            z
              .object({
                codigo: z.string().regex(/^[a-z][a-z0-9_]*$/),
                nombre: z.string().min(1),
                descripcion: z.string().min(1),
              })
              .strict(),
          )
          .min(2),
      })
      .strict(),
  )
  .min(1);

const esquemaNodo = z
  .object({
    ref: z.string().min(1),
    tipo: z.string().min(1),
    etiqueta: z.string(),
    texto: z.string(),
    categorias: z.record(z.string(), z.string()),
    epistemico: z.enum(['confirmado', 'propuesto', 'pendiente', 'desconocido']),
    origen: z.object({ tipo: z.string(), id: z.string().uuid().nullable(), version: z.number().int().nullable() }).strict(),
    desde: z.number().int().nonnegative(),
    update_id: z.string().uuid().nullable(),
  })
  .strict();

registrarGuardas({
  taxonomia_valida: ({ datos }) => {
    const r = esquemaEjes.safeParse(campo(datos, 'ejes'));
    if (!r.success) return 'Los ejes de la taxonomía no son válidos.';
    const motivos: string[] = [];
    for (const eje of r.data) {
      const codigos = eje.categorias.map((c) => c.codigo);
      if (!codigos.includes('otra')) motivos.push(`El eje ${eje.codigo} no tiene la categoría «otra».`);
      if (new Set(codigos).size !== codigos.length) motivos.push(`El eje ${eje.codigo} repite categorías.`);
    }
    return motivos.length ? motivos.join(' ') : null;
  },

  categorias_de_la_taxonomia: async ({ ctx, datos, entidad }) => {
    const t = await ctx.trx
      .selectFrom('taxonomies')
      .select('axes')
      .where('id', '=', cadena(entidad?.fila.taxonomy_id))
      .executeTakeFirst();
    const eje = ((t?.axes ?? []) as { codigo: string; categorias: { codigo: string }[] }[]).find(
      (e) => e.codigo === cadena(entidad?.fila.axis),
    );
    const categoria = cadena(campo(datos, 'categoria'));
    return eje?.categorias.some((c) => c.codigo === categoria)
      ? null
      : `«${categoria}» no es una categoría del eje en la taxonomía.`;
  },
});

async function nodoVigente(ctx: ContextoComando, ref: string): Promise<string> {
  const n = await ctx.trx
    .selectFrom('knowledge_nodes')
    .select('id')
    .where('project_id', '=', ctx.proyectoId)
    .where('ref', '=', ref)
    .where('valid_to', 'is', null)
    .executeTakeFirst();
  if (!n) throw new ErrorDominio('no_encontrado', `No hay un nodo vigente ${ref}.`);
  return n.id;
}

registrarManejadores({
  'taxonomy.propose': manejador({
    datos: z
      .object({
        codigo: z.string().regex(/^TAX-\d{3}$/),
        titulo: z.string().trim().min(3).max(200),
        ejes: z.unknown(),
        secciones: z.array(z.object({ titulo: z.string().min(1), contenido: z.string() }).strict()).default([]),
        // Versión explícita: solo para importar design/ respetando la versión del origen.
        version: z.number().int().positive().optional(),
      })
      .strict(),
    async aplicar(ctx, datos, _e, hacia) {
      const ejes = esquemaEjes.parse(datos.ejes);
      const previa = await ctx.trx
        .selectFrom('taxonomies')
        .select('version')
        .where('project_id', '=', ctx.proyectoId)
        .where('code', '=', datos.codigo)
        .orderBy('version', 'desc')
        .executeTakeFirst();
      if (datos.version !== undefined && datos.version <= (previa?.version ?? 0)) {
        throw new ErrorDominio('validacion', `La versión ${datos.version} de ${datos.codigo} no es posterior a la última.`);
      }
      const version = datos.version ?? (previa?.version ?? 0) + 1;
      const { id } = await ctx.trx
        .insertInto('taxonomies')
        .values({
          project_id: ctx.proyectoId,
          code: datos.codigo,
          version,
          title: datos.titulo,
          axes: JSON.stringify(ejes),
          sections: JSON.stringify(datos.secciones),
          content_hash: huella({ titulo: datos.titulo, ejes, secciones: datos.secciones }),
          state: hacia,
          author: formatearActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return {
        entidadId: id,
        version,
        despues: { codigo: datos.codigo, version, ejes: ejes.map((e) => e.codigo) },
        resultado: { taxonomiaId: id, version },
      };
    },
  }),

  'taxonomy.approve': manejador({
    datos: z.object({}).strict(),
    async aplicar(ctx, _d, e) {
      const id = e?.id ?? '';
      const anterior = await ctx.trx
        .selectFrom('taxonomies')
        .select('id')
        .where('project_id', '=', ctx.proyectoId)
        .where('code', '=', cadena(e?.fila.code))
        .where('state', '=', 'approved')
        .where('id', '<>', id)
        .execute();
      await ctx.trx
        .updateTable('taxonomies')
        .set({ approved_at: new Date(), approved_by: formatearActor(ctx.actor) })
        .where('id', '=', id)
        .execute();
      for (const a of anterior)
        await ctx.ejecutar({ comando: 'taxonomy.supersede', actor: sistema('taxonomia'), entidadId: a.id, datos: {} });
      return { entidadId: id, version: Number(e?.fila.version ?? 0) };
    },
  }),

  'taxonomy.supersede': manejador({
    datos: z.object({}).strict(),
    async aplicar(_ctx, _d, e) {
      return { entidadId: e?.id ?? '' };
    },
  }),

  'knowledge_update.enqueue': manejador({
    datos: z
      .object({ objeto: z.object({ tipo: z.string(), id: z.string().uuid(), version: z.number().int().nullable() }).strict() })
      .strict(),
    async aplicar(ctx, datos, _e, hacia) {
      const p = await ctx.trx
        .selectFrom('projects')
        .select('event_seq')
        .where('id', '=', ctx.proyectoId)
        .executeTakeFirstOrThrow();
      const { id } = await ctx.trx
        .insertInto('knowledge_updates')
        .values({ project_id: ctx.proyectoId, trigger: JSON.stringify(datos.objeto), trigger_seq: p.event_seq, state: hacia })
        .returning('id')
        .executeTakeFirstOrThrow();
      const { servicios, proyectoId } = ctx;
      ctx.despuesDeConfirmar(() => servicios.motor.iniciarActualizacion(id, proyectoId));
      return { entidadId: id, despues: { objeto: datos.objeto } };
    },
  }),

  'knowledge_update.classify': manejador({
    datos: z.object({}).strict(),
    async aplicar(_ctx, _d, e) {
      return { entidadId: e?.id ?? '' };
    },
  }),

  'knowledge_update.verify': manejador({
    datos: z
      .object({
        cambio: z.unknown(),
        candidatos: z.array(z.unknown()),
        input_hash: z.string(),
        clasificador: z.string(),
        veredictos: z.unknown(),
      })
      .strict(),
    async aplicar(ctx, d, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('knowledge_updates')
        .set({
          change: JSON.stringify(d.cambio),
          candidates: JSON.stringify(d.candidatos),
          candidates_hash: huella(d.candidatos),
          input_hash: d.input_hash,
          classifier: d.clasificador,
          verdicts: JSON.stringify(d.veredictos),
        })
        .where('id', '=', id)
        .execute();
      return { entidadId: id, despues: { candidatos: d.candidatos.length, input_hash: d.input_hash } };
    },
  }),

  'knowledge_update.apply': manejador({
    datos: z.object({ operaciones: z.unknown(), version_antes: z.number().int(), version_despues: z.number().int() }).strict(),
    async aplicar(ctx, d, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('knowledge_updates')
        .set({
          verification: JSON.stringify({ ok: true }),
          operations: JSON.stringify(d.operaciones),
          graph_version_before: d.version_antes,
          graph_version_after: d.version_despues,
          finished_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
      await sql`
        insert into knowledge_graph_state (project_id, version, last_update_id) values (${ctx.proyectoId}::uuid, ${d.version_despues}, ${id}::uuid)
        on conflict (project_id) do update set version = excluded.version, last_update_id = excluded.last_update_id`.execute(
        ctx.trx,
      );
      return { entidadId: id, despues: { version_antes: d.version_antes, version_despues: d.version_despues } };
    },
  }),

  'knowledge_update.reject': manejador({
    datos: z.object({ motivos: z.array(z.string()).min(1) }).strict(),
    async aplicar(ctx, d, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('knowledge_updates')
        .set({
          verification: JSON.stringify({ ok: false, motivos: d.motivos }),
          failure: d.motivos.join(' '),
          finished_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return { entidadId: id, despues: { motivos: d.motivos } };
    },
  }),

  'knowledge_update.retry': manejador({
    datos: z.object({}).strict(),
    async aplicar(ctx, _d, e) {
      const id = e?.id ?? '';
      await ctx.trx.updateTable('knowledge_updates').set({ failure: null, finished_at: null }).where('id', '=', id).execute();
      const { servicios, proyectoId } = ctx;
      ctx.despuesDeConfirmar(() => servicios.motor.iniciarActualizacion(id, proyectoId));
      return { entidadId: id };
    },
  }),

  'knowledge_node.project': manejador({
    datos: esquemaNodo,
    async aplicar(ctx, d, _e, hacia) {
      const { id } = await ctx.trx
        .insertInto('knowledge_nodes')
        .values({
          project_id: ctx.proyectoId,
          ref: d.ref,
          kind: d.tipo,
          source_type: d.origen.tipo,
          source_id: d.origen.id,
          source_version: d.origen.version,
          label: d.etiqueta,
          body: d.texto,
          categories: JSON.stringify(d.categorias),
          epistemic: d.epistemico,
          valid_from: d.desde,
          created_by_update: d.update_id,
          state: hacia,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entidadId: id, despues: { ref: d.ref, epistemico: d.epistemico, categorias: d.categorias, desde: d.desde } };
    },
  }),

  'knowledge_node.invalidate': manejador({
    datos: z.object({ hasta: z.number().int().nonnegative() }).strict(),
    async aplicar(ctx, d, e) {
      const id = e?.id ?? '';
      await ctx.trx.updateTable('knowledge_nodes').set({ valid_to: d.hasta }).where('id', '=', id).execute();
      return { entidadId: id, despues: { ref: e?.fila.ref, hasta: d.hasta } };
    },
  }),

  'knowledge_edge.project': manejador({
    datos: z
      .object({
        tipo: z.string(),
        desde: z.string(),
        hacia: z.string(),
        alta: z.number().int().nonnegative(),
        update_id: z.string().uuid().nullable(),
      })
      .strict(),
    async aplicar(ctx, d, _e, hacia) {
      const { id } = await ctx.trx
        .insertInto('knowledge_edges')
        .values({
          project_id: ctx.proyectoId,
          kind: d.tipo,
          from_node: await nodoVigente(ctx, d.desde),
          to_node: await nodoVigente(ctx, d.hacia),
          valid_from: d.alta,
          created_by_update: d.update_id,
          state: hacia,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entidadId: id, despues: { tipo: d.tipo, desde: d.desde, hacia: d.hacia, alta: d.alta } };
    },
  }),

  'knowledge_edge.invalidate': manejador({
    datos: z.object({ hasta: z.number().int().nonnegative() }).strict(),
    async aplicar(ctx, d, e) {
      const id = e?.id ?? '';
      await ctx.trx.updateTable('knowledge_edges').set({ valid_to: d.hasta }).where('id', '=', id).execute();
      return { entidadId: id, despues: { hasta: d.hasta } };
    },
  }),

  'classification.record': manejador({ datos: esquemaClasificacion(), aplicar: insertarClasificacion }),
  'classification.hold': manejador({ datos: esquemaClasificacion(), aplicar: insertarClasificacion }),

  'classification.resolve': manejador({
    datos: z.object({ categoria: z.string(), nota: z.string().trim().max(1000).optional() }).strict(),
    async aplicar(ctx, d, e) {
      const id = e?.id ?? '';
      await ctx.trx
        .updateTable('classifications')
        .set({
          resolution: JSON.stringify({ categoria: d.categoria, nota: d.nota ?? null }),
          resolved_by: formatearActor(ctx.actor),
        })
        .where('id', '=', id)
        .execute();
      return { entidadId: id, despues: { categoria: d.categoria } };
    },
  }),

  'idea_assessment.record': manejador({
    datos: z
      .object({
        propuesta_id: z.string().uuid(),
        hallazgos: z.array(z.unknown()),
        version_grafo: z.number().int().nonnegative(),
        clasificador: z.string(),
        input_hash: z.string(),
      })
      .strict(),
    async aplicar(ctx, d, _e, hacia) {
      const previa = await ctx.trx
        .selectFrom('idea_assessments')
        .select('id')
        .where('proposal_id', '=', d.propuesta_id)
        .executeTakeFirst();
      if (previa) return { entidadId: previa.id, sinCambios: true };
      const { id } = await ctx.trx
        .insertInto('idea_assessments')
        .values({
          project_id: ctx.proyectoId,
          proposal_id: d.propuesta_id,
          findings: JSON.stringify(d.hallazgos),
          graph_version: d.version_grafo,
          classifier: d.clasificador,
          input_hash: d.input_hash,
          state: hacia,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entidadId: id, despues: { propuesta: d.propuesta_id, hallazgos: d.hallazgos.length } };
    },
  }),
});

function esquemaClasificacion() {
  return z
    .object({
      nodo_ref: z.string(),
      taxonomia_id: z.string().uuid(),
      eje: z.string(),
      categoria: z.string(),
      confianza: z.number().min(0).max(1),
      justificacion: z.string(),
      clasificador: z.string(),
      input_hash: z.string(),
      update_id: z.string().uuid().nullable(),
    })
    .strict();
}

async function insertarClasificacion(
  ctx: ContextoComando,
  d: z.infer<ReturnType<typeof esquemaClasificacion>>,
  _e: unknown,
  hacia: string,
): Promise<{ entidadId: string; despues: unknown }> {
  const { id } = await ctx.trx
    .insertInto('classifications')
    .values({
      project_id: ctx.proyectoId,
      node_ref: d.nodo_ref,
      taxonomy_id: d.taxonomia_id,
      axis: d.eje,
      category: d.categoria,
      confidence: d.confianza,
      justification: d.justificacion,
      classifier: d.clasificador,
      input_hash: d.input_hash,
      update_id: d.update_id,
      state: hacia,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { entidadId: id, despues: { nodo: d.nodo_ref, eje: d.eje, categoria: d.categoria, confianza: d.confianza } };
}

// Cada evento de autoridad (aprobar una versión, aceptar una propuesta) encola «Actualizar
// conocimiento» en la misma transacción (§7.3 paso 1).
registrarReaccionDeAutoridad(async (ctx, objeto) => {
  if (!['record_version', 'proposal'].includes(objeto.tipo)) return;
  if (objeto.tipo === 'proposal') {
    // Solo las propuestas cuyo efecto es una versión de registro cambian el conocimiento.
    const p = await ctx.trx.selectFrom('proposals').select('resolution').where('id', '=', objeto.id).executeTakeFirst();
    if (!(p?.resolution as { efecto?: { versionId?: string } } | null)?.efecto?.versionId) return;
  }
  await ctx.ejecutar({ comando: 'knowledge_update.enqueue', actor: ACTUALIZADOR, datos: { objeto } });
});
