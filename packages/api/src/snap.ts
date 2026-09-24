// Development snapshots of the whole database, from the terminal (needs DEMIURGO_DEV_TOOLS=1).
//   pnpm snap list
//   pnpm snap save [label]
//   pnpm snap restore <name|label> [--force]
//   pnpm snap drop <name|label>
//   pnpm snap reset [--force]
// With the API connected, save/restore/reset refuse: use the dev panel in the web, stop the API, or
// pass --force, which cuts its connections off (restart the API afterwards).

import {
  type Snapshot,
  connectedSessions,
  dropSnapshot,
  listSnapshots,
  readConfig,
  resetDatabase,
  restoreSnapshot,
  saveSnapshot,
  snapshotTarget,
  terminateSessions,
} from '@demiurgo/core';
import { DomainError } from '@demiurgo/domain';

const args = process.argv.slice(2);
const force = args.includes('--force');
const [command, ref] = args.filter((a) => a !== '--force');
const config = readConfig();
if (!config.devTools) {
  console.error('The dev tools are off: set DEMIURGO_DEV_TOOLS=1 (never on the real instance).');
  process.exit(2);
}
const target = snapshotTarget(config.databaseUrl);

const describe = (s: Snapshot): string => {
  const projects = s.projects.map((p) => `${p.name} (${p.events} events)`).join(', ') || 'no projects';
  return `${s.name}  «${s.label}»  ${s.created_at.slice(0, 16).replace('T', ' ')} UTC  ${projects}  ${(s.size_bytes / 1e6).toFixed(1)} MB`;
};

/** The live database must be idle: another client (the API) would block the copy or lose its database. */
async function requireIdle(): Promise<void> {
  const sessions = await connectedSessions(target);
  if (sessions.length === 0) return;
  if (!force) {
    throw new DomainError(
      'conflict',
      `${target.database} is in use: use the dev panel in the web, stop the API, or pass --force (then restart the API).`,
      sessions.map((s) => `pid ${s.pid} ${s.application || '(unnamed)'} ${s.client ?? 'local'}`),
    );
  }
  console.log(`Cut off ${await terminateSessions(target)} connection(s) to ${target.database}: restart the API.`);
}

function required(name: string): string {
  if (!ref) throw new Error(`Usage: snap ${command} <${name}>`);
  return ref;
}

const commands: Record<string, () => Promise<void>> = {
  async list() {
    const all = await listSnapshots(target);
    if (all.length === 0) console.log(`No snapshots of ${target.database}.`);
    for (const s of all) console.log(describe(s));
  },
  async save() {
    await requireIdle();
    console.log(`Saved ${describe(await saveSnapshot(target, ref ?? ''))}`);
  },
  async restore() {
    const name = required('name|label');
    await requireIdle();
    console.log(`Restored ${describe(await restoreSnapshot(target, name))}`);
  },
  async drop() {
    console.log(`Dropped ${describe(await dropSnapshot(target, required('name|label')))}`);
  },
  async reset() {
    await requireIdle();
    await resetDatabase(target);
    console.log(`Reset ${target.database}: empty and migrated, with the same people.`);
  },
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
    const reasons = (e as { reasons?: unknown }).reasons;
    if (Array.isArray(reasons)) for (const m of reasons) console.error(`  - ${String(m)}`);
    process.exitCode = 1;
  }
}
