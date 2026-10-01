// task_forensics and playbook_write: the blameless post-mortem of one task, and the playbook of one error class
// aggregated from those post-mortems. Both follow the pattern of pr_review: a deterministic context builder, a
// checker that hands problems back to the agent once, and an applier that stores the output through the bus.
// The forensic must answer a checklist with exactly one entry per piece of DEMIURGO (forensics/catalog.ts): a
// missing or unknown piece makes the output invalid and the run retries through the checker.

import { type Actor, DomainError, system } from '@demiurgo/domain';
import type { Request, Result } from '../bus/types.ts';
import type { Tx } from '../db/connection.ts';
import { registerBuilder } from '../context/build.ts';
import { ManifestBuilder, inputSource } from '../context/manifest.ts';
import { type CatalogItem, catalogMarks, catalogVersion, loadPieceCatalog } from '../forensics/catalog.ts';
import { EVIDENCE_CAPS, buildTaskEvidence, type EvidenceSection } from '../forensics/evidence.ts';
import { classesOf, latestForensics, latestPlaybooks } from '../forensics/store.ts';
import { type CompactKnownError, compactKnownErrors, dueValidations, latestKnownError, latestKnownErrors, needsRecurrenceWhy, occurredAtOf, taskEndedAt } from '../forensics/vault.ts';
import { registerApplier, registerChecker } from './appliers.ts';
import { packContentOf } from './drafting.ts';

const FORENSICS = 'task_forensics@1';
const PLAYBOOK = 'playbook_write@1';
const PLAYBOOK_MAX = 80_000;
// Each evidence section has the budget of its cap (plus the few characters of the cut note); the catalog its own.
const KNOWN_ERRORS_CAP = 30_000;
const BUDGET: Record<string, number> = {
  ...Object.fromEntries(Object.entries(EVIDENCE_CAPS).map(([name, cap]) => [`evidence.${name}`, cap + 100])),
  catalog: 60_000,
  known_errors: KNOWN_ERRORS_CAP + 100,
};

type ForensicsPack = {
  task: { id: string; code: string; title: string | null };
  task_version_id: string;
  request_ids: string[];
  evidence_hash: string;
  evidence: EvidenceSection[];
  catalog_version: string;
  catalog: Pick<CatalogItem, 'id' | 'kind' | 'name' | 'phases' | 'what_it_does'>[];
  catalog_marks: Record<string, string>;
  /** The latest version of each entry of the known-error vault: what a went_wrong item may be matched against. */
  known_errors: CompactKnownError[];
  known_errors_omitted: number;
  /** When the task's activity ended: a went_wrong item without its own time is taken to have happened then. */
  task_ended_at: string | null;
  /** The build request whose end triggered this analysis (the sweeper), when it did. */
  trigger_request_id: string | null;
};

registerBuilder('task_forensics', async ({ trx, projectId, scope, input, graphVersion }) => {
  if (scope.type !== 'task' || !scope.id) throw new DomainError('validation', 'A forensic needs the task: scope {type: "task", id}.');
  const manifest = new ManifestBuilder(FORENSICS, graphVersion, BUDGET);
  const bundle = await buildTaskEvidence(trx, projectId, scope.id).catch((e: unknown) => {
    // A missing task (or one with no version) is a request problem, not a crash.
    if (e instanceof Error && /no result|has no version/i.test(e.message)) throw new DomainError('not_found', 'The task does not exist or has no version.');
    throw e;
  });
  const items = await loadPieceCatalog();
  const catalog = items.map(({ id, kind, name, phases, what_it_does }) => ({ id, kind, name, phases, what_it_does }));
  manifest.entered({ section: 'task', source: { type: 'record_version', id: bundle.task_version_id, version: null, eventSeq: null }, text: JSON.stringify(bundle.task), reason: 'scope' });
  for (const s of bundle.sections)
    manifest.entered({ section: `evidence.${s.name}`, source: inputSource('evidence'), text: s.text, originalChars: s.text.length + s.omitted_chars, reason: s.omitted_chars > 0 ? 'excerpt' : 'derived' });
  manifest.entered({ section: 'catalog', source: inputSource('catalog'), text: JSON.stringify(catalog), reason: 'derived' });
  const vault = compactKnownErrors(await latestKnownErrors(trx), KNOWN_ERRORS_CAP);
  manifest.entered({ section: 'known_errors', source: inputSource('known_errors'), text: JSON.stringify(vault.entries), reason: vault.omitted > 0 ? 'excerpt' : 'derived' });
  const ended = await taskEndedAt(trx, bundle.task_version_id, bundle.request_ids);
  const trigger = typeof input.trigger_request_id === 'string' && bundle.request_ids.includes(input.trigger_request_id) ? input.trigger_request_id : null;
  const content: ForensicsPack = {
    task: bundle.task,
    task_version_id: bundle.task_version_id,
    request_ids: bundle.request_ids,
    evidence_hash: bundle.hash,
    evidence: bundle.sections,
    catalog_version: catalogVersion(items),
    catalog,
    catalog_marks: catalogMarks(items),
    known_errors: vault.entries,
    known_errors_omitted: vault.omitted,
    task_ended_at: ended ? ended.toISOString() : null,
    trigger_request_id: trigger,
  };
  return {
    pack: {
      role: 'forensics',
      constructor: FORENSICS,
      budget: BUDGET,
      graph_version: graphVersion,
      dependencies: [{ type: 'record', id: scope.id, version: null }],
      content,
    },
    manifest: manifest.build(),
  };
});

