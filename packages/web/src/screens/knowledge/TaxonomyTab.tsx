// Taxonomy (spec §4.10): the current one and the proposed ones, with their axes and categories.
// A person approves a proposed version (decisive: it asks first) or proposes a new version based
// on the current one. Classification only ever uses the approved taxonomy.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { taxonomiesQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { Taxonomy } from '../../api/types.ts';
import { useTables } from '../../lib/hooks.ts';
import { shortDate } from '../../lib/time.ts';
import { ActionBar } from '../../ui/ActionBar.tsx';
import { Button } from '../../ui/Button.tsx';
import { Code } from '../../ui/Card.tsx';
import { ConfirmDialog } from '../../ui/dialogs.tsx';
import { ChevronRight, PlusIcon, TypeIcon } from '../../ui/icons.tsx';
import { EmptyState, Skeleton } from '../../ui/layout.tsx';
import { Markdown } from '../../ui/Markdown.tsx';
import { StateMark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { type TaxonomyDraft, draftFrom, parseAxes, starterDraft } from './taxonomy.ts';
import { TaxonomyEditor } from './TaxonomyEditor.tsx';

export function TaxonomyTab({ projectId }: { projectId: string }) {
  const list = useQuery(taxonomiesQuery(projectId));
  const tables = useTables();
  const [draft, setDraft] = useState<{ draft: TaxonomyDraft; base: Taxonomy | null } | null>(null);
  if (list.error) return <Reasons error={list.error} />;
  if (list.isPending) {
    return (
      <div role="status" aria-label="Loading the taxonomy" className="flex flex-col gap-3">
        <Skeleton className="h-64 w-full rounded-card-md" />
      </div>
    );
  }
  const taxonomies = list.data ?? [];
  const current = taxonomies.filter((t) => t.state === 'approved').sort((a, b) => b.version - a.version)[0] ?? null;
  const proposed = taxonomies.filter((t) => t.state === 'draft').sort((a, b) => b.version - a.version);
  const replaced = taxonomies.filter((t) => t.state === 'superseded').sort((a, b) => b.version - a.version);
  const base = current ?? proposed[0] ?? null;
  const canPropose = tables ? canCreate(tables, 'taxonomy.propose') : false;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-6">
        <p className="dm-text-small max-w-[640px] text-ink-2">
          The taxonomy organizes what DEMIURGO knows. Only the approved version is used to classify, and only what changes after
          approving it is classified with it.
        </p>
        {canPropose && !draft && taxonomies.length > 0 && (
          <Button variant="secondary" onClick={() => setDraft({ draft: draftFrom(base), base })} className="shrink-0">
            <PlusIcon size={13} />
            {base ? 'Propose a new version' : 'Propose a taxonomy'}
          </Button>
        )}
      </div>
      {draft && <TaxonomyEditor projectId={projectId} initial={draft.draft} base={draft.base} onClose={() => setDraft(null)} />}
      {taxonomies.length === 0 && !draft ? (
        canPropose ? (
          <section aria-labelledby="taxonomy-setup" data-taxonomy-setup className="dm-card dm-dashed gap-3 px-5 py-4">
            <h2 id="taxonomy-setup" className="dm-text-heading">
              Set up how DEMIURGO groups knowledge
            </h2>
            <p className="dm-text-small text-ink-2">
              Without a taxonomy nothing is classified. Start from a template by area and by quality and change any word, or start
              blank. Nothing is used until you approve it.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setDraft({ draft: starterDraft(), base: null })}>
                Start from a template
              </Button>
              <Button variant="text" onClick={() => setDraft({ draft: draftFrom(null), base: null })}>
                Start blank
              </Button>
            </div>
          </section>
        ) : (
          <EmptyState>There is no taxonomy yet. Without one, nothing in the knowledge is classified.</EmptyState>
        )
      ) : null}
      {current && <Group title="Current">{<TaxonomyCard projectId={projectId} taxonomy={current} current={current} />}</Group>}
      {proposed.length > 0 && (
        <Group title="Proposed">
          {proposed.map((t) => (
            <TaxonomyCard key={t.id} projectId={projectId} taxonomy={t} current={current} />
          ))}
        </Group>
      )}
      {replaced.length > 0 && (
        <details className="group">
          <summary className="dm-text-small flex cursor-pointer list-none items-center gap-1.5 font-semibold text-ink-2 hover:text-ink">
            <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
            Replaced · {replaced.length}
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {replaced.map((t) => (
              <TaxonomyCard key={t.id} projectId={projectId} taxonomy={t} current={current} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="dm-text-small font-semibold text-ink-2">{title}</h3>
      {children}
    </div>
  );
}

function TaxonomyCard({ projectId, taxonomy: t, current }: { projectId: string; taxonomy: Taxonomy; current: Taxonomy | null }) {
  const command = useCommand(projectId);
  const [confirming, setConfirming] = useState(false);
  const axes = parseAxes(t.axes);
  const approve = () =>
    command.mutate({ command: 'taxonomy.approve', entityId: t.id }, { onSuccess: () => setConfirming(false) });
  return (
    <article aria-label={`${t.code} v${t.version} · ${t.title}`} className="dm-card gap-4 px-[18px] py-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="dm-label flex items-center gap-1.5">
            <TypeIcon kind="taxonomy" size={14} />
            Taxonomy
            <span className="dm-sep" aria-hidden="true">
              ·
            </span>
            <span className="tracking-normal normal-case">
              <StateMark entity="taxonomy" state={t.state} />
            </span>
            <Code className="tracking-normal normal-case">
              {t.code} v{t.version}
            </Code>
          </span>
          <h3 className="dm-text-heading leading-snug font-semibold">{t.title}</h3>
          <p className="dm-text-caption flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            <span className="flex items-center gap-1.5">
              Proposed by <WhoMark actor={t.author} size={16} withName /> · {shortDate(t.created_at)}
            </span>
            {t.approved_by && (
              <span className="flex items-center gap-1.5">
                Approved by <WhoMark actor={t.approved_by} size={16} withName /> · {shortDate(t.approved_at)}
              </span>
            )}
          </p>
        </div>
        <ActionBar
          entity="taxonomy"
          state={t.state}
          handlers={{
            'taxonomy.approve': {
              run: () => {
                command.reset();
                setConfirming(true);
              },
            },
          }}
        />
      </header>
      <div
        className="grid gap-x-6 gap-y-4"
        style={{ gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, axes.length))}, minmax(0, 1fr))` }}
      >
        {axes.map((a) => (
          <section key={a.code} aria-labelledby={`${t.id}-${a.code}`} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2 border-b border-line-soft pb-1.5">
              <h4 id={`${t.id}-${a.code}`} className="dm-text-small font-semibold">
                {a.name}
              </h4>
              <Code>{a.code}</Code>
            </div>
            <ul className="flex flex-col gap-1.5">
              {a.categories.map((c) => (
                <li key={c.code} className="flex flex-col">
                  <span className="flex items-baseline gap-2">
                    <span className="dm-text-small font-medium text-ink">{c.name}</span>
                    <Code>{c.code}</Code>
                  </span>
                  <span className="dm-text-caption text-ink-3">{c.description}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {t.sections.length > 0 && (
        <details className="group border-t border-line-soft pt-3">
          <summary className="dm-text-caption flex cursor-pointer list-none items-center gap-1.5 font-semibold text-ink-2 hover:text-ink">
            <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
            Its text · {t.sections.map((s) => s.title).join(' · ')}
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {t.sections.map((s) => (
              <div key={s.title}>
                <h5 className="dm-text-small mb-1 font-semibold">{s.title}</h5>
                <Markdown>{s.content}</Markdown>
              </div>
            ))}
          </div>
        </details>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Approve ${t.code} v${t.version}?`}
        description={
          current && current.id !== t.id
            ? `It replaces v${current.version}. From now on, what changes is classified with this version.`
            : 'From now on, what changes is classified with it.'
        }
        confirm="Approve"
        onConfirm={approve}
        pending={command.isPending}
        error={command.error}
      />
    </article>
  );
}
