// The detail of a run under its summary (DESIGN.md §3.4, R16 R05 R08): four tabs — Engine calls,
// Context (what DEMIURGO was given, readable first, the raw JSON behind a disclosure), Output
// (what it answered, the same way) and Events (the run's life in the journal, as a timeline, R37).
// Raw data is one click away, never the first thing (INVENTORY §2 #13).

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { explorationsQuery } from '../../api/queries.ts';
import type { ContextPack, Dependency, EventRow, RunDetail } from '../../api/types.ts';
import { Code, Tag } from '../../components/Badge.tsx';
import { KeyValue, Timeline } from '../../components/Card.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import {
  CheckCircleIcon,
  ChevronRightIcon,
  CircleDotIcon,
  MinusCircleIcon,
  PlayIcon,
  XCircleIcon,
} from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { TabPanel, Tabs } from '../../components/Tabs.tsx';
import { Who } from '../../components/Who.tsx';
import { runCallsQuery } from '../../api/models.ts';
import { type Translation, useMessages } from '../../i18n/define.ts';
import { CallsPanel } from './Engine.tsx';
import { runEventsQuery } from './hooks.ts';
import { Facts, RawJson, ReadableValue, humanize } from './Readable.tsx';
import { EVENT_WORDS, clockTime } from './runs.ts';
import { DETAIL } from './words.i18n.ts';

type TabKey = 'calls' | 'context' | 'output' | 'events';

export function RunDetailTabs({ projectId, run: r, active }: { projectId: string; run: RunDetail; active: boolean }) {
  const t = useMessages(DETAIL);
  const [tab, setTab] = useState<TabKey>('calls');
  const calls = useQuery(runCallsQuery(projectId, r.id)).data;
  const events = useQuery(runEventsQuery(projectId, r)).data;
  return (
    <Tabs
      label={t.aboutRun}
      value={tab}
      onChange={(v) => setTab(v as TabKey)}
      tabs={[
        { value: 'calls', label: t.engineCalls, ...(calls ? { count: calls.length } : {}) },
        { value: 'context', label: t.context },
        { value: 'output', label: t.output },
        { value: 'events', label: t.events, ...(events ? { count: events.length } : {}) },
      ]}
    >
      <TabPanel value="calls">
        <CallsPanel projectId={projectId} runId={r.id} active={active} />
      </TabPanel>
      <TabPanel value="context">
        <ContextPanel projectId={projectId} pack={r.context_pack} />
      </TabPanel>
      <TabPanel value="output">
        <OutputPanel run={r} active={active} />
      </TabPanel>
      <TabPanel value="events">
        <EventsPanel projectId={projectId} run={r} />
      </TabPanel>
    </Tabs>
  );
}

