// Observability: one fact per build attempt, and what they say about the estimate, the cost and the rework
// (core queries/execution-facts.ts). Sober tables with units in the headers; numbers tabular. No charts yet.

import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { projectsQuery } from '../../api/queries.ts';
import { buttonClass } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, usePageTitle } from '../../components/Page.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { DayTime } from '../../components/Time.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { useSafeLocale } from '../../words.ts';
import { correlationReading, costText, minutesText, num, shareText, tokensText } from './format.ts';
import { judgmentCalibrationQuery, observabilityCsvUrl, observabilityQuery } from './queries.ts';
import type { AgentRow, Calibration, CostRow, ExecutionFact, FileCalibration, JudgmentCalibration, ReworkCause, SizeCalibration, SizeRow } from './types.ts';
import { HarnessChecksSection } from './HarnessChecks.tsx';
import { HarnessEscapesSection } from './HarnessEscapes.tsx';
import { HarnessVersionsSection } from './HarnessVersions.tsx';
import { AttentionSection, HarnessHealthSection, WorthItSection } from './HarnessHealth.tsx';
import { TestHistorySection } from './TestHistory.tsx';
import { OBSERVABILITY } from './words.i18n.ts';

const th = 'px-3 py-2 text-xs font-medium text-fg-2 whitespace-nowrap';
const td = 'px-3 py-2 align-top';
const numTd = `${td} text-right tabular-nums whitespace-nowrap`;
const numTh = `${th} text-right`;
const ROWS = 12;

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

export function ObservabilityScreen() {
  const t = useMessages(OBSERVABILITY);
  const projectId = useProjectId();
  const q = useQuery(observabilityQuery(projectId));
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  usePageTitle([t.title, project?.name]);
  const data = q.data;
  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        meta={data ? <span>{t.summaryLine(data.summary.tasks_merged, data.summary.attempts)}</span> : null}
      />
      <PageBody>
        {q.isPending ? (
          <RowsSkeleton label={t.loading} rows={5} />
        ) : q.error && !data ? (
          <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
        ) : !data || data.facts.length === 0 ? (
          <EmptyState title={t.emptyTitle}>{t.emptyBody}</EmptyState>
        ) : (
          <div className="flex flex-col gap-10">
            <CalibrationSection jev={data.summary.calibration.by_jev} />
            <JudgmentsSection projectId={projectId} />
            <CostSection
              perTask={data.summary.cost.per_task}
              perFeature={data.summary.cost.per_feature}
              without={data.summary.cost.attempts_without_usage}
              total={data.summary.cost.attempts_with_builder}
            />
            <ReworkSection
              changes={data.summary.rework.changes_requested_by_kind}
              changesAttempts={data.summary.rework.changes_requested_attempts}
              failed={data.summary.rework.failed_by_kind}
              failedAttempts={data.summary.rework.failed_attempts}
            />
            <AgentsSection agents={data.summary.agents} />
            <TestHistorySection projectId={projectId} />
            <HarnessHealthSection projectId={projectId} />
            <HarnessChecksSection projectId={projectId} />
            <HarnessEscapesSection projectId={projectId} />
            <HarnessVersionsSection projectId={projectId} />
            <AttentionSection projectId={projectId} />
            <WorthItSection projectId={projectId} />
            <AttemptsSection facts={data.facts} projectId={projectId} />
          </div>
        )}
      </PageBody>
    </>
  );
}

function CalibrationTable({ title, calibration }: { title: string; calibration: Calibration }) {
  const t = useMessages(OBSERVABILITY);
  const locale = useSafeLocale();
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      <Table
        caption={title}
        head={
          <>
            <th scope="col" className={th}>{t.colSize}</th>
            <th scope="col" className={numTh}>{t.colTasks}</th>
            <th scope="col" className={numTh}>{t.colLead}</th>
            <th scope="col" className={numTh}>{t.colAttempts}</th>
            <th scope="col" className={numTh}>{t.colBuilder}</th>
            <th scope="col" className={numTh}>{t.colTokens}</th>
            <th scope="col" className={numTh}>{t.colCost}</th>
          </>
        }
      >
        {calibration.rows.map((r) => (
          <tr key={r.size}>
            <th scope="row" className={`${td} font-medium text-fg`}>{r.size === 'none' ? t.none : r.size}</th>
            <td className={numTd}>{num(locale, r.tasks, 0)}</td>
            <td className={numTd}>{minutesText(locale, r.median_lead_minutes)}</td>
            <td className={numTd}>{num(locale, r.median_attempts)}</td>
            <td className={numTd}>{minutesText(locale, r.median_builder_minutes)}</td>
            <td className={numTd}>{tokensText(locale, r.median_tokens)}</td>
            <td className={numTd}>{costText(locale, r.median_cost_usd)}</td>
          </tr>
        ))}
      </Table>
      <p className="text-sm text-fg">{t.reading(correlationReading(calibration.correlation), title)}</p>
    </div>
  );
}

