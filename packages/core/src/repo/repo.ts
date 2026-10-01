// Each project's repository: a folder with git under DEMIURGO_PROJECTS_DIR where DEMIURGO writes
// design/ in the canonical format (design/export.ts) after every authority event (accepting a
// proposal, approving or discarding a version) and commits it, with the person as author. The
// database stays the authority; the repository is its readable copy, where the code will live next
// to its design. Each commit is kept in project_commits to show it. It runs after the commit, one at
// a time per project; a failure is logged and the next event writes everything again.

import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { replaceTree } from '@demiurgo/design';
import {
  DESIGN_SYSTEM_DIR,
  designSystemArtifacts,
  designSystemReadme,
  designSystemSpec,
  formatActor,
  parseActor,
} from '@demiurgo/domain';
import type { CommandContext } from '../bus/types.ts';
import { DISCARD_TRIGGER, registerAuthorityReaction } from '../commands/reactions.ts';
import type { Db } from '../db/connection.ts';
import { exportDesign } from '../design/export.ts';
import { designSystemSpecOf } from '../design/screens.ts';
import type { Services } from '../services.ts';

const run = promisify(execFile);
const DESIGN_DIR = 'design';

/** Where the projects' repositories live; without it, no repository is written. */
export function projectsDir(): string | null {
  return process.env.DEMIURGO_PROJECTS_DIR?.trim() || null;
}

// The repositories under /projects are DEMIURGO's own: git must not refuse them for ownership
// ("dubious ownership" after an image or volume change stopped a build).
const git = (dir: string, args: string[]) => run('git', ['-c', 'safe.directory=*', '-C', dir, ...args], { maxBuffer: 16 * 1024 * 1024 });

const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

const readmeOf = (name: string) =>
  `# ${name}\n\nThe design of ${name}, written by DEMIURGO: \`design/\` is a copy of what was accepted and approved there, one commit per change. Change it in DEMIURGO, not here.\n`;

/** The folder name for a project: its slug, with the id's tail if another folder already has it. */
async function folderFor(root: string, name: string, projectId: string): Promise<string> {
  const base = slug(name);
  const taken = await readdir(root).catch(() => [] as string[]);
  return taken.includes(base) ? `${base}-${projectId.slice(-8)}` : base;
}

/** The project's repository folder, created with git and its README the first time. */
async function ensureRepo(db: Db, root: string, projectId: string): Promise<string> {
  const known = await db.selectFrom('project_repos').select('dir').where('project_id', '=', projectId).executeTakeFirst();
  if (known) return join(root, known.dir);
  const project = await db.selectFrom('projects').select('name').where('id', '=', projectId).executeTakeFirstOrThrow();
  const name = await folderFor(root, project.name, projectId);
  const dir = join(root, name);
  await mkdir(join(dir, DESIGN_DIR), { recursive: true });
  await git(dir, ['init', '-q', '-b', 'main']);
  await writeFile(join(dir, 'README.md'), readmeOf(project.name), 'utf8');
  await db.insertInto('project_repos').values({ project_id: projectId, dir: name }).execute();
  return dir;
}

type Change = { actor: string; versionId: string | null; discarded: boolean };

/** The commit message of a change: the record, its version and what happened to it. */
/**
 * A commit that only writes design records (design/, Markdown) changes no code: CI has nothing to test, and a
 * run on main would also make every open pull request look behind. `[skip ci]` in the message skips the
 * push and pull_request workflows of that commit (GitHub Docs, «Skipping workflow runs»).
 */
