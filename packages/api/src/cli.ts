// Operations CLI for DEMIURGO v2 (uses DEMIURGO_DATABASE_URL and the rest of the configuration).
//   node packages/api/src/cli.ts migrate
//   node packages/api/src/cli.ts create-person <username>          (the password is read from stdin)
//   node packages/api/src/cli.ts create-project <name>
//   node packages/api/src/cli.ts issue-agent-token <projectId> <agentName> <username>   (the person's password from stdin)
//   node packages/api/src/cli.ts real-run <projectId> <action> <json-scope> [json-input]
//   node packages/api/src/cli.ts propose-principles <projectId> <stage>        (a covered stage of principles, as the definition's next version)
//   node packages/api/src/cli.ts sync-repo <projectId>                         (writes design/ to the project's repository and commits it)
//   node packages/api/src/cli.ts github-setup <projectId> <username>            (a person's act, password on stdin; creates the project's private GitHub repo, pushes main, protects it; prints owner/repo)
//   node packages/api/src/cli.ts supersede-batch <projectId> <batchId> <reason>  (withdraws a pending batch; decides nothing)
//   node packages/api/src/cli.ts classify-messages <projectId>                 (Jev: aspect of the messages not classified yet)
//   node packages/api/src/cli.ts evaluate-classifier <provider> <model> [effort|-] [test|dev|all] [v1|v1-en]   (spends quota)
//     provider `jev` (TypeSafe, key TYPESAFE_API_KEY): sends the evaluation set out; it spends credits, ~0.01 USD
//   node packages/api/src/cli.ts translate-records <projectId> [limit]         (proposes English versions; calls the translator)
//   node packages/api/src/cli.ts evidence-junit <projectId> <file.xml> [--pr <url>] [--ref <sha>]   (posts CI results to the running API; token in DEMIURGO_AGENT_TOKEN, URL in DEMIURGO_URL or http://127.0.0.1:8100)
//   node packages/api/src/cli.ts import-design <projectId> [dir]                (creates the H1 pending batch)
//   node packages/api/src/cli.ts harness recompute [--project <id>] [--request <id>]   (computes the harness post-mortems of ended builds; idempotent)
//   node packages/api/src/cli.ts build-footprint-backfill --project <projectId>   (records the merge commit and files of merged tasks that lack them; needs GitHub env)
//   node packages/api/src/cli.ts code-map --project <projectId> [--query "text"] [--ref main] [--budget 6000]   (prints the ranked code map of the project's repository; read-only)
//   node packages/api/src/cli.ts layers-backfill --project <projectId>           (Jev's schema opinion for tasks that have none; needs TYPESAFE_API_KEY)
//   node packages/api/src/cli.ts testability-backfill --project <projectId>       (Jev's testability opinion for task versions that have none; needs TYPESAFE_API_KEY)
//   node packages/api/src/cli.ts review-findings-backfill --project <projectId>  (Jev's category for the comments of reviews that have none; needs TYPESAFE_API_KEY)
//   node packages/api/src/cli.ts link-supersedes --project <projectId> --from TSK-… --to TSK-… [--from-version N] [--to-version N] [--note "point"]   (records that the later task supersedes the built one; idempotent)
//   node packages/api/src/cli.ts export-design <projectId> [--check dir | --out dir | dir]

