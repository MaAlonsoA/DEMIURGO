// Root of the app: tooltips, the legend, the dev tools (only with DEMIURGO_DEV_TOOLS=1) and what
// happens on a 401 anywhere (back to "Sign in", keeping the route).

import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { onUnauthorized } from '../../api/client.ts';
import { keys } from '../../api/queries.ts';
import { Legend } from '../../ui/Legend.tsx';
import { LegendContext, createLegendStore } from '../../ui/legend-store.ts';
import { TipProvider } from '../../ui/Tip.tsx';
import { DevTools } from '../dev/DevTools.tsx';

export function AppRoot() {
  const router = useRouter();
  const client = useQueryClient();
  const [legend] = useState(createLegendStore);

  useEffect(
    () =>
      onUnauthorized(() => {
        client.setQueryData(keys.session, null);
        const here = router.state.location.href;
        if (!here.startsWith('/sign-in')) void router.navigate({ to: '/sign-in', search: { next: here } });
      }),
    [client, router],
  );

  return (
    <TipProvider>
      <LegendContext.Provider value={legend}>
        <a
          href="#main"
          className="sr-only dm-text-body rounded-tag bg-ink px-3 py-2 text-surface focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
        >
          Skip to content
        </a>
        <Outlet />
        <Legend />
        <DevTools />
      </LegendContext.Provider>
    </TipProvider>
  );
}