registerChecker('task_forensics', async ({ db, run, output }) => {
  const pack = await packContentOf<ForensicsPack>(db, run);
  const known = new Set(pack.catalog.map((c) => c.id));
  const listed = output.checklist.map((c) => c.piece_id);
  const notes: string[] = [];
  const missing = [...known].filter((id) => !listed.includes(id));
  const unknown = [...new Set(listed.filter((id) => !known.has(id)))];
  const twice = [...new Set(listed.filter((id, i) => listed.indexOf(id) !== i))];
  if (missing.length > 0) notes.push(`\`checklist\` must have exactly one entry for every piece of \`catalog\`. Missing (${missing.length}): ${missing.slice(0, 60).join(', ')}${missing.length > 60 ? ', …' : ''}.`);
  if (unknown.length > 0) notes.push(`\`checklist\` has ids that are not in \`catalog\`: ${unknown.slice(0, 30).join(', ')}. Use only the ids of \`catalog\`.`);
  if (twice.length > 0) notes.push(`\`checklist\` lists these pieces twice: ${twice.slice(0, 30).join(', ')}. Exactly one entry each.`);
  for (const c of output.checklist)
    if (known.has(c.piece_id) && c.involved === 'yes' && c.verdict !== 'worked' && c.verdict !== 'not_applicable' && c.evidence.trim() === '')
      notes.push(`${c.piece_id}: a verdict of ${c.verdict} needs the evidence you rely on (a step, a comment, a version, a finding).`);
  // The vault: a went_wrong item is an occurrence of a known error, or a new one to record.
  const vault = new Map((pack.known_errors ?? []).map((k) => [k.code, k]));
  for (const [i, w] of output.went_wrong.entries()) {
    const at = `went_wrong[${i}]`;
    if (w.known_error) {
      const ke = vault.get(w.known_error);
      if (!ke) {
        notes.push(`${at}: \`known_error\` ${w.known_error} is not in \`known_errors\`${vault.size > 0 ? ` (use one of ${[...vault.keys()].slice(0, 40).join(', ')})` : ' (the vault is empty)'}. Use null with \`new_error\` when it matches none.`);
        continue;
      }
      if (w.new_error) notes.push(`${at}: it matches ${ke.code}, so \`new_error\` must be null.`);
      if (needsRecurrenceWhy(ke, occurredAtOf(w.at, pack.task_ended_at, new Date())) && !w.recurrence_why?.trim())
        notes.push(`${at}: ${ke.code} has a ${ke.status === 'validated' ? 'validated' : 'claimed'} fix (${ke.fix?.description ?? ''}) and this task ran with it in place: \`recurrence_why\` must explain why the fix did not prevent it.`);
    } else {
      if (!w.new_error) notes.push(`${at}: set \`known_error\` to the code it matches, or null with \`new_error\` (title, description, signature, pieces).`);
      else for (const p of w.new_error.pieces) if (!known.has(p)) notes.push(`${at}: \`new_error.pieces\` has "${p}", which is not an id of \`catalog\`.`);
    }
  }
  return notes;
});

registerApplier('task_forensics', async ({ trx, execute, run, output }) => {
  const pack = await packContentOf<ForensicsPack>(trx, run);
  const actor = system('task-forensics', '1');
  const recorded = await execute({
    projectId: run.project_id,
    command: 'task_forensics.record',
    actor,
    data: {
      task_id: pack.task.id,
      task_version_id: pack.task_version_id,
      request_ids: pack.request_ids,
      ai_run_id: run.id,
      analysis: { ...output, catalog_marks: pack.catalog_marks },
      evidence_hash: pack.evidence_hash,
      catalog_version: pack.catalog_version,
      agent_version: run.method.split('@')[1] ?? run.method,
      engine: { provider: run.provider, model: run.model ?? run.requested_model, effort: run.effort, ...(run.engine ? { mark: run.engine } : {}) },
      task_ended_at: pack.task_ended_at ?? null,
      trigger_request_id: pack.trigger_request_id ?? null,
    },
  });
  // The vault: each went_wrong item becomes an occurrence of an entry (a new one when none matched); a task that ran with a
  // claimed fix in place and hit the error again marks the entry as recurred.
  for (const [i, w] of output.went_wrong.entries()) {
    let code = w.known_error;
    if (!code && w.new_error) {
      const opened = await execute({ projectId: run.project_id, command: 'known_error.open', actor, data: { ...w.new_error, error_class: w.error_class, phase: w.phase } });
      code = (opened.result as { code: string }).code;
    }
    if (code) await recordOccurrence(execute, run.project_id, actor, { code, forensicId: recorded.entityId, index: i, why: w.recurrence_why?.trim() || null });
  }
  await validateDueFixes(trx, execute, run.project_id, actor);
});

