// Importación de design/ (H1, AC-CON-001-10): el árbol entero entra como un lote pendiente de
// resolución en paquete, idempotente por la huella del árbol. Nada queda aprobado hasta que una
// persona ratifica el paquete; al ratificar, cada documento se crea con el estado de su archivo.
// Cada documento se compara con lo que ya hay en la v2 renderizándolo igual que la exportación:
// «no hay nada que importar» equivale a «la exportación no tiene diff».

import {
  FOLDERS,
  type RecordDocument,
  type TaxonomyDocument,
  type ValidationReport,
  renderDocument,
  validateTree,
} from '@demiurgo/design';
import { PAYLOADS, DomainError, formatActor, fingerprint, system } from '@demiurgo/domain';
import { z } from 'zod';
import { field, registerGuards } from '../bus/guards.ts';
import { handler, registerHandlers } from '../bus/handlers.ts';
import type { CommandContext } from '../bus/types.ts';
import type { Tx } from '../db/connection.ts';
import { registerApplication } from '../commands/effects.ts';
import { derivationOf, taxonomyDocument, versionDocument } from './export.ts';

export const IMPORTER = system('importer');

const VERSION_STATE: Record<string, string> = { proposed: 'draft', approved: 'approved' };
const READABLE_STATE: Record<string, string> = {
  draft: 'en borrador',
  approved: 'approved',
  superseded: 'superseded',
  discarded: 'discarded',
};

export type ImportedDocument = RecordDocument & { annexesContent: { path: string; content: string }[] };

/** Orden topológico: los destinos de los enlaces y de «Deriva de» antes que quienes los citan. */
function sort(records: RecordDocument[]): RecordDocument[] {
  const byCode = new Map(records.map((r) => [r.code, r]));
  const acOwner = new Map(records.flatMap((r) => r.criteria.map((c) => [c.code, r] as const)));
  const done = new Set<string>();
  const command: RecordDocument[] = [];
  const visit = (r: RecordDocument, stack: Set<string>) => {
    if (done.has(r.code) || stack.has(r.code)) return;
    stack.add(r.code);
    for (const e of r.links) {
      const d = byCode.get(e.target.code);
      if (d) visit(d, stack);
    }
    for (const c of r.criteria) {
      const d = c.derivedFrom ? acOwner.get(c.derivedFrom) : undefined;
      if (d && d !== r) visit(d, stack);
    }
    done.add(r.code);
    command.push(r);
  };
  for (const r of [...records].sort((a, b) => (a.code < b.code ? -1 : 1))) visit(r, new Set());
  return command;
}

export type Counts = Record<
  'decision' | 'adr' | 'fdr' | 'bug' | 'versions' | 'criteria' | 'links' | 'taxonomies' | 'annexes',
  number
>;

export function treeCounts(records: RecordDocument[], taxonomies: TaxonomyDocument[]): Counts {
  return {
    decision: records.filter((r) => r.type === 'decision').length,
    adr: records.filter((r) => r.type === 'adr').length,
    fdr: records.filter((r) => r.type === 'fdr').length,
    bug: records.filter((r) => r.type === 'bug').length,
    // design/ guarda una versión por registro: la que está en curso.
    versions: records.length,
    criteria: records.reduce((n, r) => n + r.criteria.length, 0),
    links: records.reduce((n, r) => n + r.links.length, 0),
    taxonomies: taxonomies.length,
    annexes: records.reduce((n, r) => n + r.annexes.length, 0),
  };
}

registerGuards({
  valid_design: ({ data }) => {
    const tree = field(data, 'tree') as Record<string, string> | undefined;
    if (!tree || typeof tree !== 'object') return 'Falta el árbol de design/.';
    const report = validateTree(new Map(Object.entries(tree)));
    if (report.problems.length === 0) return null;
    return `design/ no es válido: ${report.problems
      .slice(0, 10)
      .map((p) => `${p.path}: ${p.message}`)
      .join(' · ')}`;
  },
});

/** El texto de una versión de la v2 con otro estado: sirve para comparar solo el contenido. */
const contentOf = (doc: RecordDocument | TaxonomyDocument) => renderDocument({ ...doc, state: 'proposed' });

