// Operations CLI for DEMIURGO v2 (uses DEMIURGO_DATABASE_URL and the rest of the configuration).
//   node packages/api/src/cli.ts migrate
//   node packages/api/src/cli.ts create-person <username>          (the password is read from stdin)
//   node packages/api/src/cli.ts create-project <name>
//   node packages/api/src/cli.ts real-run <projectId> <action> <json-scope> [json-input]
//   node packages/api/src/cli.ts evaluate-classifier [test|dev|all]   (uses DEMIURGO_CLASSIFIER)
//   node packages/api/src/cli.ts import-design <projectId> [dir]                (creates the H1 pending batch)
//   node packages/api/src/cli.ts export-design <projectId> [--check dir | --out dir | dir]

import {
  type Partition,
  IMPORTER,
  startCore,
  compareExport,
  exportDesign,
  createClassifier,
  evaluateClassifier,
  evaluationSummary,
  connect,
  executeCommand,
  waitForRun,
  readConfig,
  migrate,
  consoleLogger,
} from '@demiurgo/core';
import { readTree, replaceTree } from '@demiurgo/design';
import { system } from '@demiurgo/domain';
import { createPerson } from './credentials.ts';

const [command, ...args] = process.argv.slice(2);
const config = readConfig();

async function readInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const t of process.stdin) chunks.push(t as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function withDatabase<T>(f: (c: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
  const c = connect(config.databaseUrl);
  try {
    await migrate(c.pool);
    return await f(c);
  } finally {
    await c.close();
  }
}

const commands: Record<string, () => Promise<void>> = {
  async migrate() {
    const c = connect(config.databaseUrl);
    try {
      console.log(JSON.stringify({ applied: await migrate(c.pool) }));
    } finally {
      await c.close();
    }
  },

  async 'create-person'() {
    const username = args[0];
    if (!username) throw new Error('Usage: create-person <username> (password read from stdin)');
    const password = await readInput();
    await withDatabase(async (c) => {
      const id = await createPerson(c.db, username, password);
      console.log(JSON.stringify({ person: username, id }));
    });
  },

  async 'create-project'() {
    const name = args[0];
    if (!name) throw new Error('Usage: create-project <name>');
    const core = await startCore(config, consoleLogger);
    try {
      const r = await executeCommand(core.services, { command: 'project.create', actor: system('cli'), data: { name } });
      console.log(JSON.stringify({ project_id: r.projectId }));
    } finally {
      await core.stop();
    }
  },

  async 'real-run'() {
    const [projectId, action, scope, input] = args;
    if (!projectId || !action || !scope) throw new Error('Usage: real-run <projectId> <action> <json-scope> [json-input]');
    const core = await startCore(config, consoleLogger);
    try {
      const r = await executeCommand(core.services, {
        command: 'run.request',
        actor: system('cli'),
        projectId,
        data: { action, scope: JSON.parse(scope) as unknown, input: input ? (JSON.parse(input) as unknown) : {} },
      });
      const state = await waitForRun(r.entityId);
      const run = await core.services.db.selectFrom('ai_runs').selectAll().where('id', '=', r.entityId).executeTakeFirstOrThrow();
      console.log(JSON.stringify({ state, run }, null, 2));
    } finally {
      await core.stop();
    }
  },
};

commands['evaluate-classifier'] = async () => {
  const partition = (args[0] ?? 'test') as Partition;
  await withDatabase(async (c) => {
    const report = await evaluateClassifier({
      classifier: createClassifier(config),
      partition,
      chunkSize: 40,
      db: c.db,
      output: 'evals/classifier/results',
    });
    console.log(evaluationSummary(report));
    console.log(`Result saved to ${report.file ?? '(no file)'}`);
  });
};

commands['import-design'] = async () => {
  const [projectId, dir = 'design'] = args;
  if (!projectId) throw new Error('Usage: import-design <projectId> [dir]');
  const core = await startCore(config, consoleLogger);
  try {
    const tree = await readTree(dir);
    const r = await executeCommand(core.services, {
      command: 'design.import',
      actor: IMPORTER,
      projectId,
      data: { tree: Object.fromEntries(tree), origin: dir },
    });
    console.log(JSON.stringify({ batch_id: r.entityId, state: r.state, ...(r.result as object) }, null, 2));
  } finally {
    await core.stop();
  }
};

commands['export-design'] = async () => {
  const [projectId, option, dir] = args;
  if (!projectId) throw new Error('Usage: export-design <projectId> [--check dir | --out dir | dir]');
  await withDatabase(async (c) => {
    if (option === '--check') {
      const diffs = await compareExport(c.db, projectId, await readTree(dir ?? 'design'));
      if (diffs.length > 0) {
        for (const d of diffs) console.error(`✗ ${d}`);
        process.exitCode = 1;
        return;
      }
      console.log(`✓ The export matches ${dir ?? 'design'}/ byte for byte.`);
      return;
    }
    // With no flag, the second argument is the output directory.
    const target = (option === '--out' ? dir : option) ?? 'design-exported';
    if (target.startsWith('--')) throw new Error(`Unknown option: ${target}.`);
    const tree = await exportDesign(c.db, projectId);
    const removed = await replaceTree(target, tree);
    console.log(`Exported ${tree.size} file(s) to ${target}/.`);
    for (const r of removed) console.log(`  removed ${r}: no longer in v2.`);
  });
};

const action = command ? commands[command] : undefined;
if (!action) {
  console.error(`Commands: ${Object.keys(commands).join(', ')}`);
  process.exitCode = 2;
} else {
  try {
    await action();
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    // A guard's reasons say what is missing, document by document.
    const reasons = (e as { reasons?: unknown }).reasons;
    if (Array.isArray(reasons)) for (const m of reasons) console.error(`  - ${String(m)}`);
    process.exitCode = 1;
  }
}
