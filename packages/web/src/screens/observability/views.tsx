// The tabs of the Observability screen. Overview first, zoom and filter, then details-on-demand (Shneiderman,
// «The Eyes Have It», IEEE Symposium on Visual Languages, 1996): the Overview tab holds a few headline numbers,
// each with its chart and a link to the tab that explains it; every other tab leads with charts and a one-line
// reading, and the complete tables stay below, collapsed under «Show data», for auditing.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { type Catalog, type Translation, useMessages } from '../../i18n/define.ts';
import { useSafeLocale } from '../../words.ts';
import { BarRows, Sparkline, Stat, StackedBar, type BarRow, type Part } from './charts.tsx';
import { costSeries, costText, costTrend, correlationReading, minutesText, num, outcomeCounts, shareText, tokensText } from './format.ts';
import { checksQuery } from './HarnessChecks.tsx';
import { containmentQuery, type HarnessContainmentData } from './HarnessContainment.tsx';
import { HARNESS_CONTAINMENT } from './HarnessContainment.i18n.ts';
import { escapesQuery } from './HarnessEscapes.tsx';
import { attentionQuery, harnessQuery, type HarnessPiece, worthQuery } from './HarnessHealth.tsx';
import { testHistoryQuery } from './TestHistory.tsx';
import { versionsQuery } from './HarnessVersions.tsx';
import { judgmentCalibrationQuery } from './queries.ts';
import type { Observability } from './types.ts';
import { ATTENTION, HARNESS_ESCAPES, HARNESS_HEALTH as HARNESS_HEALTH_WORDS, OBSERVABILITY, OBS_VIEW } from './words.i18n.ts';

type Msgs<C> = C extends Catalog<infer E> ? Translation<E> : never;

export const TABS = ['overview', 'build', 'agents', 'harness', 'design'] as const;
export type ObsTab = (typeof TABS)[number];

const summarize = (title: string, rows: { name: string; display: string }[]) => `${title}: ${rows.map((r) => `${r.name} ${r.display}`).join('; ')}`;

