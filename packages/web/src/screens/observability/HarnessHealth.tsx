// «Harness health»: one row per piece of the harness with its verdict (core queries/harness-health.ts), the cases
// behind each row, and the findings as CSV or JSON. Sober tables, units in the cells, numbers tabular.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Fragment, type ReactNode, useState } from 'react';
import { get } from '../../api/client.ts';
import { buttonClass } from '../../components/Button.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Section } from '../../components/Page.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useSafeLocale } from '../../words.ts';
import { num, shareText } from './format.ts';
import { HARNESS_HEALTH } from './words.i18n.ts';

export type HarnessCase = {
  finding_id: string;
  piece: string;
  finding: string;
  class: 'tp' | 'fp' | 'fn' | 'tn' | 'benefit' | 'cost' | 'info';
  ground_truth: string | null;
  value: number | null;
  unit: string | null;
  subject: string | null;
  attempt: number | null;
  build_request_id: string;
  task_code: string;
  pr_url: string | null;
};
export type HarnessPiece = {
  piece: string;
  verdict: 'helps' | 'neutral' | 'hurts' | 'no_data';
  n: number;
  precision: number | null;
  recall: number | null;
  benefit: Record<string, number>;
  cost: Record<string, number>;
  cases: HarnessCase[];
  cases_total: number;
};
export type HarnessHealthData = { rules_version: string | null; requests: number; pieces: HarnessPiece[] };

const harnessUrl = (projectId: string) => `/api/projects/${projectId}/observability/harness`;
export const harnessQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['p', projectId, 'observability', 'harness'] as const,
    queryFn: () => get<HarnessHealthData>(harnessUrl(projectId)),
  });

const th = 'px-3 py-2 text-xs font-medium text-fg-2 whitespace-nowrap';
const td = 'px-3 py-2 align-top';
const numTd = `${td} text-right tabular-nums`;
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

const verdictClass = (v: HarnessPiece['verdict']) => (v === 'hurts' ? 'text-danger-text' : v === 'helps' ? 'text-success-text' : 'text-fg-2');

function CasesTable({ projectId, piece }: { projectId: string; piece: HarnessPiece }) {
  const t = useMessages(HARNESS_HEALTH);
  const locale = useSafeLocale();
  return (
    <div className="flex flex-col gap-2 py-2">
      <Table
        caption={t.casesCaption(piece.piece)}
        head={
          <>
            <th scope="col" className={th}>{t.colClass}</th>
            <th scope="col" className={th}>{t.colFinding}</th>
            <th scope="col" className={th}>{t.colTask}</th>
            <th scope="col" className={numTh}>{t.colAttempt}</th>
            <th scope="col" className={numTh}>{t.colValue}</th>
            <th scope="col" className={th}>{t.colSubject}</th>
            <th scope="col" className={th}>{t.pr}</th>
          </>
        }
      >
        {piece.cases.map((c) => (
          <tr key={c.finding_id} data-case={c.finding_id}>
            <td className={`${td} font-mono text-xs uppercase text-fg-2`}>{c.class}</td>
            <td className={`${td} break-words font-mono text-xs text-fg`}>{c.finding}</td>
            <td className={td}>
              <Link
                to="/p/$projectId/build"
                params={{ projectId }}
                search={{ task: c.task_code, request: c.build_request_id, ...(c.attempt === null ? {} : { attempt: c.attempt }) }}
                aria-label={t.openPath(c.task_code, c.attempt)}
                className="font-mono text-xs text-fg hover:underline"
              >
                {c.task_code}
              </Link>
            </td>
            <td className={numTd}>{c.attempt === null ? '—' : num(locale, c.attempt, 0)}</td>
            <td className={numTd}>{c.value === null ? '—' : `${num(locale, c.value, 2)}${c.unit ? ` ${t.unit(c.unit)}` : ''}`}</td>
            <td className={`${td} break-words font-mono text-xs text-fg-2`}>{c.subject ?? '—'}</td>
            <td className={td}>
              {c.pr_url ? (
                <a href={c.pr_url} target="_blank" rel="noreferrer" className="text-fg hover:underline">
                  {t.pr}
                </a>
              ) : (
                '—'
              )}
            </td>
          </tr>
        ))}
      </Table>
      {piece.cases_total > piece.cases.length ? <p className="text-xs text-fg-3">{t.casesCut(piece.cases.length, piece.cases_total)}</p> : null}
    </div>
  );
}