/** What DEMIURGO was given: the context pack a retry reuses as it is. */
function ContextPanel({ projectId, pack }: { projectId: string; pack: ContextPack | null }) {
  const t = useMessages(DETAIL);
  const threads = useQuery(explorationsQuery(projectId)).data;
  if (!pack)
    return (
      <EmptyState title={t.noContextTitle} headingLevel={3}>
        {t.noContextBody}
      </EmptyState>
    );
  const budget = Object.entries(pack.budget ?? {});
  return (
    <div data-context className="flex flex-col gap-5">
      <p className="text-base text-fg-2">{t.contextIntro}</p>
      <KeyValue
        items={[
          { key: 'role', label: t.role, value: pack.role },
          { key: 'builder', label: t.builder, value: <Code className="text-sm text-fg">{pack.builder}</Code> },
          {
            key: 'budget',
            label: t.budget,
            value:
              budget.length === 0 ? (
                <span className="text-fg-3">{t.none}</span>
              ) : (
                <span className="flex flex-wrap gap-1.5">
                  {budget.map(([k, v]) => (
                    <Tag key={k}>
                      {humanize(k)} {typeof v === 'number' ? v.toLocaleString('en-GB') : String(v)}
                    </Tag>
                  ))}
                </span>
              ),
          },
          { key: 'graph', label: t.graphVersion, value: <span className="tabular-nums">v{pack.graph_version}</span> },
          {
            key: 'dependencies',
            label: t.dependencies,
            value:
              pack.dependencies.length === 0 ? (
                <span className="text-fg-3">{t.none}</span>
              ) : (
                <ul className="flex flex-col gap-1">
                  {pack.dependencies.map((d, i) => (
                    <li key={`${d.type}-${d.id}-${i}`} className="flex min-w-0 items-baseline gap-2">
                      <span className="w-24 shrink-0 text-sm text-fg-3">{dependencyWord(t, d.type)}</span>
                      <DependencyName projectId={projectId} dependency={d} threads={threads} />
                    </li>
                  ))}
                </ul>
              ),
          },
          {
            key: 'hash',
            label: t.hash,
            value: (
              <code data-context-hash className="font-code text-xs break-all text-fg">
                {pack.hash}
              </code>
            ),
            hint: t.hashHint,
          },
        ]}
      />
      <details data-context-content className="group rounded-lg border border-edge">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-4 py-2 text-base font-medium text-fg hover:bg-hover [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon size={14} className="shrink-0 text-fg-2 transition-transform group-open:rotate-90" />
          {t.whatItRead}
        </summary>
        <div className="flex flex-col gap-4 border-t border-edge px-4 py-4">
          {isObject(pack.content) ? <Facts object={pack.content} /> : <ReadableValue value={pack.content} />}
          <RawJson value={pack.content} />
        </div>
      </details>
    </div>
  );
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function dependencyWord(t: Translation<typeof DETAIL.en>, type: string): string {
  const words: Record<string, string> = {
    exploration: t.dependencyThread,
    record: t.dependencyRecord,
    record_version: t.dependencyRecord,
    knowledge_node: t.dependencyKnowledge,
    source: t.dependencySource,
  };
  return words[type] ?? humanize(type);
}

function DependencyName({
  projectId,
  dependency: d,
  threads,
}: {
  projectId: string;
  dependency: Dependency;
  threads: { id: string; purpose: string }[] | undefined;
}) {
  const version = d.version !== null && d.version !== undefined ? ` v${d.version}` : '';
  const link = 'min-w-0 truncate text-fg underline decoration-edge-strong underline-offset-2 hover:decoration-fg';
  if (d.type === 'exploration') {
    const t = threads?.find((x) => x.id === d.id);
    if (t)
      return (
        <Link to="/p/$projectId/threads/$explorationId" params={{ projectId, explorationId: t.id }} className={link}>
          {t.purpose}
        </Link>
      );
  }
  if (d.code)
    return (
      <Link to="/p/$projectId/records/$code" params={{ projectId, code: d.code }} className={`${link} font-code text-sm`}>
        {d.code}
        {version}
      </Link>
    );
  return (
    <span className="min-w-0 truncate font-code text-xs text-fg-2">
      {d.id}
      {version}
    </span>
  );
}

/** What it answered: readable first, the JSON behind a disclosure. */
function OutputPanel({ run: r, active }: { run: RunDetail; active: boolean }) {
  const t = useMessages(DETAIL);
  if (r.output === null || r.output === undefined) {
    if (active)
      return (
        <EmptyState title={t.noAnswerYetTitle} headingLevel={3}>
          {t.noAnswerYetBody}
        </EmptyState>
      );
    return (
      <EmptyState title={t.noAnswerKeptTitle} headingLevel={3}>
        {r.state === 'completed' ? t.finishedNoAnswer : t.stoppedNoAnswer}
      </EmptyState>
    );
  }
  return (
    <div data-run-output className="flex flex-col gap-4">
      <p className="text-base text-fg-2">{t.outputIntro}</p>
      {isObject(r.output) ? <Facts object={r.output} /> : <ReadableValue value={r.output} />}
      <RawJson value={r.output} />
    </div>
  );
}

function eventIcon(command: string) {
  if (command === 'run.complete') return <CheckCircleIcon size={14} className="text-success-text" />;
  if (command === 'run.fail' || command === 'run.interrupt') return <XCircleIcon size={14} className="text-danger-text" />;
  if (command === 'run.cancel') return <MinusCircleIcon size={14} />;
  if (command === 'run.begin') return <PlayIcon size={12} />;
  return <CircleDotIcon size={14} />;
}

/** The run's life in the journal: its own events, those it caused, and its context pack's. */
function EventsPanel({ projectId, run: r }: { projectId: string; run: RunDetail }) {
  const t = useMessages(DETAIL);
  const events = useQuery(runEventsQuery(projectId, r));
  if (events.isPending) return <RowsSkeleton label={t.loadingEvents} rows={4} />;
  if (events.error && !events.data) return <ErrorNotice error={events.error} onRetry={() => void events.refetch()} />;
  const list: EventRow[] = events.data ?? [];
  if (list.length === 0)
    return (
      <EmptyState title={t.noEventsTitle} headingLevel={3}>
        {t.noEventsBody}
      </EmptyState>
    );
  return (
    <div data-run-events>
      <Timeline
        label={t.eventsLabel}
        items={list.map((e) => ({
          key: e.id,
          icon: eventIcon(e.command),
          body: (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{EVENT_WORDS[e.command] ?? e.command}</span>
              <Who actor={e.actor} size={16} className="text-sm text-fg-2" />
            </span>
          ),
          meta: (
            <>
              <time dateTime={e.at} className="tabular-nums">
                {clockTime(e.at)}
              </time>
              <span className="font-code"> · {e.command}</span>
            </>
          ),
        }))}
      />
    </div>
  );
}
