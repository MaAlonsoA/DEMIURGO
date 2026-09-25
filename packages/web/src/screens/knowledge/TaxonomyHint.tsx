// While a project has no approved taxonomy, what DEMIURGO knows is not grouped: this hint says so
// where the person is (the overview, the end of Day 1) and takes them to set one up.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { taxonomiesQuery } from '../../api/queries.ts';
import { ChevronRight } from '../../ui/icons.tsx';

export function TaxonomyHint({ projectId }: { projectId: string }) {
  const list = useQuery(taxonomiesQuery(projectId));
  if (!list.data || list.data.some((t) => t.state === 'approved')) return null;
  const proposed = list.data.some((t) => t.state === 'draft');
  return (
    <p data-taxonomy-hint className="dm-text-small rounded-control border border-line bg-surface-soft px-3 py-2.5 text-ink-2">
      {proposed
        ? 'A taxonomy is waiting for your approval: until then, what DEMIURGO knows is not grouped.'
        : "DEMIURGO doesn't group what it knows yet."}{' '}
      <Link
        to="/p/$projectId/knowledge"
        params={{ projectId }}
        search={{ tab: 'taxonomy' }}
        className="inline-flex items-center gap-0.5 font-semibold whitespace-nowrap text-needs-strong hover:underline"
      >
        {proposed ? 'Review the taxonomy' : 'Set up how it groups knowledge'}
        <ChevronRight size={11} />
      </Link>
    </p>
  );
}
