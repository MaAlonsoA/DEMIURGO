// The graph tab: current nodes grouped by the area of the approved taxonomy, each the design
// system's Node with its type and its mark; the invalidated ones faded. Pointing at a node (or
// focusing it) shows its relations in the peek; Enter or "Open" goes to its record.

import { type Certainty, Chip, Node as DsNode } from '@demiurgo/design-system';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { graphQuery, taxonomiesQuery } from '../../api/queries.ts';
import type { GraphNode, KnowledgeGraph, Taxonomy } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { buttonClass } from '../../ui/Button.tsx';
import { Code, Detail } from '../../ui/Card.tsx';
import { ITEM_TYPE, TypeIcon } from '../../ui/icons.tsx';
import { EmptyState, Skeleton } from '../../ui/layout.tsx';
import { EpistemicMark, Mark, MarkWord } from '../../ui/marks.tsx';
import { Peek } from '../../ui/Peek.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { EPISTEMIC_MARK } from '../../words.ts';
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
        <p className="dm-text-small text-ink-2">
          {axis ? (
            <>
              Grouped by {axis.name} ({axis.taxonomy.code} v{axis.taxonomy.version})
            </>
          ) : (
            <>
              No taxonomy is approved yet, so nothing is classified.{' '}
              <button type="button" onClick={onTaxonomy} className="font-semibold text-needs hover:text-needs-strong">
                Open the taxonomy
              </button>
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
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
            <h3 id={`area-${g.key || 'none'}`} className="dm-text-small font-semibold text-ink">
              {g.name}
            </h3>
            <span className="dm-text-caption text-muted tabular-nums">{g.nodes.length}</span>
            {g.description && <span className="dm-text-caption truncate text-muted">· {g.description}</span>}
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

/** A type filter: the design system's Chip, ink while it is the one shown. */
function FilterButton({ active, onClick, label, n }: { active: boolean; onClick: () => void; label: string; n: number }) {
  return (
    <Chip pressed={active} onClick={onClick}>
      {label} <span className="font-normal tabular-nums">{n}</span>
    </Chip>
  );
}

/** Pointing at a node strengthens its line, unless it is the kept (selected) one. */
const NODE_HOVER = 'rounded-control hover:[&_.dm-node:not(.dm-selected)]:border-line-strong';

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
  const item = ITEM_TYPE[type.icon];
  const state = invalidated ? 'parked' : ((EPISTEMIC_MARK[node.epistemic_status] ?? 'unknown') as Certainty);
  const mark = invalidated ? <Mark kind="replaced" label="Invalidated" /> : <EpistemicMark status={node.epistemic_status} />;
  return (
    <Peek
      label={`${type.word}: ${node.label} (${node.ref})`}
      onOpen={open}
      className={NODE_HOVER}
      content={<NodePeek projectId={projectId} node={node} graph={graph} axis={axis} taxonomies={taxonomies} />}
    >
      {(kept) =>
        item ? (
          <DsNode type={item} state={state} mark={mark} title={node.label} selected={kept} />
        ) : (
          // A kind the design system has no type for: its node class, with the app's icon.
          <div className={cn('dm-node', invalidated && 'dm-faded', kept && 'dm-selected')}>
            <TypeIcon kind={type.icon} size={14} className="shrink-0" />
            {mark}
            <span className="dm-text-body min-w-0 flex-1 truncate">{node.label}</span>
          </div>
        )
      }
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
          <MarkWord kind="replaced" word="Invalidated" />
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
            className={buttonClass('secondary')}
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
      {node.excerpt && <p className="dm-text-small line-clamp-3 whitespace-pre-line text-ink-3">{node.excerpt}</p>}
      {relations.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {groupRelations(relations).map((g) => (
            <div key={g.word} className="flex flex-col gap-1">
              <h4 className="dm-label">
                {g.word} · {g.relations.length}
              </h4>
              <ul className="flex flex-col gap-1">
                {g.relations.slice(0, PER_GROUP).map((r) => (
                  <li key={r.key} className="dm-text-small flex items-center gap-2">
                    {r.node && <TypeIcon kind={nodeType(r.node.type).icon} size={12} className="shrink-0 text-muted" />}
                    <span className="min-w-0 flex-1 truncate text-ink">{r.node?.label ?? r.ref}</span>
                    <Code className="shrink-0">{r.ref}</Code>
                  </li>
                ))}
              </ul>
              {g.relations.length > PER_GROUP && (
                <p className="dm-text-caption text-muted">and {g.relations.length - PER_GROUP} more</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="dm-text-caption text-muted">No relations yet.</p>
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
              <div key={i} className="dm-node">
                <Skeleton className="h-3.5 w-3.5" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
