// Header, always visible (spec §3): the design system's Header with DEMIURGO and the project, the
// sections, and Needs you on the right with its blue count; before it, search, the freshness of
// the knowledge and the person's menu with "Models & providers", "Sign out" (and, with the dev
// tools on, "Snapshots…").

import { Header as DsHeader, type LinkRenderer } from '@demiurgo/design-system';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { DropdownMenu } from 'radix-ui';
import { request, setCsrf } from '../../api/client.ts';
import { inboxQuery, knowledgeQuery, projectsQuery, sessionQuery } from '../../api/queries.ts';
import { cn } from '../../lib/cn.ts';
import { useProjectId, usePerson } from '../../lib/hooks.ts';
import { ChevronDown } from '../../ui/icons.tsx';
import { useLegendMark } from '../../ui/legend-store.ts';
import { WhoGlyph } from '../../ui/signals.tsx';
import { Tip } from '../../ui/Tip.tsx';
import { hasDevTools, openDevPanel } from '../dev/snapshots.ts';
import { Search } from './Search.tsx';

type Section = { label: string; to: string; match: RegExp };

const NEEDS_YOU = 'Needs you';

const SECTIONS: Section[] = [
  { label: 'Product', to: '/p/$projectId', match: /^\/p\/[^/]+(\/(origins|records|map|journeys)(\/.*)?)?\/?$/ },
  { label: 'Threads', to: '/p/$projectId/threads', match: /^\/p\/[^/]+\/threads/ },
  { label: 'Knowledge', to: '/p/$projectId/knowledge', match: /^\/p\/[^/]+\/knowledge/ },
  { label: 'Sources', to: '/p/$projectId/sources', match: /^\/p\/[^/]+\/sources/ },
  { label: 'Activity', to: '/p/$projectId/activity', match: /^\/p\/[^/]+\/(activity|runs)/ },
  { label: NEEDS_YOU, to: '/p/$projectId/needs-you', match: /^\/p\/[^/]+\/(needs-you|batches)/ },
];

export function Header() {
  const projectId = useProjectId();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const projects = useQuery(projectsQuery).data ?? [];
  const project = projects.find((p) => p.id === projectId);
  const needs = useQuery(inboxQuery(projectId)).data?.total ?? 0;
  useLegendMark(needs > 0 ? 'needs' : null);
  const current = SECTIONS.find((s) => s.match.test(pathname))?.label ?? '';

  // Each section, and Needs you, is a link of the router; Needs you carries its count (data-needs).
  const link: LinkRenderer = (target, props) => {
    const section = SECTIONS.find((s) => s.label === target);
    if (!section) return null;
    const count = target === NEEDS_YOU && needs > 0 ? { 'data-needs': needs } : {};
    return <Link to={section.to as '/p/$projectId'} params={{ projectId }} {...props} {...count} />;
  };

  return (
    <div className="sticky top-0 z-30">
      <DsHeader
        project={
          <span className="flex items-center gap-2">
            <span className="max-w-[220px] truncate">{project?.name ?? ''}</span>
            {projects.length > 1 && (
              <Link to="/projects" className="dm-text-caption font-medium text-muted hover:text-ink">
                Switch
              </Link>
            )}
            <Link to="/new" className="dm-text-caption font-medium text-muted hover:text-ink">
              New project
            </Link>
          </span>
        }
        tabs={SECTIONS.filter((s) => s.label !== NEEDS_YOU).map((s) => s.label)}
        current={current}
        needs={needs}
        link={link}
        actions={
          <>
            <Search projectId={projectId} />
            <Freshness projectId={projectId} />
            <PersonMenu />
          </>
        }
      />
    </div>
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
        className="dm-text-small flex items-center gap-2 rounded-tab px-2 py-1 text-ink-2 hover:bg-line-soft"
      >
        {/* Ink when up to date, the design system's Working dot while updating, rust when behind. */}
        {state === 'updating' ? (
          <span className="dm-working-dot" />
        ) : (
          <span className={cn('dm-dot dm-dot--sm', state === 'current' ? 'bg-ink' : 'bg-problem-fill')} />
        )}
        Knowledge <span className="dm-code">v{k.graph_version}</span>
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
        className="dm-text-small flex h-8 items-center gap-2 rounded-control px-2 font-medium text-ink hover:bg-line-soft"
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
          className="z-50 min-w-48 animate-fade-in rounded-control border border-line bg-surface p-1 shadow-float"
        >
          <DropdownMenu.Label className="dm-text-caption px-2.5 py-1.5 text-muted">Signed in as {person}</DropdownMenu.Label>
          <DropdownMenu.Item
            onSelect={() => void navigate({ to: '/p/$projectId/models', params: { projectId } })}
            className="dm-text-small cursor-pointer rounded-tab px-2.5 py-1.5 text-ink outline-none data-[highlighted]:bg-line-soft"
          >
            Models &amp; providers
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => void navigate({ to: '/p/$projectId/agent-keys', params: { projectId } })}
            className="dm-text-small cursor-pointer rounded-tab px-2.5 py-1.5 text-ink outline-none data-[highlighted]:bg-line-soft"
          >
            Agent keys
          </DropdownMenu.Item>
          {devTools ? (
            <DropdownMenu.Item
              // Once the menu has closed and given the focus back: then the dialog takes it.
              onSelect={() => setTimeout(openDevPanel, 0)}
              className="dm-text-small cursor-pointer rounded-tab px-2.5 py-1.5 text-ink outline-none data-[highlighted]:bg-line-soft"
            >
              Snapshots…
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Item
            onSelect={() => void signOut()}
            className="dm-text-small cursor-pointer rounded-tab px-2.5 py-1.5 text-ink outline-none data-[highlighted]:bg-line-soft"
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
        'dm-text-small border-b-2 px-1 pb-2 font-medium',
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
