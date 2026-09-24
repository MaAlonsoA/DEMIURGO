// The graph tab: current nodes grouped by the area of the approved taxonomy, each with its type
// and its mark; the invalidated ones greyed out. Pointing at a node (or focusing it) shows its
// relations in the peek; Enter or "Open" goes to its record.

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { graphQuery, taxonomiesQuery } from '../../api/queries.ts';
import type { GraphNode, KnowledgeGraph, Taxonomy } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { buttonStyles } from '../../ui/Button.tsx';
import { Code, Detail, Node } from '../../ui/Card.tsx';
import { TypeIcon } from '../../ui/icons.tsx';
import { EmptyState, Skeleton } from '../../ui/layout.tsx';
import { EpistemicMark, Mark } from '../../ui/marks.tsx';
import { Peek } from '../../ui/Peek.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { type AreaAxis, NODE_TYPES, areaAxis, groupByArea, groupRelations, nodeType, relationsOf } from './graph.ts';
import { parseAxes } from './taxonomy.ts';

export function GraphTab({ projectId, onTaxonomy }: { projectId: string; onTaxonomy: () => void }) {
  const graph = useQuery(graphQuery(projectId));
  const taxonomies = useQuery(taxonomiesQuery(projectId));
  const [filter, setFilter] = useState<string>('all');
  const axis = useMemo(() => areaAxis(taxonomies.data ?? []), [taxonomies.data]);
  const nodes = graph.data?.nodes ?? [];
  const shown = filter === 'all' ? nodes : nodes.filter((n) => n.type === filter);
  const groups = useMemo(() => groupByArea(shown, axis), [shown, axis]);

  if (graph.error || taxonomies.error) return <Reasons error={graph.error ?? taxonomies.error} />;
  if (graph.isPending || taxonomies.isPending) return <GraphSkeleton />;
  if (!graph.data || nodes.length === 0) {
    return (
      <EmptyState>
        The graph is empty. It grows as you approve decisions and designs, or accept what DEMIURGO proposes.
      </EmptyState>
    );
  }
  const counts = Object.keys(NODE_TYPES)
    .map((type) => ({ type, n: nodes.filter((x) => x.type === type).length }))
    .filter((c) => c.n > 0);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-2">
          {axis ? (
            <>
              Grouped by {axis.name} ({axis.taxonomy.code} v{axis.taxonomy.version})
            </>
          ) : (
            <>
              No taxonomy is approved yet, so nothing is classified.{' '}
              <button type="button" onClick={onTaxonomy} className="font-semibold text-needs hover:text-needs-hover">
                Open the taxonomy
              </button>
            </>
          )}
        </p>
        <div className="flex items-center gap-1 rounded-[var(--radius-control)] bg-line-soft p-[3px]">
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')} label="All" n={nodes.length} />
          {counts.map((c) => (
            <FilterButton
              key={c.type}
              active={filter === c.type}
              onClick={() => setFilter(c.type)}
              label={nodeType(c.type).plural}
              n={c.n}
            />
          ))}
        </div>
      </div>
      {groups.map((g) => (
        <section key={g.key || 'none'} aria-labelledby={`area-${g.key || 'none'}`}>
          <div className="mb-2.5 flex items-baseline gap-2">
            <h3 id={`area-${g.key || 'none'}`} className="text-[13px] font-semibold text-ink">
              {g.name}
            </h3>
            <span className="text-xs text-muted tabular-nums">{g.nodes.length}</span>
            {g.description && <span className="truncate text-xs text-muted">· {g.description}</span>}
          </div>
          <ul className="grid grid-cols-3 gap-2">
            {g.nodes.map((n) => (
              <li key={n.ref}>
                <GraphNodeCard projectId={projectId} node={n} graph={graph.data} axis={axis} taxonomies={taxonomies.data ?? []} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function FilterButton({ active, onClick, label, n }: { active: boolean; onClick: () => void; label: string; n: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-xs font-medium text-ink-3 hover:text-ink',
        active && 'bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(29,28,26,0.1)]',
      )}
    >
      {label}
      <span className="text-muted tabular-nums">{n}</span>
    </button>
  );
}

function GraphNodeCard({
  projectId,
  node,
  graph,
  axis,
  taxonomies,
}: {
  projectId: string;
  node: GraphNode;
  graph: KnowledgeGraph;
  axis: AreaAxis | null;
  taxonomies: Taxonomy[];
}) {
  const navigate = useNavigate();
  const type = nodeType(node.type);
  const record = node.record;
  const invalidated = node.state === 'invalidated';
  const open = () => {
    if (record)
      void navigate({
        to: '/p/$projectId/records/$code',
        params: { projectId, code: record.code },
        search: { v: record.version },
      });
  };
  return (
    <Peek
      label={`${type.word}: ${node.label} (${node.ref})`}
      onOpen={open}
      className="rounded-[10px]"
      content={<NodePeek projectId={projectId} node={node} graph={graph} axis={axis} taxonomies={taxonomies} />}
    >
      <Node
        icon={type.icon}
        type={type.word}
        title={node.label}
        line={
          <>
            {type.word} · <Code>{node.ref}</Code>
          </>
        }
        status={invalidated ? <Mark kind="replaced" label="Invalidated" /> : <EpistemicMark status={node.epistemic_status} />}
        shape={invalidated ? 'faded' : 'solid'}
        className="hover:border-line-strong"
      />
    </Peek>
  );
}

const PER_GROUP = 4;

/** The detail of a node: its excerpt, its areas and its relations, both ways. */
function NodePeek({
  projectId,
  node,
  graph,
  axis,
  taxonomies,
}: {
  projectId: string;
  node: GraphNode;
  graph: KnowledgeGraph;
  axis: AreaAxis | null;
  taxonomies: Taxonomy[];
}) {
  const type = nodeType(node.type);
  const relations = relationsOf(graph, node.ref);
  const areas = areaNames(node, taxonomies);
  return (
    <Detail
      icon={type.icon}
      type={type.word}
      status={
        node.state === 'invalidated' ? (
          <span className="text-muted">Invalidated</span>
        ) : (
          <EpistemicMark status={node.epistemic_status} withWord />
        )
      }
      code={node.ref}
      title={node.label}
      actions={
        node.record ? (
          <Link
            to="/p/$projectId/records/$code"
            params={{ projectId, code: node.record.code }}
            search={{ v: node.record.version }}
            className={buttonStyles({ variant: 'ink', size: 'sm' })}
          >
            Open {node.record.code}
          </Link>
        ) : null
      }
      who={
        areas.length > 0 ? (
          <span className="truncate">{areas.join(' · ')}</span>
        ) : (
          <span>{axis ? 'Not classified yet' : 'No approved taxonomy'}</span>
        )
      }
    >
      {node.excerpt && <p className="line-clamp-3 text-[13px] whitespace-pre-line text-ink-3">{node.excerpt}</p>}
      {relations.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {groupRelations(relations).map((g) => (
            <div key={g.word} className="flex flex-col gap-1">
              <h4 className="text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
                {g.word} · {g.relations.length}
              </h4>
              <ul className="flex flex-col gap-1">
                {g.relations.slice(0, PER_GROUP).map((r) => (
                  <li key={r.key} className="flex items-center gap-2 text-[13px]">
                    {r.node && <TypeIcon kind={nodeType(r.node.type).icon} size={12} className="shrink-0 text-muted" />}
                    <span className="min-w-0 flex-1 truncate text-ink">{r.node?.label ?? r.ref}</span>
                    <Code className="shrink-0">{r.ref}</Code>
                  </li>
                ))}
              </ul>
              {g.relations.length > PER_GROUP && <p className="text-xs text-muted">and {g.relations.length - PER_GROUP} more</p>}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">No relations yet.</p>
      )}
    </Detail>
  );
}

/** Names of the node's categories, axis by axis, from the taxonomy that has them. */
function areaNames(node: GraphNode, taxonomies: Taxonomy[]): string[] {
  const ordered = [...taxonomies].sort(
    (a, b) => Number(b.state === 'approved') - Number(a.state === 'approved') || b.version - a.version,
  );
  return Object.entries(node.areas).map(([axisCode, category]) => {
    for (const t of ordered) {
      const found = parseAxes(t.axes)
        .find((a) => a.code === axisCode)
        ?.categories.find((c) => c.code === category);
      if (found) return found.name;
    }
    return category;
  });
}

function GraphSkeleton() {
  return (
    <div role="status" aria-label="Loading the graph" className="flex flex-col gap-6">
      {[0, 1].map((s) => (
        <div key={s} className="flex flex-col gap-2.5">
          <Skeleton className="h-3.5 w-40" />
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex h-[52px] items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3">
                <Skeleton className="h-3.5 w-3.5" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
