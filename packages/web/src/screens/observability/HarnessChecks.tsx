// «Checks» (core harness/check.ts, queries/harness-health.ts `harnessChecks`): the latest periodic check of the harness
// with its regressions and new escapes, the series of earlier ones, and a link to the check as JSON. Sober tables.

import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { get } from '../../api/client.ts';
import { buttonClass } from '../../components/Button.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Section } from '../../components/Page.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { DayTime } from '../../components/Time.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useSafeLocale } from '../../words.ts';
import { HARNESS_CHECKS } from './HarnessChecks.i18n.ts';
import { num } from './format.ts';

export type CheckRegression = {
  kind: 'verdict_worse' | 'containment_drop' | 'cost_per_task_up';
  piece?: string;
  phase?: string;
  unit?: string;
  before: string | number | null;
  after: string | number | null;
  threshold: number | null;
};
export type CheckData = {
  id: string;
  window_from: string;
  window_to: string;
  trigger: 'schedule' | 'merges' | 'manual';
  rules_version: string;
  regressions: CheckRegression[];
  escapes: { new_total: number; by_rule?: Record<string, number> };
  computed_at: string;
};
export type HarnessChecksData = { total: number; latest: CheckData | null; checks: CheckData[] };

const checksUrl = (projectId: string) => `/api/projects/${projectId}/observability/harness/checks.json`;
export const checksQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['p', projectId, 'observability', 'harness', 'checks'] as const,
    queryFn: () => get<HarnessChecksData>(checksUrl(projectId)),
  });

const th = 'px-3 py-2 text-xs font-medium text-fg-2 whitespace-nowrap';
const td = 'px-3 py-2 align-top';
const numTh = `${th} text-right`;
const numTd = `${td} text-right tabular-nums`;

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

/** A verdict word stays as stored; a number is shown with its decimals. */
const valueText = (locale: string, v: string | number | null): string => (v === null ? '—' : typeof v === 'number' ? num(locale, v, 3) : v);
const subjectOf = (r: CheckRegression): string => r.piece ?? r.phase ?? r.unit ?? '—';

export function HarnessChecksView({ data }: { data: HarnessChecksData }) {
  const t = useMessages(HARNESS_CHECKS);
  const locale = useSafeLocale();
  const latest = data.latest;
  if (!latest) return <p className="text-sm text-fg-2">{t.empty}</p>;
  const earlier = data.checks.filter((c) => c.id !== latest.id);
  return (
    <div className="flex flex-col gap-4" data-check={latest.id}>
      <p className="text-sm text-fg-2">
        <span className="font-medium text-fg">{t.latest}</span> · <DayTime iso={latest.computed_at} /> · {t.trigger(latest.trigger)} · {t.window}: <DayTime iso={latest.window_from} /> → <DayTime iso={latest.window_to} />
      </p>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-fg">{t.regressionsTitle}</h3>
        {latest.regressions.length === 0 ? (
          <p className="text-sm text-fg-2" data-no-regressions>
            {t.noRegressions}
          </p>
        ) : (
          <Table
            caption={t.regressionsCaption}
            head={
              <>
                <th scope="col" className={th}>{t.colKind}</th>
                <th scope="col" className={th}>{t.colSubject}</th>
                <th scope="col" className={numTh}>{t.colBefore}</th>
                <th scope="col" className={numTh}>{t.colAfter}</th>
              </>
            }
          >
            {latest.regressions.map((r, i) => (
              <tr key={`${r.kind}:${subjectOf(r)}:${i}`} data-regression={r.kind}>
                <td className={td}>{t.kind(r.kind)}</td>
                <td className={`${td} font-mono text-xs text-fg`}>{subjectOf(r)}</td>
                <td className={numTd}>{valueText(locale, r.before)}</td>
                <td className={numTd}>{valueText(locale, r.after)}</td>
              </tr>
            ))}
          </Table>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-fg">{t.newEscapesTitle}</h3>
        <p className="text-sm text-fg-2" data-new-escapes={latest.escapes.new_total}>
          {t.newEscapes(latest.escapes.new_total)}
          {latest.escapes.new_total > 0 ? (
            <>
              {' '}
              {Object.entries(latest.escapes.by_rule ?? {})
                .map(([rule, n]) => `${rule} ×${n}`)
                .join(', ')}
              {' · '}
              <a href="#harness-escapes" className="text-fg hover:underline">
                {t.seeEscapes}
              </a>
            </>
          ) : null}
        </p>
      </div>
      {earlier.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-fg">{t.seriesTitle}</h3>
          <Table
            caption={t.seriesCaption}
            head={
              <>
                <th scope="col" className={th}>{t.colWhen}</th>
                <th scope="col" className={th}>{t.colTrigger}</th>
                <th scope="col" className={numTh}>{t.colRegressions}</th>
                <th scope="col" className={numTh}>{t.colNewEscapes}</th>
              </>
            }
          >
            {earlier.map((c) => (
              <tr key={c.id} data-check-row={c.id}>
                <td className={td}>
                  <DayTime iso={c.computed_at} />
                </td>
                <td className={td}>{t.trigger(c.trigger)}</td>
                <td className={numTd}>{num(locale, c.regressions.length, 0)}</td>
                <td className={numTd}>{num(locale, c.escapes.new_total, 0)}</td>
              </tr>
            ))}
          </Table>
        </div>
      ) : null}
    </div>
  );
}

export function HarnessChecksSection({ projectId }: { projectId: string }) {
  const t = useMessages(HARNESS_CHECKS);
  const q = useQuery(checksQuery(projectId));
  return (
    <Section
      title={t.title}
      id="harness-checks"
      note={t.note(q.data?.total ?? 0)}
      actions={
        <a href={checksUrl(projectId)} download="harness-checks.json" className={buttonClass()}>
          {t.downloadJson}
        </a>
      }
    >
      {q.isPending ? <RowsSkeleton label={t.loading} rows={2} /> : q.error || !q.data ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : <HarnessChecksView data={q.data} />}
    </Section>
  );
}
