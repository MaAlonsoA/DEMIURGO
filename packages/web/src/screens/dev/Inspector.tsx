// The dev inspector, only when the API runs with DEMIURGO_DEV_TOOLS=1: Alt+click anything that names
// an entity (a message, a question, a proposal, a run, a section of the product definition) and a
// side sheet shows where it comes from, its raw data with its events, and which agent contexts read
// it. It is there to check, inside the app, that what a screen shows is what was really decided.
// Not product UI: sober, a document, no decoration.

import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
import { traceQuery } from '../../api/dev.ts';
import { sessionQuery } from '../../api/queries.ts';
import { Button } from '../../components/Button.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PreviewSheet } from '../../components/Preview.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { useMessages } from '../../i18n/define.ts';
import { dayTime } from '../../lib/time.ts';
import { useSafeLocale } from '../../words.ts';
import { hasDevTools } from './snapshots.ts';
import {
  type Trace,
  type TraceStep,
  type TraceTarget,
  projectOfPath,
  rowText,
  stateChange,
  traceTargetOf,
  traceableStep,
} from './trace.ts';
import { INSPECTOR } from './words.i18n.ts';

type Words = (typeof INSPECTOR)['en'];

export function Inspector() {
  const session = useQuery(sessionQuery);
  return hasDevTools(session.data) ? <Listener /> : null;
}

function Listener() {
  const t = useMessages(INSPECTOR);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const project = projectOfPath(pathname);
  // What was traced, in order: tracing a step of the origin goes deeper; Back returns.
  const [stack, setStack] = useState<TraceTarget[]>([]);

  useEffect(() => {
    if (!project) return;
    const onClick = (e: MouseEvent) => {
      if (!e.altKey) return;
      const target = traceTargetOf(e.target instanceof Element ? e.target : null);
      if (!target) return;
      // Before the app sees it: an Alt+click on a link would otherwise download or navigate.
      e.preventDefault();
      e.stopPropagation();
      setStack([target]);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [project]);

  const current = stack.at(-1);
  if (!project) return null;
  return (
    <PreviewSheet
      open={current !== undefined}
      onOpenChange={(open) => {
        if (!open) setStack([]);
      }}
      label={t.sheetLabel}
      title={current ? `${t[current.type]} ${current.id.slice(0, 8)}` : ''}
      eyebrow={current ? <span className="font-code text-xs text-fg-3">{current.id}</span> : null}
      footer={
        stack.length > 1 ? (
          <Button size="sm" onClick={() => setStack((s) => s.slice(0, -1))}>
            {t.back}
          </Button>
        ) : null
      }
    >
      {current ? <TraceBody project={project} target={current} onTrace={(next) => setStack((s) => [...s, next])} /> : null}
    </PreviewSheet>
  );
}

function TraceBody({ project, target, onTrace }: { project: string; target: TraceTarget; onTrace: (t: TraceTarget) => void }) {
  const t = useMessages(INSPECTOR);
  const trace = useQuery(traceQuery(project, target.type, target.id));
  if (trace.isPending) return <RowsSkeleton label={t.loading} rows={4} />;
  if (trace.error) return <ErrorNotice error={trace.error} onRetry={() => void trace.refetch()} />;
  return (
    <div className="flex flex-col gap-6" data-trace-of={`${target.type}:${target.id}`}>
      <Origin trace={trace.data} words={t} onTrace={onTrace} />
      <Data trace={trace.data} words={t} />
      <ReadBy trace={trace.data} words={t} />
    </div>
  );
}

function Heading({ id, children }: { id: string; children: string }) {
  return (
    <h3 id={id} className="text-base font-semibold text-fg">
      {children}
    </h3>
  );
}

function Origin({ trace, words: t, onTrace }: { trace: Trace; words: Words; onTrace: (t: TraceTarget) => void }) {
  const id = useId();
  const locale = useSafeLocale();
  // The first step is the entity itself: the chain is what comes before it.
  const steps = trace.origin.slice(1);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <Heading id={id}>{t.origin}</Heading>
      {steps.length === 0 ? (
        <p className="text-sm text-fg-2">{t.noOrigin}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-edge-subtle">
          {steps.map((s, i) => (
            <li
              key={`${s.type}:${s.id}:${i}`}
              data-trace-step={s.type}
              className="flex flex-col gap-0.5 py-2"
              style={{ paddingLeft: Math.max(0, s.depth - 1) * 16 }}
            >
              <StepTitle step={s} words={t} onTrace={onTrace} />
              <span className="text-xs text-fg-3">
                {[s.actor, s.at ? dayTime(s.at, undefined, locale) : null].filter(Boolean).join(' · ')}
              </span>
              {s.detail ? <span className="text-sm text-fg-2">{s.detail}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StepTitle({ step, words: t, onTrace }: { step: TraceStep; words: Words; onTrace: (t: TraceTarget) => void }) {
  const target = traceableStep(step);
  const kind = <span className="text-xs font-medium text-fg-3">{t[step.type]}</span>;
  if (!target)
    return (
      <span className="flex flex-col text-sm text-fg">
        {kind}
        {step.label}
      </span>
    );
  return (
    <span className="flex flex-col text-sm">
      {kind}
      <button
        type="button"
        aria-label={t.traceStep(step.label)}
        onClick={() => onTrace(target)}
        className="cursor-pointer self-start text-left text-accent-text hover:underline"
      >
        {step.label}
      </button>
    </span>
  );
}

function Data({ trace, words: t }: { trace: Trace; words: Words }) {
  const id = useId();
  const locale = useSafeLocale();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <Heading id={id}>{t.data}</Heading>
      <details>
        <summary className="cursor-pointer text-sm text-fg-2">{t.row}</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-sunken p-3 font-code text-xs leading-5 text-fg">
          {rowText(trace.entity.row)}
        </pre>
      </details>
      <p className="text-sm font-medium text-fg">{t.events(trace.events.length)}</p>
      {trace.events.length === 0 ? (
        <p className="text-sm text-fg-2">{t.noEvents}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-edge-subtle">
          {trace.events.map((e) => {
            const change = stateChange(e);
            return (
              <li key={e.seq} className="flex flex-col gap-0.5 py-1.5">
                <span className="text-sm text-fg">
                  <span className="font-code text-xs text-fg-3">#{e.seq}</span> <span className="font-code">{e.command}</span>
                  {change ? <span className="text-fg-2"> · {change}</span> : null}
                </span>
                <span className="text-xs text-fg-3">
                  {e.actor} · {dayTime(e.at, undefined, locale)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function ReadBy({ trace, words: t }: { trace: Trace; words: Words }) {
  const id = useId();
  const locale = useSafeLocale();
  const { tracked, packs } = trace.read_by;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <Heading id={id}>{t.readBy}</Heading>
      {!tracked ? (
        <p className="text-sm text-fg-2">{t.notTracked}</p>
      ) : packs.length === 0 ? (
        <p className="text-sm text-fg-2">{t.nobodyRead}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-edge-subtle">
          {packs.map((p) => (
            <li key={p.pack_id} data-pack={p.pack_id} className="flex flex-col gap-0.5 py-1.5">
              <span className="text-sm text-fg">
                {t.pack(p.role)}
                {p.version !== null ? <span className="text-fg-2"> · {t.readsVersion(p.version)}</span> : null}
              </span>
              <span className="text-xs text-fg-3">
                {dayTime(p.created_at, undefined, locale)} ·{' '}
                {p.runs.length === 0 ? t.noRuns : p.runs.map((r) => `${r.action} (${r.state})`).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