import { readFileSync } from 'node:fs';
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
  principlesBatch,
  syncRepo,
  projectsDir,
  classifyAspects,
  githubConfig,
  ensureProjectRepo,
  pullRequest,
  pullRequestFiles,
  pullRequestFootprint,
  RULES_VERSION,
  runPostmortem,
  pendingPostmortems,
  taskFootprints,
  classifyTaskTestability,
  classifyReviewFindings,
  ensureTaskLayers,
  repositoryOf,
  buildCodeMap,
  rankCodeMap,
  renderCodeMap,
  BRIEF_MAP_CHARS,
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
    {
      channel: 'cli',
      actor: formatActor(actor),
      actorType: actor.type,
      command: command ?? '',
      projectId,
    },
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

  // Runs from CI: the agent token (an agent's credential, never printed) comes from the environment.
  async 'evidence-junit'() {
    const [projectId, file] = args;
    if (!projectId || !file) throw new Error('Usage: evidence-junit <projectId> <file.xml> [--pr <url>] [--ref <sha>]');
    const token = process.env.DEMIURGO_AGENT_TOKEN;
    if (!token) throw new Error('DEMIURGO_AGENT_TOKEN is not set.');
    const flag = (name: string): string | undefined => {
      const i = args.indexOf(name);
      return i >= 0 ? args[i + 1] : undefined;
    };
    const query = new URLSearchParams();
    const pr = flag('--pr');
    const ref = flag('--ref');
    if (pr) query.set('pr_url', pr);
    if (ref) query.set('reference', ref);
    const base = process.env.DEMIURGO_URL ?? 'http://127.0.0.1:8100';
    const res = await fetch(`${base}/api/projects/${projectId}/evidence/junit${query.size ? `?${query}` : ''}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/xml' },
      body: readFileSync(file, 'utf8'),
    });
    const text = await res.text();
    console.log(text);
    if (!res.ok) process.exitCode = 1;
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
        executeCommand(core.services, {
          command: 'project.create',
          actor,
          data: { name },
        }),
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
        executeCommand(services, {
          command: 'agent_token.issue',
          actor,
          projectId,
          data: { name },
        }),
      );
      const result = r.result as { token: string; actor: string };
      console.log(
        JSON.stringify({
          token: result.token,
          actor: result.actor,
          issued_by: `human:${username}`,
        }),
      );
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

  async 'propose-principles'() {
    const [projectId, stageKey] = args;
    if (!projectId || !stageKey) throw new Error('Usage: propose-principles <projectId> <stage>');
    const core = await startCore(config, cliLogger);
    try {
      const { db } = core.services;
      const stage = await db
        .selectFrom('stages')
        .select('id')
        .where('project_id', '=', projectId)
        .where('stage', '=', stageKey)
        .executeTakeFirst();
      const data = await principlesBatch(db, projectId, stage?.id);
      if (!data)
        throw new Error('The stage is not covered, there is no definition, another one is pending, or it already says it.');
      const r = await executeCommand(core.services, {
        command: 'batch.submit',
        actor: system('definition'),
        projectId,
        data,
      });
      console.log(JSON.stringify({ batch: r.entityId }));
    } finally {
      await core.stop();
    }
  },

  async 'sync-repo'() {
    const [projectId] = args;
    if (!projectId) throw new Error('Usage: sync-repo <projectId>');
    if (!projectsDir()) throw new Error('Set DEMIURGO_PROJECTS_DIR first.');
    await withDatabase(async (c) => {
      const sha = await syncRepo({ db: c.db, logger: consoleLogger }, projectId, {
        actor: 'system:repo@1',
        versionId: null,
        discarded: false,
      });
      console.log(JSON.stringify({ commit: sha }));
    });
  },

  // Connecting the repository is a person's act (repository.connect): the person's password is
  // checked first. It only needs the bus, like issue-agent-token.
  async 'github-setup'() {
    const [projectId, username] = args;
    if (!projectId || !username)
      throw new Error("Usage: github-setup <projectId> <username> (the person's password is read from stdin)");
    const password = await readInput();
    await withDatabase(async (c) => {
      await verifyPerson(c.db, username, password);
      const services = {
        db: c.db,
        clock: () => new Date(),
        providers: createProviders(config),
        classifierFor: () => Promise.reject(new Error('Connecting the repository classifies nothing.')),
        agentSessionsDir: config.agentSessionsDir,
        engine: inertEngine(),
        logger: cliLogger,
        observer: createObserver(config.observe, cliLogger),
      };
      const actor = human(username);
      const r = await interaction(services.observer, actor, projectId, () =>
        executeCommand(services, { command: 'repository.connect', actor, projectId, entityId: projectId, data: {} }),
      );
      console.log(JSON.stringify(r.result));
    });
  },

  async 'supersede-batch'() {
    const [projectId, batchId, ...reason] = args;
    if (!projectId || !batchId || reason.length === 0) throw new Error('Usage: supersede-batch <projectId> <batchId> <reason>');
    const core = await startCore(config, cliLogger);
    try {
      await executeCommand(core.services, {
        command: 'batch.supersede',
        actor: system('design'),
        projectId,
        entityId: batchId,
        data: { reason: reason.join(' ') },
      });
      console.log(JSON.stringify({ superseded: batchId }));
    } finally {
      await core.stop();
    }
  },

  async 'classify-messages'() {
    const [projectId] = args;
    if (!projectId) throw new Error('Usage: classify-messages <projectId>');
    const core = await startCore(config, cliLogger);
    try {
      const { db } = core.services;
      const messages = await db
        .selectFrom('messages')
        .select(['id', 'body'])
        .where('project_id', '=', projectId)
        .where('author', 'like', 'human:%')
        .where('aspect', 'is', null)
        .execute();
      const judged = await classifyAspects(
        core.services,
        projectId,
        messages.map((m) => ({ id: m.id, text: m.body })),
      );
      for (const [id, a] of judged)
        await db
          .updateTable('messages')
          .set({ aspect: a.aspect, aspect_confidence: a.confidence })
          .where('id', '=', id)
          .execute();
      console.log(JSON.stringify({ messages: messages.length, classified: judged.size }));
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
          data: {
            action,
            scope: JSON.parse(scope) as unknown,
            input: input ? (JSON.parse(input) as unknown) : {},
          },
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

commands['code-map'] = async () => {
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const projectId = flag('--project');
  if (!projectId) throw new Error('Usage: code-map --project <projectId> [--query "text"] [--ref main] [--budget 6000]');
  // Read-only: no migration is run here.
  const c = connect(config.databaseUrl);
  try {
    const repo = await repositoryOf(c.db, projectId);
    if (!repo.path) throw new Error('The project has no repository (DEMIURGO_PROJECTS_DIR).');
    const map = await buildCodeMap(repo.path, flag('--ref') ?? repo.branch);
    console.log(`# ${map.files.length} files, ${map.modules.size} modules, ${map.tables.size} tables, ${map.edges.length} imports at ${map.commit.slice(0, 8)}`);
    console.log(renderCodeMap(rankCodeMap(map, flag('--query') ?? ''), Number(flag('--budget') ?? BRIEF_MAP_CHARS)));
  } finally {
    await c.close();
  }
};

