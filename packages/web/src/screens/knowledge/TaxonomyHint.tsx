// While a project has no approved taxonomy, what DEMIURGO knows is not grouped: this hint says so
// where the person is (the product overview, the end of Day 1) and takes them to set one up, or to
// approve the one that waits. It renders nothing once a taxonomy is approved.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { taxonomiesQuery } from '../../api/queries.ts';
import { ChevronRightIcon, TagIcon } from '../../components/icons.tsx';
import { useMessages } from '../../i18n/define.ts';
import { TAXONOMY_HINT } from './words.i18n.ts';

export function TaxonomyHint({ projectId }: { projectId: string }) {
  const t = useMessages(TAXONOMY_HINT);
  const list = useQuery(taxonomiesQuery(projectId));
  if (!list.data || list.data.some((x) => x.state === 'approved')) return null;
  const proposed = list.data.some((x) => x.state === 'draft');
  return (
    <div data-taxonomy-hint className="flex items-start gap-2.5 rounded-lg border border-edge bg-sunken px-3.5 py-3 text-sm">
      <TagIcon size={16} className="mt-0.5 shrink-0 text-fg-3" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-fg-2">{proposed ? t.waitingApproval : t.notGrouped}</p>
        <Link
          to="/p/$projectId/knowledge"
          params={{ projectId }}
          search={{ tab: 'taxonomy' }}
          className="inline-flex min-h-6 items-center gap-0.5 self-start font-medium text-accent-text underline-offset-2 hover:underline"
        >
          {proposed ? t.reviewTaxonomy : t.setUpGrouping}
          <ChevronRightIcon size={14} />
        </Link>
      </div>
    </div>
  );
}
