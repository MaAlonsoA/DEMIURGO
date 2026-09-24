// Registros (decisión, FDR, ADR, bug), versiones inmutables, criterios y enlaces.
// Identidad, versión, aprobación y realización son cuatro cosas distintas: aprobar no crea
// versión (I4) y una versión nueva exige arrastrar cada criterio de forma explícita.

import {
  DomainError,
  VERSION_LIMITS,
  RECORD_PREFIX,
  RECORD_TYPES,
  type RecordType,
  verifiabilityWarnings,
  templateGaps,
  formatActor,
  fingerprint,
  system,
} from '@demiurgo/domain';
import { z } from 'zod';
import { string, field, registerGuards } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import type { CommandContext } from '../bus/types.ts';
import type { Tx } from '../db/connection.ts';
import { reviewObsolescence } from './proposals.ts';
import { DISCARD_TRIGGER, onAuthorityEvent } from './reactions.ts';

const text = (max: number) => z.string().trim().min(1).max(max);
const uuid = z.string().uuid();
const RE_CODE = /^(DEC|FDR|ADR|BUG)-[A-Z]{3}-\d{3}$/;
const LINK_TYPES = ['based_on', 'design_of', 'covers', 'origin', 'conflicts_with', 'derived_from'] as const;

const L = VERSION_LIMITS;
const sectionSchema = z.object({ title: text(L.sectionTitle), content: z.string().max(L.section) }).strict();
const criterionContent = {
  title: text(L.criterionTitle),
  statement: text(L.statement),
  verification: z.enum(['automatic', 'manual']),
  check: text(L.check),
};
export const criterionInputSchema = z.discriminatedUnion('carry', [
  z
    .object({
      carry: z.literal('new'),
      code: z
        .string()
        .regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/)
        .optional(),
      // Un criterio nuevo puede derivar de otro del proyecto con otro código.
      derived_from: z
        .string()
        .regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/)
        .optional(),
      ...criterionContent,
    })
    .strict(),
  z.object({ carry: z.literal('kept'), code: z.string() }).strict(),
  z.object({ carry: z.literal('modified'), derived_from: z.string(), ...criterionContent }).strict(),
]);
export type InputCriterion = z.infer<typeof criterionInputSchema>;

export const linkInputSchema = z
  .object({
    type: z.enum(LINK_TYPES),
    target: z.object({ code: z.string().regex(RE_CODE), version: z.number().int().positive() }).strict(),
  })
  .strict();

const originSchema = z.object({ type: z.string(), id: z.string(), version: z.number().int().nullable().optional() }).strict();

const versionContentSchema = {
  title: text(L.title),
  sections: z.array(sectionSchema).min(1).max(L.sections),
  criteria: z.array(criterionInputSchema).max(L.criteria).default([]),
  discarded: z.array(z.string()).default([]),
  links: z.array(linkInputSchema).max(L.links).default([]),
  // Anexos en orden (tablas como datos): se guardan y se exportan tal cual.
  annexes: z.array(z.object({ path: z.string().regex(/^datos\/[a-z0-9-]+\.yaml$/), content: z.string() }).strict()).default([]),
  // Número de versión explícito: solo para importar design/ respetando la versión del origen.
  number: z.number().int().positive().optional(),
  increment: z
    .string()
    .regex(/^(D|S|H)\d+$/)
    .optional(),
  change_note: z.string().trim().max(L.changeNote).optional(),
  origin: originSchema.optional(),
};

export const newRecordSchema = z
  .object({
    type: z.enum(RECORD_TYPES),
    code: z.string().regex(RE_CODE).optional(),
    // Solo letras: el dominio da nombre al código (DEC-DOM-NNN) y un código lleva letras (ADR-FMT-001).
    domain: z.string().regex(/^[a-z][a-z_]*$/, 'El dominio solo lleva letras minúsculas y guiones bajos.'),
    ...versionContentSchema,
  })
  .strict();

const newVersionSchema = z.object({ record_id: uuid, ...versionContentSchema }).strict();

/** Última versión no descartada de un registro: la base del arrastre de criterios. */
async function baseVersion(trx: Tx, recordId: string) {
  return trx
    .selectFrom('record_versions')
    .selectAll()
    .where('record_id', '=', recordId)
    .where('state', '<>', 'discarded')
    .orderBy('n', 'desc')
    .executeTakeFirst();
}