commands['link-supersedes'] = async () => {
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const projectId = flag('--project');
  const fromCode = flag('--from');
  const toCode = flag('--to');
  if (!projectId || !fromCode || !toCode) {
    throw new Error('Usage: link-supersedes --project <projectId> --from <TSK-later> --to <TSK-built> [--from-version N] [--to-version N] [--note "point"]');
  }
  await withDatabase(async (c) => {
    const services = {
      db: c.db,
      clock: () => new Date(),
      providers: createProviders(config),
      classifierFor: () => Promise.reject(new Error('A supersession classifies nothing.')),
      agentSessionsDir: config.agentSessionsDir,
      engine: inertEngine(),
      logger: cliLogger,
      observer: createObserver(config.observe, cliLogger),
    };
    // The version asked for, else the latest approved one, else the latest.
    const versionOf = async (code: string, n: string | undefined) => {
      const rows = await c.db
        .selectFrom('record_versions as v')
        .innerJoin('records as r', 'r.id', 'v.record_id')
        .select(['v.id', 'v.n', 'v.state', 'r.type'])
        .where('r.project_id', '=', projectId)
        .where('r.code', '=', code)
        .where('v.state', '<>', 'discarded')
        .orderBy('v.n', 'desc')
        .execute();
      const hit = n ? rows.find((v) => v.n === Number(n)) : (rows.find((v) => v.state === 'approved') ?? rows[0]);
      if (!hit) throw new Error(`${code}${n ? ` v${n}` : ''} not found in the project.`);
      if (hit.type !== 'task') throw new Error(`${code} is not a task.`);
      return hit;
    };
    const from = await versionOf(fromCode, flag('--from-version'));
    const to = await versionOf(toCode, flag('--to-version'));
    const exists = await c.db
      .selectFrom('links')
      .select('id')
      .where('project_id', '=', projectId)
      .where('type', '=', 'supersedes')
      .where('from_id', '=', from.id)
      .where('to_id', '=', to.id)
      .executeTakeFirst();
    if (exists) {
      console.log(JSON.stringify({ created: false, reason: 'already linked' }));
      return;
    }
    const actor = system('supersession');
    const note = flag('--note');
    const r = await interaction(services.observer, actor, projectId, () =>
      executeCommand(services, {
        command: 'link.supersede',
        actor,
        projectId,
        data: {
          from: { type: 'record_version', id: from.id },
          to: { type: 'record_version', id: to.id },
          ...(note ? { point: note } : {}),
        },
      }),
    );
    console.log(JSON.stringify({ created: true, link: r.entityId, from: `${fromCode} v${from.n}`, to: `${toCode} v${to.n}` }));
    await services.observer.flush(5000);
  });
};

