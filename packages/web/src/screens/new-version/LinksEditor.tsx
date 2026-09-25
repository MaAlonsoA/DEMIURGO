// The links a person writes by hand, born with the version being written (DESIGN.md §3.6,
// INV-NEWREC-09, INV-NEWVER-10): each with its type in product words, the record it points to and
// a Remove — carried links of a new version too, which the old form could not remove (INVENTORY
// INV-NEWVER, UX problem). Records to link to are grouped by type.

import { useState } from 'react';
import { Code, Tag } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Field, Select } from '../../components/Field.tsx';
import { PlusIcon } from '../../components/icons.tsx';
import { TYPE_WORDS_PLURAL } from '../../words.ts';
import { LINK_WORDS } from '../record/logic.ts';
import { FormPanel } from './FormParts.tsx';
import type { LinkInput } from './form.ts';
import { type LinkTarget, MANUAL_LINK_TYPES, addLink, removeLink } from './links.ts';

const keyOf = (l: LinkInput) => `${l.type}:${l.target.code}`;

export function LinksEditor({
  targets,
  links,
  onChange,
  carried = [],
  note,
}: {
  targets: readonly LinkTarget[];
  links: readonly LinkInput[];
  onChange: (links: LinkInput[]) => void;
  /** Links that come from the base version (shown as carried; they can be removed too). */
  carried?: readonly LinkInput[];
  note?: string;
}) {
  const [type, setType] = useState<string>(MANUAL_LINK_TYPES[0]);
  const [code, setCode] = useState('');
  const target = targets.find((t) => t.code === code);
  const titleOf = new Map(targets.map((t) => [t.code, t.title]));
  const carriedKeys = new Set(carried.map(keyOf));
  const groups = [...new Set(targets.map((t) => t.type))];
  const add = () => {
    if (!target) return;
    const link = { type, target: { code: target.code, version: target.version } };
    // The same type to the same record replaces the one there (a carried link to an older version).
    onChange(addLink(removeLink(links, link), link));
    setCode('');
  };
  return (
    <FormPanel
      title={
        <>
          Links <span className="font-normal text-fg-2">· {links.length}</span>
        </>
      }
      note={note ?? 'What this record builds on, designs, covers or conflicts with. Links are born with the version.'}
    >
      {links.length > 0 ? (
        <ul className="flex flex-col divide-y divide-edge-subtle rounded-md border border-edge">
          {links.map((l) => (
            <li
              key={keyOf(l)}
              data-new-link={l.target.code}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
            >
              <span className="text-fg-2">{LINK_WORDS[l.type] ?? l.type}</span>
              <span className="min-w-0 flex-1 basis-40 truncate font-medium text-fg">
                {titleOf.get(l.target.code) ?? l.target.code}
              </span>
              <Code>
                {l.target.code} v{l.target.version}
              </Code>
              {carriedKeys.has(keyOf(l)) ? <Tag>Carried</Tag> : null}
              <Button
                size="sm"
                variant="quiet"
                aria-label={`Remove the link to ${l.target.code}`}
                onClick={() => onChange(removeLink(links, l))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {targets.length === 0 ? (
        <p className="text-sm text-fg-2">There is nothing else to link to yet.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Link type" className="w-44">
            {(p) => (
              <Select {...p} value={type} onChange={(e) => setType(e.target.value)}>
                {MANUAL_LINK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LINK_WORDS[t] ?? t}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Links to" className="min-w-0 flex-1 basis-64">
            {(p) => (
              <Select {...p} value={code} onChange={(e) => setCode(e.target.value)}>
                <option value="">Choose a record…</option>
                {groups.map((g) => (
                  <optgroup key={g} label={TYPE_WORDS_PLURAL[g] ?? g}>
                    {targets
                      .filter((t) => t.type === g)
                      .map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.code} v{t.version} · {t.title}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
          <Button icon={<PlusIcon size={14} />} disabled={!target} onClick={add}>
            Add link
          </Button>
        </div>
      )}
    </FormPanel>
  );
}
