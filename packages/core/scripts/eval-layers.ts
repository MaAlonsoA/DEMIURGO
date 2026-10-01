// Offline evaluation of Jev's layers guess (H101). For every MERGED task of one project it asks Jev the
// five layer questions about the task text and compares them with the ground truth from the files the
// task's pull request changed (its footprint):
//   schema: any file under migrations/ or *.sql
//   ui:     files under src/app or src/design-system
//   server: *actions*.ts files or src/lib/db*
// It prints each task and a confusion summary (precision and recall at the threshold). It stores
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
import { taskSizeText } from '../src/classifier/size.ts';
import { isSchemaFile } from '../src/build/schema-risk.ts';
import { taskFootprints } from '../src/build/footprint.ts';
import { connect } from '../src/db/connection.ts';

const [project, ...only] = process.argv.slice(2);
const url = process.env.DATABASE_URL ?? process.env.DEMIURGO_DATABASE_URL;
if (!project || !url || !process.env.TYPESAFE_API_KEY) {
  console.error('Usage: node eval-layers.ts <project id or name> [task codes]; needs DATABASE_URL and TYPESAFE_API_KEY.');
  process.exit(1);
}

const isUi = (p: string) => /(^|\/)src\/(app|design-system)\//.test(p);
const isServer = (p: string) => /actions[^/]*\.ts$/.test(p) || /(^|\/)src\/lib\/db/.test(p);

type Layer = 'schema' | 'ui' | 'server';
const truthOf: Record<Layer, (p: string) => boolean> = { schema: isSchemaFile, ui: isUi, server: isServer };
const counts: Record<Layer, { tp: number; fp: number; fn: number; tn: number }> = {
  schema: { tp: 0, fp: 0, fn: 0, tn: 0 },
  ui: { tp: 0, fp: 0, fn: 0, tn: 0 },
  server: { tp: 0, fp: 0, fn: 0, tn: 0 },
};

const connection = connect(url, 2);
const { db } = connection;
try {
  const proj = await db
    .selectFrom('projects')
    .select(['id', 'name'])
    .where((eb) => eb.or([eb('name', '=', project), eb(eb.cast<string>('id', 'text'), '=', project)]))
    .executeTakeFirstOrThrow();
  const footprints = await taskFootprints(db, proj.id);
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
    const text = await taskSizeText({ db }, shown.id);
    if (!text) continue;
    const j = await judgeLayers(client, text, JEV_DEFAULT_MODEL, (n) => (tokens += n));
    const paths = fp.files.map((f) => f.path);
    const cells: string[] = [];
    for (const layer of ['schema', 'ui', 'server'] as const) {
      const truth = paths.some(truthOf[layer]);
      const predicted = j[layer] >= SCHEMA_THRESHOLD;
      const c = counts[layer];
      if (truth && predicted) c.tp++;
      else if (!truth && predicted) c.fp++;
      else if (truth && !predicted) c.fn++;
      else c.tn++;
      cells.push(`${layer} ${j[layer].toFixed(2)} (${truth ? 'truth yes' : 'truth no'}${truth === predicted ? '' : ', MISS'})`);
    }
    console.log(`${fp.code.padEnd(10)} ${cells.join('  ')}  tests_only ${j.tests_only.toFixed(2)}  deploy ${j.deploy.toFixed(2)}  ${fp.title}`);
  }
  console.log(`\nConfusion at ${SCHEMA_THRESHOLD}:`);
  for (const layer of ['schema', 'ui', 'server'] as const) {
    const { tp, fp, fn, tn } = counts[layer];
    const precision = tp + fp > 0 ? (tp / (tp + fp)).toFixed(2) : 'n/a';
    const recall = tp + fn > 0 ? (tp / (tp + fn)).toFixed(2) : 'n/a';
    console.log(`  ${layer.padEnd(7)} tp ${tp}  fp ${fp}  fn ${fn}  tn ${tn}  precision ${precision}  recall ${recall}`);
  }
  console.log(`\nInput tokens: ${tokens}`);
} finally {
  await connection.close();
}
