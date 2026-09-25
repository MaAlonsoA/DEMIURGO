// What the project's agents have consumed (INV-ACT-02; DESIGN.md §3.4): a collapsible panel titled
// with its period — all time — that says it counts engine calls, not runs, with its totals always
// in view and the table per part of DEMIURGO on demand. It loads and fails on its own, inline,
// while the runs stay (DESIGN.md §5 "Partial data"). Only shown: there are no limits.

import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { agentsQuery } from '../../api/models.ts';
import { usageQuery } from '../../api/queries.ts';
import { Code } from '../../components/Badge.tsx';
import { ChevronDownIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { cn } from '../../lib/cn.ts';
import { agentSection } from '../models/engines.ts';

const n = (v: number) => v.toLocaleString('en-GB');
const usd = (v: number) => (v > 0 ? `$${v.toFixed(2)}` : '—');
const secs = (ms: number | null) => (ms === null ? '—' : `${Math.round(ms / 1000)} s`);

const th = 'px-3 py-2 text-xs font-medium text-fg-2 whitespace-nowrap';
const td = 'px-3 py-2 tabular-nums';

export function ProjectUsage({ projectId }: { projectId: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const usage = useQuery(usageQuery(projectId));
  const agents = useQuery(agentsQuery).data?.agents;
  const rows = usage.data;

  if (usage.isPending)
    return (
      <Skeleton label="Loading the usage">
        <Bone className="h-12 w-full rounded-lg" />
      </Skeleton>
    );
  if (usage.error && !rows) return <ErrorNotice error={usage.error} compact focus={false} onRetry={() => void usage.refetch()} />;
  if (!rows || rows.length === 0) return null;

  const total = rows.reduce(
    (t, r) => ({
      calls: t.calls + r.calls,
      failures: t.failures + r.failures,
      tokens: t.tokens + r.inputTokens + r.outputTokens,
      cost: t.cost + r.declaredCostUsd,
    }),
    { calls: 0, failures: 0, tokens: 0, cost: 0 },
  );
  return (
    <section aria-labelledby={`${id}-title`} data-project-usage className="rounded-lg border border-edge bg-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 flex-1 basis-72 flex-col gap-0.5">
          <h2 id={`${id}-title`} className="text-base font-semibold text-fg">
            Usage · All time
          </h2>
          <p className="text-sm text-fg-2">
            <span className="tabular-nums">{n(total.calls)}</span> engine calls ·{' '}
            <span className={cn('tabular-nums', total.failures > 0 && 'font-medium text-danger-text')}>{n(total.failures)}</span>{' '}
            failed · <span className="tabular-nums">{n(total.tokens)}</span> tokens ·{' '}
            {total.cost > 0 ? usd(total.cost) : 'no cost reported'}
          </p>
          <p className="text-xs text-fg-3">
            Counts engine calls, not runs: a run can call its engine more than once. Only shown: there are no limits.
          </p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-table`}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-edge-strong bg-panel px-3 text-sm font-medium text-fg hover:bg-hover"
        >
          {open ? 'Hide per part' : 'Show per part'}
          <ChevronDownIcon size={14} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a table that scrolls sideways must be reachable by keyboard */}
      <div
        id={`${id}-table`}
        hidden={!open}
        role="group"
        aria-label="Usage per part of DEMIURGO"
        tabIndex={0}
        className="overflow-x-auto rounded-b-lg border-t border-edge-subtle"
      >
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <caption className="sr-only">Usage per part of DEMIURGO, all time</caption>
          <thead>
            <tr className="border-b border-edge-subtle">
              <th scope="col" className={th}>
                Part of DEMIURGO
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Calls
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Failed
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Tokens in / out
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Cost
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Avg time
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const section = agentSection(r.agent, agents);
              return (
                <tr key={r.agent} className="border-b border-edge-subtle last:border-b-0">
                  <th scope="row" className="px-3 py-2 font-normal">
                    <span className="flex flex-col">
                      <span className="font-medium text-fg">{section}</span>
                      {section !== r.agent ? <Code className="text-fg-3">{r.agent}</Code> : null}
                    </span>
                  </th>
                  <td className={cn(td, 'text-right')}>{n(r.calls)}</td>
                  <td className={cn(td, 'text-right', r.failures > 0 ? 'font-medium text-danger-text' : 'text-fg-3')}>
                    {n(r.failures)}
                  </td>
                  <td className={cn(td, 'text-right text-fg-2')}>
                    {n(r.inputTokens)} / {n(r.outputTokens)}
                  </td>
                  <td className={cn(td, 'text-right text-fg-2')}>{usd(r.declaredCostUsd)}</td>
                  <td className={cn(td, 'text-right text-fg-2')}>{secs(r.avgDurationMs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