export async function currentVersion(trx: Tx, recordId: string) {
  return trx
    .selectFrom('record_versions')
    .selectAll()
    .where('record_id', '=', recordId)
    .where('state', '=', 'approved')
    .orderBy('n', 'desc')
    .executeTakeFirst();
}

export async function resolveReference(trx: Tx, projectId: string, code: string, version: number) {
  return trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['record_versions.id as versionId', 'record_versions.state', 'records.id as recordId', 'records.type'])
    .where('records.project_id', '=', projectId)
    .where('records.code', '=', code)
    .where('record_versions.n', '=', version)
    .executeTakeFirst();
}

// La parte DOM-NNN de un código es única entre tipos: sus criterios se llaman AC-DOM-NNN-NN.
async function nextCode(trx: Tx, projectId: string, type: RecordType, domain: string): Promise<string> {
  const dom = domain.replaceAll('_', '').slice(0, 3).toUpperCase().padEnd(3, 'X');
  const rows = await trx
    .selectFrom('records')
    .select('code')
    .where('project_id', '=', projectId)
    .where('code', 'like', `___-${dom}-___`)
    .execute();
  const max = rows.reduce((m, f) => Math.max(m, Number(f.code.slice(-3))), 0);
  return `${RECORD_PREFIX[type]}-${dom}-${String(max + 1).padStart(3, '0')}`;
}