function CalibrationSection({ jev }: { jev: Calibration }) {
  const t = useMessages(OBSERVABILITY);
  return (
    <Section title={t.calibrationTitle} id="calibration" note={t.calibrationNote}>
      <CalibrationTable title={t.byJev} calibration={jev} />
      <p className="text-xs text-fg-3">
        {t.correlationNote} {t.sizesNote}
      </p>
    </Section>
  );
}

function bandText(locale: string, band: SizeRow['band']): string {
  if (!band) return '—';
  if (band.from === null && band.to !== null) return `< ${minutesText(locale, band.to)}`;
  if (band.to === null && band.from !== null) return `≥ ${minutesText(locale, band.from)}`;
  return band.from === null || band.to === null ? '—' : `${minutesText(locale, band.from)} – ${minutesText(locale, band.to)}`;
}

function SizeJudgments({ cal }: { cal: SizeCalibration }) {
  const t = useMessages(OBSERVABILITY);
  const locale = useSafeLocale();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-fg">{t.judgSizeTitle}</h3>
        {cal.builds === 0 ? (
          <p className="text-sm text-fg-2">{t.judgNoBuilds}</p>
        ) : (
          <>
            <Table
              caption={t.judgSizeTitle}
              head={
                <>
                  <th scope="col" className={th}>{t.colJevSize}</th>
                  <th scope="col" className={numTh}>{t.colBuilds}</th>
                  <th scope="col" className={numTh}>{t.colBuilder}</th>
                  <th scope="col" className={numTh}>{t.colQuartiles}</th>
                  <th scope="col" className={numTh}>{t.colFirstAttempt}</th>
                  <th scope="col" className={numTh}>{t.colBand}</th>
                  <th scope="col" className={numTh}>{t.colInBand}</th>
                </>
              }
            >
              {cal.by_size.map((r) => (
                <tr key={r.size}>
                  <th scope="row" className={`${td} font-medium text-fg`}>{r.size}</th>
                  <td className={numTd}>{num(locale, r.n, 0)}</td>
                  <td className={numTd}>{minutesText(locale, r.median_minutes)}</td>
                  <td className={numTd}>
                    {minutesText(locale, r.p25_minutes)} – {minutesText(locale, r.p75_minutes)}
                  </td>
                  <td className={numTd}>{minutesText(locale, r.median_first_attempt_minutes)}</td>
                  <td className={numTd}>{bandText(locale, r.band)}</td>
                  <td className={numTd}>
                    {num(locale, r.in_band, 0)} / {num(locale, r.n, 0)}
                  </td>
                </tr>
              ))}
            </Table>
            <p className="text-sm text-fg">{t.spearmanLine(cal.spearman)}</p>
            <p className="text-xs text-fg-3">{t.judgSizeNote}</p>
          </>
        )}
      </div>
      {cal.buckets.some((b) => b.n > 0) ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-fg">{t.judgBucketsTitle}</h3>
          <Table
            caption={t.judgBucketsTitle}
            head={
              <>
                <th scope="col" className={th}>{t.colBucket}</th>
                <th scope="col" className={numTh}>{t.colBuilds}</th>
                <th scope="col" className={numTh}>{t.colRight}</th>
                <th scope="col" className={numTh}>{t.colAccuracy}</th>
                <th scope="col" className={numTh}>{t.colMeanConfidence}</th>
              </>
            }
          >
            {cal.buckets.map((b) => (
              <tr key={b.bucket}>
                <th scope="row" className={`${td} font-normal text-fg`}>{t.bucket(b.bucket)}</th>
                <td className={numTd}>{num(locale, b.n, 0)}</td>
                <td className={numTd}>{num(locale, b.correct, 0)}</td>
                <td className={numTd}>{shareText(locale, b.accuracy)}</td>
                <td className={numTd}>{shareText(locale, b.mean_confidence)}</td>
              </tr>
            ))}
          </Table>
          <p className="text-sm text-fg">{t.eceLine(cal.ece)}</p>
          <p className="text-sm text-fg">{t.brierLine(cal.brier)}</p>
          <p className="text-xs text-fg-3">{t.judgBucketsNote}</p>
        </div>
      ) : null}
    </div>
  );
}

