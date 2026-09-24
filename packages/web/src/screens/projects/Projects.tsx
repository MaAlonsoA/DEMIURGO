// Choose a project (only shown with more than one).

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { projectsQuery } from '../../api/queries.ts';
import { shortDate } from '../../lib/time.ts';
import { buttonStyles } from '../../ui/Button.tsx';
import { ChevronRight } from '../../ui/icons.tsx';
import { EmptyState, Loading } from '../../ui/layout.tsx';

export function ProjectsScreen() {
  const projects = useQuery(projectsQuery);
  return (
    <main id="main" className="mx-auto flex min-h-screen w-[640px] flex-col gap-6 py-16">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-bold tracking-[0.14em]">DEMIURGO</span>
          <h1 className="text-[28px] font-semibold">Your projects</h1>
        </div>
        <Link to="/new" className={buttonStyles({ variant: 'ink', size: 'md' })}>
          New project
        </Link>
      </div>
      {projects.isPending ? (
        <Loading label="Loading projects" />
      ) : (projects.data ?? []).length === 0 ? (
        <EmptyState>There are no projects yet. Start one with New project.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {(projects.data ?? []).map((p) => (
            <li key={p.id}>
              <Link
                to="/p/$projectId"
                params={{ projectId: p.id }}
                className="flex items-center justify-between rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 hover:border-line-strong"
              >
                <span className="flex flex-col">
                  <strong className="text-[15px] font-semibold">{p.name}</strong>
                  <span className="text-xs text-muted">Created {shortDate(p.created_at)}</span>
                </span>
                <ChevronRight size={14} className="text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
