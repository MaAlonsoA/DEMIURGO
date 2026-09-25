// Every project screen (DESIGN.md §2): the sidebar on the left (a drawer under 1024 px), the page
// on a working panel beside it, the connection banner on top of the page, the event stream, the
// command menu, the tab title with what waits, and the focus moved to each new page's title.

import { useQuery } from '@tanstack/react-query';
import { Outlet } from '@tanstack/react-router';
import { Dialog as D } from 'radix-ui';
import { useEffect, useState } from 'react';
import { inboxQuery, projectsQuery } from '../api/queries.ts';
import { useProjectStream } from '../api/stream.ts';
import { Count } from '../components/Badge.tsx';
import { MenuIcon, SearchIcon } from '../components/icons.tsx';
import { cn } from '../lib/cn.ts';
import { useProjectId } from '../lib/hooks.ts';
import { CommandMenu, openCommandMenu } from './CommandMenu.tsx';
import { ConnectionBanner } from './Connection.tsx';
import { useRouteFocus } from './focus.ts';
import { Sidebar } from './Sidebar.tsx';
import { setTitleCount } from './title.ts';

const COLLAPSED = 'dm-sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED) === '1';
  } catch {
    return false;
  }
}

export function ProjectShell() {
  const projectId = useProjectId();
  useProjectStream(projectId);
  useRouteFocus();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const needs = useQuery(inboxQuery(projectId)).data?.total ?? 0;
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);

  useEffect(() => {
    setTitleCount(needs);
    return () => setTitleCount(0);
  }, [needs]);

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED, c ? '0' : '1');
      } catch {
        // A per-visit preference then.
      }
      return !c;
    });

  return (
    <div className="min-h-screen bg-app font-ui text-fg">
      {/* Desktop: a fixed sidebar. */}
      <div className={cn('fixed inset-y-0 left-0 z-30 hidden bg-app lg:block', collapsed ? 'w-[60px]' : 'w-[248px]')}>
        <Sidebar projectId={projectId} compact={collapsed} onToggle={toggle} />
      </div>

      {/* Small screens: a top bar and the sidebar in a drawer. */}
      <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-edge bg-app px-2 lg:hidden">
        <D.Root open={drawer} onOpenChange={setDrawer}>
          <D.Trigger asChild>
            <button
              type="button"
              aria-label="Open the sections"
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-fg-2 hover:bg-hover"
            >
              <MenuIcon size={18} />
            </button>
          </D.Trigger>
          <D.Portal>
            <D.Overlay className="fixed inset-0 z-40 animate-enter bg-scrim lg:hidden" />
            <D.Content
              aria-describedby={undefined}
              className="fixed inset-y-0 left-0 z-50 w-[min(300px,85vw)] animate-enter bg-app shadow-dialog lg:hidden"
            >
              <D.Title className="sr-only">Sections</D.Title>
              <Sidebar projectId={projectId} onNavigate={() => setDrawer(false)} />
            </D.Content>
          </D.Portal>
        </D.Root>
        <span className="min-w-0 flex-1 truncate text-base font-semibold">{project?.name ?? ''}</span>
        <Count n={needs} label={`${needs} ${needs === 1 ? 'thing needs' : 'things need'} you`} />
        <button
          type="button"
          aria-label="Search (Ctrl K)"
          onClick={openCommandMenu}
          className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-fg-2 hover:bg-hover"
        >
          <SearchIcon size={18} />
        </button>
      </div>

      <div className={cn('lg:py-2 lg:pr-2', collapsed ? 'lg:pl-[60px]' : 'lg:pl-[248px]')}>
        <div className="flex min-h-[calc(100vh-48px)] flex-col bg-panel lg:min-h-[calc(100vh-16px)] lg:rounded-lg lg:border lg:border-edge">
          <ConnectionBanner />
          <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
            <Outlet />
          </main>
        </div>
      </div>
      <CommandMenu projectId={projectId} />
    </div>
  );
}
