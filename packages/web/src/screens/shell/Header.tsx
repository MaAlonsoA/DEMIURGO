// Header, always visible (spec §3): DEMIURGO and the project, the tabs with the blue count of
// "Needs you", the freshness of the knowledge and the person's menu with "Models & providers",
// "Sign out" (and, with the dev tools on, "Snapshots…").

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { DropdownMenu } from 'radix-ui';
import { request, setCsrf } from '../../api/client.ts';
import { inboxQuery, knowledgeQuery, projectsQuery, sessionQuery } from '../../api/queries.ts';
import { cn } from '../../lib/cn.ts';
import { useProjectId, usePerson } from '../../lib/hooks.ts';
import { ChevronDown } from '../../ui/icons.tsx';
import { NeedsBubble, WhoGlyph } from '../../ui/signals.tsx';
import { Tip } from '../../ui/Tip.tsx';
import { useLegendMark } from '../../ui/legend-store.ts';
import { hasDevTools, openDevPanel } from '../dev/snapshots.ts';
import { Search } from './Search.tsx';

type Tab = { label: string; to: string; match: RegExp; needs?: boolean };

const TABS: Tab[] = [
  { label: 'Product', to: '/p/$projectId', match: /^\/p\/[^/]+(\/(origins|records|map|journeys)(\/.*)?)?\/?$/ },
  { label: 'Threads', to: '/p/$projectId/threads', match: /^\/p\/[^/]+\/threads/ },
  { label: 'Needs you', to: '/p/$projectId/needs-you', match: /^\/p\/[^/]+\/(needs-you|batches)/, needs: true },
  { label: 'Knowledge', to: '/p/$projectId/knowledge', match: /^\/p\/[^/]+\/knowledge/ },
  { label: 'Sources', to: '/p/$projectId/sources', match: /^\/p\/[^/]+\/sources/ },
  { label: 'Activity', to: '/p/$projectId/activity', match: /^\/p\/[^/]+\/(activity|runs)/ },
];

export function Header() {
  const projectId = useProjectId();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const projects = useQuery(projectsQuery).data ?? [];
  const project = projects.find((p) => p.id === projectId);
  const inbox = useQuery(inboxQuery(projectId)).data;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-7 border-b border-line bg-surface px-6">
      <div className="flex items-center gap-6">
        <Link to="/p/$projectId" params={{ projectId }} className="text-[13px] font-bold tracking-[0.14em] text-ink">
          DEMIURGO
        </Link>
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          {project?.name ?? ''}
          {projects.length > 1 && (
            <Link to="/projects" className="text-xs font-medium text-muted hover:text-ink">
              Switch
            </Link>
          )}
          <Link to="/new" className="text-xs font-medium text-muted hover:text-ink">
            New project
          </Link>
        </span>
      </div>
      <nav aria-label="Main" className="flex items-center gap-1">
        {TABS.map((t) => {
          const active = t.match.test(pathname);
          return (
            <Link
              key={t.label}
              to={t.to as '/p/$projectId'}
              params={{ projectId }}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center gap-2 rounded-[var(--radius-control)] px-3 text-[14px] text-ink-2 hover:text-ink',
                active && 'bg-line-soft font-semibold text-ink',
              )}
            >
              {t.label}
              {t.needs && inbox ? <NeedsBubble count={inbox.total} size="sm" /> : null}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-5">
        <Search projectId={projectId} />
        <Freshness projectId={projectId} />
        <PersonMenu />
      </div>
    </header>
  );
}

/** Graph version and a dot: ink when up to date, amber while updating, rust when behind. */
function Freshness({ projectId }: { projectId: string }) {
  const k = useQuery(knowledgeQuery(projectId)).data;
  const failed = k?.updates.filter((u) => u.state === 'rejected').length ?? 0;
  const state = !k ? null : failed > 0 ? 'behind' : k.updates_in_progress > 0 || !k.up_to_date ? 'updating' : 'current';
  useLegendMark(state === 'updating' ? 'mark:working' : state === 'behind' ? 'mark:problem' : null);
  if (!k || !state) return null;
  const text =
    state === 'current'
      ? `Knowledge is up to date (version ${k.graph_version}).`
      : state === 'updating'
        ? `DEMIURGO is updating its knowledge: ${k.updates_in_progress} ${k.updates_in_progress === 1 ? 'change' : 'changes'} to go.`
        : `Knowledge is behind: ${failed} ${failed === 1 ? 'update' : 'updates'} failed. Open Knowledge to retry.`;
  return (
    <Tip text={text} side="bottom">
      <Link
        to="/p/$projectId/knowledge"
        params={{ projectId }}
        aria-label={`Knowledge version ${k.graph_version}: ${state === 'current' ? 'up to date' : state}`}
        data-freshness={state}
        className="flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 text-[13px] text-ink-2 hover:bg-line-soft"
      >
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            state === 'current' && 'bg-ink',
            state === 'updating' && 'animate-pulse-soft bg-working shadow-[0_0_0_3px_var(--color-working-bg)]',
            state === 'behind' && 'bg-problem-fill',
          )}
        />
        Knowledge <span className="font-mono text-xs text-muted">v{k.graph_version}</span>
      </Link>
    </Tip>
  );
}

