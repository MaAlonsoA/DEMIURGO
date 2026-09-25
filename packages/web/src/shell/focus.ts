// After a navigation, the focus goes to the new page's title and its name is announced (DESIGN.md
// §2.3, R93): it never stays on a link that is gone, nor falls to <body>. Only path changes move it;
// a search parameter (a tab, a filter) leaves the focus where the person put it.

import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { announce } from '../components/announce.tsx';

export function useRouteFocus(): void {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The page may still be loading: wait for its title for up to 2 s.
    const attempt = () => {
      const title = document.getElementById('page-title');
      if (title) {
        if (!title.contains(document.activeElement) && document.activeElement?.closest('[role="dialog"]') == null) {
          title.focus({ preventScroll: true });
        }
        announce(title.textContent ?? '');
        return;
      }
      if (tries++ < 20) timer = setTimeout(attempt, 100);
    };
    timer = setTimeout(attempt, 50);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [pathname]);
}
