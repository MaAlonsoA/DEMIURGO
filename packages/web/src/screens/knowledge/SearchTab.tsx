// The Search tab (DESIGN.md §3.8, INV-KNOW-12…14): a full search over the current knowledge
// (…/knowledge/search), run on submit. Each result says what it is and how sure it is; its title
// opens its record at the version it comes from (a check opens the record that holds it), or its
// thread. A result with no page says so instead of being an inert card.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { graphQuery, knowledgeSearchQuery } from '../../api/queries.ts';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Field, TextInput } from '../../components/Field.tsx';
import { SearchIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { Certainty } from '../../components/status.tsx';
import { TypeIcon } from '../../components/types.tsx';
import { nodeType, recordOfRef } from './graph.ts';

/** A result as the API gives it (packages/core/src/knowledge/graph-pg.ts). */
type Hit = { ref: string; type: string; title: string; excerpt: string; epistemic_status: string };

export function SearchTab({ projectId }: { projectId: string }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const search = useQuery(knowledgeSearchQuery(projectId, q));
  const graph = useQuery(graphQuery(projectId)).data;
  const hits = (search.data?.results ?? []) as unknown as Hit[];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQ(text.trim());
  };
  const done = !!q && !!search.data;
  useEffect(() => {
    if (done) announce(`${hits.length} ${hits.length === 1 ? 'result' : 'results'} for “${q}”.`);
  }, [done, hits.length, q]);

  return (
    <div className="flex flex-col gap-5">
      <form role="search" onSubmit={submit} className="max-w-2xl">
        <Field label="Search the knowledge">
          {(p) => (
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <SearchIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3" />
                <TextInput
                  {...p}
                  type="search"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="A word or a phrase, as it was written"
                  className="pl-9"
                />
              </div>
              <Button type="submit" variant="primary" disabled={text.trim() === ''}>
                Search
              </Button>
            </div>
          )}
        </Field>
      </form>
      {!q ? (
        <p className="text-sm text-fg-2">
          Search what DEMIURGO knows: decisions, features, tech decisions and their checks, as they were written.
        </p>
      ) : search.error ? (
        <ErrorNotice error={search.error} onRetry={() => void search.refetch()} />
      ) : search.isPending ? (
        <RowsSkeleton label="Searching" rows={3} />
      ) : hits.length === 0 ? (
        <EmptyState
          icon={<SearchIcon size={24} />}
          title={`Nothing matches “${q}”`}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setText('');
                setQ('');
              }}
            >
              Clear the search
            </Button>
          }
        >
          Try another word, or fewer words.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg-2">
            {hits.length} {hits.length === 1 ? 'result' : 'results'} for “{q}”
          </p>
          <ul aria-label="Results" className="flex flex-col gap-2">
            {hits.map((h) => (
              <Result key={h.ref} projectId={projectId} hit={h} record={recordOfRef(h.ref, graph)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Result({
  projectId,
  hit: h,
  record,
}: {
  projectId: string;
  hit: Hit;
  record: { code: string; version: number } | null;
}) {
  const thread = h.ref.startsWith('exploration:') ? h.ref.slice('exploration:'.length) : null;
  const type = nodeType(h.type);
  const title = 'text-base font-medium text-fg underline-offset-2 hover:text-accent-text hover:underline';
  return (
    <li data-search-hit={h.ref} className="flex flex-col gap-1.5 rounded-lg border border-edge bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
        <TypeIcon type={h.type} size={15} className="text-fg-3" />
        <span>{type.word}</span>
        <Certainty status={h.epistemic_status} />
        {!thread ? <Code className="ml-auto">{h.ref}</Code> : null}
      </div>
      {thread ? (
        <Link to="/p/$projectId/threads/$explorationId" params={{ projectId, explorationId: thread }} className={title}>
          {h.title}
        </Link>
      ) : record ? (
        <Link
          to="/p/$projectId/records/$code"
          params={{ projectId, code: record.code }}
          search={{ v: record.version }}
          className={title}
        >
          {h.title}
        </Link>
      ) : (
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-base font-medium text-fg">{h.title}</span>
          <span className="text-xs text-fg-3">It has no page of its own to open.</span>
        </span>
      )}
      {h.excerpt ? <p className="line-clamp-3 text-sm text-fg-2">{h.excerpt}</p> : null}
    </li>
  );
}
