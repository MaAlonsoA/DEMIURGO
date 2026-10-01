// «Containment» (core queries/harness-containment.ts): phase containment effectiveness of the design phases against its
// target, now and over time (recomputed on read), with the contained and escaped errors listed to audit. Sober tables.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { get } from '../../api/client.ts';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Select } from '../../components/Field.tsx';
import { Section } from '../../components/Page.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { DayTime } from '../../components/Time.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useSafeLocale } from '../../words.ts';
import { HARNESS_CONTAINMENT } from './HarnessContainment.i18n.ts';
import { num } from './format.ts';

export type PhaseContainment = { phase: string; contained: number; escaped: number; pce: number | null; n: number; target_met: boolean | null };
export type ContainmentPoint = { id: string; computed_at: string; window_from: string; window_to: string; phases: PhaseContainment[] };
export type ContainmentAuditRow = {
  id: string;
  kind: 'contained' | 'escaped';
  rule: string;
  introduced_phase: string;
  found_phase: string;
  record_code: string | null;
  criterion_code: string | null;
  build_request_id: string | null;
  subject: string | null;
  occurred_at: string | null;
};
export type HarnessContainmentData = {
  rules_version: string | null;
  rules_versions: string[];
  target: number;
  min_n: number;
  phases: string[];
  current: PhaseContainment[];
  series: ContainmentPoint[];
  total: number;
  rows: ContainmentAuditRow[];
};

const containmentUrl = (projectId: string, rules?: string) =>
  `/api/projects/${projectId}/observability/harness/containment.json${rules ? `?rules=${encodeURIComponent(rules)}` : ''}`;
