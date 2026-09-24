// Settings → Models & providers (FDR-AGE-002): what each provider offers now, which engine runs each
// agent (everywhere, and this project's overrides), and what they have spent. Only discovered models
// can be chosen; nothing here switches engine on its own.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import {
  type AgentInfo,
  type Catalog,
  type Consumption,
  type ConsumptionRow,
  type Engine,
  type StatsRow,
  agentsQuery,
  assignEngine,
  providersQuery,
  refreshProviders,
  unassignEngine,
} from '../../api/models.ts';
import { cn } from '../../lib/cn.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { ago } from '../../lib/time.ts';
import { Button } from '../../ui/Button.tsx';
import { Page, PageTitle, SectionTitle, Skeleton } from '../../ui/layout.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { EngineSelect } from './EngineSelect.tsx';
import { agentOrder, engineLabel, firstEngine, choosableProviders, formatTokens, resolutionLine } from './engines.ts';

export function ModelsScreen() {
  const projectId = useProjectId();
  const client = useQueryClient();
  const providers = useQuery(providersQuery);
  const agents = useQuery(agentsQuery(projectId));
  const refresh = useMutation({
    mutationFn: refreshProviders,
    onSuccess: () => client.invalidateQueries({ queryKey: ['models'] }),
  });
  const catalogs = providers.data?.catalogs ?? [];

  return (
    <Page>
      <div className="flex max-w-[1080px] flex-col gap-9">
        <PageTitle
          eyebrow="Settings"
          title="Models & providers"
          subtitle="Which engine runs each part of DEMIURGO. You choose from what each provider offers right now; DEMIURGO never switches on its own."
          actions={
            <Button data-refresh-providers disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              {refresh.isPending ? 'Looking…' : 'Refresh'}
            </Button>
          }
          className="mb-0"
        />
        {refresh.error ? <Reasons error={refresh.error} /> : null}
        {providers.error ? <Reasons error={providers.error} /> : null}

        <section aria-labelledby="providers-title">
          <SectionTitle aside="Discovered without spending quota">
            <span id="providers-title">Providers</span>
          </SectionTitle>
          {providers.isPending ? (
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-36" />
              <Skeleton className="h-36" />
              <Skeleton className="h-36" />
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
              {catalogs.map((c) => (
                <ProviderCard key={c.provider} catalog={c} />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="agents-title">
          <SectionTitle aside="A change applies to the next run, never to one already asked for">
            <span id="agents-title">Who does what</span>
          </SectionTitle>
          {agents.error ? <Reasons error={agents.error} /> : null}
          {agents.isPending || providers.isPending ? (
            <Skeleton className="h-64" />
          ) : (
            <AgentTable agents={agents.data?.agents ?? []} catalogs={catalogs} projectId={projectId} />
          )}
        </section>

        {providers.data && (
          <>
            <UsageSection consumption={providers.data.consumption} catalogs={catalogs} />
            <StatsSection stats={providers.data.stats} catalogs={catalogs} />
          </>
        )}
      </div>
    </Page>
  );
}

function StatusDot({ tone }: { tone: 'ok' | 'problem' | 'off' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        tone === 'ok' && 'bg-ink',
        tone === 'problem' && 'bg-problem-fill',
        tone === 'off' && 'bg-inactive-light',
      )}
    />
  );
}

function ProviderCard({ catalog: c }: { catalog: Catalog }) {
  const tone = !c.installed ? 'off' : c.ready ? 'ok' : 'problem';
  const state = !c.installed ? 'Not installed' : c.ready ? 'Ready' : 'Not ready';
  return (
    <article
      data-provider={c.provider}
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold">{c.label}</h3>
        <span className="flex items-center gap-1.5 text-xs text-ink-2">
          <StatusDot tone={tone} />
          {state}
          {c.version && <span className="font-mono text-[11px] text-muted">v{c.version}</span>}
        </span>
      </header>
      {c.message && <p className={cn('text-[13px]', c.ready ? 'text-ink-2' : 'text-problem')}>{c.message}</p>}
      {c.models.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {c.models.map((m) => (
            <li key={m.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px]">
              <span className="font-medium text-ink">{m.label}</span>
              {m.efforts.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {m.efforts.map((e) => (
                    <span
                      key={e}
                      className={cn(
                        'rounded-md border px-1.5 py-px text-[11px]',
                        e === m.defaultEffort ? 'border-ink-3 text-ink' : 'border-line-soft text-muted',
                      )}
                      title={e === m.defaultEffort ? 'Default effort' : undefined}
                    >
                      {e}
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">No models to offer.</p>
      )}
      <footer className="mt-auto flex items-center gap-2 border-t border-line-soft pt-2 text-xs text-muted">
        {c.sessions ? 'Keeps a conversation per thread' : 'Sends the whole context every time'}
        <span aria-hidden="true">·</span>
        <span>Checked {ago(c.discoveredAt)}</span>
      </footer>
    </article>
  );
}

function AgentTable({ agents, catalogs, projectId }: { agents: AgentInfo[]; catalogs: Catalog[]; projectId: string }) {
  const sorted = agents.toSorted((a, b) => agentOrder(a.id, b.id));
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="grid grid-cols-[minmax(220px,1.2fr)_minmax(400px,2fr)_minmax(400px,2fr)] border-b border-line-soft bg-surface-2 px-4 py-2 text-xs font-semibold text-muted">
        <span>Part of DEMIURGO</span>
        <span>Everywhere</span>
        <span>This project</span>
      </div>
      <ul>
        {sorted.map((a) => (
          <AgentRow key={a.id} agent={a} catalogs={catalogs} projectId={projectId} />
        ))}
      </ul>
    </div>
  );
}

function AgentRow({ agent: a, catalogs, projectId }: { agent: AgentInfo; catalogs: Catalog[]; projectId: string }) {
  const client = useQueryClient();
  const [overriding, setOverriding] = useState(false);
  const done = () => client.invalidateQueries({ queryKey: ['models'] });
  const assign = useMutation({
    mutationFn: (p: { scope: 'global' | 'project'; engine: Engine }) => assignEngine(a.id, p.scope, p.engine, projectId),
    onSuccess: async () => {
      setOverriding(false);
      await done();
    },
  });
  const unassign = useMutation({
    mutationFn: (scope: 'global' | 'project') => unassignEngine(a.id, scope, projectId),
    onSuccess: done,
  });
  const busy = assign.isPending || unassign.isPending;
  const line = resolutionLine(a.effective, catalogs);
  const fallback = a.global?.engine ?? firstEngine(catalogs, choosableProviders(catalogs)[0]?.provider ?? '') ?? null;

  return (
    <li
      data-agent={a.id}
      className="grid grid-cols-[minmax(220px,1.2fr)_minmax(400px,2fr)_minmax(400px,2fr)] items-start gap-y-2 border-b border-line-soft px-4 py-3.5 last:border-b-0"
    >
      <div className="flex min-w-0 flex-col gap-0.5 pr-4">
        <span className="text-[14px] font-semibold text-ink">{a.section}</span>
        <span className="text-[13px] text-ink-2">{a.description}</span>
        <span className="font-mono text-[11px] text-muted">
          {a.id}@{a.version} · {a.skills.length} {a.skills.length === 1 ? 'skill' : 'skills'}
        </span>
        <span
          data-effective
          className={cn(
            'mt-1 flex items-center gap-1.5 text-xs',
            line.tone === 'ok' ? 'text-ink-2' : 'font-semibold text-problem',
          )}
        >
          <StatusDot tone={line.tone} />
          {line.text}
        </span>
      </div>
      <Cell>
        <EngineSelect
          label={`${a.section}, everywhere`}
          catalogs={catalogs}
          value={a.global?.engine ?? null}
          disabled={busy}
          onChange={(engine) => assign.mutate({ scope: 'global', engine })}
        />
        {a.global ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => unassign.mutate('global')}>
            Remove
          </Button>
        ) : (
          <span className="text-xs font-semibold text-problem">No model yet</span>
        )}
      </Cell>
      <Cell>
        {a.project || overriding ? (
          <>
            <EngineSelect
              label={`${a.section}, this project`}
              catalogs={catalogs}
              value={a.project?.engine ?? null}
              disabled={busy}
              onChange={(engine) => assign.mutate({ scope: 'project', engine })}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => (a.project ? unassign.mutate('project') : setOverriding(false))}
            >
              {a.project ? 'Use everywhere’s' : 'Cancel'}
            </Button>
          </>
        ) : (
          <>
            <span className="text-[13px] text-muted">Same as everywhere</span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !fallback}
              onClick={() => {
                if (fallback) assign.mutate({ scope: 'project', engine: fallback });
                else setOverriding(true);
              }}
            >
              Use another here
            </Button>
          </>
        )}
      </Cell>
      {(assign.error || unassign.error) && (
        <div className="col-span-3">
          <Reasons error={assign.error ?? unassign.error} />
        </div>
      )}
    </li>
  );
}

const Cell = ({ children }: { children: ReactNode }) => (
  <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
);

function UsageSection({ consumption, catalogs }: { consumption: Consumption; catalogs: Catalog[] }) {
  const [period, setPeriod] = useState<'today' | 'week'>('today');
  const data = consumption[period];
  const label = (key: string) => catalogs.find((c) => c.provider === key)?.label ?? key;
  return (
    <section aria-labelledby="usage-title">
      <SectionTitle
        aside={
          <span className="flex gap-1" role="group" aria-label="Period">
            {(['today', 'week'] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-xs',
                  period === p ? 'bg-line-soft font-semibold text-ink' : 'text-muted hover:text-ink',
                )}
              >
                {p === 'today' ? 'Today' : 'Last 7 days'}
              </button>
            ))}
          </span>
        }
      >
        <span id="usage-title">What it has spent</span>
      </SectionTitle>
      <p className="mb-3 text-[13px] text-muted">
        Only shown: there are no limits. Cost appears only when the provider reports it.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <UsageTable title="By provider" rows={data.byProvider} name={label} />
        <UsageTable title="By part of DEMIURGO" rows={data.byAgent} name={(k) => k} />
      </div>
    </section>
  );
}

function UsageTable({ title, rows, name }: { title: string; rows: ConsumptionRow[]; name: (key: string) => string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface">
      <h3 className="border-b border-line-soft px-4 py-2 text-[13px] font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-muted">Nothing yet.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="px-4 py-1.5 font-semibold">Name</th>
              <th className="px-2 py-1.5 text-right font-semibold">Calls</th>
              <th className="px-2 py-1.5 text-right font-semibold">Tokens in</th>
              <th className="px-2 py-1.5 text-right font-semibold">Tokens out</th>
              <th className="px-4 py-1.5 text-right font-semibold">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-line-soft tabular-nums">
                <td className="px-4 py-1.5 text-ink">{name(r.key)}</td>
                <td className="px-2 py-1.5 text-right">{r.calls}</td>
                <td className="px-2 py-1.5 text-right">{formatTokens(r.inputTokens)}</td>
                <td className="px-2 py-1.5 text-right">{formatTokens(r.outputTokens)}</td>
                <td className="px-4 py-1.5 text-right text-ink-2">
                  {r.declaredCostUsd > 0 ? `$${r.declaredCostUsd.toFixed(2)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const secs = (ms: number | null): string => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const avg = (n: number | null): string => (n === null ? '—' : n.toFixed(1));

function StatsSection({ stats, catalogs }: { stats: StatsRow[]; catalogs: Catalog[] }) {
  if (stats.length === 0) return null;
  return (
    <section aria-labelledby="stats-title">
      <SectionTitle>
        <span id="stats-title">How each engine does</span>
      </SectionTitle>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line-soft bg-surface-2 text-left text-xs text-muted">
              <th className="px-4 py-2 font-semibold">Part</th>
              <th className="px-2 py-2 font-semibold">Engine</th>
              <th className="px-2 py-2 text-right font-semibold">Calls</th>
              <th className="px-2 py-2 font-semibold">Failed</th>
              <th className="px-2 py-2 text-right font-semibold">Avg time</th>
              <th className="px-2 py-2 text-right font-semibold">Avg tokens</th>
              <th className="px-2 py-2 text-right font-semibold">Questions/run</th>
              <th className="px-4 py-2 text-right font-semibold">Proposals/run</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr
                key={`${s.agent}|${s.provider}|${s.model}|${s.effort}`}
                className="border-b border-line-soft tabular-nums last:border-b-0"
              >
                <td className="px-4 py-1.5">{s.agent}</td>
                <td className="px-2 py-1.5 text-ink-2">{engineLabel(s, catalogs)}</td>
                <td className="px-2 py-1.5 text-right">{s.calls}</td>
                <td className="px-2 py-1.5 text-xs text-problem">
                  {Object.entries(s.failures)
                    .map(([k, n]) => `${n} ${k.replace('_', ' ')}`)
                    .join(', ') || <span className="text-muted">—</span>}
                </td>
                <td className="px-2 py-1.5 text-right">{secs(s.avgDurationMs)}</td>
                <td className="px-2 py-1.5 text-right">{s.avgTokens === null ? '—' : formatTokens(Math.round(s.avgTokens))}</td>
                <td className="px-2 py-1.5 text-right">{avg(s.avgQuestions)}</td>
                <td className="px-4 py-1.5 text-right">{avg(s.avgProposals)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
