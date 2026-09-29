// Operations CLI for DEMIURGO v2 (uses DEMIURGO_DATABASE_URL and the rest of the configuration).
//   node packages/api/src/cli.ts migrate
//   node packages/api/src/cli.ts create-person <username>          (the password is read from stdin)
//   node packages/api/src/cli.ts create-project <name>
//   node packages/api/src/cli.ts issue-agent-token <projectId> <agentName> <username>   (the person's password from stdin)
//   node packages/api/src/cli.ts real-run <projectId> <action> <json-scope> [json-input]
//   node packages/api/src/cli.ts propose-quality <projectId>                   (the NFRs of a covered Global quality stage)
//   node packages/api/src/cli.ts evaluate-classifier <provider> <model> [effort|-] [test|dev|all] [v1|v1-en]   (spends quota)
//     provider `jev` (TypeSafe, key TYPESAFE_API_KEY): sends the evaluation set out; it spends credits, ~0.01 USD
//   node packages/api/src/cli.ts translate-records <projectId> [limit]         (proposes English versions; calls the translator)
//   node packages/api/src/cli.ts import-design <projectId> [dir]                (creates the H1 pending batch)
//   node packages/api/src/cli.ts export-design <projectId> [--check dir | --out dir | dir]

import {
  typeSafeEvaluationKey,
  type Observer,
  type Partition,
  IMPORTER,
  startCore,
  compareExport,
  exportDesign,
  classifierOnProvider,
  createProviders,
  createObserver,
  createSimulatedClassifier,
  createJevClassifier,
  jevCostUsd,
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
  proposeEnglishVersions,
  TRANSLATION_ACTOR,
  QUALITY_ACTOR,
  qualityBatch,
} from '@demiurgo/core';
import { readTree, replaceTree } from '@demiurgo/design';
import { type Actor, formatActor, human, system } from '@demiurgo/domain';
import { createPerson, verifyPerson } from './credentials.ts';

const [command, ...args] = process.argv.slice(2);
const config = readConfig();
const cliLogger = {
  ...consoleLogger,
  info: (message: string, data?: Record<string, unknown>) =>
    console.error(JSON.stringify({ level: 'info', m: message, ...data })),
};

/** Every order that executes commands is an interaction with channel `cli` (observability spec §7.2). */
function interaction<T>(observer: Observer, actor: Actor, projectId: string | null, fn: () => Promise<T>): Promise<T> {
  return observer.interaction(
    { channel: 'cli', actor: formatActor(actor), actorType: actor.type, command: command ?? '', projectId },
    fn,
  );
}

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
    const core = await startCore(config, cliLogger);
    try {
      const actor = system('cli');
      const r = await interaction(core.services.observer, actor, null, () =>
        executeCommand(core.services, { command: 'project.create', actor, data: { name } }),
      );
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
        logger: cliLogger,
        observer: createObserver(config.observe, cliLogger),
      };
      const actor = human(username);
      const r = await interaction(services.observer, actor, projectId, () =>
        executeCommand(services, { command: 'agent_token.issue', actor, projectId, data: { name } }),
      );
      const result = r.result as { token: string; actor: string };
      console.log(JSON.stringify({ token: result.token, actor: result.actor, issued_by: `human:${username}` }));
    });
  },

  // The English versions of the records written in another language, proposed for the person to
  // check (records are always in English). It calls the translator agent's model (Qwen by default).
  async 'translate-records'() {
    const [projectId, limitArg] = args;
    if (!projectId) throw new Error('Usage: translate-records <projectId> [limit]');
    const limit = limitArg ? Number(limitArg) : 20;
    if (!Number.isInteger(limit) || limit < 1) throw new Error('The limit is a whole number of records.');
    await withDatabase(async (c) => {
      const services = {
        db: c.db,
        clock: () => new Date(),
        providers: createProviders(config),
        classifierFor: () => Promise.reject(new Error('Proposing English versions classifies nothing.')),
        agentSessionsDir: config.agentSessionsDir,
        engine: inertEngine(),
        logger: consoleLogger,
        observer: createObserver(config.observe, consoleLogger),
      };
      const r = await interaction(services.observer, TRANSLATION_ACTOR, projectId, () =>
        proposeEnglishVersions(services, projectId, { limit }),
      );
      console.log(JSON.stringify(r, null, 2));
      await services.observer.flush(5000);
    });
  },

  async 'propose-quality'() {
    const [projectId] = args;
    if (!projectId) throw new Error('Usage: propose-quality <projectId>');
    const core = await startCore(config, cliLogger);
    try {
      const { db } = core.services;
      const stage = await db
        .selectFrom('stages')
        .select('id')
        .where('project_id', '=', projectId)
        .where('stage', '=', 'quality')
        .executeTakeFirst();
      const data = await qualityBatch(db, projectId, stage?.id);
      if (!data) throw new Error('Global quality is not covered, or its requirements were already proposed.');
      const r = await executeCommand(core.services, { command: 'batch.submit', actor: QUALITY_ACTOR, projectId, data });
      console.log(JSON.stringify({ batch: r.entityId, proposals: data.proposals.length }));
    } finally {
      await core.stop();
    }
  },

  async 'real-run'() {
    const [projectId, action, scope, input] = args;
    if (!projectId || !action || !scope) throw new Error('Usage: real-run <projectId> <action> <json-scope> [json-input]');
    const core = await startCore(config, cliLogger);
    try {
      const actor = system('cli');
      const r = await interaction(core.services.observer, actor, projectId, () =>
        executeCommand(core.services, {
          command: 'run.request',
          actor,
          projectId,
          data: { action, scope: JSON.parse(scope) as unknown, input: input ? (JSON.parse(input) as unknown) : {} },
        }),
      );
      const state = await waitForRun(r.entityId);
      const run = await core.services.db.selectFrom('ai_runs').selectAll().where('id', '=', r.entityId).executeTakeFirstOrThrow();
      console.log(JSON.stringify({ state, run }, null, 2));
    } finally {
      await core.stop();
    }
  },
};

