// Your projects (DESIGN.md §3.9): the list to choose from, reached with two or more projects or
// from the project switcher. It lives in the workspace frame, so Models & providers and Sign out are
// at hand. Each project says its state in words (active or archived look different now), and a
// failed load says so with Retry — never "There are no projects yet" (INVENTORY §2 #5).

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { projectsQuery } from '../../api/queries.ts';
import type { Project } from '../../api/types.ts';
import { stateLabel } from '../../api/tables.ts';
import { buttonClass } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ChevronRightIcon, FolderIcon, PlusIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { usePageTitle } from '../../components/Page.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { StatusBadge } from '../../components/status.tsx';
import { useTables } from '../../lib/hooks.ts';
import { shortDate } from '../../lib/time.ts';
import { WorkspaceFrame } from '../../shell/WorkspaceFrame.tsx';

export function ProjectsScreen() {
  usePageTitle(['Your projects']);
  const projects = useQuery(projectsQuery);
  const list = projects.data ?? [];
  return (
    <WorkspaceFrame current="projects">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-10 pb-16 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 id="page-title" tabIndex={-1} className="text-xl font-semibold text-fg outline-none">
              Your projects
            </h1>
            {projects.data ? (
              <p className="text-sm text-fg-2">
                {list.length} {list.length === 1 ? 'project' : 'projects'}
              </p>
            ) : null}
          </div>
          <Link to="/new" className={buttonClass({ variant: 'primary' })}>
            <PlusIcon size={15} />
            New project
          </Link>
        </div>
        {projects.isPending ? (
          <RowsSkeleton label="Loading projects" rows={3} />
        ) : projects.error ? (
          <ErrorNotice error={projects.error} onRetry={() => void projects.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState icon={<FolderIcon size={28} />} title="There are no projects yet">
            Start one with New project.
          </EmptyState>
        ) : (
          <ul
            aria-label="Projects"
            className="flex flex-col divide-y divide-edge-subtle overflow-hidden rounded-lg border border-edge"
          >
            {list.map((p) => (
              <ProjectRow key={p.id} project={p} />
            ))}
          </ul>
        )}
      </div>
    </WorkspaceFrame>
  );
}

/** The tables' words for a project's state, until the tables arrive. */
const FALLBACK: Record<string, string> = { active: 'Active', archived: 'Archived' };

function ProjectRow({ project: p }: { project: Project }) {
  const tables = useTables();
  const archived = p.state === 'archived';
  return (
    <li>
      <Link
        to="/p/$projectId"
        params={{ projectId: p.id }}
        data-project={p.id}
        className="group flex min-h-14 items-center gap-3 px-4 py-2.5 -outline-offset-2 hover:bg-hover"
      >
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sunken text-sm font-semibold text-fg-2"
        >
          {p.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-base font-medium break-words text-fg group-hover:underline">{p.name}</span>
          <span className="text-sm text-fg-2">
            Created <time dateTime={p.created_at}>{shortDate(p.created_at)}</time>
          </span>
        </span>
        <StatusBadge
          kind={archived ? 'inactive' : 'open'}
          word={tables ? stateLabel(tables, 'project', p.state) : (FALLBACK[p.state] ?? p.state)}
        />
        <ChevronRightIcon size={16} className="shrink-0 text-fg-3" />
      </Link>
    </li>
  );
}
