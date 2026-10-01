// Offline evaluation of the «Code to extend» ranking. For every MERGED task of one project it builds the
// code map of the repository as it was before the task's merge (the first parent of its merge commit, when
// the project's repository and that commit are here), ranks the files for the task text, and compares three
// orders with the files the task's pull request really changed (its footprint): the deterministic order
// (BM25 + PageRank), Jev's probabilities alone, and the hybrid DEMIURGO shows (classifier/code-rerank.ts).
// Truth: the footprint files that already existed (status modified, not tests, config or noise). Metrics:
// recall@5, recall@10 and MRR, averaged over the tasks (Manning, Raghavan and Schütze, «Introduction to
// Information Retrieval», ch. 8). The footprint boost is not used: at that time it did not exist. It stores
// nothing. It calls the real TypeSafe API (about 0.0002 USD a task) and sends the task text and file paths
// to TypeSafe: run it only when that is accepted.
//
//   set -a; . ./.env; set +a
//   DATABASE_URL=... DEMIURGO_PROJECTS_DIR=... node packages/core/scripts/eval-code-map.ts <project id or name> [TSK-001 ...]

import { buildCodeMap, rankCodeMap } from '../src/build/code-map.ts';
import { isReusableFile, taskFootprints } from '../src/build/footprint.ts';
import { taskQuery } from '../src/build/queue.ts';
import { RERANK_CANDIDATES, rerankCodeMap } from '../src/classifier/code-rerank.ts';
import { JEV_DEFAULT_MODEL, jevCostUsd } from '../src/classifier/jev.ts';
import { projectRepoDir } from '../src/classifier/repo-context.ts';
import { loadTaskObject } from '../src/classifier/task-input.ts';
import { connect } from '../src/db/connection.ts';
import { execFileSync } from 'node:child_process';

const [project, ...only] = process.argv.slice(2);
const url = process.env.DATABASE_URL ?? process.env.DEMIURGO_DATABASE_URL;
if (!project || !url || !process.env.TYPESAFE_API_KEY) {
  console.error('Usage: node eval-code-map.ts <project id or name> [task codes]; needs DATABASE_URL, DEMIURGO_PROJECTS_DIR and TYPESAFE_API_KEY.');
  process.exit(1);
}

const recallAt = (ranked: string[], truth: Set<string>, k: number) => ranked.slice(0, k).filter((p) => truth.has(p)).length / truth.size;
const mrr = (ranked: string[], truth: Set<string>) => {
  const i = ranked.findIndex((p) => truth.has(p));
  return i < 0 ? 0 : 1 / (i + 1);
};
const f = (x: number) => x.toFixed(2);

type Row = Record<'det' | 'jev' | 'hyb', { r5: number; r10: number; mrr: number }> & { code: string; truth: number; inTop: number };
const rows: Row[] = [];
const connection = connect(url, 2);
const { db } = connection;
try {
  const proj = await db
    .selectFrom('projects')
    .select(['id', 'name'])
    .where((eb) => eb.or([eb('name', '=', project), eb(eb.cast<string>('id', 'text'), '=', project)]))
    .executeTakeFirstOrThrow();
  const dir = await projectRepoDir(db, proj.id);
  if (!dir) throw new Error('The project has no repository here (DEMIURGO_PROJECTS_DIR).');
  let tokens = 0;
  for (const fp of await taskFootprints(db, proj.id)) {
    if ((only.length > 0 && !only.includes(fp.code)) || !fp.merge_commit) continue;
    let base: string;
    try {
      base = execFileSync('git', ['-c', 'safe.directory=*', '-C', dir, 'rev-parse', '--verify', '--quiet', `${fp.merge_commit}^1`], { encoding: 'utf8' }).trim();
    } catch {
      console.log(`${fp.code}  merge commit not in the clone: skipped`);
      continue;
    }
    const rec = await db.selectFrom('records').select('id').where('project_id', '=', proj.id).where('code', '=', fp.code).executeTakeFirst();
    if (!rec) continue;
    const versions = await db.selectFrom('record_versions').select(['id', 'n', 'state']).where('record_id', '=', rec.id).execute();
    const shown = versions.sort((a, b) => (b.state === 'approved' ? 1_000_000 : 0) + b.n - ((a.state === 'approved' ? 1_000_000 : 0) + a.n))[0];
    const task = shown ? await loadTaskObject(db, rec.id, shown.id) : null;
    if (!task) continue;
    const map = await buildCodeMap(dir, base);
    const truth = new Set(
      fp.files
        .filter((x) => x.status === 'modified' && isReusableFile(x.path))
        .map((x) => x.path)
        .filter((p) => {
          const k = map.byPath.get(p)?.kind;
          return k !== undefined && k !== 'test' && k !== 'config';
        }),
    );
    if (truth.size === 0) {
      console.log(`${fp.code}  no modified source files in the footprint: skipped`);
      continue;
    }
    const candidates = rankCodeMap(map, taskQuery(task), { limit: RERANK_CANDIDATES });
    const reranked = await rerankCodeMap(candidates, task, { onUsage: (n) => (tokens += n) });
    const det = candidates.map((c) => c.file.path);
    const probs = new Map(reranked.opinions.map((o) => [o.path, o.jev_p ?? 0]));
    const jev = [...det].sort((a, b) => (probs.get(b) ?? 0) - (probs.get(a) ?? 0) || det.indexOf(a) - det.indexOf(b));
    const hyb = reranked.ranked.map((c) => c.file.path);
    const score = (order: string[]) => ({ r5: recallAt(order, truth, 5), r10: recallAt(order, truth, 10), mrr: mrr(order, truth) });
    const row: Row = { code: fp.code, truth: truth.size, inTop: [...truth].filter((p) => det.includes(p)).length, det: score(det), jev: score(jev), hyb: score(hyb) };
    rows.push(row);
    const cell = (x: { r5: number; r10: number; mrr: number }) => `${f(x.r5)} ${f(x.r10)} ${f(x.mrr)}`;
    console.log(`${fp.code.padEnd(10)} truth ${String(row.truth).padStart(2)} in top${RERANK_CANDIDATES} ${String(row.inTop).padStart(2)} | det ${cell(row.det)} | jev ${cell(row.jev)} | hyb ${cell(row.hyb)}${reranked.classifier_id.startsWith('jev') ? '' : '  (no Jev answer)'}`);
  }
  const avg = (k: 'det' | 'jev' | 'hyb', m: 'r5' | 'r10' | 'mrr') => (rows.length > 0 ? f(rows.reduce((a, r) => a + r[k][m], 0) / rows.length) : '-');
  const truthTotal = rows.reduce((a, r) => a + r.truth, 0);
  console.log(`\nn = ${rows.length} tasks; truth files inside the top ${RERANK_CANDIDATES} candidates: ${truthTotal > 0 ? f(rows.reduce((a, r) => a + r.inTop, 0) / truthTotal) : '-'}`);
  console.log('order          recall@5  recall@10  MRR');
  for (const [k, name] of [['det', 'deterministic'], ['jev', 'Jev alone'], ['hyb', 'hybrid 0.1/0.9']] as const) {
    console.log(`${name.padEnd(14)} ${avg(k, 'r5').padStart(8)}  ${avg(k, 'r10').padStart(9)}  ${avg(k, 'mrr').padStart(4)}`);
  }
  console.log(`\nInput tokens: ${tokens} (${jevCostUsd(tokens).toFixed(4)} USD, ${JEV_DEFAULT_MODEL})`);
} finally {
  await connection.close();
}