commands['evaluate-classifier'] = async () => {
  const [providerId = '', model = '', effortArg = '-', partitionArg = 'test', datasetArg = 'v1'] = args;
  const partition = partitionArg as Partition;
  const jev = providerId === 'jev';
  const provider = createProviders({ ...config, devTools: true }).get(providerId);
  const agent = (await loadAgentCatalog()).get('knowledge_classifier');
  if ((!jev && !provider) || !model || !agent) {
    throw new Error(
      'Usage: evaluate-classifier <claude|codex|opencode|simulated|jev> <model> [effort|-] [test|dev|all] [v1|v1-en]',
    );
  }
  if (jev && !typeSafeEvaluationKey()) throw new Error('Set TYPESAFE_API_KEY to evaluate Jev.');
  const effort = effortArg === '-' ? null : effortArg;
  // The labeled set: v1 (Spanish, the original) or v1-en (its English translation), under evals/classifier/.
  if (!/^[a-z0-9-]+$/.test(datasetArg)) throw new Error(`Unknown dataset: ${datasetArg}.`);
  const dir = `evals/classifier/${datasetArg}`;
  await withDatabase(async (c) => {
    // Through callProvider, so the evaluation's calls leave their trace like any other (spec §7.8).
    const observer = createObserver(config.observe, cliLogger);
    const usage = { requests: 0, input: 0, output: 0 };
    const classifier = jev
      ? createJevClassifier({
          model,
          apiKey: typeSafeEvaluationKey(),
          onUsage: (u) => {
            usage.requests += 1;
            usage.input += u.input_tokens;
            usage.output += u.output_tokens;
          },
        })
      : provider?.id === 'simulated' || !provider
        ? createSimulatedClassifier()
        : classifierOnProvider({ db: c.db, observer }, provider, agent, { model, effort, source: 'override' }, null);
    const report = await evaluateClassifier({
      classifier,
      partition,
      dir,
      chunkSize: 40,
      db: c.db,
      output: 'evals/classifier/results',
    });
    console.log(evaluationSummary(report));
    console.log(`Result saved to ${report.file ?? '(no file)'}`);
    if (jev) {
      console.log(
        `Jev: ${usage.requests} requests, ${usage.input} input tokens, ${usage.output} output tokens, ${jevCostUsd(usage.input).toFixed(5)} USD`,
      );
    }
    await observer.flush(5000);
  });
};

commands['import-design'] = async () => {
  const [projectId, dir = 'design'] = args;
  if (!projectId) throw new Error('Usage: import-design <projectId> [dir]');
  const core = await startCore(config, cliLogger);
  try {
    const tree = await readTree(dir);
    const r = await interaction(core.services.observer, IMPORTER, projectId, () =>
      executeCommand(core.services, {
        command: 'design.import',
        actor: IMPORTER,
        projectId,
        data: { tree: Object.fromEntries(tree), origin: dir },
      }),
    );
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