type Execute = (p: Request) => Promise<Result>;

/** Records one occurrence of an entry; when the task ran with the entry's fix in place the entry becomes `recurred`. */
export async function recordOccurrence(execute: Execute, projectId: string, actor: Actor, o: { code: string; forensicId: string; index: number; why: string | null }): Promise<void> {
  const r = await execute({ projectId, command: 'known_error.occurrence', actor, data: { code: o.code, forensic_id: o.forensicId, went_wrong_index: o.index, recurrence_why: o.why } });
  if ((r.result as { recurs: boolean }).recurs) await execute({ projectId, command: 'known_error.recur', actor, data: { code: o.code, forensic_id: o.forensicId } });
}

/** Every claimed fix with enough clean forensics becomes validated (our convention, `VALIDATION_CLEAN_FORENSICS`). */
export async function validateDueFixes(trx: Tx, execute: Execute, projectId: string, actor: Actor): Promise<string[]> {
  const validated: string[] = [];
  for (const due of await dueValidations(trx)) {
    if (!(await latestKnownError(trx, due.code))) continue;
    await execute({ projectId, command: 'known_error.validate', actor, data: due });
    validated.push(due.code);
  }
  return validated;
}

// ---------------------------------------------------------------------------------------------------- playbooks

type PlaybookPack = {
  class_key: string;
  current: { version: number; entry: unknown } | null;
  forensic_ids: string[];
  task_codes: string[];
  occurrences: { task: string; forensic: string; went_wrong: unknown[]; root_causes: unknown[]; improvements: unknown[] }[];
};

registerBuilder('playbook_write', async ({ trx, projectId, input, graphVersion }) => {
  const classKey = typeof input.class_key === 'string' ? input.class_key.trim() : '';
  if (!classKey) throw new DomainError('validation', 'A playbook needs the class: input {class_key}.');
  const manifest = new ManifestBuilder(PLAYBOOK, graphVersion, { occurrences: PLAYBOOK_MAX, current: 20_000 });
  const rows = (await latestForensics(trx, projectId)).filter((f) => classesOf(f.analysis).includes(classKey));
  if (rows.length === 0) throw new DomainError('validation', `No forensic names the class "${classKey}".`);
  const current = (await latestPlaybooks(trx, projectId)).find((p) => p.class_key === classKey) ?? null;
  const full = rows.map((f) => ({
    task: f.code,
    forensic: f.id,
    went_wrong: f.analysis.went_wrong.filter((w) => w.error_class === classKey),
    // The causes of the task are the context of its problem of this class (a cause carries no class of its own).
    root_causes: f.analysis.root_causes,
    improvements: f.analysis.improvements.filter((i) => i.playbook_class === classKey),
  }));
  // Bounded: a task's root causes shrink first, then the last tasks are left out (and so are not examples nor based_on).
  let occurrences = full;
  const size = () => JSON.stringify(occurrences).length;
  for (let keep = 4; size() > PLAYBOOK_MAX && keep >= 0; keep = keep === 0 ? -1 : Math.floor(keep / 2))
    occurrences = occurrences.map((o) => ({ ...o, root_causes: o.root_causes.slice(0, keep) }));
  while (size() > PLAYBOOK_MAX && occurrences.length > 1) occurrences = occurrences.slice(0, -1);
  const included = new Set(occurrences.map((o) => o.forensic));
  const content: PlaybookPack = {
    class_key: classKey,
    current: current ? { version: current.version, entry: current.entry } : null,
    forensic_ids: rows.filter((f) => included.has(f.id)).map((f) => f.id),
    task_codes: rows.filter((f) => included.has(f.id)).map((f) => f.code),
    occurrences,
  };
  manifest.entered({ section: 'occurrences', source: inputSource('forensics'), text: JSON.stringify(occurrences), reason: 'derived' });
  if (current) manifest.entered({ section: 'current', source: inputSource('forensic_playbooks'), text: JSON.stringify(current.entry), reason: 'derived' });
  return {
    pack: { role: 'playbook', constructor: PLAYBOOK, budget: { occurrences: PLAYBOOK_MAX, current: 20_000 }, graph_version: graphVersion, dependencies: [], content },
    manifest: manifest.build(),
  };
});

registerChecker('playbook_write', async ({ db, run, output }) => {
  const pack = await packContentOf<PlaybookPack>(db, run);
  const notes: string[] = [];
  if (output.class_key !== pack.class_key) notes.push(`\`class_key\` must be exactly "${pack.class_key}".`);
  const stray = output.examples.filter((e) => !pack.task_codes.includes(e));
  if (stray.length > 0) notes.push(`\`examples\` lists ${stray.join(', ')}, which are not task codes of the input: use only ${pack.task_codes.join(', ')}.`);
  return notes;
});

registerApplier('playbook_write', async ({ trx, execute, run, output }) => {
  const pack = await packContentOf<PlaybookPack>(trx, run);
  await execute({
    projectId: run.project_id,
    command: 'forensic_playbook.record',
    actor: system('playbook-writer', '1'),
    data: { class_key: pack.class_key, entry: output, based_on: pack.forensic_ids, ai_run_id: run.id },
  });
});
