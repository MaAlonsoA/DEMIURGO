// Help, always in the same place (DESIGN.md §2.3, D-014; WCAG 3.2.6, R88): what each symbol means,
// who is who, the readiness track, and the keyboard. "?" opens it from anywhere except while
// typing. It replaces the legend that opened by itself over the content.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import { Readiness } from '../components/Meter.tsx';
import { StatusBadge } from '../components/status.tsx';
import { WhoAvatar } from '../components/Who.tsx';
import { MARKS, type MarkKind, WHO_PHRASES } from '../words.ts';

const listeners = new Set<() => void>();
let open = false;
function setOpen(v: boolean) {
  open = v;
  for (const l of listeners) l();
}
/** Opens Help from anywhere (the sidebar button, the command menu). */
export function openHelp(): void {
  setOpen(true);
}

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

const GROUPS: { title: string; kinds: MarkKind[] }[] = [
  { title: 'How sure it is', kinds: ['confirmed', 'assumed', 'proposed', 'open', 'unknown'] },
  { title: 'Where it stands', kinds: ['working', 'done', 'stale', 'problem', 'conflict'] },
  { title: 'Set aside', kinds: ['parked', 'dropped', 'replaced', 'inactive'] },
];

const KEYS: { keys: string; what: string }[] = [
  { keys: 'Ctrl K  ·  ⌘ K', what: 'Search, or go to a section' },
  { keys: '?', what: 'Open this help' },
  { keys: 'Esc', what: 'Close a dialog, a menu or a panel' },
  { keys: 'Enter', what: 'Send, in any box where you write to DEMIURGO' },
  { keys: 'Shift Enter', what: 'A new line in those boxes' },
  { keys: 'Ctrl Enter  ·  ⌘ Enter', what: 'Ask DEMIURGO, in a thread' },
  { keys: '↑ ↓', what: 'Move through a list, a menu or search results' },
  { keys: '← →', what: 'Move through tabs and choices; resize a side panel' },
];

export function Help() {
  const isOpen = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => open,
    () => false,
  );
  const [tab, setTab] = useState<'symbols' | 'keys'>('symbols');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={setOpen} title="Help" description="What the symbols mean, and the keyboard." wide>
      <div role="tablist" aria-label="Help" className="-mt-1 flex gap-4 border-b border-edge">
        {(
          [
            ['symbols', 'Symbols'],
            ['keys', 'Keyboard'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={
              tab === k
                ? 'relative h-9 cursor-pointer text-base font-medium text-fg after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent'
                : 'h-9 cursor-pointer text-base font-medium text-fg-2 hover:text-fg'
            }
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'symbols' ? (
        <div className="flex flex-col gap-5" data-help="symbols">
          {GROUPS.map((g) => (
            <section key={g.title} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-fg">{g.title}</h3>
              <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {g.kinds.map((k) => (
                  <li key={k} className="flex items-start gap-2.5">
                    <StatusBadge kind={k} />
                    <span className="text-sm text-fg-2">{MARKS[k].phrase}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-fg">Who did it</h3>
            <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {(['you', 'demiurgo', 'agent', 'automatic'] as const).map((k) => (
                <li key={k} className="flex items-start gap-2.5">
                  <WhoAvatar kind={k} size={20} />
                  <span className="text-sm">
                    <span className="font-medium text-fg">
                      {k === 'you' ? 'You' : k === 'demiurgo' ? 'DEMIURGO' : k === 'agent' ? 'Agent' : 'Automatic'}
                    </span>
                    <span className="text-fg-2"> · {WHO_PHRASES[k]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-fg">Ready to build</h3>
            <p className="text-sm text-fg-2">
              A feature is ready to build when nothing blocks it. The track has three steps: ready, built and verified; today only
              the first one fills.
            </p>
            <ul className="flex flex-col gap-2">
              <li>
                <Readiness stage="ready" />
              </li>
              <li>
                <Readiness stage="not-ready" blocking={2} />
              </li>
              <li>
                <Readiness stage="doubt" />
              </li>
            </ul>
          </section>
        </div>
      ) : (
        <table className="w-full text-sm" data-help="keys">
          <caption className="sr-only">Keyboard shortcuts</caption>
          <tbody className="divide-y divide-edge-subtle">
            {KEYS.map((k) => (
              <tr key={k.keys}>
                <th scope="row" className="w-48 py-2 pr-4 text-left font-medium whitespace-nowrap text-fg">
                  <kbd className="font-code text-sm">{k.keys}</kbd>
                </th>
                <td className="py-2 text-fg-2">{k.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
