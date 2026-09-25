// What the engines have spent and how each does (INV-MODELS-18, -19): today or the last 7 days, by
// provider and by part of DEMIURGO — parts named as in "Who does what", with their ids, not raw ids
// alone — and each engine's calls, failures (every kind in words), times, tokens and yield. Only
// shown: there are no limits. The tables scroll sideways inside their frame on narrow screens.

import { type ReactNode, useState } from 'react';
import type { AgentInfo, Catalog, Consumption, ConsumptionRow, StatsRow } from '../../api/models.ts';
import { Code } from '../../components/Badge.tsx';
import { Section } from '../../components/Page.tsx';
import { Segmented } from '../../components/Tabs.tsx';
import { cn } from '../../lib/cn.ts';
import { agentSection, engineLabel, failureKindsText, formatTokens } from './engines.ts';

const th = 'px-3 py-2 text-left text-xs font-medium text-fg-2 whitespace-nowrap';
const num = 'text-right tabular-nums';
const td = 'px-3 py-2 align-top';

/** A part of DEMIURGO by its name, with its id under it. */
function PartName({ id, agents }: { id: string; agents: readonly AgentInfo[] | undefined }) {
  const section = agentSection(id, agents);
  return (
    <span className="flex flex-col">
      <span className="text-fg">{section}</span>
      {section !== id ? <Code className="text-fg-3">{id}</Code> : null}
    </span>
  );
}

/** A bordered frame whose table scrolls sideways when narrow; the scroller takes the focus so the keyboard can scroll it. */
function Frame({ title, label, children }: { title?: string; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-edge bg-panel">
      {title ? <h3 className="border-b border-edge-subtle px-3 py-2 text-sm font-semibold text-fg">{title}</h3> : null}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable table must be reachable by keyboard (WCAG 2.1.1) */}
      <div role="group" aria-label={label} tabIndex={0} className="overflow-x-auto rounded-b-lg">
        {children}
      </div>
    </div>
  );
}

export function SpendSection({
  consumption,
  catalogs,
  agents,
}: {
  consumption: Consumption;
  catalogs: Catalog[];
  agents: readonly AgentInfo[] | undefined;
}) {
  const [period, setPeriod] = useState<'today' | 'week'>('today');
  const data = consumption[period];
  const providerName = (key: string) => catalogs.find((c) => c.provider === key)?.label ?? key;
  return (
    <Section
      title="What it has spent"
      id="spend"
      note="Only shown: there are no limits. Cost appears only when the provider reports it."
      actions={
        <Segmented
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'Last 7 days' },
          ]}
        />
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <UsageTable title="By provider" rows={data.byProvider} name={(k) => providerName(k)} />
        <UsageTable title="By part of DEMIURGO" rows={data.byAgent} name={(k) => <PartName id={k} agents={agents} />} />
      </div>
    </Section>
  );
}

function UsageTable({ title, rows, name }: { title: string; rows: ConsumptionRow[]; name: (key: string) => ReactNode }) {
  return (
    <Frame title={title} label={title}>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-sm text-fg-3">Nothing yet.</p>
      ) : (
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-edge-subtle">
              <th scope="col" className={th}>
                Name
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Calls
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Tokens in
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Tokens out
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-edge-subtle last:border-b-0">
                <th scope="row" className={cn(td, 'text-left font-normal')}>
                  {name(r.key)}
                </th>
                <td className={cn(td, num)}>{r.calls.toLocaleString('en-GB')}</td>
                <td className={cn(td, num)}>{formatTokens(r.inputTokens)}</td>
                <td className={cn(td, num)}>{formatTokens(r.outputTokens)}</td>
                <td className={cn(td, num, 'text-fg-2')}>{r.declaredCostUsd > 0 ? `$${r.declaredCostUsd.toFixed(2)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Frame>
  );
}

const secs = (ms: number | null): string => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const avg = (n: number | null): string => (n === null ? '—' : n.toFixed(1));

export function StatsSection({
  stats,
  catalogs,
  agents,
}: {
  stats: StatsRow[];
  catalogs: Catalog[];
  agents: readonly AgentInfo[] | undefined;
}) {
  if (stats.length === 0) return null;
  return (
    <Section title="How each engine does" id="stats" note="Per part of DEMIURGO and engine, over every call it made.">
      <Frame label="How each engine does">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <caption className="sr-only">How each engine does</caption>
          <thead>
            <tr className="border-b border-edge-subtle">
              <th scope="col" className={th}>
                Part
              </th>
              <th scope="col" className={th}>
                Engine
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Calls
              </th>
              <th scope="col" className={th}>
                Failed
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Avg time
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Avg tokens
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Questions/run
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Proposals/run
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => {
              const failed = failureKindsText(s.failures);
              return (
                <tr
                  key={`${s.agent}|${s.provider}|${s.model}|${s.effort}`}
                  className="border-b border-edge-subtle last:border-b-0"
                >
                  <th scope="row" className={cn(td, 'text-left font-normal')}>
                    <PartName id={s.agent} agents={agents} />
                  </th>
                  <td className={cn(td, 'text-fg-2')}>{engineLabel(s, catalogs)}</td>
                  <td className={cn(td, num)}>{s.calls}</td>
                  <td className={cn(td, failed ? 'text-danger-text' : 'text-fg-3')}>{failed || '—'}</td>
                  <td className={cn(td, num)}>{secs(s.avgDurationMs)}</td>
                  <td className={cn(td, num)}>{s.avgTokens === null ? '—' : formatTokens(Math.round(s.avgTokens))}</td>
                  <td className={cn(td, num)}>{avg(s.avgQuestions)}</td>
                  <td className={cn(td, num)}>{avg(s.avgProposals)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Frame>
    </Section>
  );
}
