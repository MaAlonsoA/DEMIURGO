// The live connection (DESIGN.md §4.6): "Live" in the sidebar while the stream is open; after
// 1.5 s down, a banner at the top of the page says updates are paused and what you see may be out
// of date, with Retry now. If the browser gave up (the stream was refused), the banner checks the
// session — a lost session goes to Sign in — and otherwise offers Reload. Controls stay enabled:
// a command that fails explains itself (R76, R77).

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { sessionQuery } from '../api/queries.ts';
import { reconnect, useConnection } from '../api/stream.ts';
import { Button } from '../components/Button.tsx';
import { Banner } from '../components/Notice.tsx';
import { cn } from '../lib/cn.ts';

/** "Live" · "Reconnecting…" · "Offline", with a dot of its shape and tone. */
export function LiveStatus({ compact }: { compact?: boolean }) {
  const c = useConnection();
  const word = c === 'open' ? 'Live' : c === 'closed' ? 'Offline' : c === 'down' ? 'Reconnecting…' : 'Connecting…';
  return (
    <span
      className="inline-flex min-w-0 items-center gap-2 text-sm text-fg-2"
      data-connection={c}
      title={`Live updates: ${word}`}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block h-2 w-2 shrink-0 rounded-full',
          c === 'open' && 'bg-success',
          (c === 'down' || c === 'connecting') && 'animate-breathe bg-warning',
          c === 'closed' && 'border-2 border-danger bg-transparent',
        )}
      />
      <span className={compact ? 'sr-only' : 'truncate'}>{word}</span>
    </span>
  );
}

export function ConnectionBanner() {
  const c = useConnection();
  const client = useQueryClient();
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (c !== 'down' && c !== 'closed') {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), c === 'closed' ? 0 : 1500);
    return () => clearTimeout(t);
  }, [c]);

  // The browser gave up: if the session ended, Sign in (keeping where the person was).
  useEffect(() => {
    if (c !== 'closed') return;
    let alive = true;
    void client.fetchQuery({ ...sessionQuery, staleTime: 0 }).then(
      (s) => {
        if (alive && !s) {
          const here = router.state.location.href;
          void router.navigate({ to: '/sign-in', search: { next: here } });
        }
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [c, client, router]);

  if (!visible) return null;
  if (c === 'closed')
    return (
      <Banner
        tone="danger"
        className="sticky top-0 z-20"
        action={
          <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      >
        Can't reconnect to DEMIURGO: live updates stopped. Reload the page to see them again.
      </Banner>
    );
  return (
    <Banner
      tone="warning"
      className="sticky top-0 z-20"
      action={
        <Button size="sm" variant="secondary" onClick={reconnect}>
          Retry now
        </Button>
      }
    >
      Live updates paused — reconnecting. What you see may be out of date; you can keep working.
    </Banner>
  );
}