export const containmentQuery = (projectId: string, rules?: string) =>
  queryOptions({
    queryKey: ['p', projectId, 'observability', 'harness', 'containment', rules ?? 'latest'] as const,
    queryFn: () => get<HarnessContainmentData>(containmentUrl(projectId, rules)),
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

const percent = (locale: string, v: number | null): string => (v === null ? '—' : `${num(locale, v * 100, 1)} %`);

export function HarnessContainmentView({
  projectId,
  data,
  rules,
  onRules,
}: {
  projectId: string;
  data: HarnessContainmentData;
  rules?: string;
  onRules: (v: string) => void;
}) {
  const t = useMessages(HARNESS_CONTAINMENT);
  const locale = useSafeLocale();
  const byPhase = new Map(data.current.map((p) => [p.phase, p]));
  const targetText = percent(locale, data.target);
  const status = (p: PhaseContainment | undefined): string => (!p || p.n === 0 ? t.noRows : p.target_met === null ? t.notEnough : p.target_met ? t.met : t.unmet);
  const cellOf = (p: PhaseContainment | undefined): string => (!p ? '—' : p.n < data.min_n ? `${t.notEnough} (${p.n})` : `${percent(locale, p.pce)} (${p.n})`);
  const series = [...data.series].reverse();
  return (
    <div className="flex flex-col gap-4" data-containment={data.rules_version ?? 'none'}>
      {data.rules_versions.length > 1 ? (
        <label className="flex max-w-xs flex-col gap-1 text-sm text-fg-2">
          {t.rulesVersion}
          <Select value={rules ?? data.rules_version ?? ''} onChange={(e) => onRules(e.target.value)}>
            {data.rules_versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </label>
      ) : (
        <p className="text-sm text-fg-2">
          {t.rulesVersion}: <span className="font-mono text-xs text-fg">{data.rules_version}</span>
        </p>
      )}
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg-2">
        <li>{t.integrity1}</li>
        <li>{t.integrity2}</li>
        <li>{t.integrity3}</li>
        <li>{t.integrity4}</li>
      </ul>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-fg">{t.statusTitle}</h3>
        <Table
          caption={t.statusCaption}
          head={
            <>
              <th scope="col" className={th}>{t.colPhase}</th>
              <th scope="col" className={numTh}>{t.colPce}</th>
              <th scope="col" className={numTh}>{t.colTarget}</th>
              <th scope="col" className={numTh}>{t.colN}</th>
              <th scope="col" className={numTh}>{t.colContained}</th>
              <th scope="col" className={numTh}>{t.colEscaped}</th>
              <th scope="col" className={th}>{t.colStatus}</th>
            </>
          }
        >
          {data.phases.map((phase) => {
            const p = byPhase.get(phase);
            const seen = p !== undefined && p.n >= data.min_n;
            return (
              <tr key={phase} data-phase={phase}>
                <th scope="row" className={`${td} font-normal text-fg`}>
                  <span className="font-mono text-xs text-fg-3">{phase}</span> {t.phaseName(phase)}
                </th>
                <td className={numTd}>{seen ? percent(locale, p.pce) : '—'}</td>
                <td className={numTd}>{targetText}</td>
                <td className={numTd}>{num(locale, p?.n ?? 0, 0)}</td>
                <td className={numTd}>{num(locale, p?.contained ?? 0, 0)}</td>
                <td className={numTd}>{num(locale, p?.escaped ?? 0, 0)}</td>
                <td className={`${td} text-fg-2`}>{status(p)}</td>
              </tr>
            );
          })}
        </Table>
      </div>
      {series.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-fg">{t.seriesTitle}</h3>
          <p className="text-xs text-fg-3">{t.seriesNote}</p>
          <Table
            caption={t.seriesCaption}
            head={
              <>
                <th scope="col" className={th}>{t.colCheck}</th>
                {data.phases.map((phase) => (
                  <th key={phase} scope="col" className={`${numTh} font-mono`}>{phase}</th>
                ))}
              </>
            }
          >
            {series.map((c) => {
              const cells = new Map(c.phases.map((p) => [p.phase, p]));
              return (
                <tr key={c.id} data-check-row={c.id}>
                  <td className={`${td} whitespace-nowrap`}>
                    <DayTime iso={c.window_from} /> → <DayTime iso={c.window_to} />
                  </td>
                  {data.phases.map((phase) => (
                    <td key={phase} className={`${numTd} whitespace-nowrap text-fg-2`}>{cellOf(cells.get(phase))}</td>
                  ))}
                </tr>
              );
            })}
          </Table>
        </div>
      ) : null}
      {data.rows.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-fg">{t.auditTitle}</h3>
          <Table
            caption={t.auditCaption}
            head={
              <>
                <th scope="col" className={th}>{t.colKind}</th>
                <th scope="col" className={th}>{t.colRule}</th>
                <th scope="col" className={th}>{t.colPhases}</th>
                <th scope="col" className={th}>{t.colRecord}</th>
                <th scope="col" className={th}>{t.colCriterion}</th>
                <th scope="col" className={th}>{t.colSubject}</th>
                <th scope="col" className={th}>{t.colBuild}</th>
              </>
            }
          >
            {data.rows.map((r) => (
              <tr key={r.id} data-audit={r.kind} data-escape={r.id}>
                <td className={td}>{t.kind(r.kind)}</td>
                <td className={`${td} font-mono text-xs text-fg-2`}>{r.rule}</td>
                <td className={`${td} font-mono text-xs text-fg-2`}>{`${r.introduced_phase} → ${r.found_phase}`}</td>
                <td className={td}>
                  {r.record_code ? (
                    <Link to="/p/$projectId/records/$code" params={{ projectId, code: r.record_code }} className="font-mono text-xs text-fg hover:underline">
                      {r.record_code}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={`${td} font-mono text-xs text-fg-2`}>{r.criterion_code ?? '—'}</td>
                <td className={`${td} break-words text-fg-2`}>{r.subject ?? '—'}</td>
                <td className={td}>
                  {r.build_request_id && r.record_code ? (
                    <Link
                      to="/p/$projectId/build"
                      params={{ projectId }}
                      search={{ task: r.record_code, request: r.build_request_id }}
                      aria-label={t.openBuild(r.record_code)}
                      className="font-mono text-xs text-fg hover:underline"
                    >
                      {r.record_code}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </Table>
          {data.rows.length < data.total ? <p className="text-xs text-fg-3">{t.cut(data.rows.length, data.total)}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function HarnessContainmentSection({ projectId }: { projectId: string }) {
  const t = useMessages(HARNESS_CONTAINMENT);
  const [rules, setRules] = useState<string | undefined>(undefined);
  const q = useQuery(containmentQuery(projectId, rules));
  const d = q.data;
  return (
    <Section title={t.title} id="harness-containment" note={d ? t.note(Math.round(d.target * 100), d.min_n) : undefined}>
      {q.isPending ? (
        <RowsSkeleton label={t.loading} rows={3} />
      ) : q.error || !d ? (
        <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
      ) : d.rules_version === null ? (
        <p className="text-sm text-fg-2">{t.empty}</p>
      ) : (
        <HarnessContainmentView projectId={projectId} data={d} rules={rules} onRules={setRules} />
      )}
    </Section>
  );
}
