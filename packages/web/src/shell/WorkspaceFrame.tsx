// Pages outside a project (/projects, /new, /models): a slim top bar with DEMIURGO, the way to the
// projects, to a new project and to Models & providers, Help and the person's menu — so Sign out exists everywhere
// (INVENTORY §2 #22). The page itself is centred on the working panel.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { projectsQuery } from '../api/queries.ts';
import { HelpIcon } from '../components/icons.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { cn } from '../lib/cn.ts';
import { useRouteFocus } from './focus.ts';
import { openHelp } from './Help.tsx';
import { PersonMenu } from './PersonMenu.tsx';

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn('inline-flex items-center gap-2 rounded-md text-base font-semibold text-fg', className)}>
      <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-sm text-on-accent">
        D
      </span>
      DEMIURGO
    </Link>
  );
}

const linkClass = (active: boolean) =>
  cn(
    'inline-flex h-8 items-center rounded-md px-2.5 text-base',
    active ? 'bg-selected font-medium text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg',
  );

export function WorkspaceFrame({ children, current }: { children: ReactNode; current?: 'projects' | 'models' | 'new' }) {
  useRouteFocus();
  const projects = useQuery(projectsQuery).data ?? [];
  return (
    <div className="flex min-h-screen flex-col bg-app font-ui text-fg">
      <header className="flex h-14 items-center gap-2 px-4 sm:px-6">
        <Wordmark />
        <nav aria-label="Workspace" className="ml-4 flex items-center gap-1">
          {projects.length > 0 ? (
            <Link
              to="/projects"
              aria-current={current === 'projects' ? 'page' : undefined}
              className={linkClass(current === 'projects')}
            >
              Your projects
            </Link>
          ) : null}
          <Link to="/new" aria-current={current === 'new' ? 'page' : undefined} className={linkClass(current === 'new')}>
            New project
          </Link>
          <Link to="/models" aria-current={current === 'models' ? 'page' : undefined} className={linkClass(current === 'models')}>
            Models &amp; providers
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip content="Help (?)">
            <button
              type="button"
              aria-label="Help"
              onClick={openHelp}
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
            >
              <HelpIcon size={17} />
            </button>
          </Tooltip>
          <div className="w-44">
            <PersonMenu />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none sm:px-2 sm:pb-2">
        <div className="flex flex-1 flex-col bg-panel sm:rounded-lg sm:border sm:border-edge">{children}</div>
      </main>
    </div>
  );
}
