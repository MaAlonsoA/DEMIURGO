// The harness version (salud-del-harness §9.3): the marks of the harness at one moment. The DEMIURGO commit, the
// fingerprints of the agents and skills (the catalog's content hashes), the versions of the questions put to Jev and
// the post-mortem rules version make one content hash; the API registers it at start and every build request and
// every agent run is tagged with the version in force. A comparison of cohorts by version is observational (§9.3).

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fingerprint } from '@demiurgo/domain';
import { loadAgentCatalog } from '../agents/catalog.ts';
import { RERANK_QUESTION_VERSION } from '../classifier/code-rerank.ts';
import { LAYERS_QUESTION_VERSION } from '../classifier/layers.ts';
import { TASK_NEEDS_QUESTION_VERSION } from '../classifier/task-needs.ts';
import { SIZE_QUESTION_VERSION } from '../classifier/size.ts';
import type { Db } from '../db/connection.ts';
import { RULES_VERSION } from './rules/index.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export type HarnessMarks = {
  demiurgo_sha: string;
  agents: Record<string, string>;
  skills: Record<string, string>;
  question_versions: Record<string, string>;
  rules_version: string;
};

/** The content hash of the marks: the same marks always give the same hash, whatever the order of the keys. */
export function harnessContentHash(marks: HarnessMarks): string {
  return fingerprint(marks);
}

/** The commit of the code that runs: `DEMIURGO_BUILD_SHA`, else `git rev-parse HEAD`, else the files of `.git`; `unknown` without any. */
export async function demiurgoSha(root: string = REPO_ROOT, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const fromEnv = env.DEMIURGO_BUILD_SHA?.trim();
  if (fromEnv) return fromEnv;
  try {
    const { stdout } = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 5000 });
    if (/^[0-9a-f]{40}$/.test(stdout.trim())) return stdout.trim();
  } catch {
    // No git binary or not a repository here: read the files below.
  }
  try {
    const head = (await readFile(join(root, '.git', 'HEAD'), 'utf8')).trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = /^ref: (.+)$/.exec(head)?.[1];
    if (ref) {
      const loose = (await readFile(join(root, '.git', ref), 'utf8').catch(() => '')).trim();
      if (/^[0-9a-f]{40}$/.test(loose)) return loose;
      const packed = (await readFile(join(root, '.git', 'packed-refs'), 'utf8').catch(() => ''))
        .split('\n')
        .find((l) => l.endsWith(` ${ref}`));
      const sha = packed?.split(' ')[0];
      if (sha && /^[0-9a-f]{40}$/.test(sha)) return sha;
    }
  } catch {
    // Nothing readable.
  }
  return 'unknown';
}

let marksOfProcess: Promise<HarnessMarks> | undefined;

/** The marks of this process (computed once: the code and the catalog files do not change under a running process). */
export function currentHarnessMarks(): Promise<HarnessMarks> {
  marksOfProcess ??= (async () => {
    const catalog = await loadAgentCatalog();
    return {
      demiurgo_sha: await demiurgoSha(),
      agents: Object.fromEntries(catalog.agents.map((a) => [a.id, a.version]).toSorted(([a], [b]) => String(a).localeCompare(String(b)))),
      skills: Object.fromEntries(catalog.skills.map((s) => [s.id, fingerprint({ description: s.description, body: s.body })]).toSorted(([a], [b]) => String(a).localeCompare(String(b)))),
      question_versions: { code_rerank: RERANK_QUESTION_VERSION, layers: LAYERS_QUESTION_VERSION, size: SIZE_QUESTION_VERSION, task_needs: TASK_NEEDS_QUESTION_VERSION },
      rules_version: RULES_VERSION,
    };
  })();
  return marksOfProcess;
}

/** Inserts the version once per distinct content hash and returns its id (append-only: an existing row is reused). */
export async function registerHarnessVersion(db: Db, marks?: HarnessMarks): Promise<string> {
  const m = marks ?? (await currentHarnessMarks());
  const hash = harnessContentHash(m);
  await db
    .insertInto('harness_versions')
    .values({
      content_hash: hash,
      demiurgo_sha: m.demiurgo_sha,
      agents: JSON.stringify(m.agents),
      skills: JSON.stringify(m.skills),
      question_versions: JSON.stringify(m.question_versions),
      rules_version: m.rules_version,
    })
    .onConflict((oc) => oc.column('content_hash').doNothing())
    .execute();
  const row = await db.selectFrom('harness_versions').select('id').where('content_hash', '=', hash).executeTakeFirstOrThrow();
  return row.id;
}

const idOfDb = new WeakMap<object, string>();

/** The id of the version in force for this database: registered on first use, then remembered. */
export async function currentHarnessVersionId(db: Db): Promise<string> {
  const known = idOfDb.get(db);
  if (known) return known;
  const id = await registerHarnessVersion(db);
  idOfDb.set(db, id);
  return id;
}

/** The version in force, or null when it cannot be registered: tagging must never stop the work it tags. */
export async function harnessVersionIdOrNull(db: Db): Promise<string | null> {
  try {
    return await currentHarnessVersionId(db);
  } catch {
    return null;
  }
}
