// What the project's agents consumed (observability): per agent, calls, failures, tokens, the cost
// the provider declares and the average duration. Consumption is only shown: there are no limits.

import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { usageQuery } from '../../api/queries.ts';

const n = (v: number) => v.toLocaleString('en');
const usd = (v: number) => (v > 0 ? `$${v.toFixed(2)}` : '—');
const secs = (ms: number | null) => (ms === null ? '—' : `${Math.round(ms / 1000)} s`);

export function ProjectUsage({ projectId }: { projectId: string }) {
  const id = useId();
  const rows = useQuery(usageQuery(projectId)).data;
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
    <section aria-labelledby={id} data-project-usage className="mb-6 flex flex-col gap-2">
      <h2 id={id} className="dm-text-caption font-semibold text-muted">
        Usage · {n(total.calls)} calls · {n(total.failures)} failed · {n(total.tokens)} tokens · {usd(total.cost)}
      </h2>
      <div className="overflow-hidden rounded-card-md border border-line bg-surface">
        <table className="dm-text-small w-full border-collapse text-left">
          <thead>
            <tr className="dm-label border-b border-line">
              <th scope="col" className="py-2 pr-4 pl-5 font-semibold">
                Agent
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Calls
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Failed
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Tokens in / out
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Cost
              </th>
              <th scope="col" className="py-2 pr-5 pl-4 text-right font-semibold">
                Avg time
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.agent} className="border-b border-line last:border-b-0">
                <td className="py-2 pr-4 pl-5 font-semibold">{r.agent}</td>
                <td className="px-4 py-2 text-right">{n(r.calls)}</td>
                <td className={r.failures > 0 ? 'px-4 py-2 text-right text-problem' : 'px-4 py-2 text-right text-ink-3'}>
                  {n(r.failures)}
                </td>
                <td className="px-4 py-2 text-right text-ink-2">
                  {n(r.inputTokens)} / {n(r.outputTokens)}
                </td>
                <td className="px-4 py-2 text-right text-ink-2">{usd(r.declaredCostUsd)}</td>
                <td className="py-2 pr-5 pl-4 text-right text-ink-2">{secs(r.avgDurationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
