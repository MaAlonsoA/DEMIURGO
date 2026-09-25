// The links a person writes by hand, born with the version being written (New record, New
// version): the type in product words and the record it points to, at its current version.

import { useId, useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { Code } from '../../ui/Card.tsx';
import { PlusIcon } from '../../ui/icons.tsx';
import { LINK_WORDS } from '../record/logic.ts';
import { field } from './CheckEditor.tsx';
import type { LinkInput } from './form.ts';
import { type LinkTarget, MANUAL_LINK_TYPES, addLink, removeLink } from './links.ts';

export function LinksEditor({
  targets,
  links,
  onChange,
}: {
  targets: readonly LinkTarget[];
  links: readonly LinkInput[];
  onChange: (links: LinkInput[]) => void;
}) {
  const id = useId();
  const [type, setType] = useState<string>(MANUAL_LINK_TYPES[0]);
  const [code, setCode] = useState('');
  const target = targets.find((t) => t.code === code);
  const titleOf = new Map(targets.map((t) => [t.code, t.title]));
  const add = () => {
    if (!target) return;
    onChange(addLink(links, { type, target: { code: target.code, version: target.version } }));
    setCode('');
  };
  return (
    <section aria-labelledby={`${id}-links`} className="flex flex-col gap-2.5">
      <h2 id={`${id}-links`} className="dm-text-caption font-semibold text-muted">
        Links <span className="font-normal">· {links.length}</span>
      </h2>
      {links.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-card border border-line bg-surface px-4 py-3">
          {links.map((l) => (
            <li
              key={`${l.type}-${l.target.code}`}
              data-new-link={l.target.code}
              className="dm-text-small flex items-center gap-2"
            >
              <span className="text-muted">{LINK_WORDS[l.type] ?? l.type}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{titleOf.get(l.target.code) ?? ''}</span>
              <Code className="shrink-0 whitespace-nowrap">
                {l.target.code} v{l.target.version}
              </Code>
              <Button
                variant="text"
                aria-label={`Remove the link to ${l.target.code}`}
                onClick={() => onChange(removeLink(links, l))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {targets.length === 0 ? (
        <p className="dm-text-small text-ink-3">There is nothing else to link to yet.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-type`} className="dm-text-caption font-semibold text-ink-2">
              Link type
            </label>
            <select id={`${id}-type`} value={type} onChange={(e) => setType(e.target.value)} className={field}>
              {MANUAL_LINK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {LINK_WORDS[t] ?? t}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-[260px] flex-1 flex-col gap-1">
            <label htmlFor={`${id}-target`} className="dm-text-caption font-semibold text-ink-2">
              Links to
            </label>
            <select id={`${id}-target`} value={code} onChange={(e) => setCode(e.target.value)} className={field}>
              <option value="">Choose a record…</option>
              {targets.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.code} v{t.version} · {t.title}
                </option>
              ))}
            </select>
          </div>
          <Button variant="secondary" disabled={!target} onClick={add}>
            <PlusIcon size={14} />
            Add link
          </Button>
        </div>
      )}
    </section>
  );
}