async function recordOf(trx: Tx, projectId: string, code: string) {
  return trx.selectFrom('records').selectAll().where('project_id', '=', projectId).where('code', '=', code).executeTakeFirst();
}

async function latestVersion(trx: Tx, recordId: string): Promise<number> {
  const v = await trx
    .selectFrom('record_versions')
    .select('n')
    .where('record_id', '=', recordId)
    .orderBy('n', 'desc')
    .executeTakeFirst();
  return v?.n ?? 0;
}

/** Versión aprobada (o ya sustituida) posterior a `n`: aprobar la `n` haría retroceder la vigente. */
async function laterApproved(trx: Tx, recordId: string, n: number): Promise<number | null> {
  const v = await trx
    .selectFrom('record_versions')
    .select('n')
    .where('record_id', '=', recordId)
    .where('state', 'in', ['approved', 'superseded'])
    .where('n', '>', n)
    .orderBy('n', 'desc')
    .executeTakeFirst();
  return v?.n ?? null;
}

/**
 * Problemas de los criterios de una versión nueva de un registro que ya está en la v2: un código
 * que ya se usó y ya no está (nunca se reutiliza) o un «Deriva de» distinto del que tenía el criterio.
 */
async function criteriaProblems(trx: Tx, recordId: string, r: RecordDocument, path: string): Promise<string[]> {
  const problems: string[] = [];
  const base = await trx
    .selectFrom('record_versions')
    .select('id')
    .where('record_id', '=', recordId)
    .where('state', '<>', 'discarded')
    .orderBy('n', 'desc')
    .executeTakeFirst();
  const priors = base
    ? await trx.selectFrom('criteria').select(['id', 'code']).where('record_version_id', '=', base.id).execute()
    : [];
  const used = new Set(
    (
      await trx
        .selectFrom('criteria')
        .innerJoin('record_versions', 'record_versions.id', 'criteria.record_version_id')
        .select('criteria.code')
        .where('record_versions.record_id', '=', recordId)
        .execute()
    ).map((c) => c.code),
  );
  for (const c of r.criteria) {
    const existing = priors.find((p) => p.code === c.code);
    if (!existing) {
      if (used.has(c.code))
        problems.push(`${path}: ${c.code} ya se usó en una versión anterior; un criterio nuevo lleva un código nuevo.`);
      continue;
    }
    if ((await derivationOf(trx, existing.id)) !== (c.derivedFrom ?? null)) {
      problems.push(
        `${path}: ${c.code} cambia su «Deriva de»; un criterio que se mantiene o se modifica conserva su derivación.`,
      );
    }
  }
  return problems;
}

type Plan = { proposals: { type: string; payload: Record<string, unknown> }[]; problems: string[] };

/**
 * Qué proponer de cada documento según lo que ya hay en la v2: nada si coincide (contenido y
 * estado), la aprobación si solo cambia el estado de propuesto a aprobado, o una versión nueva.
 * Una versión que ya existe con otro contenido, o anterior a la última, es un problema.
 */
