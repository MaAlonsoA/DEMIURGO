// The command menu (DESIGN.md §2.3): Ctrl/⌘ K from anywhere in a project. It searches what
// DEMIURGO knows (from 2 characters, 200 ms after typing stops) and offers every section to go to.
// ↑ ↓ choose, Enter opens, Esc closes. A result without a page of its own says so; an error stays
// inside the menu without taking the focus from the field (INVENTORY §2 #20).

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Dialog as D } from 'radix-ui';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { knowledgeSearchQuery, stateQuery } from '../api/queries.ts';
import { Certainty } from '../components/status.tsx';
import { ErrorNotice } from '../components/Notice.tsx';
import { SearchIcon } from '../components/icons.tsx';
import { TypeIcon } from '../components/types.tsx';
import { cn } from '../lib/cn.ts';
import { type SearchTarget, highlight, searchTarget, snippet } from '../screens/blueprint/search.ts';
import { nodeType } from '../screens/knowledge/graph.ts';
import { NAV } from './nav.ts';

const MIN = 2;
const DEBOUNCE_MS = 200;

const listeners = new Set<() => void>();
let open = false;
function setOpen(v: boolean) {
  open = v;
  for (const l of listeners) l();
}
export function openCommandMenu(): void {
  setOpen(true);
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((s, i) =>
        s.match ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments of one text, in order
          <mark key={i} className="rounded-xs bg-accent-soft px-px text-fg">
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

type Option =
  | { kind: 'go'; key: string; label: string; icon: ReactNode; to: string }
  | { kind: 'hit'; key: string; target: SearchTarget | null; title: string; excerpt: string; type: string; status: string };

export function CommandMenu({ projectId }: { projectId: string }) {
  const isOpen = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => open,
    () => false,
  );

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <D.Root open={isOpen} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-enter bg-scrim" />
        <D.Content
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[70vh] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 animate-enter flex-col overflow-hidden rounded-xl border border-edge bg-panel shadow-dialog"
        >
          <D.Title className="sr-only">Search and go to</D.Title>
          {isOpen ? <MenuBody projectId={projectId} close={() => setOpen(false)} /> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function MenuBody({ projectId, close }: { projectId: string; close: () => void }) {
  const navigate = useNavigate();
  const listId = useId();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const enabled = query.length >= MIN;
  const search = useQuery({ ...knowledgeSearchQuery(projectId, query), enabled });
  const state = useQuery(stateQuery(projectId)).data;
  const records = state ? [...state.designs, ...state.decisions] : undefined;
  const typed = text.trim();
  const waiting = typed.length >= MIN && (typed !== query || search.isPending);

  const options: Option[] = useMemo(() => {
    const t = typed.toLowerCase();
    const go: Option[] = NAV.filter((n) => !t || n.label.toLowerCase().includes(t)).map((n) => ({
      kind: 'go',
      key: `go:${n.key}`,
      label: n.label,
      icon: <n.icon size={16} />,
      to: n.to,
    }));
    const hits: Option[] = (enabled ? (search.data?.results ?? []) : []).map((h) => ({
      kind: 'hit',
      key: h.ref,
      target: searchTarget(h, records),
      title: h.title,
      excerpt: h.excerpt,
      type: h.type,
      status: h.epistemic_status,
    }));
    return typed.length >= MIN ? [...hits, ...go] : go;
  }, [typed, enabled, search.data, records]);

  useEffect(() => setActive(0), [query]);

  const choose = (o: Option | undefined) => {
    if (!o) return;
    if (o.kind === 'go') {
      close();
      void navigate({ to: o.to as '/p/$projectId', params: { projectId } });
      return;
    }
    if (!o.target) return;
    close();
    if ('thread' in o.target) {
      void navigate({ to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId: o.target.thread } });
      return;
    }
    void navigate({
      to: '/p/$projectId/records/$code',
      params: { projectId, code: o.target.code },
      search: (o.target.tab ? { v: o.target.v, tab: o.target.tab } : { v: o.target.v }) as never,
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(options[active]);
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;
  // The focus stays in the field (aria-activedescendant): the active option is scrolled into view.
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);
  const hits = options.filter((o) => o.kind === 'hit');
  const gos = options.filter((o) => o.kind === 'go');

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-edge px-4">
        <SearchIcon size={16} className="shrink-0 text-fg-3" />
        <input
          // biome-ignore lint/a11y/noAutofocus: the menu exists to type in it
          autoFocus
          type="text"
          role="combobox"
          aria-label="Search decisions, features, ideas"
          aria-expanded={options.length > 0}
          {...(options.length > 0 ? { 'aria-controls': listId } : {})}
          aria-autocomplete="list"
          {...(options[active] ? { 'aria-activedescendant': optionId(active) } : {})}
          placeholder="Search decisions, features, ideas — or go to a section"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-12 w-full bg-transparent text-md text-fg placeholder:text-fg-3 focus:outline-none"
        />
        <kbd className="shrink-0 rounded-xs border border-edge px-1.5 font-ui text-xs text-fg-3">Esc</kbd>
      </div>
      {/* Focusable, so the results can be scrolled by keyboard too (WCAG 2.1.1). */}
      <div role="region" tabIndex={0} aria-label="Search results" className="min-h-0 flex-1 overflow-y-auto p-2">
        {search.error && enabled ? <ErrorNotice error={search.error} focus={false} compact className="m-1" /> : null}
        {typed.length >= MIN ? (
          <p className="px-2.5 pt-1 pb-1.5 text-xs font-medium text-fg-3">
            {waiting
              ? 'Searching…'
              : hits.length === 0
                ? 'No matches'
                : `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`}
          </p>
        ) : null}
        {/* A listbox needs options (ARIA): with nothing to choose, only the line above is shown. */}
        {options.length > 0 ? (
          <ul id={listId} role="listbox" aria-label="Results" className="flex flex-col">
            {hits.map((o) => {
              const i = options.indexOf(o);
              if (o.kind !== 'hit') return null;
              const type = nodeType(o.type);
              return (
                <li
                  key={o.key}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={o.target ? undefined : true}
                  data-search-result={o.key}
                  onClick={() => choose(o)}
                  onMouseMove={() => setActive(i)}
                  className={cn(
                    'flex items-start gap-3 rounded-md px-2.5 py-2',
                    o.target ? 'cursor-pointer' : 'cursor-default',
                    i === active && 'bg-hover',
                  )}
                >
                  <TypeIcon type={o.type} size={16} className="mt-0.5 shrink-0 text-fg-2" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-base font-medium text-fg">
                      <span className="sr-only">{type.word}: </span>
                      <Highlighted text={o.title} query={query} />
                    </span>
                    {o.excerpt ? (
                      <span className="line-clamp-2 text-sm text-fg-2">
                        <Highlighted text={snippet(o.excerpt, query)} query={query} />
                      </span>
                    ) : null}
                    {!o.target ? <span className="text-xs text-fg-3">It has no page of its own.</span> : null}
                  </span>
                  <Certainty status={o.status} className="mt-0.5" />
                </li>
              );
            })}
            {gos.length > 0 ? (
              <li role="presentation" className="px-2.5 pt-2 pb-1.5 text-xs font-medium text-fg-3">
                Go to
              </li>
            ) : null}
            {gos.map((o) => {
              const i = options.indexOf(o);
              if (o.kind !== 'go') return null;
              return (
                <li
                  key={o.key}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  onClick={() => choose(o)}
                  onMouseMove={() => setActive(i)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-base text-fg',
                    i === active && 'bg-hover',
                  )}
                >
                  <span className="text-fg-2">{o.icon}</span>
                  {o.label}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </>
  );
}
