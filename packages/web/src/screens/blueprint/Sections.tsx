// The sections of a record under its header (DESIGN.md §3.6, INV-BP-11, INV-REC-09): Overview,
// Questions · n (the open questions of the thread it comes from), Checks · n and History, as route
// tabs in ?tab=. The version shown (?v=) is kept and the page doesn't scroll back to the top.

import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { explorationQuery } from '../../api/queries.ts';
import type { RecordDetail, RecordVersion } from '../../api/types.ts';
import { LinkTabs } from '../../components/Tabs.tsx';
import { questionGroups } from './questions.ts';
import { type RecordTab, tabOf, tabSearch } from './tabs.ts';

export function useRecordTab(): RecordTab {
  const search = useSearch({ strict: false }) as { tab?: unknown };
  return tabOf(search.tab);
}

/** Whether a record shows the Checks section: a decision only when it has checks, as the Overview does. */
export const hasChecks = (record: Pick<RecordDetail, 'type'>, version: Pick<RecordVersion, 'criteria'>) =>
  record.type !== 'decision' || version.criteria.length > 0;

/** How many questions of the version's thread are still open (pending or assumed). */
export function useOpenQuestions(projectId: string, version: RecordVersion): number {
  const thread = useQuery({
    ...explorationQuery(projectId, version.origin_exploration ?? ''),
    enabled: !!version.origin_exploration,
  }).data;
  return thread ? questionGroups(thread.questions).open.length : 0;
}

export function RecordTabs({
  projectId,
  record,
  version,
  tab,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  tab: RecordTab;
}) {
  const search = useSearch({ strict: false }) as { v?: number };
  const open = useOpenQuestions(projectId, version);
  const link = (t: RecordTab) => ({
    to: '/p/$projectId/records/$code' as const,
    params: { projectId, code: record.code },
    search: tabSearch(search.v, t) as never,
    resetScroll: false,
    // Only the section on screen is current, not the Overview under every ?tab=.
    activeOptions: { exact: true },
  });
  return (
    <LinkTabs
      label="Record sections"
      tabs={[
        { key: 'overview', label: 'Overview', current: tab === 'overview', link: link('overview') },
        {
          key: 'questions',
          label: 'Questions',
          current: tab === 'questions',
          link: link('questions'),
          ...(open > 0 ? { count: open } : {}),
        },
        ...(hasChecks(record, version)
          ? [
              {
                key: 'checks',
                label: 'Checks',
                current: tab === 'checks',
                link: link('checks'),
                count: version.criteria.length,
              },
            ]
          : []),
        { key: 'history', label: 'History', current: tab === 'history', link: link('history') },
      ]}
    />
  );
}