function PersonMenu() {
  const person = usePerson();
  const projectId = useProjectId();
  const devTools = hasDevTools(useQuery(sessionQuery).data);
  const client = useQueryClient();
  const navigate = useNavigate();
  const signOut = async () => {
    try {
      await request('DELETE', '/api/session');
    } finally {
      setCsrf(null);
      client.clear();
      await navigate({ to: '/sign-in' });
    }
  };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex h-8 items-center gap-2 rounded-[var(--radius-control)] px-2 text-[13px] font-medium text-ink hover:bg-line-soft"
        aria-label={`Signed in as ${person ?? ''}`}
      >
        <WhoGlyph kind="you" size={20} />
        {person}
        <ChevronDown size={12} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-48 animate-fade-in rounded-[var(--radius-control)] border border-line bg-surface p-1 shadow-[0_12px_32px_rgba(29,28,26,0.12)]"
        >
          <DropdownMenu.Label className="px-2.5 py-1.5 text-xs text-muted">Signed in as {person}</DropdownMenu.Label>
          <DropdownMenu.Item
            onSelect={() => void navigate({ to: '/p/$projectId/models', params: { projectId } })}
            className="cursor-pointer rounded-md px-2.5 py-1.5 text-[13px] text-ink outline-none data-[highlighted]:bg-line-soft"
          >
            Models &amp; providers
          </DropdownMenu.Item>
          {devTools ? (
            <DropdownMenu.Item
              // Once the menu has closed and given the focus back: then the dialog takes it.
              onSelect={() => setTimeout(openDevPanel, 0)}
              className="cursor-pointer rounded-md px-2.5 py-1.5 text-[13px] text-ink outline-none data-[highlighted]:bg-line-soft"
            >
              Snapshots…
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Item
            onSelect={() => void signOut()}
            className="cursor-pointer rounded-md px-2.5 py-1.5 text-[13px] text-ink outline-none data-[highlighted]:bg-line-soft"
          >
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

type ProductView = 'overview' | 'map' | 'origins' | 'journeys';

/** Subtabs of "Product" (canvas, step 2): Overview, Map, Origins and Journeys. */
export function ProductTabs({ active }: { active: ProductView }) {
  const projectId = useProjectId();
  const item = (
    key: ProductView,
    label: string,
    to: '/p/$projectId' | '/p/$projectId/map' | '/p/$projectId/origins' | '/p/$projectId/journeys',
  ) => (
    <Link
      to={to}
      params={{ projectId }}
      aria-current={active === key ? 'page' : undefined}
      className={cn(
        'border-b-2 px-1 pb-2 text-[13px] font-medium',
        active === key ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Product views" className="mb-6 flex gap-5 border-b border-line">
      {item('overview', 'Overview', '/p/$projectId')}
      {item('map', 'Map', '/p/$projectId/map')}
      {item('origins', 'Origins', '/p/$projectId/origins')}
      {item('journeys', 'Journeys', '/p/$projectId/journeys')}
    </nav>
  );
}
