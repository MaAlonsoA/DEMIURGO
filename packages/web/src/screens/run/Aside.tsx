// The side column of a run's page (DESIGN.md §3.4): its facts as a key-value list — the agent and
// engine, the conversation with the provider, the times and the usage — where every token and
// cost figure says where it comes from in visible text, not in a hover-only title (INVENTORY §2
// #13, R91); and its attempts, oldest first, each one a link (INV-RUN-17, R02).

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { providersQuery } from '../../api/models.ts';
import type { RunDetail, RunListItem } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { KeyValue, type KeyValueItem } from '../../components/Card.tsx';
import { Section } from '../../components/Page.tsx';
import { attemptOf } from '../../components/runState.tsx';
import { EntityState } from '../../components/status.tsx';
import { DayTime, useNow } from '../../components/Time.tsx';
import { ACTION_WORDS } from '../../words.ts';
import { engineLabel, formatTokens } from '../models/engines.ts';
import { SESSION_WORDS, attemptsOf, clockTime, runDuration } from './runs.ts';

/** "From the engine's usage report", or that it wasn't reported. */
function source(provenance: Record<string, string> | undefined, field: string): string {
  const from = provenance?.[field];
  return from ? `From ${from}` : 'Not reported by the engine';
}

export function RunFacts({ run: r, active }: { run: RunDetail; active: boolean }) {
  const catalogs = useQuery(providersQuery).data?.catalogs ?? [];
  const now = useNow(active);
  const [agent, version] = r.method.split('@');
  const engine = r.requested_model ? { provider: r.provider, model: r.requested_model, effort: r.effort ?? null } : null;
  const u = r.usage;
  const items: KeyValueItem[] = [
    {
      key: 'agent',
      label: 'Agent',
      value: (
        <Code className="text-sm text-fg">
          {r.agent ?? agent}
          {version ? <span className="text-fg-3">@{version}</span> : null}
        </Code>
      ),
    },
    { key: 'engine', label: 'Engine', value: engine ? engineLabel(engine, catalogs) : r.provider },
    { key: 'model', label: 'Answered by', value: r.model ?? <span className="text-fg-3">Not known yet</span> },
    ...(r.session_mode
      ? [{ key: 'session', label: 'Conversation', value: SESSION_WORDS[r.session_mode] ?? r.session_mode }]
      : []),
    ...(r.prompt_hash
      ? [
          {
            key: 'prompt',
            label: 'Prompt',
            value: <Code className="break-all">{r.prompt_hash}</Code>,
            hint: "Fingerprint of the agent's system prompt",
          },
        ]
      : []),
    { key: 'requested', label: 'Requested', value: <Clock iso={r.created_at} /> },
    ...(r.started_at ? [{ key: 'started', label: 'Started', value: <Clock iso={r.started_at} /> }] : []),
    ...(r.finished_at ? [{ key: 'finished', label: 'Finished', value: <Clock iso={r.finished_at} /> }] : []),
    {
      key: 'duration',
      label: 'Duration',
      value: <span className="tabular-nums">{runDuration(r, now) || '—'}</span>,
      ...(active ? { hint: 'Still counting' } : {}),
    },
    ...(u
      ? [
          {
            key: 'tokens-in',
            label: 'Tokens in',
            value: (
              <span className="tabular-nums">
                {formatTokens(u.inputTokens)}
                {u.cachedInputTokens ? <span className="text-fg-2"> · {formatTokens(u.cachedInputTokens)} cached</span> : null}
              </span>
            ),
            hint: source(u.provenance, 'inputTokens'),
          },
          {
            key: 'tokens-out',
            label: 'Tokens out',
            value: (
              <span className="tabular-nums">
                {formatTokens(u.outputTokens)}
                {u.reasoningTokens ? <span className="text-fg-2"> · {formatTokens(u.reasoningTokens)} thinking</span> : null}
              </span>
            ),
            hint: source(u.provenance, 'outputTokens'),
          },
          ...(u.turns ? [{ key: 'turns', label: 'Turns', value: <span className="tabular-nums">{u.turns}</span> }] : []),
          {
            key: 'cost',
            label: 'Cost',
            value: u.declaredCostUsd ? (
              <span className="tabular-nums">${u.declaredCostUsd.toFixed(4)}</span>
            ) : (
              <span className="text-fg-3">—</span>
            ),
            hint: u.declaredCostUsd ? source(u.provenance, 'declaredCostUsd') : 'The engine reported no cost',
          },
        ]
      : [{ key: 'usage', label: 'Usage', value: <span className="text-fg-3">Not reported yet</span> }]),
  ];
  return (
    <Section title="Details" id="run-details">
      <KeyValue items={items} />
    </Section>
  );
}

function Clock({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} className="tabular-nums">
      {clockTime(iso)}
    </time>
  );
}

/** Every attempt of the same work, oldest first; this run is marked, the others are links. */
export function Attempts({ projectId, run: r, runs }: { projectId: string; run: RunDetail; runs: RunListItem[] }) {
  type Attempt = Pick<RunListItem, 'id' | 'retry_of' | 'created_at' | 'state' | 'action'>;
  const known: Attempt[] = runs.some((x) => x.id === r.id) ? runs : [...runs, r];
  const chain = attemptsOf(r.id, known);
  if (chain.length < 2 && !r.retry_of) return null;
  const retries = new Set(runs.filter((x) => x.retry_of === r.id).map((x) => x.id));
  return (
    <Section title="Attempts" id="run-attempts" note="A retry is a new run on the same context. Oldest first.">
      <ol className="flex flex-col gap-1">
        {chain.map((x) => {
          const current = x.id === r.id;
          const body = (
            <>
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-fg">Attempt {attemptOf(x, known)}</span>
                <EntityState entity="ai_run" state={x.state} />
                {current ? <span className="text-xs font-medium text-accent-text">This run</span> : null}
              </span>
              <span className="text-xs text-fg-2">
                {ACTION_WORDS[x.action] ?? x.action} · <DayTime iso={x.created_at} />
              </span>
            </>
          );
          const row = 'flex min-h-10 flex-col justify-center gap-0.5 rounded-md border px-2.5 py-1.5 text-sm';
          return (
            <li
              key={x.id}
              {...(x.id === r.retry_of ? { 'data-run-retry-of': '' } : {})}
              {...(retries.has(x.id) ? { 'data-run-retries': '' } : {})}
            >
              {current ? (
                <span aria-current="true" className={`${row} border-accent-edge bg-accent-soft`}>
                  {body}
                </span>
              ) : (
                <Link
                  to="/p/$projectId/runs/$runId"
                  params={{ projectId, runId: x.id }}
                  className={`${row} border-transparent hover:bg-hover`}
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      {r.retry_of && !runs.some((x) => x.id === r.retry_of) ? (
        <p data-run-retry-of className="text-sm text-fg-2">
          It retries a run that is no longer in the latest runs:{' '}
          <Link
            to="/p/$projectId/runs/$runId"
            params={{ projectId, runId: r.retry_of }}
            className="font-medium text-accent-text hover:underline"
          >
            open the run it retries
          </Link>
        </p>
      ) : null}
    </Section>
  );
}