/** A chart block: its title, the one-line reading and the chart. */
function Block({ title, reading, children, link }: { title: string; reading?: ReactNode; children?: ReactNode; link?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 py-6 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        {link}
      </div>
      {reading ? <p className="text-sm text-fg-2">{reading}</p> : null}
      {children}
    </section>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-medium text-fg">{children}</h3>;
}

/** The complete table behind a chart, collapsed. */
export function ShowData({ title, children }: { title: string; children: ReactNode }) {
  const t = useMessages(OBS_VIEW);
  return (
    <details className="border-t border-edge pt-3">
      <summary className="cursor-pointer text-sm font-medium text-fg-2 hover:text-fg">{t.showData(title)}</summary>
      <div className="mt-4 flex flex-col gap-6">{children}</div>
    </details>
  );
}

function TabLink({ projectId, tab }: { projectId: string; tab: ObsTab }) {
  const t = useMessages(OBS_VIEW);
  return (
    <Link to="/p/$projectId/observability" params={{ projectId }} search={{ tab } as never} resetScroll={false} className="text-sm text-accent-text hover:underline">
      {t.seeIn(t.tab(tab))}
    </Link>
  );
}

function Pending() {
  const t = useMessages(OBS_VIEW);
  return <RowsSkeleton label={t.loadingChart} rows={1} />;
}
function Unavailable() {
  const t = useMessages(OBS_VIEW);
  return <p className="text-sm text-fg-2">{t.unavailable}</p>;
}

/** Wait for a query: skeleton, then «unavailable», then the chart. */
function Load<T>({ q, children }: { q: { isPending: boolean; data: T | undefined }; children: (d: T) => ReactNode }) {
  if (q.isPending) return <Pending />;
  return q.data === undefined ? <Unavailable /> : <>{children(q.data)}</>;
}

// ---- shared pieces ----

function phaseRows(d: HarnessContainmentData, locale: string, t: Msgs<typeof HARNESS_CONTAINMENT>): BarRow[] {
  const byPhase = new Map(d.current.map((p) => [p.phase, p]));
  return d.phases.map((phase) => {
    const p = byPhase.get(phase);
    const seen = p !== undefined && p.n >= d.min_n;
    const display = !p || p.n === 0 ? t.noRows : seen ? `${num(locale, (p.pce ?? 0) * 100, 1)} % (n ${p.n})` : `${t.notEnough} (n ${p.n})`;
    return {
      key: phase,
      label: (
        <span>
          <span className="font-mono text-xs text-fg-3">{phase}</span> {t.phaseName(phase)}
        </span>
      ),
      name: phase,
      value: seen ? p.pce : null,
      display,
      tone: seen ? (p.pce !== null && p.pce >= d.target ? 'success' : 'danger') : 'muted',
    };
  });
}

function ContainmentBars({ d }: { d: HarnessContainmentData }) {
  const t = useMessages(HARNESS_CONTAINMENT);
  const v = useMessages(OBS_VIEW);
  const locale = useSafeLocale();
  const rows = phaseRows(d, locale, t);
  return (
    <div className="flex flex-col gap-2">
      <BarRows rows={rows} max={1} target={d.target} summary={summarize(v.ovDesignTitle, rows)} />
      <p className="text-xs text-fg-3">{v.targetLine(Math.round(d.target * 100))}</p>
    </div>
  );
}

function containmentReading(d: HarnessContainmentData, v: Msgs<typeof OBS_VIEW>): string {
  const measured = d.current.filter((p) => p.n >= d.min_n);
  return measured.length === 0 ? v.ovDesignNone(d.min_n) : v.ovDesignReading(Math.round(d.target * 100), measured.filter((p) => p.target_met === true).length, measured.length);
}

// ---- Overview ----

function Headline({ title, reading, tab, projectId, stat, children }: { title: string; reading: ReactNode; tab: ObsTab; projectId: string; stat: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-x-8 gap-y-3 py-6 first:pt-0 md:grid-cols-[minmax(12rem,20rem)_1fr]">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-fg-2">{title}</h2>
        {stat}
        <TabLink projectId={projectId} tab={tab} />
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-sm text-fg">{reading}</p>
        {children}
      </div>
    </section>
  );
}

export function OverviewTab({ projectId, data }: { projectId: string; data: Observability }) {
  const v = useMessages(OBS_VIEW);
  const o = useMessages(OBSERVABILITY);
  const locale = useSafeLocale();
  const containment = useQuery(containmentQuery(projectId));
  const checks = useQuery(checksQuery(projectId));
  const s = data.summary;
  const series = costSeries(data.facts);
  const costs = series.map((c) => c.cost);
  const totalCost = costs.reduce((n, c) => n + c, 0);
  const trend = costTrend(costs);
  const out = outcomeCounts(data.facts);
  const rework = s.rework.changes_requested_attempts + s.rework.failed_attempts;
  const reworkRate = s.attempts === 0 ? null : rework / s.attempts;
  const attemptParts: Part[] = [
    { key: 'merged', label: o.outcome('merged'), value: out.merged, tone: 'success' },
    { key: 'changes', label: o.outcome('changes_requested'), value: out.changes_requested, tone: 'warning' },
    { key: 'failed', label: o.outcome('failed'), value: out.failed, tone: 'danger' },
    { key: 'other', label: v.otherOutcomes, value: out.running + out.cancelled + out.open, tone: 'muted' },
  ];
  const latest = checks.data?.latest ?? null;
  const regSeries = [...(checks.data?.checks ?? [])].sort((a, b) => (a.computed_at < b.computed_at ? -1 : 1)).map((c) => c.regressions.length);
  return (
    <div className="flex flex-col divide-y divide-edge">
      <Headline
        projectId={projectId}
        tab="design"
        title={v.ovDesignTitle}
        stat={null}
        reading={containment.data && containment.data.rules_version !== null ? containmentReading(containment.data, v) : containment.isPending ? '' : v.ovDesignEmpty}
      >
        <Load q={containment}>{(d) => (d.rules_version === null ? null : <ContainmentBars d={d} />)}</Load>
      </Headline>
      <Headline
        projectId={projectId}
        tab="build"
        title={v.ovBuildTitle}
        stat={<Stat value={num(locale, s.tasks_merged, 0)} label={v.statTasks(s.attempts)} />}
        reading={v.ovBuildReading(s.attempts === 0 ? null : s.attempts / Math.max(1, s.tasks_merged))}
      >
        <StackedBar parts={attemptParts} summary={summarize(v.ovBuildTitle, attemptParts.map((p) => ({ name: p.label, display: String(p.value) })))} />
      </Headline>
      <Headline
        projectId={projectId}
        tab="build"
        title={v.ovCostTitle}
        stat={<Stat value={costs.length === 0 ? '—' : costText(locale, totalCost)} label={v.statCost} delta={trend === null ? undefined : v.costDelta(Math.round(trend * 100))} deltaTone={trend === null ? 'muted' : trend > 0.1 ? 'danger' : trend < -0.1 ? 'success' : 'muted'} />}
        reading={costs.length === 0 ? v.ovCostNone : v.ovCostReading(costText(locale, totalCost / costs.length), costs.length)}
      >
        <Sparkline values={costs} min={0} summary={`${v.ovCostTitle}: ${costs.map((c) => costText(locale, c)).join(', ')}`} />
      </Headline>
      <Headline
        projectId={projectId}
        tab="harness"
        title={v.ovChecksTitle}
        stat={<Stat value={latest ? num(locale, latest.regressions.length, 0) : '—'} label={v.statRegressions} deltaTone={latest && latest.regressions.length > 0 ? 'danger' : 'success'} delta={latest ? (latest.regressions.length > 0 ? v.attention : v.allClear) : undefined} />}
        reading={checks.isPending ? '' : latest ? v.ovChecksReading(latest.regressions.length, latest.escapes.new_total, checks.data?.total ?? 0) : v.ovChecksNone}
      >
        <Sparkline values={regSeries} min={0} summary={`${v.ovChecksTitle}: ${regSeries.join(', ')}`} />
      </Headline>
      <Headline
        projectId={projectId}
        tab="build"
        title={v.ovReworkTitle}
        stat={<Stat value={shareText(locale, reworkRate)} label={v.statRework} />}
        reading={v.ovReworkReading(s.rework.changes_requested_attempts, s.rework.failed_attempts, s.attempts)}
      >
        <StackedBar
          parts={[
            { key: 'changes', label: o.outcome('changes_requested'), value: s.rework.changes_requested_attempts, tone: 'warning' },
            { key: 'failed', label: o.outcome('failed'), value: s.rework.failed_attempts, tone: 'danger' },
            { key: 'clean', label: v.noRework, value: Math.max(0, s.attempts - rework), tone: 'muted' },
          ]}
          summary={`${v.ovReworkTitle}: ${rework} / ${s.attempts}`}
        />
      </Headline>
    </div>
  );
}

// ---- Build ----

export function BuildBlocks({ projectId, data }: { projectId: string; data: Observability }) {
  const v = useMessages(OBS_VIEW);
  const o = useMessages(OBSERVABILITY);
  const locale = useSafeLocale();
  const tests = useQuery(testHistoryQuery(projectId));
  const s = data.summary;
  const cal = s.calibration.by_jev;
  const maxLead = Math.max(0, ...cal.rows.map((r) => r.median_lead_minutes ?? 0));
  const leadRows: BarRow[] = cal.rows.map((r) => ({
    key: r.size,
    label: r.size === 'none' ? o.none : r.size,
    name: r.size === 'none' ? o.none : r.size,
    value: r.median_lead_minutes,
    display: `${minutesText(locale, r.median_lead_minutes)} (${r.tasks})`,
  }));
  const feat = s.cost.per_feature.filter((r) => r.cost_usd !== null).slice(0, 8);
  const maxFeat = Math.max(0, ...feat.map((r) => r.cost_usd ?? 0));
  const featRows: BarRow[] = feat.map((r) => ({ key: r.key, label: <span className="font-mono text-xs">{r.key === '—' ? o.noFeature : r.key}</span>, name: r.key, value: r.cost_usd, display: costText(locale, r.cost_usd) }));
  const costs = costSeries(data.facts).map((c) => c.cost);
  const causes = [...s.rework.changes_requested_by_kind.map((c) => ({ ...c, group: 'changes' })), ...s.rework.failed_by_kind.map((c) => ({ ...c, group: 'failed' }))];
  const maxCause = Math.max(1, ...causes.map((c) => c.count));
  const causeRows = (list: typeof causes): BarRow[] =>
    list.map((c) => ({ key: `${c.group}:${c.cause}`, label: <span className="font-mono text-xs">{c.cause}</span>, name: c.cause, value: c.count, display: String(c.count), tone: c.group === 'failed' ? 'danger' : 'warning' }));
  const out = outcomeCounts(data.facts);
  const attemptParts: Part[] = [
    { key: 'merged', label: o.outcome('merged'), value: out.merged, tone: 'success' },
    { key: 'changes', label: o.outcome('changes_requested'), value: out.changes_requested, tone: 'warning' },
    { key: 'failed', label: o.outcome('failed'), value: out.failed, tone: 'danger' },
    { key: 'other', label: v.otherOutcomes, value: out.running + out.cancelled + out.open, tone: 'muted' },
  ];
  const maxAtt = Math.max(1, ...cal.rows.map((r) => r.median_attempts ?? 0));
  const attRows: BarRow[] = cal.rows.map((r) => ({ key: r.size, label: r.size === 'none' ? o.none : r.size, name: r.size, value: r.median_attempts, display: num(locale, r.median_attempts) }));
  return (
    <>
      <Block title={v.bCalibTitle} reading={o.reading(correlationReading(cal.correlation), o.byJev)}>
        <BarRows rows={leadRows} max={maxLead || 1} summary={summarize(v.bCalibTitle, leadRows)} />
        <p className="text-xs text-fg-3">{v.leadUnit}</p>
      </Block>
      <Block title={v.bCostTitle} reading={costs.length === 0 ? v.ovCostNone : v.ovCostReading(costText(locale, costs.reduce((n, c) => n + c, 0) / costs.length), costs.length)}>
        {featRows.length > 0 ? (
          <div className="flex flex-col gap-2">
            <SubHeading>{o.perFeature}</SubHeading>
            <BarRows rows={featRows} max={maxFeat || 1} summary={summarize(o.perFeature, featRows)} />
          </div>
        ) : null}
        {costs.length > 1 ? (
          <div className="flex flex-col gap-2">
            <SubHeading>{v.costPerTaskOverTime}</SubHeading>
            <Sparkline values={costs} min={0} summary={`${v.costPerTaskOverTime}: ${costs.map((c) => costText(locale, c)).join(', ')}`} />
          </div>
        ) : null}
      </Block>
      <Block title={v.bReworkTitle} reading={v.ovReworkReading(s.rework.changes_requested_attempts, s.rework.failed_attempts, s.attempts)}>
        {causes.length === 0 ? (
          <p className="text-sm text-fg-2">{o.noRework}</p>
        ) : (
          <BarRows rows={causeRows(causes)} max={maxCause} summary={summarize(v.bReworkTitle, causeRows(causes))} />
        )}
      </Block>
      <Block title={v.bAttemptsTitle} reading={v.ovBuildReading(s.attempts === 0 ? null : s.attempts / Math.max(1, s.tasks_merged))}>
        <StackedBar parts={attemptParts} summary={summarize(v.bAttemptsTitle, attemptParts.map((p) => ({ name: p.label, display: String(p.value) })))} />
        <SubHeading>{v.attemptsPerSize}</SubHeading>
        <BarRows rows={attRows} max={maxAtt} summary={summarize(v.attemptsPerSize, attRows)} />
      </Block>
      <Block title={v.bTestsTitle} reading={tests.data && tests.data.total_runs > 0 ? v.testsReading(tests.data.flaky.length, tests.data.total_tests) : undefined}>
        <Load q={tests}>
          {(d) => {
            if (d.total_runs === 0) return <p className="text-sm text-fg-2">{v.testsNone}</p>;
            const slow = d.slowest.slice(0, 6);
            const max = Math.max(1, ...slow.map((x) => x.median_duration_ms ?? 0));
            const rows: BarRow[] = slow.map((x) => ({ key: x.test_name, label: <span className="font-mono text-xs">{x.test_name}</span>, name: x.test_name, value: x.median_duration_ms, display: `${num(locale, x.median_duration_ms, 0)} ms` }));
            return <BarRows rows={rows} max={max} summary={summarize(v.bTestsTitle, rows)} />;
          }}
        </Load>
      </Block>
    </>
  );
}

// ---- Agents and Jev ----

export function AgentsBlocks({ projectId, data }: { projectId: string; data: Observability }) {
  const v = useMessages(OBS_VIEW);
  const o = useMessages(OBSERVABILITY);
  const locale = useSafeLocale();
  const judg = useQuery(judgmentCalibrationQuery(projectId));
  const agents = data.summary.agents;
  const runs = agents.reduce((n, a) => n + a.runs, 0);
  const failures = agents.reduce((n, a) => n + a.failures, 0);
  const byAgent = new Map<string, { cost: number | null; runs: number; failures: number }>();
  for (const a of agents) {
    const r = byAgent.get(a.agent) ?? { cost: null, runs: 0, failures: 0 };
    if (a.cost_usd !== null) r.cost = (r.cost ?? 0) + a.cost_usd;
    r.runs += a.runs;
    r.failures += a.failures;
    byAgent.set(a.agent, r);
  }
  const costly = [...byAgent.entries()].filter(([, r]) => r.cost !== null).sort((a, b) => (b[1].cost ?? 0) - (a[1].cost ?? 0)).slice(0, 10);
  const maxCost = Math.max(0, ...costly.map(([, r]) => r.cost ?? 0));
  const costRows: BarRow[] = costly.map(([name, r]) => ({ key: name, label: <span className="font-mono text-xs">{name}</span>, name, value: r.cost, display: `${costText(locale, r.cost)} · ${r.runs}` }));
  const parts: Part[] = [
    { key: 'ok', label: v.runsOk, value: runs - failures, tone: 'success' },
    { key: 'failed', label: o.colFailures, value: failures, tone: 'danger' },
  ];
  return (
    <>
      <Block title={v.aAgentsTitle} reading={runs === 0 ? v.noRuns : v.agentRunsReading(runs, failures)}>
        {runs === 0 ? null : (
          <>
            <StackedBar parts={parts} summary={summarize(v.aAgentsTitle, parts.map((p) => ({ name: p.label, display: String(p.value) })))} />
            {costRows.length > 0 ? (
              <div className="flex flex-col gap-2">
                <SubHeading>{v.costByAgent}</SubHeading>
                <BarRows rows={costRows} max={maxCost || 1} summary={summarize(v.costByAgent, costRows)} />
              </div>
            ) : null}
          </>
        )}
      </Block>
      <Block title={v.aJevTitle} reading={o.spearmanLine(judg.data?.sizes.overall.spearman ?? null)}>
        <Load q={judg}>
          {(d) => {
            const sz = d.sizes.overall;
            const f = d.files.overall;
            if (sz.tasks === 0 && f.builds === 0) return <p className="text-sm text-fg-2">{o.judgEmpty}</p>;
            const band: BarRow[] = sz.by_size.map((r) => ({ key: r.size, label: r.size, name: r.size, value: r.n === 0 ? null : r.in_band / r.n, display: `${r.in_band} / ${r.n}`, tone: 'accent' }));
            const buckets: BarRow[] = sz.buckets
              .filter((b) => b.n > 0)
              .map((b) => ({ key: b.bucket, label: o.bucket(b.bucket), name: o.bucket(b.bucket), value: b.accuracy, display: `${shareText(locale, b.accuracy)} (n ${b.n})`, tone: 'info' }));
            const files: BarRow[] =
              f.builds === 0
                ? []
                : [
                    { key: 'p', label: o.colPrecision, name: o.colPrecision, value: f.median_precision, display: shareText(locale, f.median_precision), tone: 'accent' },
                    { key: 'r', label: o.colFileRecall, name: o.colFileRecall, value: f.median_recall, display: shareText(locale, f.median_recall), tone: 'accent' },
                  ];
            return (
              <div className="flex flex-col gap-5">
                {band.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <SubHeading>{v.inBandHeading}</SubHeading>
                    <BarRows rows={band} max={1} summary={summarize(v.inBandHeading, band)} />
                  </div>
                ) : null}
                {buckets.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <SubHeading>{o.judgBucketsTitle}</SubHeading>
                    <BarRows rows={buckets} max={1} summary={summarize(o.judgBucketsTitle, buckets)} />
                    <p className="text-sm text-fg-2">{o.eceLine(sz.ece)}</p>
                  </div>
                ) : null}
                {files.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <SubHeading>{o.judgFilesTitle}</SubHeading>
                    <BarRows rows={files} max={1} summary={summarize(o.judgFilesTitle, files)} />
                  </div>
                ) : null}
              </div>
            );
          }}
        </Load>
      </Block>
    </>
  );
}

