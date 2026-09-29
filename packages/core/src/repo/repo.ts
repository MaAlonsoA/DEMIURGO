// Each project's repository: a folder with git under DEMIURGO_PROJECTS_DIR where DEMIURGO writes
// design/ in the canonical format (design/export.ts) after every authority event (accepting a
// proposal, approving or discarding a version) and commits it, with the person as author. The
// database stays the authority; the repository is its readable copy, where the code will live next
// to its design. Each commit is kept in project_commits to show it. It runs after the commit, one at
// a time per project; a failure is logged and the next event writes everything again.

import { execFile } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { replaceTree } from '@demiurgo/design';
import { formatActor, parseActor } from '@demiurgo/domain';
import type { CommandContext } from '../bus/types.ts';
import { DISCARD_TRIGGER, registerAuthorityReaction } from '../commands/reactions.ts';
import type { Db } from '../db/connection.ts';
import { exportDesign } from '../design/export.ts';
import type { Services } from '../services.ts';

const run = promisify(execFile);
const DESIGN_DIR = 'design';

/** Where the projects' repositories live; without it, no repository is written. */
export function projectsDir(): string | null {
  return process.env.DEMIURGO_PROJECTS_DIR?.trim() || null;
}

const git = (dir: string, args: string[]) => run('git', ['-C', dir, ...args], { maxBuffer: 16 * 1024 * 1024 });

const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

/** The project's repository folder, created with git and its README the first time. */
async function ensureRepo(db: Db, root: string, projectId: string): Promise<string> {
  const known = await db.selectFrom('project_repos').select('dir').where('project_id', '=', projectId).executeTakeFirst();
  if (known) return join(root, known.dir);
  const project = await db.selectFrom('projects').select('name').where('id', '=', projectId).executeTakeFirstOrThrow();
  let name = slug(project.name);
  const taken = await readdir(root).catch(() => [] as string[]);
  if (taken.includes(name)) name = `${name}-${projectId.slice(-8)}`;
  const dir = join(root, name);
  await mkdir(join(dir, DESIGN_DIR), { recursive: true });
  await git(dir, ['init', '-q', '-b', 'main']);
  await writeFile(
    join(dir, 'README.md'),
    `# ${project.name}\n\nThe design of ${project.name}, written by DEMIURGO: \`design/\` is a copy of what was accepted and approved there, one commit per change. Change it in DEMIURGO, not here.\n`,
    'utf8',
  );
  await db.insertInto('project_repos').values({ project_id: projectId, dir: name }).execute();
  return dir;
}

type Change = { actor: string; versionId: string | null; discarded: boolean };

/** The commit message of a change: the record, its version and what happened to it. */
async function messageOf(db: Db, projectId: string, change: Change): Promise<{ title: string; body: string }> {
  const v = change.versionId
    ? await db
        .selectFrom('record_versions')
        .innerJoin('records', 'records.id', 'record_versions.record_id')
        .select([
          'records.code',
          'record_versions.n',
          'record_versions.state',
          'record_versions.title',
          'record_versions.change_note',
        ])
        .where('record_versions.id', '=', change.versionId)
        .executeTakeFirst()
    : undefined;
  if (!v) {
    const first = !(await db
      .selectFrom('project_commits')
      .select('id')
      .where('project_id', '=', projectId)
      .limit(1)
      .executeTakeFirst());
    return { title: first ? 'Initial design' : 'Design updated', body: '' };
  }
  const what = change.discarded ? 'discarded' : v.state === 'approved' ? 'approved' : 'accepted';
  return {
    title: `${v.code} v${v.n} ${what}: ${v.title}`,
    body: v.change_note?.trim() ?? '',
  };
}

/** Writes design/ and commits it if anything changed; the commit is kept to show it. */
async function sync(services: Pick<Services, 'db' | 'logger'>, projectId: string, change: Change): Promise<string | null> {
  const root = projectsDir();
  if (!root) return null;
  const { db } = services;
  const dir = await ensureRepo(db, root, projectId);
  await replaceTree(join(dir, DESIGN_DIR), await exportDesign(db, projectId));
  await git(dir, ['add', '-A']);
  const status = (await git(dir, ['status', '--porcelain'])).stdout.trim();
  if (!status) return null;
  const files = status.split('\n').map((l) => l.slice(3).trim());
  const { title, body } = await messageOf(db, projectId, change);
  const who = parseActor(change.actor);
  const author = who.type === 'human' ? `${who.person} <${who.person}@demiurgo.local>` : 'DEMIURGO <demiurgo@demiurgo.local>';
  await git(dir, [
    '-c',
    'user.name=DEMIURGO',
    '-c',
    'user.email=demiurgo@demiurgo.local',
    'commit',
    '-q',
    `--author=${author}`,
    '-m',
    title,
    ...(body ? ['-m', body] : []),
  ]);
  const sha = (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim();
  await db
    .insertInto('project_commits')
    .values({
      project_id: projectId,
      sha,
      message: title,
      actor: change.actor,
      record_version_id: change.versionId,
      files: JSON.stringify(files),
    })
    .execute();
  services.logger.info('Design committed', {
    projectId,
    sha: sha.slice(0, 7),
    files: files.length,
  });
  return sha;
}

const queues = new Map<string, Promise<unknown>>();

/** Syncs the project's repository after the ones already queued for it. */
export function syncRepo(services: Pick<Services, 'db' | 'logger'>, projectId: string, change: Change): Promise<string | null> {
  const next = (queues.get(projectId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => sync(services, projectId, change))
    .catch((err: unknown) => {
      services.logger.error('Could not commit the design', {
        projectId,
        error: String(err),
      });
      return null;
    });
  queues.set(projectId, next);
  return next;
}

/** The version an authority event is about: the version itself, or the one a proposal's effect wrote. */
async function versionOf(ctx: CommandContext, object: { type: string; id: string }): Promise<string | null> {
  if (object.type === 'record_version' || object.type === DISCARD_TRIGGER) return object.id;
  if (object.type !== 'proposal') return null;
  const p = await ctx.trx.selectFrom('proposals').select('resolution').where('id', '=', object.id).executeTakeFirst();
  return (p?.resolution as { effect?: { versionId?: string } } | null)?.effect?.versionId ?? null;
}

registerAuthorityReaction(async (ctx, object) => {
  if (!projectsDir()) return;
  const versionId = await versionOf(ctx, object);
  const change = {
    actor: formatActor(ctx.actor),
    versionId,
    discarded: object.type === DISCARD_TRIGGER,
  };
  ctx.afterCommit(() => void syncRepo(ctx.services, ctx.projectId, change));
});