commands.harness = async () => {
  if (args[0] !== 'recompute') throw new Error('Usage: harness recompute [--project <id>] [--request <id>]');
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const projectId = flag('--project');
  const requestId = flag('--request');
  await withDatabase(async (c) => {
    const services = {
      db: c.db,
      clock: () => new Date(),
      providers: createProviders(config),
      classifierFor: () => Promise.reject(new Error('A post-mortem classifies nothing.')),
      agentSessionsDir: config.agentSessionsDir,
      engine: inertEngine(),
      logger: cliLogger,
      observer: createObserver(config.observe, cliLogger),
    };
    const ids = requestId
      ? [requestId]
      : (await pendingPostmortems(c.db)).filter((p) => !projectId || p.project_id === projectId).map((p) => p.id);
    const counts = { recorded: 0, unchanged: 0, not_ended: 0 };
    for (const id of ids) {
      const r = await runPostmortem(services, id, RULES_VERSION);
      counts[r.status]++;
      console.log(`${id}: ${r.status}${r.status === 'recorded' ? ` (${r.findings} finding(s))` : ''}`);
    }
    console.log(JSON.stringify({ rules_version: RULES_VERSION, requests: ids.length, ...counts }));
    await services.observer.flush(5000);
  });
};

commands['build-footprint-backfill'] = async () => {
  const i = args.indexOf('--project');
  const projectId = i >= 0 ? args[i + 1] : undefined;
  if (!projectId) throw new Error('Usage: build-footprint-backfill --project <projectId>');
  const cfg = githubConfig();
  if (!cfg) throw new Error('Set DEMIURGO_GITHUB_TOKEN and DEMIURGO_GITHUB_OWNER.');
  await withDatabase(async (c) => {
    const services = {
      db: c.db,
      clock: () => new Date(),
      providers: createProviders(config),
      classifierFor: () => Promise.reject(new Error('A footprint classifies nothing.')),
      agentSessionsDir: config.agentSessionsDir,
      engine: inertEngine(),
      logger: cliLogger,
      observer: createObserver(config.observe, cliLogger),
    };
    const repo = await c.db.selectFrom('project_github').select(['owner', 'repo']).where('project_id', '=', projectId).executeTakeFirst();
    if (!repo) throw new Error('The project has no GitHub repository.');
    const have = new Set((await taskFootprints(c.db, projectId)).map((t) => t.code));
    const merged = await c.db
      .selectFrom('build_requests as b')
      .innerJoin('records as r', 'r.id', 'b.task_id')
      .select(['b.id', 'b.pr_number', 'r.code'])
      .where('b.project_id', '=', projectId)
      .where('b.state', '=', 'done')
      .where('b.pr_number', 'is not', null)
      .orderBy('b.done_at')
      .execute();
    const actor = system('cli');
    let written = 0;
    for (const m of merged) {
      if (have.has(m.code) || m.pr_number === null) continue;
      const attempt = await c.db
        .selectFrom('build_steps')
        .select((eb) => eb.fn.max('attempt').as('attempt'))
        .where('build_request_id', '=', m.id)
        .executeTakeFirst();
      try {
        const footprint = await pullRequestFootprint({ pullRequest, pullRequestFiles }, cfg, repo, m.pr_number);
        await interaction(services.observer, actor, projectId, () =>
          executeCommand(services, {
            command: 'build_step.record',
            actor,
            projectId,
            data: { build_request_id: m.id, attempt: Number(attempt?.attempt ?? 1), stage: 'footprint', outcome: 'ok', detail: { footprint, backfilled: true } },
          }),
        );
        written++;
        console.log(`${m.code}: ${footprint.files.length} file(s)`);
      } catch (e) {
        console.error(`${m.code}: skipped (${(e as Error).message})`);
      }
    }
    console.log(JSON.stringify({ merged: merged.length, written }));
    await services.observer.flush(5000);
  });
};