function FileJudgments({ overall }: { overall: FileCalibration }) {
  const t = useMessages(OBSERVABILITY);
  const locale = useSafeLocale();
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold text-fg">{t.judgFilesTitle}</h3>
      {overall.builds === 0 ? (
        <p className="text-sm text-fg-2">{t.judgEmpty}</p>
      ) : (
        <Table
          caption={t.judgFilesTitle}
          head={
            <>
              <th scope="col" className={numTh}>{t.colBuilds}</th>
              <th scope="col" className={numTh}>{t.colPrecision}</th>
              <th scope="col" className={numTh}>{t.colFileRecall}</th>
              <th scope="col" className={numTh}>{t.colPredicted}</th>
              <th scope="col" className={numTh}>{t.colTouched}</th>
            </>
          }
        >
          <tr>
            <td className={numTd}>{num(locale, overall.builds, 0)}</td>
            <td className={numTd}>{shareText(locale, overall.median_precision)}</td>
            <td className={numTd}>{shareText(locale, overall.median_recall)}</td>
            <td className={numTd}>{num(locale, overall.mean_predicted)}</td>
            <td className={numTd}>{num(locale, overall.mean_touched)}</td>
          </tr>
        </Table>
      )}
      <p className="text-xs text-fg-3">{t.judgFilesNote}</p>
    </div>
  );
}

function VersionsTable({ data }: { data: JudgmentCalibration }) {
  const t = useMessages(OBSERVABILITY);
  const locale = useSafeLocale();
  const sizes = data.sizes.by_version;
  const files = data.files.by_version;
  if (sizes.length === 0 && files.length === 0) return null;
  const version = (v: string | null) => (v ? <span className="font-mono text-xs">{v}</span> : <span className="text-fg-2">{t.noVersion}</span>);
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-fg">{t.versionsTitle}</h3>
      {sizes.length > 0 ? (
        <Table
          caption={`${t.versionsTitle}: ${t.judgSizeTitle}`}
          head={
            <>
              <th scope="col" className={th}>{t.colVersion}</th>
              <th scope="col" className={numTh}>{t.colBuilds}</th>
              <th scope="col" className={numTh}>{t.colAgree}</th>
              <th scope="col" className={numTh}>{t.colEce}</th>
              <th scope="col" className={numTh}>{t.colBrier}</th>
            </>
          }
        >
          {sizes.map((g) => (
            <tr key={g.question_version ?? 'none'}>
              <th scope="row" className={`${td} font-normal`}>{version(g.question_version)}</th>
              <td className={numTd}>{num(locale, g.calibration.builds, 0)}</td>
              <td className={numTd}>{g.calibration.builds === 0 ? '—' : shareText(locale, g.calibration.by_size.reduce((n, r) => n + r.in_band, 0) / g.calibration.builds)}</td>
              <td className={numTd}>{num(locale, g.calibration.ece, 2)}</td>
              <td className={numTd}>{num(locale, g.calibration.brier?.score, 3)}</td>
            </tr>
          ))}
        </Table>
      ) : null}
      {files.length > 0 ? (
        <Table
          caption={`${t.versionsTitle}: ${t.judgFilesTitle}`}
          head={
            <>
              <th scope="col" className={th}>{t.colVersion}</th>
              <th scope="col" className={numTh}>{t.colBuilds}</th>
              <th scope="col" className={numTh}>{t.colPrecision}</th>
              <th scope="col" className={numTh}>{t.colFileRecall}</th>
            </>
          }
        >
          {files.map((g) => (
            <tr key={g.question_version ?? 'none'}>
              <th scope="row" className={`${td} font-normal`}>{version(g.question_version)}</th>
              <td className={numTd}>{num(locale, g.calibration.builds, 0)}</td>
              <td className={numTd}>{shareText(locale, g.calibration.median_precision)}</td>
              <td className={numTd}>{shareText(locale, g.calibration.median_recall)}</td>
            </tr>
          ))}
        </Table>
      ) : null}
      <p className="text-xs text-fg-3">{t.versionsNote}</p>
    </div>
  );
}

