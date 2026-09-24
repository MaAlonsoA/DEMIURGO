// Knowledge (spec §4.10): the graph version and its freshness, the latest updates (a failed one
// can be retried), and five tabs: the graph by taxonomy area, search, idea checks, the taxonomy
// and the rebuild fingerprint. The tab lives in the URL (?tab=).

import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Tabs } from 'radix-ui';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { knowledgeQuery, stateQuery } from '../../api/queries.ts';
import type { Knowledge, KnowledgeUpdate } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { ago } from '../../lib/time.ts';
import { ActionBar } from '../../ui/ActionBar.tsx';
import { Page, PageTitle, Skeleton } from '../../ui/layout.tsx';
import { useLegendMark } from '../../ui/legend-store.ts';
import { StateMark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { GraphTab } from './GraphTab.tsx';
import { type Freshness, describeTrigger, freshnessOf } from './graph.ts';
import { IdeaChecksTab } from './IdeaChecksTab.tsx';
import { RebuildTab } from './RebuildTab.tsx';
import { SearchTab } from './SearchTab.tsx';
import { TaxonomyTab } from './TaxonomyTab.tsx';

const TABS = [
  { value: 'graph', label: 'Graph' },
  { value: 'search', label: 'Search' },
  { value: 'ideas', label: 'Idea checks' },
  { value: 'taxonomy', label: 'Taxonomy' },
  { value: 'rebuild', label: 'Rebuild' },
] as const;

export type KnowledgeTab = (typeof TABS)[number]['value'];

export function KnowledgeScreen() {
  const projectId = useProjectId();
  const search = useSearch({ strict: false }) as { tab?: string };
  const tab: KnowledgeTab = TABS.find((t) => t.value === search.tab)?.value ?? 'graph';
  const navigate = useNavigate();
  const knowledge = useQuery(knowledgeQuery(projectId));
  const show = (value: string) =>
    void navigate({ to: '/p/$projectId/knowledge', params: { projectId }, search: value === 'graph' ? {} : { tab: value } });

  return (
    <Page aside={<LatestUpdates projectId={projectId} knowledge={knowledge.data} />}>
      <PageTitle
        title="Knowledge"
        subtitle={knowledge.data ? <FreshnessLine k={knowledge.data} /> : <Skeleton className="mt-1 h-4 w-96" />}
        className="mb-5"
      />
      <Tabs.Root value={tab} onValueChange={show}>
        <Tabs.List aria-label="Knowledge views" className="mb-6 flex gap-6 border-b border-line">
          {TABS.map((t) => (
            <Tabs.Trigger
              key={t.value}
              value={t.value}
              className="-mb-px border-b-2 border-transparent px-0.5 pb-2 text-[14px] font-medium text-muted hover:text-ink data-[state=active]:border-ink data-[state=active]:font-semibold data-[state=active]:text-ink"
            >
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="graph" className="outline-none">
          <GraphTab projectId={projectId} onTaxonomy={() => show('taxonomy')} />
        </Tabs.Content>
        <Tabs.Content value="search" className="outline-none">
          <SearchTab projectId={projectId} />
        </Tabs.Content>
        <Tabs.Content value="ideas" className="outline-none">
          <IdeaChecksTab projectId={projectId} />
        </Tabs.Content>
        <Tabs.Content value="taxonomy" className="outline-none">
          <TaxonomyTab projectId={projectId} />
        </Tabs.Content>
        <Tabs.Content value="rebuild" className="outline-none">
          <RebuildTab projectId={projectId} />
        </Tabs.Content>
      </Tabs.Root>
    </Page>
  );
}

const FRESHNESS_WORDS: Record<Freshness, string> = { current: 'Up to date', updating: 'Updating', behind: 'Behind' };

/** The dot of the header: ink when up to date, amber while updating, rust when an update failed. */
export function FreshnessDot({ state }: { state: Freshness }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        state === 'current' && 'bg-ink',
        state === 'updating' && 'animate-pulse-soft bg-working shadow-[0_0_0_3px_var(--color-working-bg)]',
        state === 'behind' && 'bg-problem-fill',
      )}
    />
  );
}

function FreshnessLine({ k }: { k: Knowledge }) {
  const state = freshnessOf(k);
  const failed = k.updates.filter((u) => u.state === 'rejected').length;
  useLegendMark(state === 'updating' ? 'mark:working' : state === 'behind' ? 'mark:problem' : null);
  const parts = [
    state === 'updating' && `${k.updates_in_progress} ${k.updates_in_progress === 1 ? 'change' : 'changes'} to go`,
    state === 'behind' && `${failed} ${failed === 1 ? 'update' : 'updates'} failed`,
    `Graph version ${k.graph_version}`,
    `${k.current_nodes} nodes`,
    `${k.current_edges} relations`,
  ].filter((p): p is string => typeof p === 'string');
  return (
    <p data-knowledge-freshness={state} className="flex flex-wrap items-center gap-x-2 text-[14px] text-ink-2">
      <FreshnessDot state={state} />
      <strong
        className={cn(
          'font-semibold',
          state === 'current' && 'text-ink',
          state === 'updating' && 'text-working-text',
          state === 'behind' && 'text-problem',
        )}
      >
        {FRESHNESS_WORDS[state]}
      </strong>
      {parts.map((p) => (
        <span key={p} className="flex items-center gap-x-2">
          <span className="text-inactive" aria-hidden="true">
            ·
          </span>
          {p}
        </span>
      ))}
    </p>
  );
}

const SHOWN = 8;

function LatestUpdates({ projectId, knowledge }: { projectId: string; knowledge: Knowledge | undefined }) {
  const rows = useQuery(stateQuery(projectId)).data;
  const products = [...(rows?.decisions ?? []), ...(rows?.designs ?? [])];
  const [all, setAll] = useState(false);
  const updates = knowledge?.updates ?? [];
  // A failed update is always in view: it is the one that asks for something.
  const shown = all ? updates : updates.filter((u, i) => i < SHOWN || u.state === 'rejected');
  return (
    <section aria-labelledby="updates-title" className="flex flex-col gap-3">
      <div>
        <h2 id="updates-title" className="text-[15px] font-semibold">
          Latest updates
        </h2>
        <p className="mt-0.5 text-xs text-muted">What you approve, accept or discard updates what DEMIURGO knows.</p>
      </div>
      {!knowledge ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : updates.length === 0 ? (
        <p className="text-[13px] text-ink-3">Nothing has changed the knowledge yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft border-y border-line-soft">
          {shown.map((u) => (
            <UpdateRow key={u.id} projectId={projectId} update={u} what={describeTrigger(u.trigger, products)} />
          ))}
        </ul>
      )}
      {updates.length > shown.length || all ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="self-start text-xs font-semibold text-needs hover:text-needs-hover"
        >
          {all ? 'Show fewer' : `Show all ${updates.length}`}
        </button>
      ) : null}
    </section>
  );
}