commands['layers-backfill'] = async () => {
  const i = args.indexOf('--project');
  const projectId = i >= 0 ? args[i + 1] : undefined;
  if (!projectId) throw new Error('Usage: layers-backfill --project <projectId>');
  await withDatabase(async (c) => {
    const services = {
      db: c.db,
      clock: () => new Date(),
      providers: createProviders(config),
      classifierFor: () => Promise.reject(new Error('Layers use Jev directly.')),
      agentSessionsDir: config.agentSessionsDir,
      engine: inertEngine(),
      logger: cliLogger,
      observer: createObserver(config.observe, cliLogger),
    };
    const codes = (await c.db.selectFrom('records').select('code').where('project_id', '=', projectId).where('type', '=', 'task').execute()).map((r) => r.code);
    const asked = await ensureTaskLayers(services as never, projectId, codes);
    console.log(JSON.stringify({ tasks: codes.length, asked }));
  });
};

commands['testability-backfill'] = async () => {
  const i = args.indexOf('--project');
  const projectId = i >= 0 ? args[i + 1] : undefined;
  if (!projectId) throw new Error('Usage: testability-backfill --project <projectId>');
  await withDatabase(async (c) => {
    const services = {
      db: c.db,
      clock: () => new Date(),
      providers: createProviders(config),
      classifierFor: () => Promise.reject(new Error('Testability uses Jev directly.')),
      agentSessionsDir: config.agentSessionsDir,
      engine: inertEngine(),
      logger: cliLogger,
      observer: createObserver(config.observe, cliLogger),
    };
    // The latest approved version of each task that has no opinion yet (Jev judges new versions on its own).
    const versions = await c.db
      .selectFrom('records as r')
      .innerJoin('record_versions as v', 'v.record_id', 'r.id')
      .select(['r.id', 'r.code', 'v.id as version_id', 'v.n'])
      .where('r.project_id', '=', projectId)
      .where('r.type', '=', 'task')
      .where('v.state', '=', 'approved')
      .orderBy('r.code')
      .orderBy('v.n', 'desc')
      .execute();
    const judged = new Set(
      (await c.db.selectFrom('task_testability_opinions').select('record_version_id').where('project_id', '=', projectId).execute()).map((x) => x.record_version_id),
    );
    const seen = new Set<string>();
    let asked = 0;
    for (const v of versions) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      if (judged.has(v.version_id)) continue;
      await classifyTaskTestability(services, projectId, v.id, v.version_id);
      asked++;
      console.log(v.code);
    }
    console.log(JSON.stringify({ tasks: seen.size, asked }));
  });
};

commands['review-findings-backfill'] = async () => {
  const i = args.indexOf('--project');
  const projectId = i >= 0 ? args[i + 1] : undefined;
  if (!projectId) throw new Error('Usage: review-findings-backfill --project <projectId>');
  await withDatabase(async (c) => {
    const reviews = await c.db.selectFrom('pr_reviews').select(['id', 'comments']).where('project_id', '=', projectId).orderBy('created_at').execute();
    const judged = new Set((await c.db.selectFrom('review_finding_kinds').select('pr_review_id').where('project_id', '=', projectId).execute()).map((x) => x.pr_review_id));
    let asked = 0;
    let comments = 0;
    for (const r of reviews) {
      if (judged.has(r.id) || !Array.isArray(r.comments) || r.comments.length === 0) continue;
      comments += await classifyReviewFindings({ db: c.db, logger: cliLogger }, projectId, r.id);
      asked++;
      console.log(r.id);
    }
    console.log(JSON.stringify({ reviews: reviews.length, asked, comments }));
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