function JudgmentsSection({ projectId }: { projectId: string }) {
  const t = useMessages(OBSERVABILITY);
  const q = useQuery(judgmentCalibrationQuery(projectId));
  return (
    <Section title={t.judgTitle} id="judgments" note={t.judgNote}>
      {q.isPending ? (
        <RowsSkeleton label={t.loading} rows={3} />
      ) : q.error || !q.data ? (
        <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.sizes.overall.tasks === 0 && q.data.files.overall.builds === 0 ? (
        <p className="text-sm text-fg-2">{t.judgEmpty}</p>
      ) : (
        <>
          <SizeJudgments cal={q.data.sizes.overall} />
          <FileJudgments overall={q.data.files.overall} />
          <VersionsTable data={q.data} />
        </>
      )}
    </Section>
  );
}

function CostTable({ rows, label, keyHeader, withTitle }: { rows: CostRow[]; label: string; keyHeader: string; withTitle: boolean }) {
  const t = useMessages(OBSERVABILITY);
  const locale = useSafeLocale();
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, ROWS);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold text-fg">{label}</h3>
      <Table
        caption={label}
        head={
          <>
            <th scope="col" className={th}>{keyHeader}</th>
            <th scope="col" className={numTh}>{t.colTasks}</th>
            <th scope="col" className={numTh}>{t.colAttemptsTotal}</th>
            <th scope="col" className={numTh}>{t.colTokensTotal}</th>
            <th scope="col" className={numTh}>{t.colCostTotal}</th>
          </>
        }
      >
        {shown.map((r) => (
          <tr key={r.key}>
            <th scope="row" className={`${td} font-normal`}>
              <span className="font-mono text-xs text-fg-2">{r.key === '—' ? t.noFeature : r.key}</span>
              {withTitle && r.title ? <span className="ml-2 text-fg">{r.title}</span> : null}
            </th>
            <td className={numTd}>{num(locale, r.tasks, 0)}</td>
            <td className={numTd}>{num(locale, r.attempts, 0)}</td>
            <td className={numTd}>{tokensText(locale, r.tokens)}</td>
            <td className={numTd}>{costText(locale, r.cost_usd)}</td>
          </tr>
        ))}
      </Table>
      {rows.length > ROWS ? (
        <button type="button" className={buttonClass({ variant: 'quiet' })} onClick={() => setAll(!all)}>
          {all ? t.showLess : t.showAll(rows.length)}
        </button>
      ) : null}
    </div>
  );
}

function CostSection({ perTask, perFeature, without, total }: { perTask: CostRow[]; perFeature: CostRow[]; without: number; total: number }) {
  const t = useMessages(OBSERVABILITY);
  return (
    <Section title={t.costTitle} id="cost" note={t.costNote}>
      {without > 0 ? <Notice tone="info">{t.missingUsage(without, total)}</Notice> : null}
      <CostTable rows={perFeature} label={t.perFeature} keyHeader={t.colFeature} withTitle={false} />
      <CostTable rows={perTask} label={t.perTask} keyHeader={t.colTask} withTitle />
    </Section>
  );
}