// ---- Harness health ----

export function HarnessBlocks({ projectId }: { projectId: string }) {
  const v = useMessages(OBS_VIEW);
  const a = useMessages(ATTENTION);
  const locale = useSafeLocale();
  const health = useQuery(harnessQuery(projectId));
  const checks = useQuery(checksQuery(projectId));
  const versions = useQuery(versionsQuery(projectId));
  const attention = useQuery(attentionQuery(projectId));
  const worth = useQuery(worthQuery(projectId));
  const hh = useMessages(HARNESS_HEALTH_WORDS);
  return (
    <>
      <Block title={v.hHealthTitle} reading={health.data && health.data.pieces.length > 0 ? healthReading(health.data.pieces, v) : undefined}>
        <Load q={health}>
          {(d) => {
            if (d.pieces.length === 0) return <p className="text-sm text-fg-2">{v.healthNone}</p>;
            const count = (k: string) => d.pieces.filter((p) => p.verdict === k).length;
            const parts: Part[] = [
              { key: 'helps', label: hh.verdict('helps'), value: count('helps'), tone: 'success' },
              { key: 'neutral', label: hh.verdict('neutral'), value: count('neutral'), tone: 'info' },
              { key: 'hurts', label: hh.verdict('hurts'), value: count('hurts'), tone: 'danger' },
              { key: 'no_data', label: hh.verdict('no_data'), value: count('no_data'), tone: 'muted' },
            ];
            return <StackedBar parts={parts} summary={summarize(v.hHealthTitle, parts.map((p) => ({ name: p.label, display: String(p.value) })))} />;
          }}
        </Load>
      </Block>
      <Block title={v.hChecksTitle} reading={checks.data?.latest ? v.ovChecksReading(checks.data.latest.regressions.length, checks.data.latest.escapes.new_total, checks.data.total) : checks.isPending ? undefined : v.ovChecksNone}>
        <Load q={checks}>
          {(d) => {
            const regs = [...d.checks].sort((x, y) => (x.computed_at < y.computed_at ? -1 : 1)).map((c) => c.regressions.length);
            return regs.length === 0 ? null : (
              <div className="flex flex-col gap-1">
                <SubHeading>{v.regressionsOverTime}</SubHeading>
                <Sparkline values={regs} min={0} summary={`${v.regressionsOverTime}: ${regs.join(', ')}`} />
              </div>
            );
          }}
        </Load>
      </Block>
      <Block title={v.hVersionsTitle} reading={versions.data && versions.data.cohorts.length > 0 ? v.versionsReading(versions.data.cohorts.length) : undefined}>
        <Load q={versions}>
          {(d) => {
            if (d.cohorts.length === 0) return <p className="text-sm text-fg-2">{v.versionsNone}</p>;
            const max = Math.max(1, ...d.cohorts.map((c) => c.requests));
            const rows: BarRow[] = d.cohorts.map((c, i) => {
              const name = c.demiurgo_sha ? c.demiurgo_sha.slice(0, 7) : v.untagged;
              return { key: `${c.harness_version_id ?? 'none'}:${i}`, label: <span className="font-mono text-xs">{name}</span>, name, value: c.requests, display: v.buildsCount(c.requests) };
            });
            return <BarRows rows={rows} max={max} summary={summarize(v.hVersionsTitle, rows)} />;
          }}
        </Load>
      </Block>
      <Block title={v.hAttentionTitle} reading={v.hAttentionReading}>
        <Load q={attention}>
          {(d) => {
            const stages = d.stages.filter((s) => s.person_minutes_proxy > 0);
            if (stages.length === 0) return <p className="text-sm text-fg-2">{v.attentionNone}</p>;
            const max = Math.max(1, ...stages.map((s) => s.person_minutes_proxy));
            const rows: BarRow[] = stages.map((s) => ({ key: s.stage, label: a.stage(s.stage), name: a.stage(s.stage), value: s.person_minutes_proxy, display: `${num(locale, s.person_minutes_proxy, 0)} min` }));
            return <BarRows rows={rows} max={max} summary={summarize(v.hAttentionTitle, rows)} />;
          }}
        </Load>
      </Block>
      <Block title={v.hWorthTitle} reading={v.hWorthReading}>
        <Load q={worth}>
          {(d) => (
            <div className="flex flex-wrap gap-x-10 gap-y-4">
              <Stat value={d.units.usd_per_merged_task === null ? '—' : costText(locale, d.units.usd_per_merged_task)} label={v.statUsdPerTask} />
              <Stat value={tokensText(locale, d.units.tokens_per_merged_task)} label={v.statTokensPerTask} />
              <Stat value={num(locale, d.units.person_minutes_per_merged_task, 0)} label={v.statMinutesPerTask} />
            </div>
          )}
        </Load>
      </Block>
    </>
  );
}

