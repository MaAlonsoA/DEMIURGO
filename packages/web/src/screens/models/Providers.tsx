// What each provider offers right now (INV-MODELS-05…08): one card per discovered catalog with its
// state in words (Ready, Not ready, Not installed), its version, what discovery said, its models
// with their efforts — the default one says so in text, not only with a border — and whether it
// keeps a conversation per thread.

import type { Catalog } from '../../api/models.ts';
import { Code, Tag } from '../../components/Badge.tsx';
import { StatusBadge } from '../../components/status.tsx';
import { RelativeTime } from '../../components/Time.tsx';
import { cn } from '../../lib/cn.ts';

export function ProviderCard({ catalog: c }: { catalog: Catalog }) {
  const state = !c.installed
    ? ({ kind: 'inactive', word: 'Not installed' } as const)
    : c.ready
      ? ({ kind: 'done', word: 'Ready' } as const)
      : ({ kind: 'problem', word: 'Not ready' } as const);
  return (
    <article
      data-provider={c.provider}
      aria-labelledby={`provider-${c.provider}`}
      className="flex flex-col gap-3 rounded-lg border border-edge bg-panel p-4"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={`provider-${c.provider}`} className="mr-auto text-base font-semibold text-fg">
          {c.label}
        </h3>
        <StatusBadge kind={state.kind} word={state.word} />
        {c.version ? <Code>v{c.version}</Code> : null}
      </header>
      {c.message ? <p className={cn('text-sm', c.ready ? 'text-fg-2' : 'text-danger-text')}>{c.message}</p> : null}
      {c.models.length > 0 ? (
        <ul aria-label={`Models of ${c.label}`} className="flex flex-col gap-2">
          {c.models.map((m) => (
            <li key={m.id} className="flex flex-col gap-1">
              <span className="text-sm font-medium text-fg">{m.label}</span>
              {m.efforts.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {m.efforts.map((e) => (
                    <Tag key={e} className={e === m.defaultEffort ? 'border-edge-strong text-fg' : undefined}>
                      {e === m.defaultEffort ? `${e} · default` : e}
                    </Tag>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-3">No models to offer.</p>
      )}
      <p className="mt-auto border-t border-edge-subtle pt-3 text-xs text-fg-2">
        {c.sessions ? 'Keeps a conversation per thread' : 'Sends the whole context every time'}
        <span aria-hidden className="text-fg-3">
          {' · '}
        </span>
        <span className="sr-only">. </span>
        <RelativeTime iso={c.discoveredAt} prefix="Checked" />
      </p>
    </article>
  );
}
