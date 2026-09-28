// The four views of the product (DESIGN.md §2.1): Overview, Map, Journeys, Origins — tabs with
// their own URL under the Product page header.

import { LinkTabs } from '../components/Tabs.tsx';
import { useMessages } from '../i18n/define.ts';
import { useProjectId } from '../lib/hooks.ts';
import { PRODUCT_TABS } from './words.i18n.ts';

export type ProductView = 'overview' | 'map' | 'origins' | 'journeys';

export function ProductTabs({ active, className }: { active: ProductView; className?: string }) {
  const t = useMessages(PRODUCT_TABS);
  const projectId = useProjectId();
  return (
    <LinkTabs
      label={t.productViews}
      {...(className ? { className } : {})}
      tabs={[
        {
          key: 'overview',
          label: t.overview,
          current: active === 'overview',
          link: { to: '/p/$projectId', params: { projectId } },
        },
        { key: 'map', label: t.map, current: active === 'map', link: { to: '/p/$projectId/map', params: { projectId } } },
        {
          key: 'journeys',
          label: t.journeys,
          current: active === 'journeys',
          link: { to: '/p/$projectId/journeys', params: { projectId } },
        },
        {
          key: 'origins',
          label: t.origins,
          current: active === 'origins',
          link: { to: '/p/$projectId/origins', params: { projectId } },
        },
      ]}
    />
  );
}
