// While a project has no approved taxonomy, what DEMIURGO knows is not grouped: this hint says so
// where the person is (the product overview, the end of Day 1) and takes them to set one up, or to
// approve the one that waits. It renders nothing once a taxonomy is approved.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { taxonomiesQuery } from '../../api/queries.ts';
import { ChevronRightIcon, TagIcon } from '../../components/icons.tsx';

export function TaxonomyHint({ projectId }: { projectId: string }) {
  const list = useQuery(taxonomiesQuery(projectId));
  if (!list.data || list.data.some((t) => t.state === 'approved')) return null;
  const proposed = list.data.some((t) => t.state === 'draft');
  return (
    <div data-taxonomy-hint className="flex items-start gap-2.5 rounded-lg border border-edge bg-sunken px-3.5 py-3 text-sm">
      <TagIcon size={16} className="mt-0.5 shrink-0 text-fg-3" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-fg-2">
          {proposed
            ? 'A taxonomy is waiting for your approval: until then, what DEMIURGO knows is not grouped.'
            : "DEMIURGO doesn't group what it knows yet."}
        </p>
        <Link
          to="/p/$projectId/knowledge"
          params={{ projectId }}
          search={{ tab: 'taxonomy' }}
          className="inline-flex min-h-6 items-center gap-0.5 self-start font-medium text-accent-text underline-offset-2 hover:underline"
        >
          {proposed ? 'Review the taxonomy' : 'Set up how it groups knowledge'}
          <ChevronRightIcon size={14} />
        </Link>
      </div>
    </div>
  );
}
