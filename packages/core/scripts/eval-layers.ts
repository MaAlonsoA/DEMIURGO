// Offline evaluation of Jev's schema guess (H101). For every MERGED task of one project it asks Jev the
// schema Score about the task, with the repository as it was before the task's merge (the first parent
// of its merge commit, when the project's repository is here), and compares it with the ground truth
// from the files the task's pull request changed (its footprint): schema is any file under migrations/
// or *.sql. It prints each task and a confusion summary (precision and recall at the threshold). It stores
// nothing. It calls the real TypeSafe API, so it needs TYPESAFE_API_KEY, and it sends the project's task
// text to TypeSafe: run it only when that is accepted.
//
//   set -a; . ./.env; set +a
//   node packages/core/scripts/eval-layers.ts <project id or name> [TSK-001 TSK-002 ...]
//
// The database comes from DATABASE_URL or DEMIURGO_DATABASE_URL. Use it to tune SCHEMA_THRESHOLD in
// classifier/layers.ts.

import { TypeSafeClient } from '@typesafe-ai/sdk';
import { JEV_DEFAULT_MODEL } from '../src/classifier/jev.ts';
import { SCHEMA_THRESHOLD, judgeLayers } from '../src/classifier/layers.ts';
import { readRepoContext, projectRepoDir } from '../src/classifier/repo-context.ts';
import { loadTaskObject } from '../src/classifier/task-input.ts';
import { isSchemaFile } from '../src/build/schema-risk.ts';
import { taskFootprints } from '../src/build/footprint.ts';
import { connect } from '../src/db/connection.ts';

const [project, ...only] = process.argv.slice(2);
const url = process.env.DATABASE_URL ?? process.env.DEMIURGO_DATABASE_URL;
if (!project || !url || !process.env.TYPESAFE_API_KEY) {
  console.error('Usage: node eval-layers.ts <project id or name> [task codes]; needs DATABASE_URL and TYPESAFE_API_KEY.');
  process.exit(1);
}

const counts = { tp: 0, fp: 0, fn: 0, tn: 0 };

const connection = connect(url, 2);
const { db } = connection;
try {
  const proj = await db
    .selectFrom('projects')
    .select(['id', 'name'])
    .where((eb) => eb.or([eb('name', '=', project), eb(eb.cast<string>('id', 'text'), '=', project)]))
    .executeTakeFirstOrThrow();
  const footprints = await taskFootprints(db, proj.id);
  const dir = await projectRepoDir(db, proj.id);
  const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, defaultModel: JEV_DEFAULT_MODEL, timeout: 30_000 });
  let tokens = 0;
  for (const fp of footprints) {
    if (only.length > 0 && !only.includes(fp.code)) continue;
    const rec = await db.selectFrom('records').select('id').where('project_id', '=', proj.id).where('code', '=', fp.code).executeTakeFirst();
    if (!rec) continue;
    const versions = await db.selectFrom('record_versions').select(['id', 'n', 'state']).where('record_id', '=', rec.id).execute();
    const rank = (v: { n: number; state: string }) => (v.state === 'approved' ? 1_000_000 : 0) + v.n;
    const shown = versions.sort((a, b) => rank(b) - rank(a))[0];
    if (!shown) continue;
    const task = await loadTaskObject(db, rec.id, shown.id);
    if (!task) continue;
    // Without the repository (or the merge commit) the request goes out without those fields.
    const repo = dir && fp.merge_commit ? await readRepoContext(dir, `${fp.merge_commit}^1`) : null;
    const j = await judgeLayers(client, { task, repo }, JEV_DEFAULT_MODEL, (n) => (tokens += n));
    const truth = fp.files.some((f) => isSchemaFile(f.path));
    const predicted = j.schema >= SCHEMA_THRESHOLD;
    if (truth && predicted) counts.tp++;
    else if (!truth && predicted) counts.fp++;
    else if (truth && !predicted) counts.fn++;
    else counts.tn++;
    console.log(`${fp.code.padEnd(10)} schema ${j.schema.toFixed(2)} (${truth ? 'truth yes' : 'truth no'}${truth === predicted ? '' : ', MISS'})${repo ? '' : '  (no repository context)'}  ${fp.title}`);
  }
  const { tp, fp, fn, tn } = counts;
  const precision = tp + fp > 0 ? (tp / (tp + fp)).toFixed(2) : 'n/a';
  const recall = tp + fn > 0 ? (tp / (tp + fn)).toFixed(2) : 'n/a';
  console.log(`\nConfusion at ${SCHEMA_THRESHOLD}: tp ${tp}  fp ${fp}  fn ${fn}  tn ${tn}  precision ${precision}  recall ${recall}`);
  console.log(`\nInput tokens: ${tokens}`);
} finally {
  await connection.close();
}
