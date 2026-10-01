// Offline evaluation of Jev's testability check (H97). It reads the tasks of one project from the
// database and prints, per automatic criterion, the two probabilities, what Jev says checking it needs and the policy result. It
// stores nothing. It calls the real TypeSafe API, so it needs TYPESAFE_API_KEY, and it sends the
// project's task text to TypeSafe: run it only when that is accepted.
//
//   set -a; . ./.env; set +a
//   node packages/core/scripts/eval-testability.ts <project id or name> [TSK-001 TSK-002 ...]
//
// The database comes from DATABASE_URL or DEMIURGO_DATABASE_URL. Use it to tune the thresholds in
// classifier/testability-policy.ts against the «request changes» the PR reviewer really gave.

import { TypeSafeClient } from '@typesafe-ai/sdk';
import { JEV_DEFAULT_MODEL } from '../src/classifier/jev.ts';
import { judgeTestability, loadTestabilityInput, testabilityStrength, testabilityVerdict } from '../src/classifier/testability.ts';
import { connect } from '../src/db/connection.ts';

const [project, ...only] = process.argv.slice(2);
const url = process.env.DATABASE_URL ?? process.env.DEMIURGO_DATABASE_URL;
if (!project || !url || !process.env.TYPESAFE_API_KEY) {
  console.error('Usage: node eval-testability.ts <project id or name> [task codes]; needs DATABASE_URL and TYPESAFE_API_KEY.');
  process.exit(1);
}

const connection = connect(url, 2);
const { db } = connection;
try {
  const proj = await db
    .selectFrom('projects')
    .select(['id', 'name'])
    .where((eb) => eb.or([eb('name', '=', project), eb(eb.cast<string>('id', 'text'), '=', project)]))
    .executeTakeFirstOrThrow();
  const tasks = await db
    .selectFrom('records')
    .select(['id', 'code'])
    .where('project_id', '=', proj.id)
    .where('type', '=', 'task')
    .orderBy('code')
    .execute();
  const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, defaultModel: JEV_DEFAULT_MODEL, timeout: 30_000 });
  let tokens = 0;
  for (const task of tasks) {
    if (only.length > 0 && !only.includes(task.code)) continue;
    // The shown version: the highest approved, else the highest of any state.
    const versions = await db.selectFrom('record_versions').select(['id', 'n', 'state']).where('record_id', '=', task.id).execute();
    const rank = (v: { n: number; state: string }) => (v.state === 'approved' ? 1_000_000 : 0) + v.n;
    const shown = versions.sort((a, b) => rank(b) - rank(a))[0];
    if (!shown) continue;
    const input = await loadTestabilityInput(db, proj.id, task.id, shown.id);
    if (!input) {
      console.log(`${task.code}  (no feature or covered criteria)`);
      continue;
    }
    console.log(`\n${task.code}  ${input.title}`);
    const judgments = await judgeTestability(client, input, JEV_DEFAULT_MODEL, (n) => (tokens += n));
    for (const j of judgments) {
      const verdict = testabilityVerdict(j);
      const strength = testabilityStrength(j, verdict).toFixed(2);
      console.log(
        `  ${j.code.padEnd(14)} outside ${j.needs_outside_ci.toFixed(2)}  unbuilt ${j.needs_unbuilt_feature.toFixed(2)}  needs ${j.needs}  -> ${verdict}${verdict === 'ok' ? '' : ` (${strength})`}`,
      );
    }
  }
  console.log(`\nInput tokens: ${tokens}`);
} finally {
  await connection.close();
}
