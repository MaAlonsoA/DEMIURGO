// «Flaky and slow tests»: what the kept CI test results say per test (core queries/test-history.ts).

import { queryOptions, useQuery } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { get } from '../../api/client.ts';
import { Section } from '../../components/Page.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { DayTime } from '../../components/Time.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useSafeLocale } from '../../words.ts';
import { num } from './format.ts';
import { TEST_HISTORY } from './TestHistory.i18n.ts';

type TestStat = {
  test_name: string;
  runs: number;
  fails: number;
  flaky_shas: string[];
  last_seen: string;
  median_duration_ms: number | null;
};
type TestHistoryData = { flaky: TestStat[]; slowest: TestStat[]; total_tests: number; total_runs: number };

const testHistoryQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['p', projectId, 'observability', 'tests'] as const,
    queryFn: () => get<TestHistoryData>(`/api/projects/${projectId}/observability/tests`),
  });

const th = 'px-3 py-2 text-xs font-medium text-fg-2 whitespace-nowrap';
const td = 'px-3 py-2 align-top';
const numTd = `${td} text-right tabular-nums whitespace-nowrap`;
const numTh = `${th} text-right`;

function Table({ caption, head, children }: { caption: string; head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-edge">{head}</tr>
        </thead>
        <tbody className="divide-y divide-edge">{children}</tbody>
      </table>
    </div>
  );
}

export function TestHistorySection({ projectId }: { projectId: string }) {
  const t = useMessages(TEST_HISTORY);
  const locale = useSafeLocale();
  const q = useQuery(testHistoryQuery(projectId));
  const d = q.data;
  return (
    <Section title={t.title} id="tests" note={d ? t.note(d.total_tests, d.total_runs) : undefined}>
      {q.isPending ? (
        <RowsSkeleton label={t.loading} rows={3} />
      ) : !d || d.total_runs === 0 ? (
        <p className="text-sm text-fg-2">{t.noResults}</p>
      ) : (
        <>
          <h3 className="text-sm font-medium text-fg">{t.flakyTitle}</h3>
          {d.flaky.length === 0 ? (
            <p className="text-sm text-fg-2">{t.noFlaky}</p>
          ) : (
            <Table
              caption={t.flakyTitle}
              head={
                <>
                  <th scope="col" className={th}>{t.colTest}</th>
                  <th scope="col" className={numTh}>{t.colFlakyShas}</th>
                  <th scope="col" className={numTh}>{t.colFails}</th>
                  <th scope="col" className={numTh}>{t.colRuns}</th>
                  <th scope="col" className={th}>{t.colLastSeen}</th>
                  <th scope="col" className={numTh}>{t.colMedian} (ms)</th>
                </>
              }
            >
              {d.flaky.map((s) => (
                <tr key={s.test_name}>
                  <th scope="row" className={`${td} break-words font-mono text-xs font-normal text-fg`}>{s.test_name}</th>
                  <td className={numTd}>{num(locale, s.flaky_shas.length, 0)}</td>
                  <td className={numTd}>{num(locale, s.fails, 0)}</td>
                  <td className={numTd}>{num(locale, s.runs, 0)}</td>
                  <td className={`${td} whitespace-nowrap text-fg-2`}><DayTime iso={s.last_seen} /></td>
                  <td className={numTd}>{num(locale, s.median_duration_ms, 0)}</td>
                </tr>
              ))}
            </Table>
          )}
          <h3 className="mt-4 text-sm font-medium text-fg">{t.slowTitle}</h3>
          <Table
            caption={t.slowTitle}
            head={
              <>
                <th scope="col" className={th}>{t.colTest}</th>
                <th scope="col" className={numTh}>{t.colMedian} (ms)</th>
                <th scope="col" className={numTh}>{t.colRuns}</th>
              </>
            }
          >
            {d.slowest.map((s) => (
              <tr key={s.test_name}>
                <th scope="row" className={`${td} break-words font-mono text-xs font-normal text-fg`}>{s.test_name}</th>
                <td className={numTd}>{num(locale, s.median_duration_ms, 0)}</td>
                <td className={numTd}>{num(locale, s.runs, 0)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Section>
  );
}
