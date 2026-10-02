// Operator actions on the known-error vault, used by the `vault` CLI: record that a fix was made, and seed the vault
// from the forensics that predate it (one curator run). Both go through the bus as the system.

import { DomainError, system } from '@demiurgo/domain';
import { executeCommand } from '../bus/bus.ts';
import { waitForRun } from '../engine/engine.ts';
import type { Services } from '../services.ts';
import { catalogMarks, loadPieceCatalog } from './catalog.ts';
import { refusal, requestRun } from './run.ts';
import { latestKnownError, occurrencesOf } from './vault.ts';
import { latestForensics } from './store.ts';

/**
 * Records that a fix for a known error was made (status `fix_claimed`): the commits, the note and the versions the
 * error's pieces have right now, which is what later forensics are compared with. The claim moment is now.
 */
export async function vaultFix(services: Services, code: string, fix: { commits: string[]; note: string }) {
  const ke = await latestKnownError(services.db, code);
  if (!ke) throw new DomainError('not_found', `The known error ${code} does not exist.`);
  const marks = catalogMarks(await loadPieceCatalog());
  const piece_versions = Object.fromEntries(ke.pieces.filter((p) => marks[p] !== undefined).map((p) => [p, marks[p] as string]));
  const done = await executeCommand(services, {
    command: 'known_error.claim_fix',
    actor: system('cli'),
    projectId: ke.origin_project_id,
    data: { code, description: fix.note, commits: fix.commits, piece_versions },
  });
  const r = done.result as { version: number; claimed_at: string };
  return { code, status: 'fix_claimed' as const, version: r.version, claimed_at: r.claimed_at, commits: fix.commits, piece_versions, pieces_missing_from_catalog: ke.pieces.filter((p) => marks[p] === undefined) };
}

/**
 * Merges a duplicate known error into another one (the source becomes `merged`): later reads, the vault the forensic
 * agent receives and the counts leave the source out and credit its occurrences to the target.
 */
export async function vaultMerge(services: Services, code: string, into: string, note: string) {
  const ke = await latestKnownError(services.db, code);
  if (!ke) throw new DomainError('not_found', `The known error ${code} does not exist.`);
  const done = await executeCommand(services, {
    command: 'known_error.merge',
    actor: system('cli'),
    projectId: ke.origin_project_id,
    data: { code, into, note },
  });
  const r = done.result as { version: number; merged_into: string };
  return { code, status: 'merged' as const, version: r.version, merged_into: r.merged_into, note };
}

export type VaultSeedResult = {
  status: 'seeded' | 'nothing_to_seed' | 'failed' | 'refused';
  run_id?: string;
  entries_created: number;
  occurrences_added: number;
  /** Items still without an occurrence (the run is bounded): seed again to take them. */
  remaining: number;
  reason?: string;
};

async function counts(services: Services): Promise<{ entries: number; occurrences: number }> {
  const e = await services.db.selectFrom('known_errors').select((eb) => eb.fn.countAll().as('n')).where('version', '=', 1).executeTakeFirstOrThrow();
  return { entries: Number(e.n), occurrences: (await occurrencesOf(services.db)).length };
}

async function remainingItems(services: Services, projectId: string): Promise<number> {
  const covered = new Set((await occurrencesOf(services.db)).map((o) => `${o.forensic_id}:${o.went_wrong_index}`));
  return (await latestForensics(services.db, projectId)).reduce((n, f) => n + f.analysis.went_wrong.filter((_, i) => !covered.has(`${f.id}:${i}`)).length, 0);
}

/** Builds the vault from the went_wrong items of the project's existing forensics that are not yet an occurrence (one curator run). */
export async function vaultSeed(services: Services, projectId: string): Promise<VaultSeedResult> {
  const before = await counts(services);
  if ((await remainingItems(services, projectId)) === 0) return { status: 'nothing_to_seed', entries_created: 0, occurrences_added: 0, remaining: 0 };
  let runId: string;
  try {
    runId = await requestRun(services, projectId, { action: 'known_error_curate', scope: { type: 'project', id: projectId }, input: {} });
  } catch (e) {
    const why = refusal(e);
    if (why) return { status: 'refused', entries_created: 0, occurrences_added: 0, remaining: await remainingItems(services, projectId), reason: why };
    throw e;
  }
  await waitForRun(runId);
  const run = await services.db.selectFrom('ai_runs').select(['state', 'error', 'failure_kind']).where('id', '=', runId).executeTakeFirstOrThrow();
  const after = await counts(services);
  const remaining = await remainingItems(services, projectId);
  if (run.state !== 'completed') return { status: 'failed', run_id: runId, entries_created: 0, occurrences_added: 0, remaining, reason: `${run.state}${run.failure_kind ? ` (${run.failure_kind})` : ''}${run.error ? `: ${run.error.slice(0, 300)}` : ''}` };
  return { status: 'seeded', run_id: runId, entries_created: after.entries - before.entries, occurrences_added: after.occurrences - before.occurrences, remaining };
}
