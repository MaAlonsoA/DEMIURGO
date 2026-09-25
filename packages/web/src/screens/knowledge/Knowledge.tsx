// Knowledge (DESIGN.md §3.8, spec §4.10): what DEMIURGO derives from what the person decided. The
// header says its freshness in words ("Up to date", "Updating · 2 to go", "Behind · 1 failed") and
// the graph version; five APG tabs (Graph, Search, Idea checks, Taxonomy, Rebuild) live in ?tab=
// without piling history entries; the side column lists the latest updates, and a failed one can be
// retried where it is shown (INV-KNOW-01…05).

import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { knowledgeQuery, projectsQuery, stateQuery } from '../../api/queries.ts';
import type { Knowledge, KnowledgeUpdate } from '../../api/types.ts';
import { ActionBar } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { AlertCircleIcon, ChevronDownIcon, RetryIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, WithAside, usePageTitle } from '../../components/Page.tsx';
import { Bone, RowsSkeleton } from '../../components/Spinner.tsx';
import { EntityState, StatusBadge } from '../../components/status.tsx';
import { TabPanel, Tabs } from '../../components/Tabs.tsx';
import { RelativeTime } from '../../components/Time.tsx';
import { cn } from '../../lib/cn.ts';
import { useProjectId } from '../../lib/hooks.ts';
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
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  usePageTitle(['Knowledge', project?.name]);
  const search = useSearch({ strict: false }) as { tab?: string };
  const tab: KnowledgeTab = TABS.find((t) => t.value === search.tab)?.value ?? 'graph';
  const navigate = useNavigate();
  const knowledge = useQuery(knowledgeQuery(projectId));
  // A tab is a view of the same page: it replaces the URL, so Back leaves the page (not the tab).
  const show = (value: string) =>
    void navigate({
      to: '/p/$projectId/knowledge',
      params: { projectId },
      search: value === 'graph' ? {} : { tab: value },
      replace: true,
    });

  return (
    <>
      <PageHeader
        title="Knowledge"
        meta={knowledge.data ? <FreshnessLine k={knowledge.data} /> : knowledge.isPending ? <Bone className="h-4 w-80" /> : null}
      />
      <PageBody>
        <WithAside
          asideLabel="Updates"
          aside={
            <LatestUpdates projectId={projectId} knowledge={knowledge.data} error={knowledge.error} retry={knowledge.refetch} />
          }
        >
          <Tabs label="Knowledge views" value={tab} onChange={show} tabs={TABS.map((t) => ({ value: t.value, label: t.label }))}>
            <TabPanel value="graph">
              <GraphTab projectId={projectId} onTaxonomy={() => show('taxonomy')} />
            </TabPanel>
            <TabPanel value="search">
              <SearchTab projectId={projectId} />
            </TabPanel>
            <TabPanel value="ideas">
              <IdeaChecksTab projectId={projectId} />
            </TabPanel>
            <TabPanel value="taxonomy">
              <TaxonomyTab projectId={projectId} />
            </TabPanel>
            <TabPanel value="rebuild">
              <RebuildTab projectId={projectId} />
            </TabPanel>
          </Tabs>
        </WithAside>
      </PageBody>
    </>
  );
}

/** The freshness in words and the graph's size (INV-KNOW-02): "Behind · 1 failed · Graph v12 · …". */
function FreshnessLine({ k }: { k: Knowledge }) {
  const state = freshnessOf(k);
  const failed = k.updates.filter((u) => u.state === 'rejected').length;
  const badge: Record<Freshness, { kind: 'done' | 'working' | 'problem'; word: string; title: string }> = {
    current: { kind: 'done', word: 'Up to date', title: `Knowledge is up to date (version ${k.graph_version}).` },
    updating: {
      kind: 'working',
      word: `Updating · ${k.updates_in_progress} to go`,
      title: `DEMIURGO is updating its knowledge: ${k.updates_in_progress} ${k.updates_in_progress === 1 ? 'change' : 'changes'} to go.`,
    },
    behind: {
      kind: 'problem',
      word: `Behind · ${failed} failed`,
      title: `Knowledge is behind: ${failed} ${failed === 1 ? 'update' : 'updates'} failed. Retry it in Latest updates.`,
    },
  };
  const b = badge[state];
  return (
    <span data-knowledge-freshness={state} className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusBadge kind={b.kind} word={b.word} size="md" title={b.title} />
      <span className="tabular-nums">
        Graph v{k.graph_version} · {k.current_nodes} {k.current_nodes === 1 ? 'node' : 'nodes'} · {k.current_edges}{' '}
        {k.current_edges === 1 ? 'relation' : 'relations'}
      </span>
      {state === 'behind' ? <span className="text-danger-text">Retry the failed update in Latest updates.</span> : null}
    </span>
  );
}

