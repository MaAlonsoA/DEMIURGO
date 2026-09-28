// Help, always in the same place (DESIGN.md §2.3, D-014; WCAG 3.2.6, R88): what each symbol means,
// who is who, the readiness track, and the keyboard. "?" opens it from anywhere except while
// typing. It replaces the legend that opened by itself over the content.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import { Readiness } from '../components/Meter.tsx';
import { StatusBadge } from '../components/status.tsx';
import { WhoAvatar } from '../components/Who.tsx';
import { useMessages } from '../i18n/define.ts';
import { type MarkKind, useMarks, useSafeLocale, whoPhraseFor } from '../words.ts';
import { HELP, HELP_KEYS } from './words.i18n.ts';

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

const GROUPS: { titleKey: 'howSure' | 'whereItStands' | 'setAside'; kinds: MarkKind[] }[] = [
  { titleKey: 'howSure', kinds: ['confirmed', 'assumed', 'proposed', 'open', 'unknown'] },
  { titleKey: 'whereItStands', kinds: ['working', 'done', 'stale', 'problem', 'conflict'] },
  { titleKey: 'setAside', kinds: ['parked', 'dropped', 'replaced', 'inactive'] },
];

const KEYS: { keys: string; whatKey: keyof typeof HELP_KEYS.en }[] = [
  { keys: 'Ctrl K  ·  ⌘ K', whatKey: 'search' },
  { keys: '?', whatKey: 'openHelp' },
  { keys: 'Esc', whatKey: 'closeLayer' },
  { keys: 'Enter', whatKey: 'send' },
  { keys: 'Shift Enter', whatKey: 'newLine' },
  { keys: 'Ctrl Enter  ·  ⌘ Enter', whatKey: 'askInThread' },
  { keys: '↑ ↓', whatKey: 'moveList' },
  { keys: '← →', whatKey: 'moveTabs' },
];

export function Help() {
  const t = useMessages(HELP);
  const tk = useMessages(HELP_KEYS);
  const marks = useMarks();
  const locale = useSafeLocale();
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
    <Dialog open={isOpen} onOpenChange={setOpen} title={t.title} description={t.description} wide>
      <div role="tablist" aria-label={t.title} className="-mt-1 flex gap-4 border-b border-edge">
        {(
          [
            ['symbols', t.symbols],
            ['keys', t.keyboard],
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
            <section key={g.titleKey} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-fg">{t[g.titleKey]}</h3>
              <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {g.kinds.map((k) => (
                  <li key={k} className="flex items-start gap-2.5">
                    <StatusBadge kind={k} />
                    <span className="text-sm text-fg-2">{marks[k].phrase}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-fg">{t.whoDidIt}</h3>
            <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {(['you', 'demiurgo', 'agent', 'automatic'] as const).map((k) => (
                <li key={k} className="flex items-start gap-2.5">
                  <WhoAvatar kind={k} size={20} />
                  <span className="text-sm">
                    <span className="font-medium text-fg">{t[k]}</span>
                    <span className="text-fg-2"> · {whoPhraseFor(locale, k)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-fg">{t.readyToBuild}</h3>
            <p className="text-sm text-fg-2">{t.readyToBuildBody}</p>
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
          <caption className="sr-only">{t.keyboardShortcuts}</caption>
          <tbody className="divide-y divide-edge-subtle">
            {KEYS.map((k) => (
              <tr key={k.keys}>
                <th scope="row" className="w-48 py-2 pr-4 text-left font-medium whitespace-nowrap text-fg">
                  <kbd className="font-code text-sm">{k.keys}</kbd>
                </th>
                <td className="py-2 text-fg-2">{tk[k.whatKey]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