registerGuards({
  async free_code({ ctx, data }) {
    const code = string(field(data, 'code'));
    if (!code) return null;
    const existing = await ctx.trx
      .selectFrom('records')
      .select('code')
      .where('project_id', '=', ctx.projectId)
      .where('code', 'like', `___-${code.slice(4)}`)
      .executeTakeFirst();
    if (!existing) return null;
    return existing.code === code
      ? `El código ${code} ya existe en este proyecto.`
      : `${code} comparte ${code.slice(4)} con ${existing.code}: la parte DOM-NNN de un código es única entre tipos.`;
  },

  async valid_template({ ctx, data, entity }) {
    if (ctx.command === 'record_version.approve') {
      const v = entity?.row as { record_id: string; sections: { title: string; content: string }[] } | undefined;
      const r = await ctx.trx
        .selectFrom('records')
        .select('type')
        .where('id', '=', v?.record_id ?? '')
        .executeTakeFirstOrThrow();
      const gaps = templateGaps(r.type as RecordType, v?.sections ?? []);
      return gaps.length ? gaps.join(' ') : null;
    }
    let type = field(data, 'type') as RecordType | undefined;
    if (!type) {
      const r = await ctx.trx
        .selectFrom('records')
        .select('type')
        .where('id', '=', string(field(data, 'record_id')))
        .executeTakeFirst();
      type = r?.type as RecordType | undefined;
    }
    if (!type) return 'El registro no existe.';
    const gaps = templateGaps(
      type,
      (field(data, 'sections') as { title: string; content: string }[] | undefined) ?? [],
    );
    return gaps.length ? gaps.join(' ') : null;
  },

  async criteria_carry_complete({ ctx, data }) {
    const recordId = string(field(data, 'record_id'));
    const base = await baseVersion(ctx.trx, recordId);
    if (!base) return null;
    const criteria = (field(data, 'criteria') as InputCriterion[] | undefined) ?? [];
    const discarded = new Set((field(data, 'discarded') as string[] | undefined) ?? []);
    const covered = new Set<string>(discarded);
    for (const c of criteria) {
      if (c.carry === 'kept') covered.add(c.code);
      if (c.carry === 'modified') covered.add(c.derived_from);
    }
    const priors = await ctx.trx.selectFrom('criteria').select('code').where('record_version_id', '=', base.id).execute();
    const missing = priors.map((p) => p.code).filter((c) => !covered.has(c));
    const reasons: string[] = [];
    if (missing.length) reasons.push(`Falta decidir qué hacer con ${missing.join(', ')}: mantener, modificar o descartar.`);
    if (!string(field(data, 'change_note'))) reasons.push('Una versión nueva exige una nota de cambio.');
    const unknown = [...covered].filter((c) => !priors.some((p) => p.code === c));
    if (unknown.length) reasons.push(`${unknown.join(', ')} no está en la versión ${base.n}.`);
    return reasons.length ? reasons.join(' ') : null;
  },

  async record_of_project({ ctx, data }) {
    const r = await ctx.trx
      .selectFrom('records')
      .select('id')
      .where('id', '=', string(field(data, 'record_id')))
      .where('project_id', '=', ctx.projectId)
      .executeTakeFirst();
    return r ? null : 'El registro no existe en este proyecto.';
  },

  // Una versión aprobada más reciente es la vigente: aprobar una anterior la dejaría con dos aprobadas.
  async without_later_approved({ ctx, entity }) {
    const v = entity?.row as { record_id: string; n: number } | undefined;
    const later = await ctx.trx
      .selectFrom('record_versions')
      .select('n')
      .where('record_id', '=', v?.record_id ?? '')
      .where('state', 'in', ['approved', 'superseded'])
      .where('n', '>', v?.n ?? 0)
      .orderBy('n', 'desc')
      .executeTakeFirst();
    return later
      ? `Ya hay una versión aprobada posterior (v${later.n}): descarta este borrador o crea una versión nueva.`
      : null;
  },

  // Los criterios y los enlaces de una versión solo nacen al crearla: después su contenido no cambia (I4).
  within_its_version({ ctx, data }) {
    const versionId = string(field(data, 'version_id')) || string(field(field(data, 'from'), 'id'));
    return ctx.cause.versionBeingCreated === versionId
      ? null
      : 'Los criterios y los enlaces se crean con su versión: crea una versión nueva del registro.';
  },

  async version_in_draft({ ctx, data }) {
    const v = await ctx.trx
      .selectFrom('record_versions')
      .select('state')
      .where('id', '=', string(field(data, 'version_id')))
      .where('project_id', '=', ctx.projectId)
      .executeTakeFirst();
    return v?.state === 'draft' ? null : 'Solo se añaden criterios a una versión en borrador.';
  },

  // Solo se sustituye una versión aprobada cuando hay otra aprobada posterior del mismo registro.
  async has_later_approved({ ctx, entity }) {
    const v = entity?.row as { record_id: string; n: number } | undefined;
    const later = await ctx.trx
      .selectFrom('record_versions')
      .select('id')
      .where('record_id', '=', v?.record_id ?? '')
      .where('state', '=', 'approved')
      .where('n', '>', v?.n ?? 0)
      .executeTakeFirst();
    return later ? null : 'Una versión aprobada solo queda sustituida cuando se aprueba otra posterior.';
  },

  async endpoints_exist({ ctx, data }) {
    for (const endpoint of ['from', 'to']) {
      const id = string(field(field(data, endpoint), 'id'));
      const v = await ctx.trx
        .selectFrom('record_versions')
        .select('id')
        .where('id', '=', id)
        .where('project_id', '=', ctx.projectId)
        .executeTakeFirst();
      if (!v) return `El extremo «${endpoint}» del enlace no existe.`;
    }
    return null;
  },
});

