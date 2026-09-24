// CLI de operación de DEMIURGO v2 (usa DEMIURGO_DATABASE_URL y el resto de la configuración).
//   node packages/api/src/cli.ts migrar
//   node packages/api/src/cli.ts crear-persona <usuario>          (la clave se lee de la entrada estándar)
//   node packages/api/src/cli.ts crear-proyecto <nombre>
//   node packages/api/src/cli.ts ejecucion-real <proyectoId> <accion> <json-alcance> [json-entrada]
//   node packages/api/src/cli.ts evaluar-clasificador [prueba|desarrollo|todas]   (usa DEMIURGO_CLASIFICADOR)
//   node packages/api/src/cli.ts importar-diseno <proyectoId> [dir]                (crea el lote pendiente de H1)
//   node packages/api/src/cli.ts exportar-diseno <proyectoId> [--comprobar dir | --salida dir | dir]

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

async function withBase<T>(f: (c: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
  const c = connect(config.baseUrl);
  try {
    await migrate(c.pool);
    return await f(c);
  } finally {
    await c.close();
  }
}

const commands: Record<string, () => Promise<void>> = {
  async migrate() {
    const c = connect(config.baseUrl);
    try {
      console.log(JSON.stringify({ applied: await migrate(c.pool) }));
    } finally {
      await c.close();
    }
  },

  async 'create-person'() {
    const username = args[0];
    if (!username) throw new Error('Uso: crear-persona <usuario> (clave por la entrada estándar)');
    const key = await readInput();
    await withBase(async (c) => {
      const id = await createPerson(c.db, username, key);
      console.log(JSON.stringify({ person: username, id }));
    });
  },

  async 'create-project'() {
    const name = args[0];
    if (!name) throw new Error('Uso: crear-proyecto <nombre>');
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
    if (!projectId || !action || !scope)
      throw new Error('Uso: ejecucion-real <proyectoId> <accion> <json-alcance> [json-entrada]');
    const core = await startCore(config, consoleLogger);
    try {
      const r = await executeCommand(core.services, {
        command: 'run.request',
        actor: system('cli'),
        projectId,
        data: { action, scope: JSON.parse(scope) as unknown, input: input ? (JSON.parse(input) as unknown) : {} },
      });
      const state = await waitForRun(r.entityId);
      const run = await core.services.db
        .selectFrom('ai_runs')
        .selectAll()
        .where('id', '=', r.entityId)
        .executeTakeFirstOrThrow();
      console.log(JSON.stringify({ state, run }, null, 2));
    } finally {
      await core.stop();
    }
  },
};

commands['evaluate-classifier'] = async () => {
  const partition = (args[0] ?? 'test') as Partition;
  await withBase(async (c) => {
    const report = await evaluateClassifier({
      classifier: createClassifier(config),
      partition,
      chunkSize: 40,
      db: c.db,
      output: 'evals/classifier/results',
    });
    console.log(evaluationSummary(report));
    console.log(`Resultado guardado en ${report.file ?? '(sin archivo)'}`);
  });
};

commands['import-design'] = async () => {
  const [projectId, dir = 'design'] = args;
  if (!projectId) throw new Error('Uso: importar-diseno <proyectoId> [dir]');
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
  if (!projectId) throw new Error('Uso: exportar-diseno <proyectoId> [--comprobar dir | --salida dir | dir]');
  await withBase(async (c) => {
    if (option === '--check') {
      const diffs = await compareExport(c.db, projectId, await readTree(dir ?? 'design'));
      if (diffs.length > 0) {
        for (const d of diffs) console.error(`✗ ${d}`);
        process.exitCode = 1;
        return;
      }
      console.log(`✓ La exportación coincide byte a byte con ${dir ?? 'design'}/.`);
      return;
    }
    // Sin bandera, el segundo argumento es el directorio de salida.
    const target = (option === '--out' ? dir : option) ?? 'design-exported';
    if (target.startsWith('--')) throw new Error(`Opción desconocida: ${target}.`);
    const tree = await exportDesign(c.db, projectId);
    const removed = await replaceTree(target, tree);
    console.log(`Exportados ${tree.size} archivo(s) en ${target}/.`);
    for (const r of removed) console.log(`  borrado ${r}: ya no está en la v2.`);
  });
};

const action = command ? commands[command] : undefined;
if (!action) {
  console.error(`Órdenes: ${Object.keys(commands).join(', ')}`);
  process.exitCode = 2;
} else {
  try {
    await action();
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    // Los motivos de una guarda dicen qué falta, documento a documento.
    const reasons = (e as { reasons?: unknown }).reasons;
    if (Array.isArray(reasons)) for (const m of reasons) console.error(`  - ${String(m)}`);
    process.exitCode = 1;
  }
}
