// Root of the app (DESIGN.md §2.3): the skip link, tooltips, the live region, Help ("?"), the dev
// tools (only with DEMIURGO_DEV_TOOLS=1) and what happens on a 401 anywhere: back to Sign in,
// keeping the route.

import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { onUnauthorized } from '../api/client.ts';
import { keys } from '../api/queries.ts';
import { Announcer } from '../components/announce.tsx';
import { TooltipProvider } from '../components/Tooltip.tsx';
import { DevPanel } from './DevPanel.tsx';
import { Help } from './Help.tsx';
import './theme.ts';

export function AppRoot() {
  const router = useRouter();
  const client = useQueryClient();

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
    <TooltipProvider>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-inverse px-3 py-2 text-base text-on-inverse focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <Outlet />
      <Help />
      <DevPanel />
      <Announcer />
    </TooltipProvider>
  );
}
