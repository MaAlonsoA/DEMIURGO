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
import { useMessages } from '../../i18n/define.ts';
import { duration } from '../../lib/time.ts';
import { DIAGNOSTICS } from './words.i18n.ts';

type Words = (typeof DIAGNOSTICS)['en'];

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

function time(ms: number | null, t: Words): string {
  if (ms === null) return t.notYet;
  return ms < 1000 ? `${ms} ms` : duration(ms);
}

async function copy(value: string, label: string, t: Words): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    announce(t.copied(label));
  } catch {
    announce(t.couldNotCopy(label));
  }
}

function latestCall(calls: readonly RunCall[]): RunCall | null {
  return [...calls].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0] ?? null;
}

export function RunDiagnostics({ projectId, run }: { projectId: string; run: RunDetail }) {
  const t = useMessages(DIAGNOSTICS);
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
      label: t.traceId,
      value: run.trace_id ? (
        <span className="flex flex-wrap items-center gap-1">
          <Code className="break-all">{run.trace_id}</Code>
          <Button size="sm" variant="quiet" onClick={() => void copy(run.trace_id as string, t.traceId, t)}>
            {t.copy}
          </Button>
        </span>
      ) : (
        <span className="text-fg-3">{t.noTrace}</span>
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
                {t.openTrace}
              </a>
            ),
          }
        : {}),
    },
    {
      key: 'conversation-id',
      label: t.conversationId,
      value: conversationId ? (
        <span className="flex flex-wrap items-center gap-1">
          <Code className="break-all">{conversationId}</Code>
          <Button size="sm" variant="quiet" onClick={() => void copy(conversationId, t.conversationId, t)}>
            {t.copy}
          </Button>
        </span>
      ) : (
        <span className="text-fg-3">{t.notYet}</span>
      ),
      hint: t.conversationHint,
    },
    {
      key: 'wait',
      label: t.beforeStart,
      value: <span className="tabular-nums">{time(elapsedMs(run.created_at, run.started_at), t)}</span>,
    },
    {
      key: 'before-engine',
      label: t.beforeFirstCall,
      value: <span className="tabular-nums">{time(elapsedMs(run.started_at, first?.started_at), t)}</span>,
    },
    {
      key: 'engine-time',
      label: t.engineCalls,
      value: <span className="tabular-nums">{time(engineMs, t)}</span>,
      hint: t.engineCallsHint,
    },
    {
      key: 'after-engine',
      label: t.afterLastCall,
      value: <span className="tabular-nums">{time(elapsedMs(last?.finished_at, run.finished_at), t)}</span>,
    },
  ];
  return (
    <Section title={t.title} id="run-diagnostics" note={t.note}>
      <KeyValue items={items} />
    </Section>
  );
}
