// Search over the current nodes of the knowledge (…/knowledge/search). Each result links to its
// record at the version it comes from; a check goes to the record that contains it.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useId, useState } from 'react';
import { graphQuery, knowledgeSearchQuery } from '../../api/queries.ts';
import { Button } from '../../ui/Button.tsx';
import { Code } from '../../ui/Card.tsx';
import { SearchIcon, TypeIcon } from '../../ui/icons.tsx';
import { EmptyState, Skeleton } from '../../ui/layout.tsx';
import { EpistemicMark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { nodeType, recordOfRef } from './graph.ts';

/** A result as the API gives it (packages/core/src/knowledge/graph-pg.ts). */
type Hit = { ref: string; type: string; title: string; excerpt: string; epistemic_status: string };

export function SearchTab({ projectId }: { projectId: string }) {
  const id = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const search = useQuery(knowledgeSearchQuery(projectId, q));
  const graph = useQuery(graphQuery(projectId)).data;
  const hits = (search.data?.results ?? []) as unknown as Hit[];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQ(text.trim());
  };
  return (
    <div className="flex flex-col gap-5">
      <form role="search" onSubmit={submit} className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-xs font-semibold text-ink-2">
          Search the knowledge
        </label>
        <div className="flex items-center gap-2">
          <div className="relative w-[520px]">
            <SearchIcon size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              id={id}
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="A word or a phrase, as it was written"
              className="h-9 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface pr-3 pl-8 text-sm text-ink placeholder:text-muted focus:border-needs focus:outline-none"
            />
          </div>
          <Button type="submit" variant="ink" size="lg" disabled={text.trim() === ''}>
            Search
          </Button>
        </div>
      </form>
      {!q ? (
        <p className="text-[13px] text-ink-3">
          Search what DEMIURGO knows: decisions, features, tech decisions and their checks, as they were written.
        </p>
      ) : search.isPending ? (
        <div role="status" aria-label="Searching" className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[72px] w-full rounded-[var(--radius-card)]" />
          ))}
        </div>
      ) : search.error ? (
        <Reasons error={search.error} />
      ) : hits.length === 0 ? (
        <EmptyState>Nothing matches “{q}”.</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted" aria-live="polite">
            {hits.length} {hits.length === 1 ? 'result' : 'results'} for “{q}”
          </p>
          <ul aria-label="Results" className="flex flex-col gap-2">
            {hits.map((h) => {
              const record = recordOfRef(h.ref, graph);
              const type = nodeType(h.type);
              const body = (
                <>
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
                    <TypeIcon kind={type.icon} size={13} />
                    {type.word}
                    <span className="tracking-normal normal-case">
                      <EpistemicMark status={h.epistemic_status} withWord />
                    </span>
                    <Code className="ml-auto tracking-normal normal-case">{h.ref}</Code>
                  </span>
                  <strong className="text-[14px] leading-snug font-semibold">{h.title}</strong>
                  {h.excerpt && <span className="line-clamp-2 text-[13px] text-ink-3">{h.excerpt}</span>}
                </>
              );
              const cls = 'flex flex-col gap-1 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-left';
              return (
                <li key={h.ref}>
                  {record ? (
                    <Link
                      to="/p/$projectId/records/$code"
                      params={{ projectId, code: record.code }}
                      search={{ v: record.version }}
                      className={`${cls} hover:border-line-strong`}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
