// design/ import (H1, AC-CON-001-10): the whole tree comes in as a batch pending package
// resolution, idempotent by the tree's fingerprint. Nothing is approved until a person ratifies
// the package; on ratification, each document is created with the state from its file.
// Each document is compared with what is already in the v2 by rendering it the same way as the
// export: "nothing to import" is the same as "the export has no diff".

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
  draft: 'draft',
  approved: 'approved',
  superseded: 'superseded',
  discarded: 'discarded',
};

export type ImportedDocument = RecordDocument & { annexesContent: { path: string; content: string }[] };

/** Topological order: link targets and "Derived from" targets come before whoever cites them. */
function sort(records: RecordDocument[]): RecordDocument[] {
  const byCode = new Map(records.map((r) => [r.code, r]));
  const acOwner = new Map(records.flatMap((r) => r.criteria.map((c) => [c.code, r] as const)));
  const done = new Set<string>();
  const ordered: RecordDocument[] = [];
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
    ordered.push(r);
  };
  for (const r of [...records].sort((a, b) => (a.code < b.code ? -1 : 1))) visit(r, new Set());
  return ordered;
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
    // design/ keeps one version per record: the one in progress.
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
    if (!tree || typeof tree !== 'object') return 'The design/ tree is missing.';
    const report = validateTree(new Map(Object.entries(tree)));
    if (report.problems.length === 0) return null;
    return `design/ is not valid: ${report.problems
      .slice(0, 10)
      .map((p) => `${p.path}: ${p.message}`)
      .join(' · ')}`;
  },
});

/** The text of a v2 version with a different state: used to compare content only. */
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

/** An approved (or already superseded) version after `n`: approving `n` would move the current version backwards. */
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
 * Problems with the criteria of a new version of a record already in the v2: a code that was
 * already used and is no longer there (never reused), or a "Derived from" different from the
 * one the criterion had.
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
        problems.push(`${path}: ${c.code} was already used in a previous version; a new criterion needs a new code.`);
      continue;
    }
    if ((await derivationOf(trx, existing.id)) !== (c.derivedFrom ?? null)) {
      problems.push(`${path}: ${c.code} changes its "Derived from"; a criterion that is kept or modified keeps its derivation.`);
    }
  }
  return problems;
}

type Plan = { proposals: { type: string; payload: Record<string, unknown> }[]; problems: string[] };

/**
 * What to propose for each document based on what is already in the v2: nothing if it matches
 * (content and state), approval if only the state changes from proposed to approved, or a new
 * version. A version that already exists with different content, or is older than the latest, is
 * a problem.
 */
async function buildPlan(ctx: CommandContext, tree: Map<string, string>, report: ValidationReport): Promise<Plan> {
  const plan: Plan = { proposals: [], problems: [] };
  const versionInDesign = new Map(report.records.map((r) => [r.code, r.version]));
  for (const r of sort(report.records)) {
    const path = `${FOLDERS[r.type]}/${r.code}.md`;
    // A link to an earlier version of its target requires that version to already be in the v2.
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
          `${path}: the link to ${e.target.code}@${e.target.version} points to a version that is not in design/ or the v2.`,
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
            `${path}: version ${r.version} is already in the v2 with different content; bump the version and add a change_note.`,
          );
          continue;
        }
        if (v.state === VERSION_STATE[r.state]) continue;
        if (!(v.state === 'draft' && r.state === 'approved')) {
          plan.problems.push(
            `${path}: version ${r.version} is ${READABLE_STATE[v.state] ?? v.state} in the v2 and cannot move to "${r.state}".`,
          );
          continue;
        }
        const later = await laterApproved(ctx.trx, record.id, r.version);
        if (later !== null) {
          plan.problems.push(`${path}: the v2 already has version ${later} approved; ${r.version} can only be discarded.`);
          continue;
        }
      } else {
        const latest = await latestVersion(ctx.trx, record.id);
        if (r.version < latest) {
          plan.problems.push(`${path}: version ${r.version} is older than the latest in the v2 (${latest}).`);
          continue;
        }
        const ofCriteria = await criteriaProblems(ctx.trx, record.id, r, path);
        if (ofCriteria.length > 0) {
          plan.problems.push(...ofCriteria);
          continue;
        }
      }
    } else {
      // A new record does not share DOM-NNN with another one already in the v2 (their ACs would be named the same).
      const clash = await ctx.trx
        .selectFrom('records')
        .select('code')
        .where('project_id', '=', ctx.projectId)
        .where('code', 'like', `___-${r.code.slice(4)}`)
        .executeTakeFirst();
      if (clash) {
        plan.problems.push(`${path}: ${r.code} shares ${r.code.slice(4)} with ${clash.code}, which is already in the v2.`);
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
        plan.problems.push(`${path}: version ${t.version} is already in the v2 with different content; bump the version.`);
        continue;
      }
      if (existing.state === VERSION_STATE[t.state]) continue;
      if (!(existing.state === 'draft' && t.state === 'approved')) {
        plan.problems.push(
          `${path}: version ${t.version} is ${READABLE_STATE[existing.state] ?? existing.state} in the v2 and cannot move to "${t.state}".`,
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
        plan.problems.push(`${path}: the v2 already has version ${later.version} approved; ${t.version} cannot be approved.`);
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
        plan.problems.push(`${path}: version ${t.version} is older than the latest in the v2 (${latest.version}).`);
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
        throw new DomainError('guard', 'design/ cannot be imported over what is already in the v2.', problems);
      }
      if (proposals.length === 0) {
        throw new DomainError('conflict', 'design/ is already imported: there is nothing new to propose.');
      }
      // A new import makes any still-pending one obsolete: only the latest gets ratified.
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
          data: { reason: 'There is a more recent import of design/.' },
        });
      }
      // The importer produces the proposals; whoever imports (person or CLI) is recorded in the import event.
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
          summary: `Import of design/${data.origin ? ` (${data.origin})` : ''}: ${JSON.stringify(counts)}`,
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
  return new DomainError('conflict', `${code} v${version} changed in the v2 after importing: import design/ again.`);
}

// Ratifying: each document is created (or versioned) with the person as actor and the state from its file.
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
    verification: c.verification === 'automatic' ? 'automatic' : 'manual',
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
    // Only the state changes: check that the content still matches what was imported.
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
    // New version: criteria that continue are kept or modified by their code; the rest are discarded.
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
        p.title === c.title && p.statement === c.statement && p.verification === c.verification && p.check_text === c.check;
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
        change_note: d.changeNote ?? 'Imported from design/.',
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
    // Only the state changes (proposed → approved): the existing version gets approved.
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