/** Crea la versión y sus criterios y enlaces con comandos anidados del mismo actor. */
async function createVersion(
  ctx: CommandContext,
  recordId: string,
  data: z.infer<typeof newVersionSchema>,
  to: string,
): Promise<{ id: string; n: number; code: string; warnings: string[] }> {
  const record = await ctx.trx.selectFrom('records').selectAll().where('id', '=', recordId).executeTakeFirstOrThrow();
  const base = await baseVersion(ctx.trx, recordId);
  const n =
    (
      await ctx.trx
        .selectFrom('record_versions')
        .select('n')
        .where('record_id', '=', recordId)
        .orderBy('n', 'desc')
        .executeTakeFirst()
    )?.n ?? 0;
  if (data.number !== undefined && data.number <= n) {
    throw new DomainError('validation', `La versión ${data.number} no es posterior a la última (${n}).`);
  }
  const number = data.number ?? n + 1;
  const priors = base
    ? await ctx.trx.selectFrom('criteria').selectAll().where('record_version_id', '=', base.id).orderBy('position').execute()
    : [];
  const byCode = new Map(priors.map((p) => [p.code, p]));
  const acPrefix = `AC-${record.code.slice(4)}-`;
  // Un código de AC no se reutiliza nunca, ni el de un criterio descartado en una versión anterior.
  const used = new Set(
    (
      await ctx.trx
        .selectFrom('criteria')
        .innerJoin('record_versions', 'record_versions.id', 'criteria.record_version_id')
        .select('criteria.code')
        .where('record_versions.record_id', '=', recordId)
        .execute()
    ).map((c) => c.code),
  );
  let next = [...used].reduce((m, c) => Math.max(m, Number(c.slice(-2))), 0);
  // Criterios nuevos que derivan de otro: el de ese código en la última versión que lo contiene.
  const derived = new Map<string, string>();
  for (const c of data.criteria) {
    if (c.carry !== 'new' || !c.derived_from) continue;
    const origin = await ctx.trx
      .selectFrom('criteria')
      .innerJoin('record_versions', 'record_versions.id', 'criteria.record_version_id')
      .select('criteria.id')
      .where('criteria.project_id', '=', ctx.projectId)
      .where('criteria.code', '=', c.derived_from)
      .orderBy('record_versions.n', 'desc')
      .executeTakeFirst();
    if (!origin) throw new DomainError('validation', `${c.derived_from}, del que deriva un criterio nuevo, no existe.`);
    derived.set(c.derived_from, origin.id);
  }
  const criteria = data.criteria.map((c) => {
    if (c.carry === 'kept') {
      const p = byCode.get(c.code);
      if (!p) throw new DomainError('validation', `${c.code} no está en la versión anterior.`);
      return {
        code: p.code,
        title: p.title,
        statement: p.statement,
        verification: p.verification,
        check: p.check_text,
        carry: 'kept',
        derivation: p.id,
      };
    }
    if (c.carry === 'modified') {
      const p = byCode.get(c.derived_from);
      if (!p) throw new DomainError('validation', `${c.derived_from} no está en la versión anterior.`);
      return {
        code: p.code,
        title: c.title,
        statement: c.statement,
        verification: c.verification,
        check: c.check,
        carry: 'modified',
        derivation: p.id,
      };
    }
    const code = c.code ?? `${acPrefix}${String(++next).padStart(2, '0')}`;
    if (!code.startsWith(acPrefix)) throw new DomainError('validation', `El código ${code} debe empezar por ${acPrefix}.`);
    if (used.has(code)) {
      throw new DomainError(
        'validation',
        `El código ${code} ya se usó en una versión anterior: un criterio nuevo lleva un código nuevo.`,
      );
    }
    return {
      code,
      title: c.title,
      statement: c.statement,
      verification: c.verification,
      check: c.check,
      carry: 'new',
      derivation: c.derived_from ? (derived.get(c.derived_from) ?? null) : null,
    };
  });
  const codes = criteria.map((c) => c.code);
  if (new Set(codes).size !== codes.length) throw new DomainError('validation', 'Hay criterios con el mismo código.');
  const content = {
    title: data.title,
    sections: data.sections,
    criteria: criteria.map(({ code, title, statement, verification, check }) => ({
      code,
      title,
      statement,
      verification,
      check,
    })),
    annexes: data.annexes,
    increment: data.increment ?? null,
  };
  const { id } = await ctx.trx
    .insertInto('record_versions')
    .values({
      project_id: ctx.projectId,
      record_id: recordId,
      n: number,
      title: data.title,
      sections: JSON.stringify(data.sections),
      annexes: JSON.stringify(data.annexes),
      increment: data.increment ?? null,
      change_note: data.change_note ?? null,
      origin: data.origin ? JSON.stringify(data.origin) : null,
      author: formatActor(ctx.actor),
      content_hash: fingerprint(content),
      state: to,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const [i, c] of criteria.entries()) {
    await ctx.execute({
      command: 'criterion.record',
      actor: ctx.actor,
      data: {
        version_id: id,
        code: c.code,
        title: c.title,
        statement: c.statement,
        verification: c.verification,
        check: c.check,
        carry: c.carry,
        derived_from_id: c.derivation,
        position: i + 1,
      },
      cause: { versionBeingCreated: id },
    });
  }
  for (const e of data.links) {
    const target = await resolveReference(ctx.trx, ctx.projectId, e.target.code, e.target.version);
    if (!target)
      throw new DomainError('validation', `El enlace apunta a ${e.target.code}@${e.target.version}, que no existe.`);
    await ctx.execute({
      command: 'link.create',
      actor: ctx.actor,
      data: { type: e.type, from: { type: 'record_version', id }, to: { type: 'record_version', id: target.versionId } },
      cause: { versionBeingCreated: id },
    });
  }
  // El chequeo de verificabilidad nunca bloquea: el aviso vuelve con la versión creada (AC-DIS-001-14).
  const warnings = criteria.flatMap((c) => verifiabilityWarnings(c.code, c.statement));
  return { id, n: number, code: record.code, warnings };
}

registerHandlers({
  'record.create': handler({
    data: newRecordSchema,
    async apply(ctx, data, _e, to) {
      const code = data.code ?? (await nextCode(ctx.trx, ctx.projectId, data.type, data.domain));
      if (!code.startsWith(`${RECORD_PREFIX[data.type]}-`)) {
        throw new DomainError('validation', `El código ${code} no corresponde a un registro de tipo «${data.type}».`);
      }
      const { id } = await ctx.trx
        .insertInto('records')
        .values({ project_id: ctx.projectId, code: code, type: data.type, domain: data.domain, state: to })
        .returning('id')
        .executeTakeFirstOrThrow();
      const { type: _t, code: _c, domain: _d, ...content } = data;
      const v = await ctx.execute({
        command: 'record_version.create',
        actor: ctx.actor,
        data: { record_id: id, ...content },
      });
      return {
        entityId: id,
        after: { code, type: data.type, domain: data.domain },
        result: {
          recordId: id,
          code,
          versionId: v.entityId,
          version: (v.result as { version: number }).version,
          warnings: (v.result as { warnings: string[] }).warnings,
        },
      };
    },
  }),

  'record_version.create': handler({
    data: newVersionSchema,
    async apply(ctx, data, _e, to) {
      const v = await createVersion(ctx, data.record_id, data, to);
      return {
        entityId: v.id,
        version: v.n,
        after: { code: v.code, n: v.n, title: data.title, change_note: data.change_note ?? null },
        result: { versionId: v.id, version: v.n, code: v.code, warnings: v.warnings },
      };
    },
  }),

  'record_version.approve': handler({
    data: z.object({ note: z.string().trim().max(2000).optional() }).strict(),
    async apply(ctx, data, e) {
      const v = e?.row as { id: string; record_id: string; n: number };
      const previous = await ctx.trx
        .selectFrom('record_versions')
        .selectAll()
        .where('record_id', '=', v.record_id)
        .where('state', '=', 'approved')
        .where('id', '<>', v.id)
        .orderBy('n', 'desc')
        .executeTakeFirst();
      await ctx.trx
        .updateTable('record_versions')
        .set({ approved_at: new Date(), approved_by: formatActor(ctx.actor) })
        .where('id', '=', v.id)
        .execute();
      if (previous && previous.n < v.n) {
        await ctx.execute({
          command: 'record_version.supersede',
          actor: system('versions'),
          entityId: previous.id,
          data: {},
        });
        // Lo que se basaba en la versión anterior queda pendiente de revisión (nunca se cambia solo).
        const links = await ctx.trx
          .selectFrom('links')
          .select('id')
          .where('to_id', '=', previous.id)
          .where('state', 'in', ['current', 'kept', 'changed'])
          .execute();
        for (const l of links) {
          await ctx.execute({
            command: 'link.flag_review',
            actor: system('versions'),
            entityId: l.id,
            data: { reason: `Hay una versión nueva (v${v.n}) del registro enlazado.` },
          });
        }
      }
      await reviewObsolescence(ctx, { record: v.record_id });
      await onAuthorityEvent(ctx, { type: 'record_version', id: v.id, version: v.n });
      return { entityId: v.id, version: v.n, after: { note: data.note ?? null, supersedes: previous?.n ?? null } };
    },
  }),

  'record_version.supersede': handler({
    data: z.object({}).strict(),
    async apply(_ctx, _d, e) {
      return { entityId: e?.id ?? '', version: Number(e?.row.n ?? 0) };
    },
  }),

  'record_version.discard': handler({
    data: z.object({ reason: z.string().trim().max(1000).optional() }).strict(),
    async apply(ctx, data, e) {
      const n = Number(e?.row.n ?? 0);
      // Lo que enlazaba este borrador queda pendiente de revisión, y lo que dependía de él, obsoleto.
      const links = await ctx.trx
        .selectFrom('links')
        .select('id')
        .where('to_id', '=', e?.id ?? '')
        .where('state', 'in', ['current', 'kept', 'changed'])
        .execute();
      for (const l of links) {
        await ctx.execute({
          command: 'link.flag_review',
          actor: system('versions'),
          entityId: l.id,
          data: { reason: `La versión enlazada (v${n}) se ha descartado.` },
        });
      }
      await reviewObsolescence(ctx, { record: string(e?.row.record_id) });
      // Lo que el borrador proyectó en el conocimiento (si venía de una propuesta aceptada) se retira.
      await onAuthorityEvent(ctx, { type: DISCARD_TRIGGER, id: e?.id ?? '', version: n });
      return { entityId: e?.id ?? '', version: n, after: { reason: data.reason ?? null } };
    },
  }),

  'criterion.record': handler({
    data: z
      .object({
        version_id: uuid,
        code: z.string().regex(/^AC-[A-Z]{3}-\d{3}-\d{2}$/),
        ...criterionContent,
        carry: z.enum(['new', 'kept', 'modified']),
        derived_from_id: uuid.nullable(),
        position: z.number().int().positive(),
      })
      .strict(),
    async apply(ctx, d, _e, to) {
      const record = await ctx.trx
        .selectFrom('record_versions')
        .innerJoin('records', 'records.id', 'record_versions.record_id')
        .select('records.code')
        .where('record_versions.id', '=', d.version_id)
        .executeTakeFirstOrThrow();
      if (!d.code.startsWith(`AC-${record.code.slice(4)}-`)) {
        throw new DomainError('validation', `El código ${d.code} no corresponde a ${record.code}.`);
      }
      const { id } = await ctx.trx
        .insertInto('criteria')
        .values({
          project_id: ctx.projectId,
          record_version_id: d.version_id,
          code: d.code,
          title: d.title,
          statement: d.statement,
          verification: d.verification,
          check_text: d.check,
          derived_from: d.derived_from_id,
          carry: d.carry,
          position: d.position,
          state: to,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, after: { code: d.code, version: d.version_id, carry: d.carry } };
    },
  }),

  'link.create': handler({
    data: z
      .object({
        type: z.enum(LINK_TYPES),
        from: z.object({ type: z.literal('record_version'), id: uuid }).strict(),
        to: z.object({ type: z.literal('record_version'), id: uuid }).strict(),
      })
      .strict(),
    async apply(ctx, d, _e, to) {
      const n = async (id: string) =>
        (await ctx.trx.selectFrom('record_versions').select('n').where('id', '=', id).executeTakeFirstOrThrow()).n;
      const { id } = await ctx.trx
        .insertInto('links')
        .values({
          project_id: ctx.projectId,
          type: d.type,
          from_type: d.from.type,
          from_id: d.from.id,
          from_version: await n(d.from.id),
          to_type: d.to.type,
          to_id: d.to.id,
          to_version: await n(d.to.id),
          state: to,
          created_by: formatActor(ctx.actor),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { entityId: id, after: { type: d.type, from: d.from.id, to: d.to.id } };
    },
  }),

  'link.flag_review': handler({
    data: z.object({ reason: z.string().max(1000) }).strict(),
    async apply(_ctx, d, e) {
      return { entityId: e?.id ?? '', after: { reason: d.reason } };
    },
  }),
  'link.keep': handler({
    data: z.object({ note: z.string().trim().max(1000).optional() }).strict(),
    async apply(_ctx, d, e) {
      return { entityId: e?.id ?? '', after: { note: d.note ?? null } };
    },
  }),
  'link.change': handler({
    data: z.object({ note: z.string().trim().max(1000).optional() }).strict(),
    async apply(_ctx, d, e) {
      return { entityId: e?.id ?? '', after: { note: d.note ?? null } };
    },
  }),
  'link.obsolete': handler({
    data: z.object({ note: z.string().trim().max(1000).optional() }).strict(),
    async apply(_ctx, d, e) {
      return { entityId: e?.id ?? '', after: { note: d.note ?? null } };
    },
  }),
});
