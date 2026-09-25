// The four views of the product (DESIGN.md §2.1): Overview, Map, Journeys, Origins — tabs with
// their own URL under the Product page header.

import { LinkTabs } from '../components/Tabs.tsx';
import { useProjectId } from '../lib/hooks.ts';

export type ProductView = 'overview' | 'map' | 'origins' | 'journeys';

export function ProductTabs({ active, className }: { active: ProductView; className?: string }) {
  const projectId = useProjectId();
  return (
    <LinkTabs
      label="Product views"
      {...(className ? { className } : {})}
      tabs={[
        {
          key: 'overview',
          label: 'Overview',
          current: active === 'overview',
          link: { to: '/p/$projectId', params: { projectId } },
        },
        { key: 'map', label: 'Map', current: active === 'map', link: { to: '/p/$projectId/map', params: { projectId } } },
        {
          key: 'journeys',
          label: 'Journeys',
          current: active === 'journeys',
          link: { to: '/p/$projectId/journeys', params: { projectId } },
        },
        {
          key: 'origins',
          label: 'Origins',
          current: active === 'origins',
          link: { to: '/p/$projectId/origins', params: { projectId } },
        },
      ]}
    />
  );
}