async function buildPlan(ctx: CommandContext, tree: Map<string, string>, report: ValidationReport): Promise<Plan> {
  const plan: Plan = { proposals: [], problems: [] };
  const versionInDesign = new Map(report.records.map((r) => [r.code, r.version]));
  for (const r of sort(report.records)) {
    const path = `${FOLDERS[r.type]}/${r.code}.md`;
    // Un enlace a una versión anterior de su destino exige que esa versión ya esté en la v2.
    for (const e of r.links) {
      if (e.target.version >= (versionInDesign.get(e.target.code) ?? 0)) continue;
      const target = await recordOf(ctx.trx, ctx.projectId, e.target.code);
      const exists =
        target &&
        (await ctx.trx
          .selectFrom('record_versions')
          .select('id')
          .where('record_id', '=', target.id)
          .where('n', '=', e.target.version)
          .executeTakeFirst());
      if (!exists) {
        plan.problems.push(
          `${path}: el enlace a ${e.target.code}@${e.target.version} apunta a una versión que no está en design/ ni en la v2.`,
        );
      }
    }
    const document: ImportedDocument = {
      ...r,
      annexesContent: r.annexes.map((a) => ({ path: a, content: tree.get(a) ?? '' })),
    };
    const record = await recordOf(ctx.trx, ctx.projectId, r.code);
    if (record) {
      const v = await ctx.trx
        .selectFrom('record_versions')
        .selectAll()
        .where('record_id', '=', record.id)
        .where('n', '=', r.version)
        .executeTakeFirst();
      if (v) {
        const inV2 = await versionDocument(ctx.trx, record, v);
        const annexesEqual = JSON.stringify(inV2.annexes) === JSON.stringify(document.annexesContent);
        if (contentOf(inV2.doc) !== contentOf(r) || !annexesEqual) {
          plan.problems.push(
            `${path}: la versión ${r.version} ya está en la v2 con otro contenido; sube la versión y añade nota_de_cambio.`,
          );
          continue;
        }
        if (v.state === VERSION_STATE[r.state]) continue;
        if (!(v.state === 'draft' && r.state === 'approved')) {
          plan.problems.push(
            `${path}: la versión ${r.version} está ${READABLE_STATE[v.state] ?? v.state} en la v2 y no puede pasar a «${r.state}».`,
          );
          continue;
        }
        const later = await laterApproved(ctx.trx, record.id, r.version);
        if (later !== null) {
          plan.problems.push(
            `${path}: la v2 ya tiene aprobada la versión ${later}; la ${r.version} solo se puede descartar.`,
          );
          continue;
        }
      } else {
        const latest = await latestVersion(ctx.trx, record.id);
        if (r.version < latest) {
          plan.problems.push(`${path}: la versión ${r.version} es anterior a la última de la v2 (${latest}).`);
          continue;
        }
        const ofCriteria = await criteriaProblems(ctx.trx, record.id, r, path);
        if (ofCriteria.length > 0) {
          plan.problems.push(...ofCriteria);
          continue;
        }
      }
    } else {
      // Un registro nuevo no comparte DOM-NNN con otro que ya esté en la v2 (sus AC se llamarían igual).
      const clash = await ctx.trx
        .selectFrom('records')
        .select('code')
        .where('project_id', '=', ctx.projectId)
        .where('code', 'like', `___-${r.code.slice(4)}`)
        .executeTakeFirst();
      if (clash) {
        plan.problems.push(`${path}: ${r.code} comparte ${r.code.slice(4)} con ${clash.code}, que ya está en la v2.`);
        continue;
      }
    }
    plan.proposals.push({ type: 'imported_record', payload: { document, path } });
  }
  for (const t of report.taxonomies) {
    const path = `${FOLDERS.taxonomy}/${t.code}.md`;
    const existing = await ctx.trx
      .selectFrom('taxonomies')
      .selectAll()
      .where('project_id', '=', ctx.projectId)
      .where('code', '=', t.code)
      .where('version', '=', t.version)
      .executeTakeFirst();
    if (existing) {
      if (contentOf(taxonomyDocument(existing)) !== contentOf(t)) {
        plan.problems.push(`${path}: la versión ${t.version} ya está en la v2 con otro contenido; sube la versión.`);
        continue;
      }
      if (existing.state === VERSION_STATE[t.state]) continue;
      if (!(existing.state === 'draft' && t.state === 'approved')) {
        plan.problems.push(
          `${path}: la versión ${t.version} está ${READABLE_STATE[existing.state] ?? existing.state} en la v2 y no puede pasar a «${t.state}».`,
        );
        continue;
      }
      const later = await ctx.trx
        .selectFrom('taxonomies')
        .select('version')
        .where('project_id', '=', ctx.projectId)
        .where('code', '=', t.code)
        .where('state', 'in', ['approved', 'superseded'])
        .where('version', '>', t.version)
        .executeTakeFirst();
      if (later) {
        plan.problems.push(
          `${path}: la v2 ya tiene aprobada la versión ${later.version}; la ${t.version} no se puede aprobar.`,
        );
        continue;
      }
    } else {
      const latest = await ctx.trx
        .selectFrom('taxonomies')
        .select('version')
        .where('project_id', '=', ctx.projectId)
        .where('code', '=', t.code)
        .orderBy('version', 'desc')
        .executeTakeFirst();
      if (latest && t.version < latest.version) {
        plan.problems.push(`${path}: la versión ${t.version} es anterior a la última de la v2 (${latest.version}).`);
        continue;
      }
    }
    plan.proposals.push({ type: 'imported_taxonomy', payload: { document: t, path } });
  }
  return plan;
}