function CauseTable({ title, rows }: { title: string; rows: ReworkCause[] }) {
  const t = useMessages(OBSERVABILITY);
  const locale = useSafeLocale();
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-2">{t.noRework}</p>
      ) : (
        <Table
          caption={title}
          head={
            <>
              <th scope="col" className={th}>{t.colCause}</th>
              <th scope="col" className={numTh}>{t.colCount}</th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.cause}>
              <th scope="row" className={`${td} font-mono text-xs font-normal text-fg`}>{r.cause}</th>
              <td className={numTd}>{num(locale, r.count, 0)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function ReworkSection(p: { changes: ReworkCause[]; changesAttempts: number; failed: ReworkCause[]; failedAttempts: number }) {
  const t = useMessages(OBSERVABILITY);
  return (
    <Section title={t.reworkTitle} id="rework" note={t.reworkNote}>
      <CauseTable title={t.changesTitle(p.changesAttempts)} rows={p.changes} />
      <CauseTable title={t.failedTitle(p.failedAttempts)} rows={p.failed} />
    </Section>
  );
}

function AgentsSection({ agents }: { agents: AgentRow[] }) {
  const t = useMessages(OBSERVABILITY);
  const locale = useSafeLocale();
  return (
    <Section title={t.agentsTitle} id="agents" note={t.agentsNote}>
      <Table
        caption={t.agentsTitle}
        head={
          <>
            <th scope="col" className={th}>{t.colAgent}</th>
            <th scope="col" className={th}>{t.colModel}</th>
            <th scope="col" className={numTh}>{t.colRuns}</th>
            <th scope="col" className={numTh}>{t.colFailures}</th>
            <th scope="col" className={numTh}>{t.colTokensTotal}</th>
            <th scope="col" className={numTh}>{t.colCostTotal}</th>
            <th scope="col" className={numTh}>{t.colMedianDuration} (s)</th>
          </>
        }
      >
        {agents.map((a) => (
          <tr key={`${a.agent}|${a.provider}|${a.model}`}>
            <th scope="row" className={`${td} font-mono text-xs font-normal text-fg`}>{a.agent}</th>
            <td className={`${td} text-fg-2`}>{[a.provider, a.model].filter(Boolean).join(' · ') || '—'}</td>
            <td className={numTd}>{num(locale, a.runs, 0)}</td>
            <td className={numTd}>{num(locale, a.failures, 0)}</td>
            <td className={numTd}>{tokensText(locale, a.tokens)}</td>
            <td className={numTd}>{costText(locale, a.cost_usd)}</td>
            <td className={numTd}>{num(locale, a.median_duration_seconds)}</td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

function AttemptsSection({ facts, projectId }: { facts: ExecutionFact[]; projectId: string }) {
  const t = useMessages(OBSERVABILITY);
  const locale = useSafeLocale();
  const [all, setAll] = useState(false);
  const shown = all ? facts : facts.slice(0, 50);
  return (
    <Section
      title={t.attemptsTitle}
      id="attempts"
      note={t.attemptsNote}
      actions={
        <a href={observabilityCsvUrl(projectId)} download className={buttonClass()}>
          {t.downloadCsv}
        </a>
      }
    >
      <Table
        caption={t.caption}
        head={
          <>
            <th scope="col" className={th}>{t.colStarted}</th>
            <th scope="col" className={th}>{t.colTask}</th>
            <th scope="col" className={numTh}>{t.colAttempt}</th>
            <th scope="col" className={th}>{t.colOutcome}</th>
            <th scope="col" className={th}>{t.colSize}</th>
            <th scope="col" className={numTh}>{t.colBuilderTime} (min)</th>
            <th scope="col" className={numTh}>{t.colCi} (min)</th>
            <th scope="col" className={numTh}>{t.colReview} (min)</th>
            <th scope="col" className={numTh}>{t.colWait} (min)</th>
            <th scope="col" className={numTh}>{t.colTokensTotal}</th>
            <th scope="col" className={numTh}>{t.colFiles}</th>
            <th scope="col" className={numTh}>{t.colRecall}</th>
            <th scope="col" className={numTh}>{t.colIssues}</th>
          </>
        }
      >
        {shown.map((f) => {
          const tokens =
            f.builder_usage?.total_tokens == null && f.reviewer_usage?.total_tokens == null
              ? null
              : (f.builder_usage?.total_tokens ?? 0) + (f.reviewer_usage?.total_tokens ?? 0);
          const why = f.outcome === 'failed' ? f.failure_kind : f.outcome === 'changes_requested' && f.blocking_kinds.length > 0 ? f.blocking_kinds.join(', ') : null;
          return (
            <tr key={`${f.request_id}:${f.attempt}`}>
              <td className={`${td} whitespace-nowrap text-fg-2`}>
                <DayTime iso={f.started_at} />
              </td>
              <th scope="row" className={`${td} font-normal`}>
                <span className="font-mono text-xs text-fg-2">{f.task_code}</span>
                {f.task_title ? <span className="ml-2 text-fg">{f.task_title}</span> : null}
              </th>
              <td className={numTd}>
                {f.attempt}/{f.request_attempts}
              </td>
              <td className={td}>
                {t.outcome(f.outcome)}
                {why ? <span className="ml-2 font-mono text-xs text-fg-3">{why}</span> : null}
              </td>
              <td className={`${td} whitespace-nowrap`}>{f.size_jev ?? '—'}</td>
              <td className={numTd}>{num(locale, f.builder_minutes)}</td>
              <td className={numTd}>{num(locale, f.ci_minutes)}</td>
              <td className={numTd}>{num(locale, f.review_minutes)}</td>
              <td className={numTd}>{num(locale, f.wait_minutes)}</td>
              <td className={numTd}>{tokensText(locale, tokens)}</td>
              <td className={numTd}>{num(locale, f.files_changed, 0)}</td>
              <td className={numTd}>{shareText(locale, f.context_recall)}</td>
              <td className={numTd}>{num(locale, f.issues_later, 0)}</td>
            </tr>
          );
        })}
      </Table>
      {facts.length > 50 ? (
        <button type="button" className={buttonClass({ variant: 'quiet' })} onClick={() => setAll(!all)}>
          {all ? t.showLess : t.showAll(facts.length)}
        </button>
      ) : null}
      <p className="text-xs text-fg-3">{t.units}</p>
    </Section>
  );
}
