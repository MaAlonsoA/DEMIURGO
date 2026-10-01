// Opt-in GitHub rewind for a project restore (development only): force-push the snapshot's main to the
// project's own repository and close the pull requests opened after the snapshot. It only ever touches
// the repository the snapshot recorded, and only when that is still the repository linked to the project.

import { type GithubConfig, closePullRequest, deleteBranch, listOpenPullRequests, runGit } from '../github/client.ts';

export type SnapshotGithub = { owner: string; repo: string; main: string };
export type LiveGithub = { owner: string; repo: string; protection: string };

/** Why the rewind must be refused (a 409 message), or null when it may go ahead. Pure. */
export function rewindRefusal(snap: SnapshotGithub | null | undefined, live: LiveGithub | null, cfg: GithubConfig | null): string | null {
  if (!snap) return 'The snapshot has no GitHub data to rewind to.';
  if (!live) return 'The project is not linked to a GitHub repository now: nothing to rewind.';
  if (live.owner !== snap.owner || live.repo !== snap.repo) {
    return `The project now uses ${live.owner}/${live.repo}, not ${snap.owner}/${snap.repo} of the snapshot: GitHub was not rewound.`;
  }
  if (live.protection === 'github') {
    return `${snap.owner}/${snap.repo} uses GitHub branch protection: a force-push to main would be blocked, so GitHub cannot be rewound.`;
  }
  if (!cfg) return 'GitHub is not configured (DEMIURGO_GITHUB_TOKEN and DEMIURGO_GITHUB_OWNER): GitHub cannot be rewound.';
  return null;
}

/** Pull requests created after the snapshot that live in the repository itself (their branch can be deleted). */
export function newerPullRequests<T extends { createdAt: string }>(prs: T[], since: string): T[] {
  const t = Date.parse(since);
  return prs.filter((p) => Date.parse(p.createdAt) > t);
}

/**
 * Force-pushes `snap.main` to the repository's main and closes (and deletes the branch of) the open pull
 * requests created after `since`. Never throws: it returns what was done, or what failed.
 */
export async function rewindGithub(a: {
  repoDir: string;
  snap: SnapshotGithub;
  since: string;
  label: string;
  cfg: GithubConfig;
}): Promise<string> {
  const { snap, cfg } = a;
  const short = snap.main.slice(0, 8);
  const url = `https://github.com/${snap.owner}/${snap.repo}.git`;
  try {
    await runGit(a.repoDir, ['cat-file', '-e', `${snap.main}^{commit}`]);
    // The explicit URL (not "origin") guarantees no other repository can be pushed to.
    await runGit(a.repoDir, ['push', '--force', url, `${snap.main}:refs/heads/main`], { network: true });
  } catch (e) {
    return `GitHub main could not be reset to ${short} (${(e instanceof Error ? e.message : 'git failed').split('\n')[0]}).`;
  }
  let closed = 0;
  try {
    const comment = `Closed: the DEMIURGO project was restored to the snapshot “${a.label}”.`;
    const prs = newerPullRequests(await listOpenPullRequests(cfg, snap.owner, snap.repo), a.since);
    for (const p of prs) {
      await closePullRequest(cfg, snap.owner, snap.repo, p.number, comment);
      closed++;
      if (p.headRepo === `${snap.owner}/${snap.repo}` && p.headRef && p.headRef !== 'main') {
        await deleteBranch(cfg, snap.owner, snap.repo, p.headRef);
      }
    }
  } catch (e) {
    return `GitHub main reset to ${short}; ${closed} pull request(s) closed, then it failed (${(e instanceof Error ? e.message : 'error').split('\n')[0]}).`;
  }
  return `GitHub main reset to ${short}; ${closed} pull request${closed === 1 ? '' : 's'} closed.`;
}
