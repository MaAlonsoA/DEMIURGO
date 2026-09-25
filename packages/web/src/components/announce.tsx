// The shell's live region (DESIGN.md §2.3): one polite `role="status"` for the results of the
// person's actions and the state changes they wait for. Throttled — the same message is not
// repeated within 2 s — and never fed streamed tokens or every event (WCAG 4.1.3, R80, R92).

import { useEffect, useState } from 'react';

type Listener = (message: string) => void;
const listeners = new Set<Listener>();
let last = { text: '', at: 0 };

/** Say something politely to screen readers ("Accepted. 3 left in Needs you."). */
export function announce(text: string): void {
  const now = Date.now();
  if (!text || (text === last.text && now - last.at < 2000)) return;
  last = { text, at: now };
  for (const l of listeners) l(text);
}

/** Mounted once in the app root. */
export function Announcer() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    const l: Listener = (text) => {
      // Clearing first makes screen readers announce a repeated text again.
      setMessage('');
      setTimeout(() => setMessage(text), 50);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-announcer>
      {message}
    </div>
  );
}
