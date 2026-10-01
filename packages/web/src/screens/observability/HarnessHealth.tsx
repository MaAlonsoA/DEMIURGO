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
import { costText, num, shareText, tokensText } from './format.ts';
import { ATTENTION, HARNESS_HEALTH } from './words.i18n.ts';

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
  /** English name from the inventory (core harness/pieces.ts); null when the piece has none. */
  name?: string | null;
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

/** «B03 · Queue: hotspots and modules»; the bare code when the piece has no name. */
export const pieceText = (p: { piece: string; name?: string | null }): string => (p.name ? `${p.piece} · ${p.name}` : p.piece);

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
                      {pieceText(p)}
                    </button>
                  ) : (
                    <span className="font-mono text-xs text-fg-2">{pieceText(p)}</span>
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

// ---- Attention and cost per stage, and «Is it worth it?» (core queries/attention.ts) ----

type Stat = { n: number; median: number | null; p90: number | null; max: number | null };
export type StageAttention = {
  stage: string;
  questions: { raised: number; answered: number; discarded: number; pending: number; led_to_version: number; led_to_version_proxy: number; seconds_to_answer: Stat };
  proposals: { accepted: number; rejected: number; edited: number; pending: number; superseded: number; seconds_to_decide: Stat };
  batches: { resolved: number; whole_accepted: number; timed: number; timed_from_shown: number; seconds_per_item: Stat };
  cost: { runs: number; input_tokens: number; output_tokens: number; usd: number; artefacts: number; tokens_per_artefact: number | null; usd_per_artefact: number | null };
  person_minutes_proxy: number;
};
export type AttentionData = { stages: StageAttention[]; person: { buckets_minutes: number; session_minutes: number; sessions: number } };
export type WorthItData = {
  value: { merged_tasks: number; criteria_verified: number; records_approved: Record<string, number>; records_approved_total: number };
  cost: {
    design: { runs_without_usage: number };
    reviewer: { runs_without_usage: number };
    builder: { steps_without_usage: number };
    tokens: number;
    usd: number;
    ci: { runs: number; minutes: number };
    person_minutes: { buckets_minutes: number };
    patches: { count: number | null; source: 'parameter' | 'not_derivable' };
  };
  units: {
    tokens_per_merged_task: number | null;
    usd_per_merged_task: number | null;
    usd_per_verified_criterion: number | null;
    person_minutes_per_merged_task: number | null;
    patches_per_merged_task: number | null;
  };
};

const attentionUrl = (projectId: string) => `/api/projects/${projectId}/observability/harness/attention.json`;
const worthUrl = (projectId: string) => `/api/projects/${projectId}/observability/harness/worth.json`;
export const attentionQuery = (projectId: string) =>
  queryOptions({ queryKey: ['p', projectId, 'observability', 'harness', 'attention'] as const, queryFn: () => get<AttentionData>(attentionUrl(projectId)) });
export const worthQuery = (projectId: string) =>
  queryOptions({ queryKey: ['p', projectId, 'observability', 'harness', 'worth'] as const, queryFn: () => get<WorthItData>(worthUrl(projectId)) });

export function AttentionView({ data }: { data: AttentionData }) {
  const t = useMessages(ATTENTION);
  const locale = useSafeLocale();
  const seconds = (v: number | null) => (v === null ? '—' : t.seconds(num(locale, v, 0)));
  const proxy = data.stages.reduce((n, s) => n + s.questions.led_to_version_proxy, 0);
  const rows = data.stages.filter((s) => s.questions.raised > 0 || s.proposals.accepted + s.proposals.rejected + s.proposals.pending > 0 || s.cost.runs > 0);
  return (
    <div className="flex flex-col gap-3">
      <Table
        caption={t.caption}
        head={
          <>
            <th scope="col" className={th}>{t.colStage}</th>
            <th scope="col" className={numTh}>{t.colAsked}</th>
            <th scope="col" className={numTh}>{t.colAnswered}</th>
            <th scope="col" className={numTh}>{t.colLed}</th>
            <th scope="col" className={numTh}>{t.colAnswerTime}</th>
            <th scope="col" className={numTh}>{t.colAccepted}</th>
            <th scope="col" className={numTh}>{t.colRejected}</th>
            <th scope="col" className={numTh}>{t.colEdited}</th>
            <th scope="col" className={numTh}>{t.colItemTime}</th>
            <th scope="col" className={numTh}>{t.colWhole}</th>
            <th scope="col" className={numTh}>{t.colTokens}</th>
            <th scope="col" className={numTh}>{t.colUsd}</th>
            <th scope="col" className={numTh}>{t.colPerArtefact}</th>
            <th scope="col" className={numTh}>{t.colMinutes}</th>
          </>
        }
      >
        {rows.map((s) => (
          <tr key={s.stage} data-stage={s.stage}>
            <th scope="row" className={`${td} font-normal text-fg`}>{t.stage(s.stage)}</th>
            <td className={numTd}>{num(locale, s.questions.raised, 0)}</td>
            <td className={numTd}>{num(locale, s.questions.answered, 0)}</td>
            <td className={numTd}>{num(locale, s.questions.led_to_version, 0)}</td>
            <td className={numTd}>{seconds(s.questions.seconds_to_answer.median)}</td>
            <td className={numTd}>{num(locale, s.proposals.accepted, 0)}</td>
            <td className={numTd}>{num(locale, s.proposals.rejected, 0)}</td>
            <td className={numTd}>{num(locale, s.proposals.edited, 0)}</td>
            <td className={numTd}>{seconds(s.batches.seconds_per_item.median)}</td>
            <td className={numTd}>{num(locale, s.batches.whole_accepted, 0)}</td>
            <td className={numTd}>{tokensText(locale, s.cost.input_tokens + s.cost.output_tokens)}</td>
            <td className={numTd}>{s.cost.usd > 0 ? costText(locale, s.cost.usd) : '—'}</td>
            <td className={numTd}>{tokensText(locale, s.cost.tokens_per_artefact)}</td>
            <td className={numTd}>{num(locale, s.person_minutes_proxy, 0)}</td>
          </tr>
        ))}
      </Table>
      <p className="text-xs text-fg-3">{t.proxyNote(proxy)}</p>
      <p className="text-xs text-fg-3">{t.personTotal(num(locale, data.person.buckets_minutes, 0), num(locale, data.person.session_minutes, 0), data.person.sessions)}</p>
    </div>
  );
}

export function WorthItView({ data }: { data: WorthItData }) {
  const t = useMessages(ATTENTION);
  const locale = useSafeLocale();
  const n0 = (v: number) => num(locale, v, 0);
  const unit = (v: number | null) => (v === null ? '—' : num(locale, v, 2));
  const without = data.cost.design.runs_without_usage + data.cost.reviewer.runs_without_usage + data.cost.builder.steps_without_usage;
  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: t.valueGroup,
      rows: [
        [t.mergedTasks, n0(data.value.merged_tasks)],
        [t.criteriaVerified, n0(data.value.criteria_verified)],
        [t.recordsApproved, n0(data.value.records_approved_total)],
      ],
    },
    {
      title: t.costGroup,
      rows: [
        [t.tokensTotal, tokensText(locale, data.cost.tokens)],
        [t.usdTotal, costText(locale, data.cost.usd)],
        [t.ciRuns, n0(data.cost.ci.runs)],
        [t.ciMinutes, n0(data.cost.ci.minutes)],
        [t.personMinutes, n0(data.cost.person_minutes.buckets_minutes)],
        [t.patches, data.cost.patches.count === null ? t.patchesNone : n0(data.cost.patches.count)],
      ],
    },
    {
      title: t.unitsGroup,
      rows: [
        [t.tokensPerTask, data.units.tokens_per_merged_task === null ? '—' : tokensText(locale, data.units.tokens_per_merged_task)],
        [t.usdPerTask, data.units.usd_per_merged_task === null ? '—' : costText(locale, data.units.usd_per_merged_task)],
        [t.usdPerCriterion, data.units.usd_per_verified_criterion === null ? '—' : costText(locale, data.units.usd_per_verified_criterion)],
        [t.minutesPerTask, unit(data.units.person_minutes_per_merged_task)],
        [t.patchesPerTask, unit(data.units.patches_per_merged_task)],
      ],
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <Table
        caption={t.worthCaption}
        head={
          <>
            <th scope="col" className={th}>{t.colMeasure}</th>
            <th scope="col" className={numTh}>{t.colAmount}</th>
          </>
        }
      >
        {groups.flatMap((g) => [
          <tr key={g.title} className="bg-sunken">
            <th scope="rowgroup" colSpan={2} className={`${th} text-left`}>{g.title}</th>
          </tr>,
          ...g.rows.map(([label, value]) => (
            <tr key={`${g.title}:${label}`}>
              <th scope="row" className={`${td} font-normal text-fg`}>{label}</th>
              <td className={numTd}>{value}</td>
            </tr>
          )),
        ])}
      </Table>
      {without > 0 ? <p className="text-xs text-fg-3">{t.withoutUsage(without)}</p> : null}
    </div>
  );
}

export function AttentionSection({ projectId }: { projectId: string }) {
  const t = useMessages(ATTENTION);
  const q = useQuery(attentionQuery(projectId));
  return (
    <Section title={t.attentionTitle} id="harness-attention" note={t.attentionNote}>
      {q.isPending ? <RowsSkeleton label={t.loading} rows={3} /> : q.error || !q.data ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : <AttentionView data={q.data} />}
    </Section>
  );
}

export function WorthItSection({ projectId }: { projectId: string }) {
  const t = useMessages(ATTENTION);
  const q = useQuery(worthQuery(projectId));
  return (
    <Section title={t.worthTitle} id="harness-worth" note={t.worthNote}>
      {q.isPending ? <RowsSkeleton label={t.worthLoading} rows={3} /> : q.error || !q.data ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : <WorthItView data={q.data} />}
    </Section>
  );
}

// The «Escapes from design» section lives in HarnessEscapes.tsx and is shown next to this one.
export { HarnessEscapesSection } from './HarnessEscapes.tsx';