/** Per unit: «12 min», «3 CI runs»; a dash when the piece has none. */
function sums(locale: string, by: Record<string, number>, unit: (k: string) => string): string {
  const parts = Object.entries(by).map(([u, v]) => `${num(locale, v, 2)} ${unit(u)}`);
  return parts.length === 0 ? '—' : parts.join(', ');
}

export function HarnessHealthView({ projectId, data }: { projectId: string; data: HarnessHealthData }) {
  const t = useMessages(HARNESS_HEALTH);
  const locale = useSafeLocale();
  const [open, setOpen] = useState<string | null>(null);
  if (data.pieces.length === 0) return <p className="text-sm text-fg-2">{t.empty}</p>;
  return (
    <div className="flex flex-col gap-4">
      <Table
        caption={t.caption}
        head={
          <>
            <th scope="col" className={th}>{t.colPiece}</th>
            <th scope="col" className={th}>{t.colVerdict}</th>
            <th scope="col" className={numTh}>{t.colN}</th>
            <th scope="col" className={numTh}>{t.colBenefit}</th>
            <th scope="col" className={numTh}>{t.colCost}</th>
            <th scope="col" className={numTh}>{t.colPrecision}</th>
            <th scope="col" className={numTh}>{t.colRecall}</th>
          </>
        }
      >
        {data.pieces.map((p) => {
          const expanded = open === p.piece;
          return (
            <Fragment key={p.piece}>
              <tr data-piece={p.piece} data-verdict={p.verdict}>
                <th scope="row" className={`${td} font-normal`}>
                  {p.cases.length > 0 ? (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={expanded ? t.hideCases(p.piece) : t.showCases(p.piece, p.cases_total)}
                      onClick={() => setOpen(expanded ? null : p.piece)}
                      className="font-mono text-xs text-fg hover:underline"
                    >
                      {p.piece}
                    </button>
                  ) : (
                    <span className="font-mono text-xs text-fg-2">{p.piece}</span>
                  )}
                </th>
                <td className={`${td} font-medium ${verdictClass(p.verdict)}`}>{t.verdict(p.verdict)}</td>
                <td className={numTd}>{num(locale, p.n, 0)}</td>
                <td className={numTd}>{sums(locale, p.benefit, t.unit)}</td>
                <td className={numTd}>{sums(locale, p.cost, t.unit)}</td>
                <td className={numTd}>{shareText(locale, p.precision)}</td>
                <td className={numTd}>{shareText(locale, p.recall)}</td>
              </tr>
              {expanded ? (
                <tr>
                  <td colSpan={7} className="bg-sunken px-3">
                    <CasesTable projectId={projectId} piece={p} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </Table>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-fg">{t.worthTitle}</h3>
        <p className="text-sm text-fg-2">{t.overviewNote}</p>
      </div>
    </div>
  );
}

export function HarnessHealthSection({ projectId }: { projectId: string }) {
  const t = useMessages(HARNESS_HEALTH);
  const q = useQuery(harnessQuery(projectId));
  const base = harnessUrl(projectId);
  return (
    <Section
      title={t.title}
      id="harness"
      note={q.data ? t.note(q.data.requests, q.data.rules_version) : undefined}
      actions={
        <div className="flex gap-2">
          <a href={`${base}/findings.csv`} download className={buttonClass()}>
            {t.downloadCsv}
          </a>
          <a href={`${base}/findings.json`} download="harness-findings.json" className={buttonClass()}>
            {t.downloadJson}
          </a>
        </div>
      }
    >
      {q.isPending ? (
        <RowsSkeleton label={t.loading} rows={3} />
      ) : q.error || !q.data ? (
        <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <HarnessHealthView projectId={projectId} data={q.data} />
      )}
    </Section>
  );
}
