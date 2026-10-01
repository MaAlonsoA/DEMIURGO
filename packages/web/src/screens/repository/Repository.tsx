// The project's repository, in the project settings (core repo/repo.ts): the folder where DEMIURGO
// writes design/ and the commit each accepted or approved change made, newest first, each with its
// record. Nothing here changes it: the repository is the readable copy of what the person decided.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCommand } from '../../api/commands.ts';
import type { ProjectCommits } from '../../api/types.ts';
import { commitsQuery, projectsQuery } from '../../api/queries.ts';
import { Button } from '../../components/Button.tsx';
import { Code } from '../../components/Badge.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { FolderIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, usePageTitle } from '../../components/Page.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { DayTime } from '../../components/Time.tsx';
import { whoName } from '../../components/Who.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { whoOf } from '../../words.ts';
import { CodeMapSection } from './CodeMap.tsx';
import { REPOSITORY } from './words.i18n.ts';

function GithubSection({ projectId, data }: { projectId: string; data: ProjectCommits }) {
  const t = useMessages(REPOSITORY);
  const connect = useCommand(projectId);
  const { github } = data;
  return (
    <Section title={t.github}>
      <div data-github className="flex max-w-prose flex-col gap-2 text-sm text-fg">
        {github ? (
          <>
            <p>
              {t.githubPrivate}{' '}
              <a href={github.url} target="_blank" rel="noreferrer" className="underline">
                {github.owner}/{github.repo}
              </a>
            </p>
            <p className="text-fg-2">{github.protection === 'github' ? t.protectionGithub : t.protectionDemiurgo}</p>
            <p className="text-fg-2">{t.githubFlow}</p>
          </>
        ) : data.github_configured ? (
          <>
            <p className="text-fg-2">{t.githubCreateBody}</p>
            <div>
              <Button
                variant="primary"
                pending={connect.isPending}
                onClick={() => connect.mutate({ command: 'repository.connect', entityId: projectId })}
              >
                {connect.isPending ? t.githubCreating : t.githubCreate}
              </Button>
            </div>
            {connect.error ? <ErrorNotice error={connect.error} /> : null}
          </>
        ) : (
          <p className="text-fg-2">{t.githubNotConfigured}</p>
        )}
      </div>
    </Section>
  );
}

export function RepositoryScreen() {
  const t = useMessages(REPOSITORY);
  const projectId = useProjectId();
  const project = useQuery(projectsQuery).data?.find((p) => p.id === projectId);
  usePageTitle([t.title, project?.name]);
  const q = useQuery(commitsQuery(projectId));
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <FolderIcon size={14} className="text-fg-3" />
            {t.eyebrow}
          </span>
        }
        title={t.title}
        meta={<span className="max-w-prose">{t.meta}</span>}
      />
      <PageBody width="full">
        {q.error ? (
          <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <RowsSkeleton label={t.loading} />
        ) : !q.data.dir ? (
          <EmptyState icon={<FolderIcon size={24} />} title={t.none}>
            {t.noneBody}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-8">
            <GithubSection projectId={projectId} data={q.data} />
            <Section title={t.folder}>
              <Code className="text-sm text-fg">{q.data.dir}</Code>
            </Section>
            <CodeMapSection projectId={projectId} />
            <Section title={t.commits}>
              <ol data-commits className="flex flex-col divide-y divide-edge">
                {q.data.commits.map((c) => {
                  const who = whoOf(c.actor);
                  return (
                    <li key={c.sha} data-commit={c.sha} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                      <Code>{c.sha.slice(0, 7)}</Code>
                      <span className="min-w-0 flex-1 text-sm text-fg">
                        {c.record ? (
                          <Link
                            to="/p/$projectId/records/$code"
                            params={{ projectId, code: c.record.code }}
                            search={{ v: c.record.version }}
                            className="hover:underline"
                          >
                            {c.message}
                          </Link>
                        ) : (
                          c.message
                        )}
                      </span>
                      <span className="text-xs text-fg-2">
                        {who.kind === 'you' ? t.you : whoName(who)} · <DayTime iso={c.at} /> · {t.files(c.files.length)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </Section>
          </div>
        )}
      </PageBody>
    </>
  );
}
