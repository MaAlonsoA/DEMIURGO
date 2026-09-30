// Connecting the project's private GitHub repository (repository.connect). Creating the repo and
// pushing main are network calls, so they run in the preparer, before the transaction opens (as
// definition/english.ts does for translations): a slow GitHub never holds a transaction open. The
// handler then saves the `project_github` link and the journal event in one transaction. It is
// idempotent: connecting a connected project returns the existing link and writes nothing. Only a
// person runs it (capability matrix).

import { DomainError } from '@demiurgo/domain';
import { z } from 'zod';
import { githubConfig, provisionProjectRepo, type ProjectGithub } from '../github/client.ts';
import { handler, registerHandlers, registerPreparers } from '../bus/handlers.ts';
import type { Request, Tx } from '../bus/types.ts';
import type { Db } from '../db/connection.ts';
import type { Services } from '../services.ts';

const NOT_CONFIGURED = 'GitHub is not configured on this DEMIURGO: set DEMIURGO_GITHUB_TOKEN and DEMIURGO_GITHUB_OWNER.';

async function linkOf(db: Db | Tx, projectId: string): Promise<ProjectGithub | null> {
  const row = await db
    .selectFrom('project_github')
    .select(['owner', 'repo', 'protection'])
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  return row
    ? {
        owner: row.owner,
        repo: row.repo,
        url: `https://github.com/${row.owner}/${row.repo}`,
        protection: row.protection as ProjectGithub['protection'],
      }
    : null;
}

registerPreparers({
  async 'repository.connect'(services: Services, request: Request) {
    // Only the server writes `provisioned`: whatever a client sends in it is dropped.
    const { provisioned: _ignored, ...data } = (
      typeof request.data === 'object' && request.data !== null ? request.data : {}
    ) as Record<string, unknown>;
    const clean = { ...request, data };
    // The bus refuses whoever may not run it (403) or a missing or archived project after this: no GitHub call for them.
    if (request.actor.type !== 'human' || !request.projectId) return clean;
    const project = await services.db
      .selectFrom('projects')
      .select('state')
      .where('id', '=', request.projectId)
      .executeTakeFirst();
    if (project?.state !== 'active') return clean;
    if (await linkOf(services.db, request.projectId)) return clean;
    const cfg = githubConfig();
    if (!cfg) throw new DomainError('conflict', NOT_CONFIGURED);
    return {
      ...clean,
      data: {
        ...data,
        provisioned: await provisionProjectRepo(services.db, request.projectId, cfg),
      },
    };
  },
});

registerHandlers({
  'repository.connect': handler({
    data: z
      .object({
        provisioned: z
          .object({
            owner: z.string(),
            repo: z.string(),
            url: z.string(),
            protection: z.enum(['github', 'demiurgo']),
          })
          .optional(),
      })
      .strict(),
    async apply(ctx, data, e) {
      const id = e?.id ?? ctx.projectId;
      const existing = await linkOf(ctx.trx, ctx.projectId);
      if (existing) return { entityId: id, result: { ...existing, connected: false } };
      if (!data.provisioned) throw new DomainError('conflict', NOT_CONFIGURED);
      const p = data.provisioned;
      await ctx.trx
        .insertInto('project_github')
        .values({
          project_id: ctx.projectId,
          owner: p.owner,
          repo: p.repo,
          protection: p.protection,
        })
        .execute();
      return {
        entityId: id,
        after: {
          owner: p.owner,
          repo: p.repo,
          url: p.url,
          protection: p.protection,
        },
        result: { ...p, connected: true },
      };
    },
  }),
});