registerHandlers({
  'design.import': handler({
    data: z.object({ tree: z.record(z.string(), z.string()), origin: z.string().max(200).optional() }).strict(),
    async apply(ctx, data, _e, to) {
      const tree = new Map(Object.entries(data.tree).sort(([a], [b]) => (a < b ? -1 : 1)));
      const treeHash = fingerprint([...tree.entries()]);
      const prior = await ctx.trx
        .selectFrom('proposal_batches')
        .select(['id', 'state'])
        .where('project_id', '=', ctx.projectId)
        .where('kind', '=', 'import')
        .where('tree_hash', '=', treeHash)
        .where('state', 'in', ['pending', 'accepted'])
        .executeTakeFirst();
      if (prior)
        return { entityId: prior.id, noChanges: true, result: { batchId: prior.id, duplicate: true, state: prior.state } };
      const report = validateTree(tree);
      const counts = treeCounts(report.records, report.taxonomies);
      const { proposals, problems } = await buildPlan(ctx, tree, report);
      if (problems.length > 0) {
        throw new DomainError('guard', 'design/ no se puede importar sobre lo que ya hay en la v2.', problems);
      }
      if (proposals.length === 0) {
        throw new DomainError('conflict', 'design/ ya está importado: no hay nada nuevo que proponer.');
      }
      // Una importación nueva deja obsoleta la que siguiera pendiente: solo se ratifica la última.
      const pending = await ctx.trx
        .selectFrom('proposal_batches')
        .select('id')
        .where('project_id', '=', ctx.projectId)
        .where('kind', '=', 'import')
        .where('state', '=', 'pending')
        .execute();
      for (const p of pending) {
        await ctx.execute({
          command: 'batch.supersede',
          actor: IMPORTER,
          entityId: p.id,
          data: { reason: 'Hay una importación más reciente de design/.' },
        });
      }
      // El importador produce las propuestas; quien importa (persona o CLI) queda en el evento de la importación.
      const { id } = await ctx.trx
        .insertInto('proposal_batches')
        .values({
          project_id: ctx.projectId,
          kind: 'import',
          producer: formatActor(IMPORTER),
          run_id: null,
          context_pack_id: null,
          resolution_mode: 'package',
          dependencies: JSON.stringify([]),
          summary: `Importación de design/${data.origin ? ` (${data.origin})` : ''}: ${JSON.stringify(counts)}`,
          tree_hash: treeHash,
          state: to,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const [i, p] of proposals.entries()) {
        await ctx.execute({
          command: 'proposal.create',
          actor: IMPORTER,
          data: { batch_id: id, position: i + 1, type: p.type, payload: p.payload },
        });
      }
      return {
        entityId: id,
        after: { counts, proposals: proposals.length, hash: treeHash },
        result: { batchId: id, counts, proposals: proposals.length },
      };
    },
  }),
});

function noChangesSinceImport(code: string, version: number): DomainError {
  return new DomainError('conflict', `${code} v${version} cambió en la v2 después de importar: vuelve a importar design/.`);
}

// Ratificar: cada documento se crea (o se versiona) con la persona como actor y el estado de su archivo.
registerApplication('imported_record', async (ctx, { proposalId, payload }) => {
  const d = PAYLOADS.imported_record.parse(payload).document as unknown as ImportedDocument;
  const content = {
    title: d.title,
    sections: d.sections,
    links: d.links.map((e) => ({ type: e.type, target: e.target })),
    annexes: d.annexesContent,
    ...(d.increment ? { increment: d.increment } : {}),
    ...(d.changeNote ? { change_note: d.changeNote } : {}),
    origin: { type: 'proposal', id: proposalId },
    number: d.version,
  };
  const newCriteria = d.criteria.map((c) => ({
    carry: 'new' as const,
    code: c.code,
    title: c.title,
    statement: c.statement,
    verification: c.verification === 'automática' ? 'automatic' : 'manual',
    check: c.check,
    ...(c.derivedFrom ? { derived_from: c.derivedFrom } : {}),
  }));
  let record = await recordOf(ctx.trx, ctx.projectId, d.code);
  const existing = record
    ? await ctx.trx
        .selectFrom('record_versions')
        .selectAll()
        .where('record_id', '=', record.id)
        .where('n', '=', d.version)
        .executeTakeFirst()
    : undefined;
  let versionId: string;
  if (record && existing) {
    // Solo cambia el estado: se comprueba que el contenido sigue siendo el importado.
    if (contentOf((await versionDocument(ctx.trx, record, existing)).doc) !== contentOf(d)) {
      throw noChangesSinceImport(d.code, d.version);
    }
    versionId = existing.id;
  } else if (!record) {
    const r = await ctx.execute({
      command: 'record.create',
      actor: ctx.actor,
      data: { type: d.type, code: d.code, domain: d.domain, criteria: newCriteria, ...content },
    });
    versionId = (r.result as { versionId: string }).versionId;
    record = await recordOf(ctx.trx, ctx.projectId, d.code);
  } else {
    // Versión nueva: los criterios que siguen se mantienen o modifican por su código; el resto se descarta.
    const base = await ctx.trx
      .selectFrom('record_versions')
      .select('id')
      .where('record_id', '=', record.id)
      .where('state', '<>', 'discarded')
      .orderBy('n', 'desc')
      .executeTakeFirstOrThrow();
    const priors = await ctx.trx.selectFrom('criteria').selectAll().where('record_version_id', '=', base.id).execute();
    const byCode = new Map(priors.map((p) => [p.code, p]));
    const criteria = newCriteria.map((c) => {
      const p = byCode.get(c.code);
      if (!p) return c;
      const equal =
        p.title === c.title &&
        p.statement === c.statement &&
        p.verification === c.verification &&
        p.check_text === c.check;
      return equal
        ? { carry: 'kept' as const, code: c.code }
        : {
            carry: 'modified' as const,
            derived_from: c.code,
            title: c.title,
            statement: c.statement,
            verification: c.verification,
            check: c.check,
          };
    });
    const codes = new Set(d.criteria.map((c) => c.code));
    const r = await ctx.execute({
      command: 'record_version.create',
      actor: ctx.actor,
      data: {
        record_id: record.id,
        criteria,
        discarded: priors.map((p) => p.code).filter((c) => !codes.has(c)),
        ...content,
        change_note: d.changeNote ?? 'Importado de design/.',
      },
    });
    versionId = r.entityId;
  }
  const v = await ctx.trx
    .selectFrom('record_versions')
    .select(['n', 'state'])
    .where('id', '=', versionId)
    .executeTakeFirstOrThrow();
  if (d.state === 'approved' && v.state === 'draft') {
    await ctx.execute({ command: 'record_version.approve', actor: ctx.actor, entityId: versionId, data: {} });
  }
  const state = d.state === 'approved' ? 'approved' : v.state;
  return { type: 'record', code: d.code, recordId: record?.id ?? null, versionId, version: v.n, state };
});

registerApplication('imported_taxonomy', async (ctx, { payload }) => {
  const t = PAYLOADS.imported_taxonomy.parse(payload).document as unknown as TaxonomyDocument;
  const existing = await ctx.trx
    .selectFrom('taxonomies')
    .selectAll()
    .where('project_id', '=', ctx.projectId)
    .where('code', '=', t.code)
    .where('version', '=', t.version)
    .executeTakeFirst();
  let id: string;
  let state: string;
  if (existing) {
    // Solo cambia el estado (propuesto → aprobado): se aprueba la versión que ya está.
    if (contentOf(taxonomyDocument(existing)) !== contentOf(t)) throw noChangesSinceImport(t.code, t.version);
    id = existing.id;
    state = existing.state;
  } else {
    const r = await ctx.execute({
      command: 'taxonomy.propose',
      actor: ctx.actor,
      data: { code: t.code, title: t.title, axes: t.axes, sections: t.sections, version: t.version },
    });
    id = r.entityId;
    state = r.state;
  }
  if (t.state === 'approved' && state === 'draft') {
    await ctx.execute({ command: 'taxonomy.approve', actor: ctx.actor, entityId: id, data: {} });
  }
  return { type: 'taxonomy', code: t.code, taxonomyId: id, version: t.version };
});
