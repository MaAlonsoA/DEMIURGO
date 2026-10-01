// The project's Issues: bugs people report and escalations of the PR reviewer, open until a task
// resolves them or a person closes them with a reason.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { issuesQuery, projectsQuery } from '../../api/queries.ts';
import { Code } from '../../components/Badge.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { AlertTriangleIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, usePageTitle } from '../../components/Page.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { RelativeTime } from '../../components/Time.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { FILTERS, type IssueFilter, countByState, filterIssues } from './logic.ts';
import { ReportBugButton } from './ReportBug.tsx';
import { ISSUES } from './words.i18n.ts';

export function IssuesScreen() {
  const t = useMessages(ISSUES);
  const projectId = useProjectId();
  const issues = useQuery(issuesQuery(projectId));
  const project = useQuery(projectsQuery).data?.find((p) => p.id === projectId);
  const [filter, setFilter] = useState<IssueFilter>('open');
  usePageTitle([t.title, project?.name]);

  const all = issues.data ?? [];
  const counts = countByState(all);
  const shown = filterIssues(all, filter);

  return (
    <>
      <PageHeader
        title={t.title}
        meta={issues.data ? <span className="tabular-nums">{t.meta(counts.open, counts.all)}</span> : null}
        actions={<ReportBugButton projectId={projectId} variant="primary" />}
      />
      <PageBody width="wide" className="flex flex-col gap-4">
        {issues.isPending ? (
          <Skeleton label={t.loading}>
            <Bone className="h-12 w-full" />
            <Bone className="h-12 w-full" />
          </Skeleton>
        ) : !issues.data ? (
          <ErrorNotice error={issues.error} onRetry={() => void issues.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState size="spacious" icon={<AlertTriangleIcon size={28} />} title={t.emptyAll}>
            {t.emptyHint}
          </EmptyState>
        ) : (
          <>
            <div role="group" aria-label={t.filterLabel} className="flex flex-wrap gap-1" data-issue-filters>
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  data-issue-filter={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-sm',
                    filter === f ? 'bg-hover font-medium text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg',
                  )}
                >
                  {t[`filter_${f}`]}
                  <span className="tabular-nums text-fg-3">{counts[f]}</span>
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <p className="text-sm text-fg-2">{t.emptyFilter(t[`filter_${filter}`])}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-edge-subtle" aria-label={t.list} data-issues>
                {shown.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5" data-issue={i.code}>
                    <Code>{i.code}</Code>
                    <Link
                      to="/p/$projectId/issues/$code"
                      params={{ projectId, code: i.code }}
                      className="min-w-0 font-medium text-fg hover:underline"
                    >
                      {i.title}
                    </Link>
                    <span className="text-sm text-fg-2">{t[`kind_${i.kind}`]}</span>
                    {filter === 'all' ? <span className="text-sm text-fg-2">{t[`state_${i.state}`]}</span> : null}
                    {i.task ? (
                      <Link
                        to="/p/$projectId/records/$code"
                        params={{ projectId, code: i.task.code }}
                        className="font-code text-xs text-accent-text hover:underline"
                      >
                        {i.task.code}
                      </Link>
                    ) : null}
                    <RelativeTime iso={i.opened_at} prefix={t.openedAgo} className="ml-auto text-sm text-fg-2" />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
