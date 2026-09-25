// The Taxonomy tab (DESIGN.md §3.8, INV-KNOW-19…25): the current taxonomy and the proposed ones, with
// their axes and categories as data. A person approves a proposed version (decisive: the dialog says
// what changes before it happens) or proposes a new version from the current one. Classification
// only ever uses the approved taxonomy. A project without one gets a setup card: from a template or
// blank, nothing used until approved.

import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { taxonomiesQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { Taxonomy } from '../../api/types.ts';
import { ActionBar } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Card } from '../../components/Card.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ChevronRightIcon, PlusIcon, TagIcon } from '../../components/icons.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { EntityState } from '../../components/status.tsx';
import { Who } from '../../components/Who.tsx';
import { useTables } from '../../lib/hooks.ts';
import { shortDate } from '../../lib/time.ts';
import { type TaxonomyDraft, draftFrom, parseAxes, starterDraft } from './taxonomy.ts';
import { TaxonomyEditor } from './TaxonomyEditor.tsx';

export function TaxonomyTab({ projectId }: { projectId: string }) {
  const list = useQuery(taxonomiesQuery(projectId));
  const tables = useTables();
  const [draft, setDraft] = useState<{ draft: TaxonomyDraft; base: Taxonomy | null } | null>(null);
  if (list.error) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;
  if (list.isPending) {
    return (
      <Skeleton label="Loading the taxonomy">
        <Bone className="h-64 w-full rounded-lg" />
      </Skeleton>
    );
  }
  const taxonomies = list.data ?? [];
  const current = taxonomies.filter((t) => t.state === 'approved').sort((a, b) => b.version - a.version)[0] ?? null;
  const proposed = taxonomies.filter((t) => t.state === 'draft').sort((a, b) => b.version - a.version);
  const replaced = taxonomies.filter((t) => t.state === 'superseded').sort((a, b) => b.version - a.version);
  const base = current ?? proposed[0] ?? null;
  const canPropose = tables ? canCreate(tables, 'taxonomy.propose') : false;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-fg-2">
          The taxonomy organizes what DEMIURGO knows. Only the approved version is used to classify, and only what changes after
          approving it is classified with it.
        </p>
        {canPropose && !draft && taxonomies.length > 0 ? (
          <Button variant="secondary" icon={<PlusIcon size={15} />} onClick={() => setDraft({ draft: draftFrom(base), base })}>
            {base ? 'Propose a new version' : 'Propose a taxonomy'}
          </Button>
        ) : null}
      </div>
      {draft ? (
        <TaxonomyEditor projectId={projectId} initial={draft.draft} base={draft.base} onClose={() => setDraft(null)} />
      ) : null}
      {taxonomies.length === 0 && !draft ? (
        canPropose ? (
          <section
            aria-labelledby="taxonomy-setup"
            data-taxonomy-setup
            className="flex flex-col gap-3 rounded-lg border border-dashed border-accent-edge bg-accent-soft px-5 py-5"
          >
            <h2 id="taxonomy-setup" className="text-lg font-semibold text-fg">
              Set up how DEMIURGO groups knowledge
            </h2>
            <p className="max-w-2xl text-base text-fg-2">
              Without a taxonomy nothing is classified. Start from a template by area and by quality and change any word, or start
              blank. Nothing is used until you approve it.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => setDraft({ draft: starterDraft(), base: null })}>
                Start from a template
              </Button>
              <Button variant="quiet" onClick={() => setDraft({ draft: draftFrom(null), base: null })}>
                Start blank
              </Button>
            </div>
          </section>
        ) : (
          <EmptyState icon={<TagIcon size={24} />} title="There is no taxonomy yet">
            Without one, nothing in the knowledge is classified.
          </EmptyState>
        )
      ) : null}
      {current ? (
        <Group title="Current">
          <TaxonomyCard projectId={projectId} taxonomy={current} current={current} />
        </Group>
      ) : null}
      {proposed.length > 0 ? (
        <Group title="Proposed">
          {proposed.map((t) => (
            <TaxonomyCard key={t.id} projectId={projectId} taxonomy={t} current={current} />
          ))}
        </Group>
      ) : null}
      {replaced.length > 0 ? (
        <details className="group flex flex-col gap-3">
          <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1.5 text-base font-semibold text-fg-2 hover:text-fg">
            <ChevronRightIcon size={14} className="transition-transform group-open:rotate-90" />
            Replaced · {replaced.length}
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {replaced.map((t) => (
              <TaxonomyCard key={t.id} projectId={projectId} taxonomy={t} current={current} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={`${title} taxonomy`} className="flex flex-col gap-2.5">
      <h2 className="text-base font-semibold text-fg-2">{title}</h2>
      {children}
    </section>
  );
}

function TaxonomyCard({ projectId, taxonomy: t, current }: { projectId: string; taxonomy: Taxonomy; current: Taxonomy | null }) {
  const command = useCommand(projectId);
  const [confirming, setConfirming] = useState(false);
  const axes = parseAxes(t.axes);
  const approve = () =>
    command.mutate(
      { command: 'taxonomy.approve', entityId: t.id },
      {
        onSuccess: () => {
          setConfirming(false);
          announce(`Approved ${t.code} v${t.version}. What changes from now on is classified with it.`);
        },
      },
    );
  return (
    <Card as="article" aria-label={`${t.code} v${t.version} · ${t.title}`} className="flex flex-col gap-5" padding="none">
      <header className="flex flex-wrap items-start justify-between gap-4 px-5 pt-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
            <TagIcon size={15} className="text-fg-3" />
            <span>Taxonomy</span>
            <EntityState entity="taxonomy" state={t.state} />
            <Code>
              {t.code} v{t.version}
            </Code>
          </div>
          <h3 className="text-lg font-semibold text-fg">{t.title}</h3>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-2">
            <span className="inline-flex items-center gap-1.5">
              Proposed by <Who actor={t.author} size={16} /> · {shortDate(t.created_at)}
            </span>
            {t.approved_by ? (
              <span className="inline-flex items-center gap-1.5">
                Approved by <Who actor={t.approved_by} size={16} /> · {shortDate(t.approved_at)}
              </span>
            ) : null}
          </div>
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
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-5 md:grid-cols-2 xl:grid-cols-3">
        {axes.map((a) => (
          <section key={a.code} aria-labelledby={`${t.id}-${a.code}`} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2 border-b border-edge-subtle pb-1.5">
              <h4 id={`${t.id}-${a.code}`} className="text-sm font-semibold text-fg">
                {a.name}
              </h4>
              <Code>{a.code}</Code>
            </div>
            <ul className="flex flex-col gap-2">
              {a.categories.map((c) => (
                <li key={c.code} className="flex flex-col">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-fg">{c.name}</span>
                    <Code>{c.code}</Code>
                  </span>
                  <span className="text-sm text-fg-2">{c.description}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {t.sections.length > 0 ? (
        <details className="group border-t border-edge-subtle px-5 py-3">
          <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-fg-2 hover:text-fg">
            <ChevronRightIcon size={14} className="transition-transform group-open:rotate-90" />
            Its text · {t.sections.map((s) => s.title).join(' · ')}
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {t.sections.map((s) => (
              <div key={s.title} className="flex flex-col gap-1">
                <h5 className="text-sm font-semibold text-fg">{s.title}</h5>
                <Markdown size="sm">{s.content}</Markdown>
              </div>
            ))}
          </div>
        </details>
      ) : (
        <span className="pb-1" />
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
        pendingLabel="Approving…"
        error={command.error}
      />
    </Card>
  );
}
