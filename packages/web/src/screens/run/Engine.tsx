// How a run was run (FDR-AGE-002): its agent and engine, the session with the provider, the
// normalized metrics (each with where it comes from), and every call to the provider with its events.

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { type RunCall, type RunUsage, providersQuery, runCallsQuery } from '../../api/models.ts';
import { type RunProgress, progressText } from '../../api/progress.ts';
import type { RunDetail } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { ChevronRight } from '../../ui/icons.tsx';
import { Skeleton } from '../../ui/layout.tsx';
import { engineLabel, formatTokens } from '../models/engines.ts';

const SESSION_WORDS: Record<string, string> = {
  none: 'None: the whole context',
  fresh: 'New conversation, whole context',
  resumed: 'Continued: only what was added',
};

const KIND_WORDS: Record<string, string> = {
  started: 'Started',
  thinking: 'Thinking',
  message: 'Wrote',
  usage: 'Counted usage',
  result: 'Answered',
  error: 'Error',
};

/** The facts of the run's engine, for the side panel. */
export function EngineFacts({ run: r, Fact }: { run: RunDetail; Fact: (p: { term: string; children: ReactNode }) => ReactNode }) {
  const catalogs = useQuery(providersQuery).data?.catalogs ?? [];
  const [agent, version] = r.method.split('@');
  const engine = r.requested_model ? { provider: r.provider, model: r.requested_model, effort: r.effort ?? null } : null;
  return (
    <>
      <Fact term="Agent">
        <span className="font-mono text-[12px]">
          {r.agent ?? agent}
          {version && <span className="text-muted">@{version}</span>}
        </span>
      </Fact>
      <Fact term="Engine">{engine ? engineLabel(engine, catalogs) : r.provider}</Fact>
      <Fact term="Answered by">{r.model ?? <span className="text-muted">Not known yet</span>}</Fact>
      {r.session_mode && <Fact term="Conversation">{SESSION_WORDS[r.session_mode] ?? r.session_mode}</Fact>}
      {r.prompt_hash && (
        <Fact term="Prompt">
          <span className="font-mono text-[12px]" title="Fingerprint of the agent's system prompt">
            {r.prompt_hash}
          </span>
        </Fact>
      )}
    </>
  );
}

/** Tokens and cost, each with its provenance on hover. */
export function UsageFacts({
  usage: u,
  Fact,
}: {
  usage: RunUsage;
  Fact: (p: { term: string; children: ReactNode }) => ReactNode;
}) {
  const from = (field: string) => u.provenance?.[field] ?? 'not reported';
  return (
    <>
      <Fact term="Tokens in">
        <span className="tabular-nums" title={`From ${from('inputTokens')}`}>
          {formatTokens(u.inputTokens)}
          {u.cachedInputTokens ? <span className="text-muted"> · {formatTokens(u.cachedInputTokens)} cached</span> : null}
        </span>
      </Fact>
      <Fact term="Tokens out">
        <span className="tabular-nums" title={`From ${from('outputTokens')}`}>
          {formatTokens(u.outputTokens)}
          {u.reasoningTokens ? <span className="text-muted"> · {formatTokens(u.reasoningTokens)} thinking</span> : null}
        </span>
      </Fact>
      {u.turns ? <Fact term="Turns">{u.turns}</Fact> : null}
      {u.declaredCostUsd ? (
        <Fact term="Cost">
          <span className="tabular-nums" title={`From ${from('declaredCostUsd')}`}>
            ${u.declaredCostUsd.toFixed(4)}
          </span>
        </Fact>
      ) : null}
    </>
  );
}

/** «Thinking… 1,240 tokens · 0:12» while the provider works. */
export function LiveProgress({ progress, now }: { progress: RunProgress | undefined; now: number }) {
  if (!progress) return null;
  return (
    <span data-run-progress className="text-[13px] font-medium tabular-nums">
      {progressText(progress, now)}
    </span>
  );
}

function offset(call: RunCall, at: string): string {
  const s = Math.max(0, (new Date(at).getTime() - new Date(call.started_at).getTime()) / 1000);
  return `+${s.toFixed(1)} s`;
}

/** Each call to the provider (a run can take more than one), with its events in order. */
export function CallsSection({ projectId, runId, active }: { projectId: string; runId: string; active: boolean }) {
  const calls = useQuery({ ...runCallsQuery(projectId, runId), refetchInterval: active ? 2000 : false });
  const catalogs = useQuery(providersQuery).data?.catalogs ?? [];
  if (calls.isPending) return <Skeleton className="h-24 w-full" />;
  const list = calls.data ?? [];
  if (list.length === 0) return null;
  return (
    <section data-run-calls aria-labelledby="run-calls" className="rounded-[var(--radius-card)] border border-line bg-surface">
      <header className="flex items-baseline justify-between gap-3 border-b border-line-soft px-5 py-3">
        <h2 id="run-calls" className="text-[15px] font-semibold">
          What the engine did
        </h2>
        <span className="text-xs text-muted">Every event as it arrived</span>
      </header>
      <ol className="flex flex-col">
        {list.map((c, i) => (
          <li key={c.id} className="border-b border-line-soft px-5 py-3 last:border-b-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
              <span className="font-semibold text-ink">{list.length > 1 ? `Call ${i + 1}` : 'Call'}</span>
              <span className="text-ink-2">
                {engineLabel({ provider: c.provider, model: c.requested_model, effort: c.effort }, catalogs)}
              </span>
              <span className="text-muted">{SESSION_WORDS[c.session_mode]}</span>
              <span
                className={cn(
                  'ml-auto text-xs font-semibold',
                  c.state === 'error' ? 'text-problem' : c.state === 'running' ? 'text-working-text' : 'text-ink-2',
                )}
              >
                {c.state === 'error'
                  ? (c.failure_kind ?? 'failed').replace('_', ' ')
                  : c.state === 'running'
                    ? 'working'
                    : 'answered'}
              </span>
            </div>
            {c.error && <p className="mt-1 text-[13px] text-problem">{c.error}</p>}
            <ol className="mt-2 flex flex-col gap-1 border-l border-line pl-3">
              {c.events.map((e) => (
                <li key={e.seq} className="flex items-baseline gap-2 text-[12px]">
                  <span className="w-14 shrink-0 font-mono text-muted tabular-nums">{offset(c, e.received_at)}</span>
                  <span className={cn('font-semibold', e.kind === 'error' ? 'text-problem' : 'text-ink')}>
                    {KIND_WORDS[e.kind] ?? e.kind}
                  </span>
                  {e.tokens !== null && <span className="text-muted tabular-nums">{formatTokens(e.tokens)} tokens</span>}
                </li>
              ))}
            </ol>
            <details className="group mt-2">
              <summary className="cursor-pointer list-none text-xs font-semibold text-ink-2 hover:text-ink">
                <span className="inline-flex items-center gap-1">
                  <ChevronRight size={11} className="transition-transform group-open:rotate-90" />
                  Raw events
                </span>
              </summary>
              <pre className="mt-2 max-h-[320px] overflow-auto rounded-md bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-ink-2">
                {c.events.map((e) => e.raw).join('\n')}
              </pre>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