export const designOnly = (files: readonly string[]): boolean =>
  files.length > 0 && files.every((f) => f.replace(/^"|"$/g, '').startsWith('design/') || /\.md"?$/i.test(f));
const withSkipCi = (title: string, files: readonly string[]): string => (designOnly(files) ? `${title} [skip ci]` : title);

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

/**
 * The files of the project's approved design system (step 7): design/design-system/tokens.json,
 * manifest.json and README.md, written from the approved version's spec so the builder and the
 * `demiurgo/design` check read the same thing. Empty without an approved system.
 */
async function designSystemFiles(db: Db, projectId: string): Promise<Map<string, string>> {
  const row = await db
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id', 'records.code', 'record_versions.n', 'record_versions.spec'])
    .where('records.project_id', '=', projectId)
    .where('records.type', '=', 'design_system')
    .where('record_versions.state', '=', 'approved')
    .orderBy('record_versions.n', 'desc')
    .executeTakeFirst();
  const files = new Map<string, string>();
  if (!row) return files;
  // A version made from text alone inherits the spec of the latest earlier version that has one.
  const spec = await designSystemSpecOf(db, row.id, row.n, row.spec);
  if (!spec) return files;
  const parsed = designSystemSpec.safeParse(spec);
  if (!parsed.success) return files;
  const { manifest, manifestJson, tokensJson } = designSystemArtifacts(row.code, row.n, parsed.data);
  files.set('tokens.json', tokensJson);
  files.set('manifest.json', manifestJson);
  files.set('README.md', designSystemReadme(manifest));
  return files;
}

/** Writes design/ and commits it if anything changed; the commit is kept to show it. */
async function sync(services: Pick<Services, 'db' | 'logger'>, projectId: string, change: Change): Promise<string | null> {
  const root = projectsDir();
  if (!root) return null;
  const { db } = services;
  const dir = await ensureRepo(db, root, projectId);
  await replaceTree(join(dir, DESIGN_DIR), await exportDesign(db, projectId));
  // Written beside the exported tree, not through export.ts (another agent owns it).
  const system = await designSystemFiles(db, projectId);
  if (system.size > 0) {
    const systemDir = join(dir, ...DESIGN_SYSTEM_DIR.split('/'));
    await mkdir(systemDir, { recursive: true });
    for (const [name, text] of system) await writeFile(join(systemDir, name), text, 'utf8');
  }
  await git(dir, ['add', '-A']);
  const status = (await git(dir, ['status', '--porcelain'])).stdout.trim();
  if (!status) return null;
  const files = status.split('\n').map((l) => l.slice(3).trim());
  const message = await messageOf(db, projectId, change);
  const title = withSkipCi(message.title, files);
  const body = message.body;
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
      message: message.title,
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

/** Moves the repository folder to the project's new name, rewrites the README and commits it. */
async function rename_(services: Pick<Services, 'db' | 'logger'>, projectId: string, actor: string): Promise<void> {
  const root = projectsDir();
  if (!root) return;
  const { db } = services;
  const known = await db.selectFrom('project_repos').select('dir').where('project_id', '=', projectId).executeTakeFirst();
  if (!known) return;
  const project = await db.selectFrom('projects').select('name').where('id', '=', projectId).executeTakeFirstOrThrow();
  const others = (await readdir(root).catch(() => [] as string[])).filter((d) => d !== known.dir);
  const base = slug(project.name);
  const next = others.includes(base) ? `${base}-${projectId.slice(-8)}` : base;
  const oldDir = join(root, known.dir);
  const dir = join(root, next);
  // The previous name comes from the README's title, since the project row already has the new one.
  const oldName = (await readFile(join(oldDir, 'README.md'), 'utf8').catch(() => ''))
    .split('\n')[0]
    ?.replace(/^#\s*/, '')
    .trim();
  if (next !== known.dir) {
    await rename(oldDir, dir);
    await db.updateTable('project_repos').set({ dir: next }).where('project_id', '=', projectId).execute();
  }
  await writeFile(join(dir, 'README.md'), readmeOf(project.name), 'utf8');
  await git(dir, ['add', '-A']);
  const status = (await git(dir, ['status', '--porcelain'])).stdout.trim();
  if (!status) return;
  const files = status.split('\n').map((l) => l.slice(3).trim());
  const title = `Project renamed: ${oldName || known.dir} \u2192 ${project.name}`;
  const who = parseActor(actor);
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
  ]);
  const sha = (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim();
  await db
    .insertInto('project_commits')
    .values({ project_id: projectId, sha, message: title, actor, record_version_id: null, files: JSON.stringify(files) })
    .execute();
  services.logger.info('Repository renamed', { projectId, dir: next, sha: sha.slice(0, 7) });
}

/** Follows a project's rename in its repository, after the syncs already queued for it. */
export function renameRepo(services: Pick<Services, 'db' | 'logger'>, projectId: string, actor: string): Promise<void> {
  const next = (queues.get(projectId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => rename_(services, projectId, actor))
    .catch((err: unknown) => {
      services.logger.error('Could not rename the repository', { projectId, error: String(err) });
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
