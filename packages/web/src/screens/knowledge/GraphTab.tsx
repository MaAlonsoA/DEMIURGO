// The Graph tab (DESIGN.md §3.8, D-015): the current nodes grouped by the area of the approved
// taxonomy, as a list. A node's title opens its record (one click means open); its "Preview" button
// opens a side sheet with its excerpt, its areas and its relations both ways, where every relation
// is a link and every group can show all of its rows (INV-KNOW-06…11; the hover peek is gone).

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { graphQuery, taxonomiesQuery } from '../../api/queries.ts';
import type { GraphNode, KnowledgeGraph, Taxonomy } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ArrowRightIcon, ChevronDownIcon, KnowledgeIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PreviewButton, PreviewSheet } from '../../components/Preview.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { Certainty, EntityState } from '../../components/status.tsx';
import { Segmented } from '../../components/Tabs.tsx';
import { TypeIcon } from '../../components/types.tsx';
import { cn } from '../../lib/cn.ts';
import {
  type AreaAxis,
  NODE_TYPES,
  type Relation,
  areaAxis,
  groupByArea,
  groupRelations,
  nodeType,
  relationsOf,
} from './graph.ts';
import { parseAxes } from './taxonomy.ts';

export function GraphTab({ projectId, onTaxonomy }: { projectId: string; onTaxonomy: () => void }) {
  const graph = useQuery(graphQuery(projectId));
  const taxonomies = useQuery(taxonomiesQuery(projectId));
  const [filter, setFilter] = useState<string>('all');
  const [preview, setPreview] = useState<string | null>(null);
  const axis = useMemo(() => areaAxis(taxonomies.data ?? []), [taxonomies.data]);
  const nodes = graph.data?.nodes ?? [];
  const shown = filter === 'all' ? nodes : nodes.filter((n) => n.type === filter);
  const groups = useMemo(() => groupByArea(shown, axis), [shown, axis]);

  const error = graph.error ?? taxonomies.error;
  if (error)
    return (
      <ErrorNotice
        error={error}
        onRetry={() => {
          void graph.refetch();
          void taxonomies.refetch();
        }}
      />
    );
  if (graph.isPending || taxonomies.isPending) return <GraphSkeleton />;
  if (!graph.data || nodes.length === 0) {
    return (
      <EmptyState icon={<KnowledgeIcon size={24} />} title="The graph is empty">
        It grows as you approve decisions and designs, or accept what DEMIURGO proposes.
      </EmptyState>
    );
  }
  const counts = Object.keys(NODE_TYPES)
    .map((type) => ({ type, n: nodes.filter((x) => x.type === type).length }))
    .filter((c) => c.n > 0);
  const previewed = preview ? graph.data.nodes.find((n) => n.ref === preview) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-2">
          {axis ? (
            <>
              Grouped by {axis.name} ({axis.taxonomy.code} v{axis.taxonomy.version})
            </>
          ) : (
            <>
              No taxonomy is approved yet, so nothing is classified.{' '}
              <Button size="sm" variant="secondary" onClick={onTaxonomy} className="ml-1 align-middle">
                Open the taxonomy
              </Button>
            </>
          )}
        </p>
        <Segmented
          label="Show node types"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: nodes.length },
            ...counts.map((c) => ({ value: c.type, label: nodeType(c.type).plural, count: c.n })),
          ]}
        />
      </div>
      {groups.map((g) => {
        const id = `area-${g.key || 'none'}`;
        return (
          <section key={g.key || 'none'} aria-labelledby={id} data-area={g.key || 'none'} className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h2 id={id} className="text-base font-semibold text-fg">
                {g.name}
              </h2>
              <span className="text-sm text-fg-3 tabular-nums">
                {g.nodes.length} {g.nodes.length === 1 ? 'node' : 'nodes'}
              </span>
              {g.description ? <p className="w-full text-sm text-fg-2">{g.description}</p> : null}
            </div>
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {g.nodes.map((n) => (
                <li key={n.ref}>
                  <NodeRow projectId={projectId} node={n} onPreview={() => setPreview(n.ref)} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <PreviewSheet
        open={!!previewed}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        title={previewed?.label ?? ''}
        eyebrow={previewed ? <NodeEyebrow node={previewed} /> : null}
        footer={
          previewed?.record ? (
            <Link
              to="/p/$projectId/records/$code"
              params={{ projectId, code: previewed.record.code }}
              search={{ v: previewed.record.version }}
              className={buttonClass({ variant: 'primary' })}
            >
              Open {previewed.record.code}
              <ArrowRightIcon size={15} />
            </Link>
          ) : previewed ? (
            <p className="text-sm text-fg-2">It has no page of its own to open.</p>
          ) : null
        }
      >
        {previewed ? (
          <NodePreview projectId={projectId} node={previewed} graph={graph.data} axis={axis} taxonomies={taxonomies.data ?? []} />
        ) : null}
      </PreviewSheet>
    </div>
  );
}

/** How sure it is, or that it was invalidated (a newer version replaced it). */
function NodeState({ node }: { node: GraphNode }) {
  return node.state === 'invalidated' ? (
    <EntityState entity="knowledge_node" state="invalidated" />
  ) : (
    <Certainty status={node.epistemic_status} />
  );
}

/**
 * A node of the list: its type, its title (a link to its record when it has one; a node without a
 * record says so instead of pretending to open), its state and its Preview button.
 */
function NodeRow({ projectId, node, onPreview }: { projectId: string; node: GraphNode; onPreview: () => void }) {
  const type = nodeType(node.type);
  const name = `${type.word}: ${node.label} (${node.ref})`;
  return (
    <div
      data-graph-node={node.ref}
      className="flex min-h-10 items-center gap-2 rounded-md border border-edge bg-panel py-1 pr-1 pl-2.5 hover:border-edge-strong"
    >
      <TypeIcon type={node.type} size={15} className="shrink-0 text-fg-3" />
      {node.record ? (
        <Link
          to="/p/$projectId/records/$code"
          params={{ projectId, code: node.record.code }}
          search={{ v: node.record.version }}
          aria-label={name}
          className="min-w-0 flex-1 truncate text-sm text-fg hover:text-accent-text hover:underline"
        >
          {node.label}
        </Link>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm text-fg">
          <span className="sr-only">{type.word}: </span>
          {node.label}
        </span>
      )}
      <NodeState node={node} />
      <PreviewButton label={`Preview ${node.label}`} onClick={onPreview} />
    </div>
  );
}

function NodeEyebrow({ node }: { node: GraphNode }) {
  return (
    <>
      <TypeIcon type={node.type} size={15} className="text-fg-3" />
      <span>{nodeType(node.type).word}</span>
      <NodeState node={node} />
      <Code>{node.ref}</Code>
    </>
  );
}

const PER_GROUP = 4;

/** The detail of a node (INV-KNOW-10): its excerpt, its areas and its relations, both ways. */
function NodePreview({
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
  const relations = relationsOf(graph, node.ref);
  const areas = areaNames(node, taxonomies);
  return (
    <>
      {node.excerpt ? <p className="text-sm whitespace-pre-line text-fg-2">{node.excerpt}</p> : null}
      <p className="text-sm text-fg-2">
        <span className="font-medium text-fg">Where it sits: </span>
        {areas.length > 0 ? areas.join(' · ') : axis ? 'Not classified yet' : 'No approved taxonomy'}
      </p>
      <section aria-labelledby="preview-relations" className="flex flex-col gap-3 border-t border-edge-subtle pt-3">
        <h3 id="preview-relations" className="text-base font-semibold text-fg">
          Relations
        </h3>
        {relations.length > 0 ? (
          groupRelations(relations).map((g) => (
            <RelationGroup key={g.word} projectId={projectId} word={g.word} relations={g.relations} />
          ))
        ) : (
          <p className="text-sm text-fg-2">No relations yet.</p>
        )}
      </section>
    </>
  );
}

function RelationGroup({ projectId, word, relations }: { projectId: string; word: string; relations: Relation[] }) {
  const [all, setAll] = useState(false);
  const id = `rel-${word.replace(/\W+/g, '-')}`;
  const shown = all ? relations : relations.slice(0, PER_GROUP);
  return (
    <div className="flex flex-col gap-1.5" data-relation-group={word}>
      <h4 className="text-sm font-medium text-fg-2">
        {word} · {relations.length}
      </h4>
      <ul id={id} className="flex flex-col gap-1">
        {shown.map((r) => {
          const record = r.node?.record;
          const label = r.node?.label ?? r.ref;
          return (
            <li key={r.key} className="flex min-h-7 items-center gap-2 text-sm">
              <TypeIcon type={r.node?.type ?? 'knowledge'} size={14} className="shrink-0 text-fg-3" />
              {record ? (
                <Link
                  to="/p/$projectId/records/$code"
                  params={{ projectId, code: record.code }}
                  search={{ v: record.version }}
                  className="min-w-0 flex-1 truncate text-fg underline-offset-2 hover:text-accent-text hover:underline"
                >
                  {label}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate text-fg">{label}</span>
              )}
              <Code className="shrink-0">{r.ref}</Code>
            </li>
          );
        })}
      </ul>
      {relations.length > PER_GROUP ? (
        <button
          type="button"
          aria-expanded={all}
          aria-controls={id}
          onClick={() => setAll((v) => !v)}
          className="inline-flex min-h-6 cursor-pointer items-center gap-1 self-start rounded-xs text-sm font-medium text-accent-text hover:underline"
        >
          {all ? 'Show fewer' : `Show all ${relations.length}`}
          <ChevronDownIcon size={14} className={cn('transition-transform', all && 'rotate-180')} />
        </button>
      ) : null}
    </div>
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
    <Skeleton label="Loading the graph" className="flex flex-col gap-6">
      {[0, 1].map((s) => (
        <div key={s} className="flex flex-col gap-2.5">
          <Bone className="h-4 w-40" />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Bone key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        </div>
      ))}
    </Skeleton>
  );
}
