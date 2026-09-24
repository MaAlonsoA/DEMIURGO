// Registros (decisión, FDR, ADR, bug), versiones inmutables, criterios y enlaces.
// Identidad, versión, aprobación y realización son cuatro cosas distintas: aprobar no crea
// versión (I4) y una versión nueva exige arrastrar cada criterio de forma explícita.

import {
  ErrorDominio,
  PREFIJO_REGISTRO,
  TIPOS_REGISTRO,
  type TipoRegistro,
  faltasDePlantilla,
  formatearActor,
  huella,
  sistema,
} from '@demiurgo/domain';
import { z } from 'zod';
import { cadena, campo, registrarGuardas } from '../bus/guardas.ts';
import { manejador, registrarManejadores } from '../bus/manejadores.ts';
import type { ContextoComando } from '../bus/tipos.ts';
import type { Tx } from '../db/conexion.ts';
import { alEventoDeAutoridad } from './reacciones.ts';

const texto = (max: number) => z.string().trim().min(1).max(max);
const uuid = z.string().uuid();
const RE_CODIGO = /^(DEC|FDR|ADR|BUG)-[A-Z]{3}-\d{3}$/;
const TIPOS_ENLACE = ['based_on', 'design_of', 'covers', 'origin', 'conflicts_with', 'derived_from'] as const;

const esquemaSeccion = z.object({ titulo: texto(120), contenido: z.string().max(50_000) }).strict();
const contenidoCriterio = {
  titulo: texto(200),
  enunciado: texto(3000),
  verificacion: z.enum(['automatic', 'manual']),
  comprobacion: texto(1000),
};
export const esquemaCriterioEntrada = z.discriminatedUnion('arrastre', [
  z
    .object({
      arrastre: z.literal('new'),
      codigo: z
        .string()
        .regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/)
        .optional(),
      ...contenidoCriterio,
    })
    .strict(),
  z.object({ arrastre: z.literal('kept'), codigo: z.string() }).strict(),
  z.object({ arrastre: z.literal('modified'), deriva_de: z.string(), ...contenidoCriterio }).strict(),
]);
export type CriterioEntrada = z.infer<typeof esquemaCriterioEntrada>;

export const esquemaEnlaceEntrada = z
  .object({
    tipo: z.enum(TIPOS_ENLACE),
    destino: z.object({ codigo: z.string().regex(RE_CODIGO), version: z.number().int().positive() }).strict(),
  })
  .strict();

const esquemaOrigen = z.object({ tipo: z.string(), id: z.string(), version: z.number().int().nullable().optional() }).strict();

const esquemaContenidoVersion = {
  titulo: texto(200),
  secciones: z.array(esquemaSeccion).min(1).max(40),
  criterios: z.array(esquemaCriterioEntrada).max(60).default([]),
  descartados: z.array(z.string()).default([]),
  enlaces: z.array(esquemaEnlaceEntrada).max(40).default([]),
  anexos: z.record(z.string().regex(/^datos\/[a-z0-9-]+\.yaml$/), z.string()).default({}),
  incremento: z
    .string()
    .regex(/^(D|S|H)\d+$/)
    .optional(),
  nota_de_cambio: z.string().trim().max(2000).optional(),
  origen: esquemaOrigen.optional(),
};

export const esquemaNuevoRegistro = z
  .object({
    tipo: z.enum(TIPOS_REGISTRO),
    codigo: z.string().regex(RE_CODIGO).optional(),
    dominio: z.string().regex(/^[a-z][a-z0-9_]*$/),
    ...esquemaContenidoVersion,
  })
  .strict();

const esquemaNuevaVersion = z.object({ record_id: uuid, ...esquemaContenidoVersion }).strict();

/** Última versión no descartada de un registro: la base del arrastre de criterios. */
async function versionBase(trx: Tx, recordId: string) {
  return trx
    .selectFrom('record_versions')
    .selectAll()
    .where('record_id', '=', recordId)
    .where('state', '<>', 'discarded')
    .orderBy('n', 'desc')
    .executeTakeFirst();
}

export async function versionVigente(trx: Tx, recordId: string) {
  return trx
    .selectFrom('record_versions')
    .selectAll()
    .where('record_id', '=', recordId)
    .where('state', '=', 'approved')
    .orderBy('n', 'desc')
    .executeTakeFirst();
}

