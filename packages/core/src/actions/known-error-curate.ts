// known_error_curate: the seed of the known-error vault. The agent reads every went_wrong item of a project's earlier
// forensics that is not yet an occurrence of an entry and returns a deduplicated list of entries (defects of DEMIURGO,
// each with its signature and pieces) and which items each covers. A deterministic builder, a checker that hands
// problems back once (every item covered once, only known forensic ids and codes) and an applier that goes through the
// bus (the same commands the forensic's own applier uses). Practice: a Known Error Database (ITIL Problem Management)
// is seeded from the incidents already recorded.

import { DomainError, system } from '@demiurgo/domain';
import { registerBuilder } from '../context/build.ts';
import { ManifestBuilder, inputSource } from '../context/manifest.ts';
import { loadPieceCatalog } from '../forensics/catalog.ts';
import { latestForensics } from '../forensics/store.ts';
import { compactKnownErrors, latestKnownErrors, occurrencesOf } from '../forensics/vault.ts';
import { registerApplier, registerChecker } from './appliers.ts';
import { packContentOf } from './drafting.ts';
import { recordOccurrence, validateDueFixes } from './task-forensics.ts';

const CURATE = 'known_error_curate@1';
/** What one run reads of the items, in characters; the rest stays for the next seed (an item with no occurrence is picked up again). */
export const CURATE_ITEMS_MAX = 90_000;
const CURATE_VAULT_MAX = 20_000;

type CurateItem = { index: number; what: string; phase: string; error_class: string; evidence: string; at: string | null };
type CurateGroup = {
  forensic: string;
  task: string;
  outcome: string;
  root_causes: { cause: string; dimension: string; where: string }[];
  went_wrong: CurateItem[];
};
type CuratePack = {
  groups: CurateGroup[];
  /** Items left for a later seed because the run is bounded. */
  left_out: number;
  known_errors: ReturnType<typeof compactKnownErrors>['entries'];
  catalog: { id: string; name: string }[];
};

registerBuilder('known_error_curate', async ({ trx, projectId, graphVersion }) => {
  const manifest = new ManifestBuilder(CURATE, graphVersion, { items: CURATE_ITEMS_MAX, known_errors: CURATE_VAULT_MAX, catalog: 20_000 });
  const covered = new Set((await occurrencesOf(trx)).map((o) => `${o.forensic_id}:${o.went_wrong_index}`));
  const groups: CurateGroup[] = [];
  let size = 0;
  let leftOut = 0;
  for (const f of await latestForensics(trx, projectId)) {
    const items = f.analysis.went_wrong
      .map((w, index) => ({ index, what: w.what, phase: w.phase, error_class: w.error_class, evidence: w.evidence, at: w.at ?? null }))
      .filter((w) => !covered.has(`${f.id}:${w.index}`));
    if (items.length === 0) continue;
    const group: CurateGroup = {
      forensic: f.id,
      task: f.code,
      outcome: f.analysis.outcome,
      root_causes: f.analysis.root_causes.map((c) => ({ cause: c.cause, dimension: c.dimension, where: c.where })),
      went_wrong: items,
    };
    const n = JSON.stringify(group).length;
    if (size + n > CURATE_ITEMS_MAX && groups.length > 0) {
      leftOut += items.length;
      continue;
    }
    size += n;
    groups.push(group);
  }
  if (groups.length === 0) throw new DomainError('validation', 'There are no went_wrong items of earlier forensics left to seed the vault from.');
  const vault = compactKnownErrors(await latestKnownErrors(trx), CURATE_VAULT_MAX);
  const catalog = (await loadPieceCatalog()).map((i) => ({ id: i.id, name: i.name }));
  manifest.entered({ section: 'items', source: inputSource('forensics'), text: JSON.stringify(groups), reason: leftOut > 0 ? 'excerpt' : 'derived' });
  manifest.entered({ section: 'known_errors', source: inputSource('known_errors'), text: JSON.stringify(vault.entries), reason: 'derived' });
  manifest.entered({ section: 'catalog', source: inputSource('catalog'), text: JSON.stringify(catalog), reason: 'derived' });
  const content: CuratePack = { groups, left_out: leftOut, known_errors: vault.entries, catalog };
  return {
    pack: { role: 'known_error_curator', constructor: CURATE, budget: { items: CURATE_ITEMS_MAX, known_errors: CURATE_VAULT_MAX, catalog: 20_000 }, graph_version: graphVersion, dependencies: [], content },
    manifest: manifest.build(),
  };
});

registerChecker('known_error_curate', async ({ db, run, output }) => {
  const pack = await packContentOf<CuratePack>(db, run);
  const items = new Set(pack.groups.flatMap((g) => g.went_wrong.map((w) => `${g.forensic}:${w.index}`)));
  const catalog = new Set(pack.catalog.map((c) => c.id));
  const codes = new Set(pack.known_errors.map((k) => k.code));
  const notes: string[] = [];
  const seen = new Map<string, number>();
  for (const [n, e] of output.entries.entries()) {
    if (e.known_error && !codes.has(e.known_error)) notes.push(`entries[${n}]: \`known_error\` ${e.known_error} is not in \`known_errors\`; use null to create a new entry.`);
    for (const p of e.pieces) if (!catalog.has(p)) notes.push(`entries[${n}]: \`pieces\` has "${p}", which is not an id of \`catalog\`.`);
    for (const c of e.covers) {
      const key = `${c.forensic}:${c.went_wrong_index}`;
      if (!items.has(key)) notes.push(`entries[${n}]: covers ${c.forensic} item ${c.went_wrong_index}, which is not in \`groups\`.`);
      else if (seen.has(key)) notes.push(`entries[${n}]: covers ${c.forensic} item ${c.went_wrong_index}, which entries[${seen.get(key)}] already covers. Each item belongs to exactly one entry.`);
      else seen.set(key, n);
    }
  }
  const missing = [...items].filter((k) => !seen.has(k));
  if (missing.length > 0) notes.push(`${missing.length} item(s) are not covered by any entry (forensic:index): ${missing.slice(0, 40).join(', ')}${missing.length > 40 ? ', …' : ''}. Every item must be covered.`);
  return notes.slice(0, 60);
});

registerApplier('known_error_curate', async ({ trx, execute, run, output }) => {
  const actor = system('known-error-curator', '1');
  for (const e of output.entries) {
    let code = e.known_error;
    if (!code) {
      const opened = await execute({
        projectId: run.project_id,
        command: 'known_error.open',
        actor,
        data: { title: e.title, description: e.description, signature: e.signature, pieces: e.pieces, dimension: e.dimension, error_class: e.error_class, phase: e.phase },
      });
      code = (opened.result as { code: string }).code;
    }
    for (const c of e.covers) {
      await recordOccurrence(execute, run.project_id, actor, {
        code,
        forensicId: c.forensic,
        index: c.went_wrong_index,
        // An item attached to an entry whose fix was already in place needs its why: the seed says what it knows.
        why: 'Found when the vault was seeded from earlier forensics: the curator matched it to this entry.',
      });
    }
  }
  await validateDueFixes(trx, execute, run.project_id, actor);
});
