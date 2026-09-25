// Operations CLI for DEMIURGO v2 (uses DEMIURGO_DATABASE_URL and the rest of the configuration).
//   node packages/api/src/cli.ts migrate
//   node packages/api/src/cli.ts create-person <username>          (the password is read from stdin)
//   node packages/api/src/cli.ts create-project <name>
//   node packages/api/src/cli.ts issue-agent-token <projectId> <agentName> <username>   (the person's password from stdin)
//   node packages/api/src/cli.ts real-run <projectId> <action> <json-scope> [json-input]
//   node packages/api/src/cli.ts evaluate-classifier <provider> <model> [effort|-] [test|dev|all]   (spends quota)
//   node packages/api/src/cli.ts import-design <projectId> [dir]                (creates the H1 pending batch)
//   node packages/api/src/cli.ts export-design <projectId> [--check dir | --out dir | dir]

import {
  type Partition,
  IMPORTER,
  startCore,
  compareExport,
  exportDesign,
  createAgentClassifier,
  createProviders,
  createSimulatedClassifier,
  evaluateClassifier,
  loadAgentCatalog,
  evaluationSummary,
  connect,
  executeCommand,
  waitForRun,
  readConfig,
  migrate,
  consoleLogger,
  inertEngine,
} from '@demiurgo/core';
import { readTree, replaceTree } from '@demiurgo/design';
import { composeSystem, human, system } from '@demiurgo/domain';
import { createPerson, verifyPerson } from './credentials.ts';

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

  // An agent key is a person's act (agent_token.issue): the person's password is checked first.
  // It only needs the bus: no durable engine, so it never touches what a running server has in
  // flight (its provider calls, its pending workflows).
  async 'issue-agent-token'() {
    const [projectId, name, username] = args;
    if (!projectId || !name || !username) {
      throw new Error("Usage: issue-agent-token <projectId> <agentName> <username> (the person's password is read from stdin)");
    }
    const password = await readInput();
    await withDatabase(async (c) => {
      await verifyPerson(c.db, username, password);
      const services = {
        db: c.db,
        clock: () => new Date(),
        providers: createProviders(config),
        classifierFor: () => Promise.reject(new Error('Issuing an agent key classifies nothing.')),
        agentSessionsDir: config.agentSessionsDir,
        engine: inertEngine(),
        logger: consoleLogger,
      };
      const r = await executeCommand(services, {
        command: 'agent_token.issue',
        actor: human(username),
        projectId,
        data: { name },
      });
      const result = r.result as { token: string; actor: string };
      console.log(JSON.stringify({ token: result.token, actor: result.actor, issued_by: `human:${username}` }));
    });
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
  const [providerId = '', model = '', effortArg = '-', partitionArg = 'test'] = args;
  const partition = partitionArg as Partition;
  const provider = createProviders({ ...config, devTools: true }).get(providerId);
  const agent = (await loadAgentCatalog()).get('knowledge_classifier');
  if (!provider || !model || !agent) {
    throw new Error('Usage: evaluate-classifier <claude|codex|opencode|simulated> <model> [effort|-] [test|dev|all]');
  }
  const effort = effortArg === '-' ? null : effortArg;
  const classifier =
    provider.id === 'simulated'
      ? createSimulatedClassifier()
      : createAgentClassifier({
          id: `agent:knowledge_classifier@${agent.version}/${provider.id}/${model}/${effort ?? 'default'}`,
          system: (_primitive, rules) => composeSystem(agent, agent.skillDefinitions, rules).system,
          invoke: (call) =>
            provider.run({
              system: call.system,
              input: call.input,
              schema: call.schema,
              model,
              effort,
              session: { mode: 'none' },
              timeMs: agent.timeLimitSeconds * 1000,
            }),
        });
  await withDatabase(async (c) => {
    const report = await evaluateClassifier({
      classifier,
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