function healthReading(pieces: HarnessPiece[], v: Msgs<typeof OBS_VIEW>): string {
  const hurting = pieces.filter((p) => p.verdict === 'hurts').map((p) => p.name ?? p.piece);
  return v.healthReading(pieces.filter((p) => p.verdict === 'helps').length, hurting.length, pieces.length, hurting.slice(0, 3).join(', '));
}

// ---- Design ----

export function DesignBlocks({ projectId }: { projectId: string }) {
  const v = useMessages(OBS_VIEW);
  const e = useMessages(HARNESS_ESCAPES);
  const ct = useMessages(HARNESS_CONTAINMENT);
  const locale = useSafeLocale();
  const containment = useQuery(containmentQuery(projectId));
  const escapes = useQuery(escapesQuery(projectId));
  return (
    <>
      <Block title={v.dContainTitle} reading={containment.data && containment.data.rules_version !== null ? containmentReading(containment.data, v) : containment.isPending ? undefined : v.ovDesignEmpty}>
        <Load q={containment}>
          {(d) => {
            if (d.rules_version === null) return null;
            const chrono = [...d.series].reverse();
            return (
              <div className="flex flex-col gap-5">
                <ContainmentBars d={d} />
                {chrono.length > 1 ? (
                  <div className="flex flex-col gap-2">
                    <SubHeading>{v.dContainOverTime}</SubHeading>
                    <ul className="flex flex-col gap-2">
                      {d.phases.map((phase) => {
                        const values = chrono.map((c) => {
                          const p = c.phases.find((x) => x.phase === phase);
                          return p && p.n >= d.min_n ? p.pce : null;
                        });
                        const last = [...values].reverse().find((x) => x !== null) ?? null;
                        return (
                          <li key={phase} className="grid grid-cols-[minmax(6rem,12rem)_1fr_minmax(5rem,auto)] items-center gap-3 text-sm">
                            <span className="font-mono text-xs text-fg">{phase}</span>
                            {values.every((x) => x === null) ? <span className="text-fg-3">{ct.notEnough}</span> : <Sparkline values={values} min={0} max={1} target={d.target} summary={`${phase}: ${values.map((x) => (x === null ? ct.notEnough : shareText(locale, x))).join(', ')}`} />}
                            <span className="text-right tabular-nums text-fg-2">{shareText(locale, last)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          }}
        </Load>
      </Block>
      <Block title={v.dEscapesTitle}>
        <Load q={escapes}>
          {(d) => {
            const contained = containment.data?.current.reduce((n, p) => n + p.contained, 0) ?? 0;
            const escaped = containment.data?.current.reduce((n, p) => n + p.escaped, 0) ?? d.total;
            const rows: BarRow[] = d.by_rule.map((r) => ({ key: r.rule, label: <span title={e.rule(r.rule)}>{r.rule}</span>, name: e.rule(r.rule), value: r.n, display: String(r.n), tone: 'danger' }));
            const max = Math.max(1, ...d.by_rule.map((r) => r.n));
            const parts: Part[] = [
              { key: 'contained', label: ct.kind('contained'), value: contained, tone: 'success' },
              { key: 'escaped', label: ct.kind('escaped'), value: escaped, tone: 'danger' },
            ];
            return d.total === 0 && contained === 0 ? (
              <p className="text-sm text-fg-2">{e.empty}</p>
            ) : (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-fg-2">{v.escapesReading(d.total, contained, escaped)}</p>
                <StackedBar parts={parts} summary={summarize(v.dEscapesTitle, parts.map((p) => ({ name: p.label, display: String(p.value) })))} />
                {rows.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <SubHeading>{v.escapesByRule}</SubHeading>
                    <BarRows rows={rows} max={max} summary={summarize(v.escapesByRule, rows)} />
                  </div>
                ) : null}
              </div>
            );
          }}
        </Load>
      </Block>
    </>
  );
}