function UpdateRow({ projectId, update: u, what }: { projectId: string; update: KnowledgeUpdate; what: string }) {
  const command = useCommand(projectId);
  const before = u.graph_version_before;
  const after = u.graph_version_after;
  return (
    <li className="flex flex-col gap-1 py-2.5" data-update={u.state}>
      <div className="flex items-center justify-between gap-2">
        <StateMark entity="knowledge_update" state={u.state} />
        <span className="text-xs text-muted">{ago(u.created_at)}</span>
      </div>
      <p className="text-[13px] text-ink">{what}</p>
      {before !== null && after !== null && before !== after && (
        <p className="font-mono text-[11px] text-muted">
          v{before} → v{after}
        </p>
      )}
      {u.state === 'rejected' && (
        <>
          {u.failure && <p className="text-[13px] text-problem">{u.failure}</p>}
          <ActionBar
            entity="knowledge_update"
            state={u.state}
            size="sm"
            className="mt-1"
            handlers={{
              'knowledge_update.retry': {
                variant: 'problem',
                disabled: command.isPending,
                run: () => command.mutate({ command: 'knowledge_update.retry', entityId: u.id }),
              },
            }}
          />
          {command.error ? <Reasons error={command.error} /> : null}
        </>
      )}
    </li>
  );
}
