// Focus back to what opened a layer (APG modal dialog, R95). The kit's dialogs and sheets open from
// state, without a Radix trigger, so on close Radix has nothing to return the focus to and it falls
// to <body>. This remembers the element focused when the layer opened and focuses it again on
// close; when that element is gone (Approve disappears once approved), the page's title takes it.

import { useLayoutEffect, useRef } from 'react';

/** Returns the `onCloseAutoFocus` handler for a Radix dialog opened by `open`. */
export function useReturnFocus(open: boolean): (event: Event) => void {
  const opener = useRef<HTMLElement | null>(null);
  // A layout effect runs before Radix moves the focus into the layer (in its passive effect).
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);
  return (event) => {
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) {
      event.preventDefault();
      el.focus();
      return;
    }
    const title = document.getElementById('page-title');
    if (title) {
      event.preventDefault();
      title.focus({ preventScroll: true });
    }
  };
}
