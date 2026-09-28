// A small diagnostic reading from the operational run and calls. The evidence base remains outside
// the product: the trace id lets a person find the detailed spans in Phoenix when available.

import { useQuery } from '@tanstack/react-query';
import { runCallsQuery } from '../../api/models.ts';
import type { RunCall } from '../../api/models.ts';
import type { RunDetail } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { KeyValue, type KeyValueItem } from '../../components/Card.tsx';
import { Section } from '../../components/Page.tsx';
import { duration } from '../../lib/time.ts';

/** The configured viewer, or the sibling host of a deployed DEMIURGO. */
function phoenixUrl(): string | null {
  const configured = import.meta.env.VITE_PHOENIX_URL;
  if (configured) return configured;
  if (typeof window === 'undefined') return null;
  const { hostname, protocol } = window.location;
  if (hostname.startsWith('demiurgo.')) return `${protocol}//phoenix.${hostname.slice('demiurgo.'.length)}`;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://127.0.0.1:6006';
  return null;
}

export function elapsedMs(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
}

function time(ms: number | null): string {
  if (ms === null) return 'Not available yet';
  return ms < 1000 ? `${ms} ms` : duration(ms);
}

async function copy(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    announce(`${label} copied.`);
  } catch {
    announce(`Could not copy the ${label.toLowerCase()}.`);
  }
}

function latestCall(calls: readonly RunCall[]): RunCall | null {
  return [...calls].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0] ?? null;
}

export function RunDiagnostics({ projectId, run }: { projectId: string; run: RunDetail }) {
  const calls = useQuery(runCallsQuery(projectId, run.id)).data ?? [];
  const first = calls[0] ?? null;
  const last = latestCall(calls);
  const engineMs =
    calls.length > 0 && calls.every((c) => c.finished_at)
      ? calls.reduce((n, c) => n + (elapsedMs(c.started_at, c.finished_at) ?? 0), 0)
      : null;
  const conversationId = run.provider_session_id ?? last?.provider_session_id ?? null;
  const viewer = phoenixUrl();
  const items: KeyValueItem[] = [
    {
      key: 'trace',
      label: 'Trace ID',
      value: run.trace_id ? (
        <span className="flex flex-wrap items-center gap-1">
          <Code className="break-all">{run.trace_id}</Code>
          <Button size="sm" variant="quiet" onClick={() => void copy(run.trace_id as string, 'Trace ID')}>
            Copy
          </Button>
        </span>
      ) : (
        <span className="text-fg-3">No trace recorded</span>
      ),
      ...(run.trace_id && viewer
        ? {
            hint: (
              <a
                href={`${viewer.replace(/\/$/, '')}/redirects/traces/${run.trace_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: 'quiet', size: 'sm', className: 'mt-1' })}
              >
                Open trace in Phoenix
              </a>
            ),
          }
        : {}),
    },
    {
      key: 'conversation-id',
      label: 'Conversation ID',
      value: conversationId ? (
        <span className="flex flex-wrap items-center gap-1">
          <Code className="break-all">{conversationId}</Code>
          <Button size="sm" variant="quiet" onClick={() => void copy(conversationId, 'Conversation ID')}>
            Copy
          </Button>
        </span>
      ) : (
        <span className="text-fg-3">Not available yet</span>
      ),
      hint: 'The provider’s own conversation identifier, when it reports one.',
    },
    {
      key: 'wait',
      label: 'Before start',
      value: <span className="tabular-nums">{time(elapsedMs(run.created_at, run.started_at))}</span>,
    },
    {
      key: 'before-engine',
      label: 'Before first call',
      value: <span className="tabular-nums">{time(elapsedMs(run.started_at, first?.started_at))}</span>,
    },
    {
      key: 'engine-time',
      label: 'Engine calls',
      value: <span className="tabular-nums">{time(engineMs)}</span>,
      hint: 'Sum of all calls, including retries.',
    },
    {
      key: 'after-engine',
      label: 'After last call',
      value: <span className="tabular-nums">{time(elapsedMs(last?.finished_at, run.finished_at))}</span>,
    },
  ];
  return (
    <Section
      title="Diagnostics"
      id="run-diagnostics"
      note="Times come from the run and call records. They do not include every internal step."
    >
      <KeyValue items={items} />
    </Section>
  );
}