export async function resolverReferencia(trx: Tx, proyectoId: string, codigo: string, version: number) {
  return trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['record_versions.id as versionId', 'record_versions.state', 'records.id as recordId', 'records.type'])
    .where('records.project_id', '=', proyectoId)
    .where('records.code', '=', codigo)
    .where('record_versions.n', '=', version)
    .executeTakeFirst();
}

async function siguienteCodigo(trx: Tx, proyectoId: string, tipo: TipoRegistro, dominio: string): Promise<string> {
  const base = `${PREFIJO_REGISTRO[tipo]}-${dominio.replaceAll('_', '').slice(0, 3).toUpperCase().padEnd(3, 'X')}`;
  const filas = await trx
    .selectFrom('records')
    .select('code')
    .where('project_id', '=', proyectoId)
    .where('code', 'like', `${base}-%`)
    .execute();
  const max = filas.reduce((m, f) => Math.max(m, Number(f.code.slice(-3))), 0);
  return `${base}-${String(max + 1).padStart(3, '0')}`;
}

registrarGuardas({
  async codigo_libre({ ctx, datos }) {
    const codigo = cadena(campo(datos, 'codigo'));
    if (!codigo) return null;
    const previo = await ctx.trx
      .selectFrom('records')
      .select('id')
      .where('project_id', '=', ctx.proyectoId)
      .where('code', '=', codigo)
      .executeTakeFirst();
    return previo ? `El código ${codigo} ya existe en este proyecto.` : null;
  },

  async plantilla_valida({ ctx, datos, entidad }) {
    if (ctx.comando === 'record_version.approve') {
      const v = entidad?.fila as { record_id: string; sections: { titulo: string; contenido: string }[] } | undefined;
      const r = await ctx.trx
        .selectFrom('records')
        .select('type')
        .where('id', '=', v?.record_id ?? '')
        .executeTakeFirstOrThrow();
      const faltas = faltasDePlantilla(r.type as TipoRegistro, v?.sections ?? []);
      return faltas.length ? faltas.join(' ') : null;
    }
    let tipo = campo(datos, 'tipo') as TipoRegistro | undefined;
    if (!tipo) {
      const r = await ctx.trx
        .selectFrom('records')
        .select('type')
        .where('id', '=', cadena(campo(datos, 'record_id')))
        .executeTakeFirst();
      tipo = r?.type as TipoRegistro | undefined;
    }
    if (!tipo) return 'El registro no existe.';
    const faltas = faltasDePlantilla(
      tipo,
      (campo(datos, 'secciones') as { titulo: string; contenido: string }[] | undefined) ?? [],
    );
    return faltas.length ? faltas.join(' ') : null;
  },

  async arrastre_de_criterios_completo({ ctx, datos }) {
    const recordId = cadena(campo(datos, 'record_id'));
    const base = await versionBase(ctx.trx, recordId);
    if (!base) return null;
    const criterios = (campo(datos, 'criterios') as CriterioEntrada[] | undefined) ?? [];
    const descartados = new Set((campo(datos, 'descartados') as string[] | undefined) ?? []);
    const cubiertos = new Set<string>(descartados);
    for (const c of criterios) {
      if (c.arrastre === 'kept') cubiertos.add(c.codigo);
      if (c.arrastre === 'modified') cubiertos.add(c.deriva_de);
    }
    const previos = await ctx.trx.selectFrom('criteria').select('code').where('record_version_id', '=', base.id).execute();
    const faltan = previos.map((p) => p.code).filter((c) => !cubiertos.has(c));
    const motivos: string[] = [];
    if (faltan.length) motivos.push(`Falta decidir qué hacer con ${faltan.join(', ')}: mantener, modificar o descartar.`);
    if (!cadena(campo(datos, 'nota_de_cambio'))) motivos.push('Una versión nueva exige una nota de cambio.');
    const desconocidos = [...cubiertos].filter((c) => !previos.some((p) => p.code === c));
    if (desconocidos.length) motivos.push(`${desconocidos.join(', ')} no está en la versión ${base.n}.`);
    return motivos.length ? motivos.join(' ') : null;
  },

  async version_en_borrador({ ctx, datos }) {
    const v = await ctx.trx
      .selectFrom('record_versions')
      .select('state')
      .where('id', '=', cadena(campo(datos, 'version_id')))
      .executeTakeFirst();
    return v?.state === 'draft' ? null : 'Solo se añaden criterios a una versión en borrador.';
  },

  async extremos_existentes({ ctx, datos }) {
    for (const extremo of ['desde', 'hacia']) {
      const id = cadena(campo(campo(datos, extremo), 'id'));
      const v = await ctx.trx
        .selectFrom('record_versions')
        .select('id')
        .where('id', '=', id)
        .where('project_id', '=', ctx.proyectoId)
        .executeTakeFirst();
      if (!v) return `El extremo «${extremo}» del enlace no existe.`;
    }
    return null;
  },
});

