// The sections of a record under its header (canvas B2): Overview (the body as it is), Questions
// of the thread it comes from, its Checks and its History. The section lives in ?tab= and the
// version shown (?v=) is kept.

import { useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { explorationQuery } from '../../api/queries.ts';
import type { Readiness, RecordDetail, RecordVersion } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { Checks } from '../record/Checks.tsx';
import { HistoryTab } from './HistoryTab.tsx';
import { questionGroups } from './questions.ts';
import { QuestionsTab } from './QuestionsTab.tsx';
import { type RecordTab, tabOf, tabSearch } from './tabs.ts';

export function useRecordTab(): RecordTab {
  const search = useSearch({ strict: false }) as { tab?: unknown };
  return tabOf(search.tab);
}

/** Whether a record shows the Checks section: a decision only when it has checks, as the Overview does. */
export const hasChecks = (record: RecordDetail, version: RecordVersion) =>
  record.type !== 'decision' || version.criteria.length > 0;

export function RecordSectionTabs({
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
  const thread = useQuery({
    ...explorationQuery(projectId, version.origin_exploration ?? ''),
    enabled: !!version.origin_exploration,
  }).data;
  const open = thread ? questionGroups(thread.questions).open.length : 0;
  const items: { tab: RecordTab; label: string }[] = [
    { tab: 'overview', label: 'Overview' },
    { tab: 'questions', label: open > 0 ? `Questions · ${open}` : 'Questions' },
    ...(hasChecks(record, version) ? [{ tab: 'checks' as const, label: `Checks · ${version.criteria.length}` }] : []),
    { tab: 'history', label: 'History' },
  ];
  return (
    <nav aria-label="Record sections" className="mb-6 flex gap-5 border-b border-line">
      {items.map((i) => (
        <Link
          key={i.tab}
          to="/p/$projectId/records/$code"
          params={{ projectId, code: record.code }}
          search={tabSearch(search.v, i.tab) as never}
          // Only the section on screen is the current page, not the Overview under every ?tab=.
          activeOptions={{ exact: true }}
          resetScroll={false}
          data-section={i.tab}
          aria-current={tab === i.tab ? 'page' : undefined}
          className={cn(
            'border-b-2 px-1 pb-2 text-[13px] font-medium',
            tab === i.tab ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** The section other than Overview: the Overview is the record's body, rendered by the record page. */
export function RecordSectionPanel({
  projectId,
  record,
  version,
  readiness,
  tab,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  readiness: Readiness | null;
  tab: Exclude<RecordTab, 'overview'>;
}) {
  if (tab === 'questions') return <QuestionsTab projectId={projectId} version={version} readiness={readiness} />;
  if (tab === 'history') return <HistoryTab projectId={projectId} record={record} />;
  return <Checks criteria={version.criteria} readiness={readiness} />;
}
