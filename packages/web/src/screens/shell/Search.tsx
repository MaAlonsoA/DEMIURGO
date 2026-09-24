// Header search (canvas B1, top right): what DEMIURGO knows (…/knowledge/search), as the person
// types. Each result shows what it is, its title, the words that matched and how sure it is.
// ↑ and ↓ choose, Enter opens (a record at its version; a check, the Checks of its record), Esc
// closes and clears, Ctrl+K comes back here from anywhere.

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { knowledgeSearchQuery, stateQuery } from '../../api/queries.ts';
import { cn } from '../../lib/cn.ts';
import { SearchIcon, TypeIcon } from '../../ui/icons.tsx';
import { EpistemicMark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { type SearchTarget, highlight, searchTarget, snippet } from '../blueprint/search.ts';
import { nodeType } from '../knowledge/graph.ts';

const LABEL = 'Search decisions, features, ideas';
const MIN = 2;
const DEBOUNCE_MS = 200;

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((s, i) =>
        s.match ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments of one text, in order
          <mark key={i} className="rounded-[3px] bg-needs-ring px-px text-ink">
            {s.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments of one text, in order
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

export function Search({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  // Ctrl+K (⌘K) brings the search from anywhere; "?" stays the legend's.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const enabled = query.length >= MIN;
  const search = useQuery({ ...knowledgeSearchQuery(projectId, query), enabled });
  const rows = useQuery(stateQuery(projectId)).data;
  const records = rows ? [...rows.designs, ...rows.decisions] : undefined;
  const results = (enabled ? (search.data?.results ?? []) : []).map((hit) => ({ hit, target: searchTarget(hit, records) }));
  const typed = text.trim();
  const waiting = typed !== query || (enabled && search.isPending);
  const showing = open && typed.length >= MIN;
  const listed = showing && !waiting && !search.error && results.length > 0;
  const optionId = (i: number) => `${listId}-${i}`;

  const clear = () => {
    setText('');
    setQuery('');
    setActive(-1);
    setOpen(false);
  };
  const go = (target: SearchTarget | null) => {
    if (!target) return;
    clear();
    void navigate({
      to: '/p/$projectId/records/$code',
      params: { projectId, code: target.code },
      search: (target.tab ? { v: target.v, tab: target.tab } : { v: target.v }) as never,
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (results.length === 0) return;
      setActive((a) => (e.key === 'ArrowDown' ? Math.min(a + 1, results.length - 1) : Math.max(a - 1, 0)));
    } else if (e.key === 'Enter') {
      if (!listed) return;
      e.preventDefault();
      const chosen = results[active] ?? results.find((r) => r.target);
      go(chosen?.target ?? null);
    } else if (e.key === 'Escape') {
      if (text || open) {
        e.preventDefault();
        e.stopPropagation();
        clear();
      }
    }
  };

  // Under 1400 px the header has no room for the whole box: it is its magnifier, and it opens over
  // the tabs while it has the focus or a text.
  return (
    <div className="relative h-8 w-8 shrink-0 min-[1400px]:w-[280px]">
      <div
        className={cn(
          'absolute top-0 right-0 z-40 h-8 min-[1400px]:w-[280px]',
          text ? 'w-[280px]' : 'w-8 focus-within:w-[280px]',
        )}
      >
        <SearchIcon size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label={LABEL}
          placeholder={LABEL}
          aria-expanded={listed}
          aria-autocomplete="list"
          {...(listed ? { 'aria-controls': listId } : {})}
          {...(listed && active >= 0 ? { 'aria-activedescendant': optionId(active) } : {})}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="h-8 w-full cursor-pointer rounded-[var(--radius-control)] border border-line-strong bg-surface pr-2.5 pl-8 text-[13px] text-ink placeholder:text-transparent focus:cursor-text focus:border-needs focus:outline-none focus:placeholder:text-muted min-[1400px]:cursor-text min-[1400px]:placeholder:text-muted"
        />
      </div>
      {showing && (
        <div
          // Keeps the focus in the field while choosing with the pointer.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute top-full right-0 z-40 mt-1.5 w-[440px] animate-fade-in rounded-[var(--radius-control)] border border-line bg-surface p-1 shadow-[0_12px_32px_rgba(29,28,26,0.12)]"
        >
          {search.error ? (
            <Reasons error={search.error} className="m-1" />
          ) : waiting ? (
            <p role="status" className="px-3 py-2.5 text-[13px] text-muted">
              Searching…
            </p>
          ) : results.length === 0 ? (
            <p role="status" className="px-3 py-2.5 text-[13px] text-muted">
              No matches
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Results" className="flex max-h-[420px] flex-col overflow-y-auto">
              {results.map(({ hit, target }, i) => {
                const type = nodeType(hit.type);
                return (
                  <li
                    key={hit.ref}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    aria-disabled={target ? undefined : true}
                    data-search-result={hit.ref}
                    onClick={() => go(target)}
                    onMouseMove={() => setActive(i)}
                    className={cn(
                      'flex items-start gap-2.5 rounded-md px-2.5 py-2',
                      target ? 'cursor-pointer' : 'cursor-default',
                      i === active && 'bg-line-soft',
                    )}
                  >
                    <span className="mt-[2px] flex shrink-0 text-muted">
                      <TypeIcon kind={type.icon} size={14} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[13px] font-semibold text-ink">
                        <span className="sr-only">{type.word}: </span>
                        <Highlighted text={hit.title} query={query} />
                      </span>
                      {hit.excerpt && (
                        <span className="line-clamp-2 text-xs text-ink-3">
                          <Highlighted text={snippet(hit.excerpt, query)} query={query} />
                        </span>
                      )}
                      {!target && <span className="text-[11px] text-muted">It has no page of its own.</span>}
                    </span>
                    <span className="mt-[3px] flex shrink-0">
                      <EpistemicMark status={hit.epistemic_status} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
