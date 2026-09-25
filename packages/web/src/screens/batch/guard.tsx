// Unsaved "Change" edits are never lost silently (DESIGN.md §3.1.1, INVENTORY Part D §3 UX
// problem): while a proposal's "Your version" has changes, moving to another proposal, skipping it
// or leaving the page asks first. The guard wraps a page; the Change form reports whether it is
// dirty; lists and navigators ask the guard before they move (R87).

import { useBlocker } from '@tanstack/react-router';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../../components/Dialog.tsx';

type Guard = {
  /** The Change form of proposal `id` has (or no longer has) unsaved changes. */
  setDirty: (id: string, dirty: boolean) => void;
  /** Runs `move` now, or after the person agrees to drop their changes. */
  guard: (move: () => void) => void;
};

const NOOP: Guard = { setDirty: () => {}, guard: (move) => move() };
const GuardContext = createContext<Guard>(NOOP);

export function useEditGuard(): Guard {
  return useContext(GuardContext);
}

export function EditGuard({ children }: { children: ReactNode }) {
  const dirty = useRef(new Set<string>());
  const [pending, setPending] = useState<null | (() => void)>(null);
  const isDirty = useCallback(() => dirty.current.size > 0, []);

  // Leaving the page (a link, the sidebar, Back): the router asks first.
  const blocker = useBlocker({ shouldBlockFn: isDirty, enableBeforeUnload: isDirty, withResolver: true });

  const value = useMemo<Guard>(
    () => ({
      setDirty: (id, d) => {
        if (d) dirty.current.add(id);
        else dirty.current.delete(id);
      },
      guard: (move) => {
        if (dirty.current.size === 0) move();
        else setPending(() => move);
      },
    }),
    [],
  );

  const open = pending !== null || blocker.status === 'blocked';
  const cancel = () => {
    setPending(null);
    if (blocker.status === 'blocked') blocker.reset();
  };
  const discard = () => {
    dirty.current.clear();
    const move = pending;
    setPending(null);
    if (blocker.status === 'blocked') blocker.proceed();
    else move?.();
  };

  return (
    <GuardContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          if (!o) cancel();
        }}
        title="Leave your version?"
        description={
          <p>You changed this proposal and haven&apos;t accepted your version. If you leave, your changes are lost.</p>
        }
        confirm="Discard my changes"
        cancel="Keep editing"
        tone="danger"
        onConfirm={discard}
      />
    </GuardContext.Provider>
  );
}

/** Reports a form's dirty state to the guard while it is mounted. */
export function useReportDirty(id: string, dirty: boolean): void {
  const { setDirty } = useEditGuard();
  useEffect(() => {
    setDirty(id, dirty);
  }, [id, dirty, setDirty]);
  useEffect(() => () => setDirty(id, false), [id, setDirty]);
}
