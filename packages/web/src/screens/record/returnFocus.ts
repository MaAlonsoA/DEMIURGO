// Focus back to what opened a layer (DESIGN.md §6.6, R95). The kit's dialogs and preview sheet are
// opened from state, without a Radix trigger, so on close Radix has nothing to give the focus back
// to and it falls to <body>. This remembers the element focused when the layer opened and focuses
// it again once the layer has gone, unless the person already moved the focus somewhere else. When
// the opener is gone (Approve disappears once approved), the page's title takes the focus.

import { useRef } from 'react';

export function useReturnFocus(): { capture: () => void; restore: () => void } {
  const opener = useRef<HTMLElement | null>(null);
  return {
    capture: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    restore: () => {
      const el = opener.current;
      opener.current = null;
      if (!el) return;
      setTimeout(() => {
        const lost = !document.activeElement || document.activeElement === document.body;
        if (!lost) return;
        if (el.isConnected) el.focus();
        else document.getElementById('page-title')?.focus({ preventScroll: true });
        // After the layer has unmounted and Radix has let go of the focus.
      }, 50);
    },
  };
}