const SHOWN = 8;

/** Latest updates (INV-KNOW-04, 05): the newest eight plus every failed one, which can be retried. */
function LatestUpdates({
  projectId,
  knowledge,
  error,
  retry,
}: {
  projectId: string;
  knowledge: Knowledge | undefined;
  error: unknown;
  retry: () => unknown;
}) {
  const rows = useQuery(stateQuery(projectId)).data;
  const products = [...(rows?.decisions ?? []), ...(rows?.designs ?? [])];
  const [all, setAll] = useState(false);
  const updates = knowledge?.updates ?? [];
  // A failed update is always in view: it is the one that asks for something.
  const shown = all ? updates : updates.filter((u, i) => i < SHOWN || u.state === 'rejected');
  return (
    <Section id="updates" title="Latest updates" note="What you approve, accept or discard updates what DEMIURGO knows.">
      {error && !knowledge ? (
        <ErrorNotice error={error} compact onRetry={() => void retry()} />
      ) : !knowledge ? (
        <RowsSkeleton label="Loading the latest updates" rows={3} />
      ) : updates.length === 0 ? (
        <p className="text-sm text-fg-2">Nothing has changed the knowledge yet.</p>
      ) : (
        <ul id="knowledge-updates" className="flex flex-col divide-y divide-edge-subtle border-y border-edge-subtle">
          {shown.map((u) => (
            <UpdateRow key={u.id} projectId={projectId} update={u} what={describeTrigger(u.trigger, products)} />
          ))}
        </ul>
      )}
      {updates.length > SHOWN ? (
        <Button
          size="sm"
          variant="quiet"
          aria-expanded={all}
          aria-controls="knowledge-updates"
          onClick={() => setAll((v) => !v)}
          trailing={<ChevronDownIcon size={14} className={cn('transition-transform', all && 'rotate-180')} />}
          className="self-start"
        >
          {all ? 'Show fewer' : `Show all ${updates.length}`}
        </Button>
      ) : null}
    </Section>
  );
}

function UpdateRow({ projectId, update: u, what }: { projectId: string; update: KnowledgeUpdate; what: string }) {
  const command = useCommand(projectId);
  const before = u.graph_version_before;
  const after = u.graph_version_after;
  const failed = u.state === 'rejected';
  return (
    <li className="flex flex-col gap-1 py-2.5" data-update={u.state}>
      <div className="flex items-center justify-between gap-2">
        <EntityState entity="knowledge_update" state={u.state} />
        <RelativeTime iso={u.created_at} className="text-xs text-fg-3" />
      </div>
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm text-fg">
        <span>{what}</span>
        {before !== null && after !== null && before !== after ? (
          <Code>
            v{before} → v{after}
          </Code>
        ) : null}
      </p>
      {failed ? (
        <>
          {u.failure ? (
            <p className="flex items-start gap-1.5 text-sm text-danger-text">
              <AlertCircleIcon size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{u.failure}</span>
            </p>
          ) : null}
          <ActionBar
            entity="knowledge_update"
            state={u.state}
            size="sm"
            handlers={{
              'knowledge_update.retry': {
                variant: 'secondary',
                icon: <RetryIcon size={14} />,
                pending: command.isPending,
                pendingLabel: 'Retrying…',
                run: () =>
                  command.mutate(
                    { command: 'knowledge_update.retry', entityId: u.id },
                    { onSuccess: () => announce(`${what}: sent to update again.`) },
                  ),
              },
            }}
          />
          {command.error ? <ErrorNotice error={command.error} compact /> : null}
        </>
      ) : null}
    </li>
  );
}
