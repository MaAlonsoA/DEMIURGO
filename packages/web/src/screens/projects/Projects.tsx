// Choose a project (only shown with more than one): each one on the design system's card.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { projectsQuery } from '../../api/queries.ts';
import { shortDate } from '../../lib/time.ts';
import { buttonClass } from '../../ui/Button.tsx';
import { ChevronRight } from '../../ui/icons.tsx';
import { EmptyState, Loading } from '../../ui/layout.tsx';

export function ProjectsScreen() {
  const projects = useQuery(projectsQuery);
  return (
    <main id="main" className="mx-auto flex min-h-screen w-[640px] flex-col gap-6 py-16">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="dm-text-wordmark">DEMIURGO</span>
          <h1 className="dm-text-page-title font-semibold">Your projects</h1>
        </div>
        <Link to="/new" className={buttonClass('secondary')}>
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
                className="dm-card flex-row items-center justify-between hover:border-line-strong"
              >
                <span className="flex flex-col">
                  <strong className="dm-text-heading font-semibold">{p.name}</strong>
                  <span className="dm-text-caption text-muted">Created {shortDate(p.created_at)}</span>
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