/** Crea la versión y sus criterios y enlaces con comandos anidados del mismo actor. */
async function crearVersion(
  ctx: ContextoComando,
  recordId: string,
  datos: z.infer<typeof esquemaNuevaVersion>,
  hacia: string,
): Promise<{ id: string; n: number; codigo: string }> {
  const registro = await ctx.trx.selectFrom('records').selectAll().where('id', '=', recordId).executeTakeFirstOrThrow();
  const base = await versionBase(ctx.trx, recordId);
  const n =
    (
      await ctx.trx
        .selectFrom('record_versions')
        .select('n')
        .where('record_id', '=', recordId)
        .orderBy('n', 'desc')
        .executeTakeFirst()
    )?.n ?? 0;
  const previos = base
    ? await ctx.trx.selectFrom('criteria').selectAll().where('record_version_id', '=', base.id).orderBy('position').execute()
    : [];
  const porCodigo = new Map(previos.map((p) => [p.code, p]));
  const prefijoAc = `AC-${registro.code.slice(4)}-`;
  let siguiente = previos.reduce((m, p) => Math.max(m, Number(p.code.slice(-2))), 0);
  const criterios = datos.criterios.map((c) => {
    if (c.arrastre === 'kept') {
      const p = porCodigo.get(c.codigo);
      if (!p) throw new ErrorDominio('validacion', `${c.codigo} no está en la versión anterior.`);
      return {
        codigo: p.code,
        titulo: p.title,
        enunciado: p.statement,
        verificacion: p.verification,
        comprobacion: p.check_text,
        arrastre: 'kept',
        deriva: p.id,
      };
    }
    if (c.arrastre === 'modified') {
      const p = porCodigo.get(c.deriva_de);
      if (!p) throw new ErrorDominio('validacion', `${c.deriva_de} no está en la versión anterior.`);
      return {
        codigo: p.code,
        titulo: c.titulo,
        enunciado: c.enunciado,
        verificacion: c.verificacion,
        comprobacion: c.comprobacion,
        arrastre: 'modified',
        deriva: p.id,
      };
    }
    const codigo = c.codigo ?? `${prefijoAc}${String(++siguiente).padStart(2, '0')}`;
    if (!codigo.startsWith(prefijoAc)) throw new ErrorDominio('validacion', `El código ${codigo} debe empezar por ${prefijoAc}.`);
    return {
      codigo,
      titulo: c.titulo,
      enunciado: c.enunciado,
      verificacion: c.verificacion,
      comprobacion: c.comprobacion,
      arrastre: 'new',
      deriva: null,
    };
  });
  const codigos = criterios.map((c) => c.codigo);
  if (new Set(codigos).size !== codigos.length) throw new ErrorDominio('validacion', 'Hay criterios con el mismo código.');
  const contenido = {
    titulo: datos.titulo,
    secciones: datos.secciones,
    criterios: criterios.map(({ codigo, titulo, enunciado, verificacion, comprobacion }) => ({
      codigo,
      titulo,
      enunciado,
      verificacion,
      comprobacion,
    })),
    anexos: datos.anexos,
    incremento: datos.incremento ?? null,
  };
  const { id } = await ctx.trx
    .insertInto('record_versions')
    .values({
      project_id: ctx.proyectoId,
      record_id: recordId,
      n: n + 1,
      title: datos.titulo,
      sections: JSON.stringify(datos.secciones),
      annexes: JSON.stringify(datos.anexos),
      increment: datos.incremento ?? null,
      change_note: datos.nota_de_cambio ?? null,
      origin: datos.origen ? JSON.stringify(datos.origen) : null,
      author: formatearActor(ctx.actor),
      content_hash: huella(contenido),
      state: hacia,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const [i, c] of criterios.entries()) {
    await ctx.ejecutar({
      comando: 'criterion.record',
      actor: ctx.actor,
      datos: {
        version_id: id,
        codigo: c.codigo,
        titulo: c.titulo,
        enunciado: c.enunciado,
        verificacion: c.verificacion,
        comprobacion: c.comprobacion,
        arrastre: c.arrastre,
        deriva_de_id: c.deriva,
        posicion: i + 1,
      },
    });
  }
  for (const e of datos.enlaces) {
    const destino = await resolverReferencia(ctx.trx, ctx.proyectoId, e.destino.codigo, e.destino.version);
    if (!destino)
      throw new ErrorDominio('validacion', `El enlace apunta a ${e.destino.codigo}@${e.destino.version}, que no existe.`);
    await ctx.ejecutar({
      comando: 'link.create',
      actor: ctx.actor,
      datos: { tipo: e.tipo, desde: { tipo: 'record_version', id }, hacia: { tipo: 'record_version', id: destino.versionId } },
    });
  }
  return { id, n: n + 1, codigo: registro.code };
}

registrarManejadores({
  'record.create': manejador({
    datos: esquemaNuevoRegistro,
    async aplicar(ctx, datos, _e, hacia) {
      const codigo = datos.codigo ?? (await siguienteCodigo(ctx.trx, ctx.proyectoId, datos.tipo, datos.dominio));
      if (!codigo.startsWith(`${PREFIJO_REGISTRO[datos.tipo]}-`)) {
        throw new ErrorDominio('validacion', `El código ${codigo} no corresponde a un registro de tipo «${datos.tipo}».`);
      }
      const { id } = await ctx.trx
        .insertInto('records')
        .values({ project_id: ctx.proyectoId, code: codigo, type: datos.tipo, domain: datos.dominio, state: hacia })
        .returning('id')
        .executeTakeFirstOrThrow();
      const { tipo: _t, codigo: _c, dominio: _d, ...contenido } = datos;
      const v = await ctx.ejecutar({
        comando: 'record_version.create',
        actor: ctx.actor,
        datos: { record_id: id, ...contenido },
      });
      return {
        entidadId: id,
        despues: { codigo, tipo: datos.tipo, dominio: datos.dominio },
        resultado: { recordId: id, codigo, versionId: v.entidadId, version: 1 },
      };
    },
  }),

  'record_version.create': manejador({
    datos: esquemaNuevaVersion,
    async aplicar(ctx, datos, _e, hacia) {
      const v = await crearVersion(ctx, datos.record_id, datos, hacia);
      return {
        entidadId: v.id,
        version: v.n,
        despues: { codigo: v.codigo, n: v.n, titulo: datos.titulo, nota_de_cambio: datos.nota_de_cambio ?? null },
        resultado: { versionId: v.id, version: v.n, codigo: v.codigo },
      };
    },
  }),

  'record_version.approve': manejador({
    datos: z.object({ nota: z.string().trim().max(2000).optional() }).strict(),
    async aplicar(ctx, datos, e) {
      const v = e?.fila as { id: string; record_id: string; n: number };
      const anterior = await versionVigente(ctx.trx, v.record_id);
      await ctx.trx
        .updateTable('record_versions')
        .set({ approved_at: new Date(), approved_by: formatearActor(ctx.actor) })
        .where('id', '=', v.id)
        .execute();
      if (anterior && anterior.n < v.n) {
        await ctx.ejecutar({
          comando: 'record_version.supersede',
          actor: sistema('versiones'),
          entidadId: anterior.id,
          datos: {},
        });
        // Lo que se basaba en la versión anterior queda pendiente de revisión (nunca se cambia solo).
        const enlaces = await ctx.trx
          .selectFrom('links')
          .select('id')
          .where('to_id', '=', anterior.id)
          .where('state', 'in', ['current', 'kept', 'changed'])
          .execute();
        for (const l of enlaces) {
          await ctx.ejecutar({
            comando: 'link.flag_review',
            actor: sistema('versiones'),
            entidadId: l.id,
            datos: { motivo: `Hay una versión nueva (v${v.n}) del registro enlazado.` },
          });
        }
      }
      await supersederPropuestasObsoletas(ctx, v.record_id, v.n);
      await alEventoDeAutoridad(ctx, { tipo: 'record_version', id: v.id, version: v.n });
      return { entidadId: v.id, version: v.n, despues: { nota: datos.nota ?? null, sustituye: anterior?.n ?? null } };
    },
  }),

  'record_version.supersede': manejador({
    datos: z.object({}).strict(),
    async aplicar(_ctx, _d, e) {
      return { entidadId: e?.id ?? '', version: Number(e?.fila.n ?? 0) };
    },
  }),

  'record_version.discard': manejador({
    datos: z.object({ motivo: z.string().trim().max(1000).optional() }).strict(),
    async aplicar(_ctx, datos, e) {
      return { entidadId: e?.id ?? '', version: Number(e?.fila.n ?? 0), despues: { motivo: datos.motivo ?? null } };
    },
  }),

  'criterion.record': manejador({
    datos: z
      .object({
        version_id: uuid,
        codigo: z.string().regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/),
        ...contenidoCriterio,
        arrastre: z.enum(['new', 'kept', 'modified']),
        deriva_de_id: uuid.nullable(),
        posicion: z.number().int().positive(),
      })
      .strict(),
    async aplicar(ctx, d, _e, hacia) {
      const { id } = await ctx.trx
        .insertInto('criteria')
        .values({
          project_id: ctx.proyectoId,
          record_version_id: d.version_id,
          code: d.codigo,
          title: d.titulo,
          statement: d.enunciado,
          verification: d.verificacion,
          check_text: d.comprobacion,
          derived_from: d.deriva_de_id,
          carry: d.arrastre,
          position: d.posicion,
          state: hacia,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entidadId: id, despues: { codigo: d.codigo, version: d.version_id, arrastre: d.arrastre } };
    },
  }),

  'link.create': manejador({
    datos: z
      .object({
        tipo: z.enum(TIPOS_ENLACE),
        desde: z.object({ tipo: z.literal('record_version'), id: uuid }).strict(),
        hacia: z.object({ tipo: z.literal('record_version'), id: uuid }).strict(),
      })
      .strict(),
    async aplicar(ctx, d, _e, hacia) {
      const n = async (id: string) =>
        (await ctx.trx.selectFrom('record_versions').select('n').where('id', '=', id).executeTakeFirstOrThrow()).n;
      const { id } = await ctx.trx
        .insertInto('links')
        .values({
          project_id: ctx.proyectoId,
          type: d.tipo,
          from_type: d.desde.tipo,
          from_id: d.desde.id,
          from_version: await n(d.desde.id),
          to_type: d.hacia.tipo,
          to_id: d.hacia.id,
          to_version: await n(d.hacia.id),
          state: hacia,
          created_by: formatearActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entidadId: id, despues: { tipo: d.tipo, desde: d.desde.id, hacia: d.hacia.id } };
    },
  }),

  'link.flag_review': manejador({
    datos: z.object({ motivo: z.string().max(1000) }).strict(),
    async aplicar(_ctx, d, e) {
      return { entidadId: e?.id ?? '', despues: { motivo: d.motivo } };
    },
  }),
  'link.keep': manejador({
    datos: z.object({ nota: z.string().trim().max(1000).optional() }).strict(),
    async aplicar(_ctx, d, e) {
      return { entidadId: e?.id ?? '', despues: { nota: d.nota ?? null } };
    },
  }),
  'link.change': manejador({
    datos: z.object({ nota: z.string().trim().max(1000).optional() }).strict(),
    async aplicar(_ctx, d, e) {
      return { entidadId: e?.id ?? '', despues: { nota: d.nota ?? null } };
    },
  }),
  'link.obsolete': manejador({
    datos: z.object({ nota: z.string().trim().max(1000).optional() }).strict(),
    async aplicar(_ctx, d, e) {
      return { entidadId: e?.id ?? '', despues: { nota: d.nota ?? null } };
    },
  }),
});

/** Una propuesta pendiente que dependía de una versión anterior del registro queda obsoleta. */
async function supersederPropuestasObsoletas(ctx: ContextoComando, recordId: string, nueva: number): Promise<void> {
  const pendientes = await ctx.trx
    .selectFrom('proposals')
    .select(['id', 'dependencies'])
    .where('project_id', '=', ctx.proyectoId)
    .where('state', '=', 'pending')
    .execute();
  for (const p of pendientes) {
    const deps = (p.dependencies ?? []) as { tipo: string; id: string; version: number }[];
    const obsoleta = deps.some((d) => d.tipo === 'record' && d.id === recordId && d.version !== nueva);
    if (obsoleta) {
      await ctx.ejecutar({
        comando: 'proposal.supersede',
        actor: sistema('versiones'),
        entidadId: p.id,
        datos: { motivo: `Un registro del que dependía tiene una versión vigente nueva (v${nueva}).` },
      });
    }
  }
}
