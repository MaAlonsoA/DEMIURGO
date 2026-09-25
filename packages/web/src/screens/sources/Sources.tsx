// Sources (DESIGN.md §3.8, spec §4.11): what the person and agents give DEMIURGO to read — a name, a
// content hash, who registered it and when. An agent's source is untrusted input, and the page says
// what that means in text. Times show their absolute value and every hash can be read in full, with
// no hover needed. "Add a source" is the form of source.register built from its JSON Schema; its
// success message stays until the next change (INV-SRC-01…04).

import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { projectsQuery, sourcesQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { JsonSchema, Source } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Field, TextArea, TextInput } from '../../components/Field.tsx';
import { AlertTriangleIcon, ChevronRightIcon, SourcesIcon } from '../../components/icons.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, WithAside, usePageTitle } from '../../components/Page.tsx';
import { Bone, RowsSkeleton, Skeleton } from '../../components/Spinner.tsx';
import { DayTime, RelativeTime } from '../../components/Time.tsx';
import { Who } from '../../components/Who.tsx';
import { useCatalog, useProjectId, useTables } from '../../lib/hooks.ts';
import { whoOf } from '../../words.ts';

const UNTRUSTED = 'An agent registered it. DEMIURGO reads it as input to check, never as something you decided.';

export function SourcesScreen() {
  const projectId = useProjectId();
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  usePageTitle(['Sources', project?.name]);
  const sources = useQuery(sourcesQuery(projectId));
  const tables = useTables();
  const canAdd = tables ? canCreate(tables, 'source.register') : false;
  // Newest first: the API lists them oldest first.
  const rows = (sources.data ?? []).toReversed();
  const untrusted = rows.some((s) => whoOf(s.registered_by).kind === 'agent');

  const list = sources.error ? (
    <ErrorNotice error={sources.error} onRetry={() => void sources.refetch()} />
  ) : sources.isPending ? (
    <RowsSkeleton label="Loading the sources" rows={4} />
  ) : rows.length === 0 ? (
    <EmptyState icon={<SourcesIcon size={28} />} title="No sources yet" size="spacious">
      Add notes, rules or anything else DEMIURGO should read.
    </EmptyState>
  ) : (
    <div className="flex flex-col gap-3">
      {untrusted ? (
        <p className="flex items-start gap-2 text-sm text-fg-2">
          <AlertTriangleIcon size={15} className="mt-0.5 shrink-0 text-warning-text" />
          <span>
            <strong className="font-medium text-fg">Untrusted input:</strong> {UNTRUSTED}
          </span>
        </p>
      ) : null}
      <div className="relative overflow-x-auto rounded-lg border border-edge">
        <table className="w-full min-w-[600px] border-collapse text-left text-sm">
          <caption className="sr-only">Sources</caption>
          <thead className="bg-sunken text-xs text-fg-2">
            <tr className="border-b border-edge">
              <th scope="col" className="px-4 py-2.5 font-medium">
                Name
              </th>
              <th scope="col" className="w-44 px-4 py-2.5 font-medium">
                Registered by
              </th>
              <th scope="col" className="w-32 px-4 py-2.5 font-medium">
                When
              </th>
              <th scope="col" className="w-40 px-4 py-2.5 font-medium">
                Content hash
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge-subtle">
            {rows.map((s) => (
              <SourceRow key={s.id} source={s} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Sources"
        meta="What you and your agents give DEMIURGO to read. A source is input for its work, never a decision."
      />
      <PageBody>
        {canAdd ? (
          <WithAside asideLabel="New source" aside={<AddSource projectId={projectId} />} asideWidth="md">
            {list}
          </WithAside>
        ) : (
          list
        )}
      </PageBody>
    </>
  );
}

function SourceRow({ source: s }: { source: Source }) {
  const untrusted = whoOf(s.registered_by).kind === 'agent';
  return (
    <tr data-source={s.id} className="align-top">
      <td className="px-4 py-3">
        <span className="flex items-start gap-2">
          <SourcesIcon size={15} className="mt-0.5 shrink-0 text-fg-3" />
          <span className="flex min-w-0 flex-col items-start gap-1">
            <span className="font-medium break-words text-fg">{s.name}</span>
            {untrusted ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-warning-edge bg-warning-soft px-2 text-xs leading-5 font-medium whitespace-nowrap text-warning-text">
                <AlertTriangleIcon size={12} />
                Untrusted input
              </span>
            ) : null}
          </span>
        </span>
      </td>
      <td className="px-4 py-3">
        <Who actor={s.registered_by} size={18} />
      </td>
      <td className="px-4 py-3 text-fg-2">
        <span className="flex flex-col">
          <RelativeTime iso={s.created_at} className="text-fg" />
          <DayTime iso={s.created_at} className="text-xs text-fg-3" />
        </span>
      </td>
      <td className="px-4 py-3">
        <details className="group">
          <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-xs font-code text-xs text-fg-2 hover:text-fg">
            <ChevronRightIcon size={12} className="shrink-0 transition-transform group-open:rotate-90" />
            {s.content_hash.slice(0, 12)}…<span className="sr-only"> Show the full hash</span>
          </summary>
          <code className="mt-1 block font-code text-xs break-all text-fg">{s.content_hash}</code>
        </details>
      </td>
    </tr>
  );
}

type FormField = {
  key: string;
  label: string;
  hint: string | undefined;
  required: boolean;
  maxLength: number | undefined;
  long: boolean;
};

/** Written words for the fields the command has today; any other string field gets its key as label. */
const COPY: Record<string, { label: string; hint: string }> = {
  name: { label: 'Name', hint: 'How you will recognise it: "Meeting notes, 12 Sep".' },
  content: { label: 'Content', hint: 'Paste it as it is. DEMIURGO reads it; it never becomes a decision.' },
};

/** The fields of a command from its JSON Schema: strings, long ones as a text area. */
function fieldsOf(schema: JsonSchema | null | undefined): FormField[] {
  const required = new Set(schema?.required ?? []);
  return Object.entries(schema?.properties ?? {})
    .filter(([, p]) => p.type === 'string')
    .map(([key, p]) => ({
      key,
      label: COPY[key]?.label ?? key.charAt(0).toUpperCase() + key.slice(1).replaceAll('_', ' '),
      hint: COPY[key]?.hint,
      required: required.has(key),
      maxLength: p.maxLength,
      long: (p.maxLength ?? 0) > 1000,
    }));
}

function AddSource({ projectId }: { projectId: string }) {
  const catalog = useCatalog();
  const fields = fieldsOf(catalog?.['source.register']?.data);
  const command = useCommand(projectId);
  const [values, setValues] = useState<Record<string, string>>({});
  // The confirmation stays until the person changes something again (DESIGN.md §3.8).
  const [added, setAdded] = useState<string | null>(null);
  const id = useId();
  const complete = fields.length > 0 && fields.every((f) => !f.required || (values[f.key] ?? '').trim() !== '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!complete || command.isPending) return;
    const data = Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? '']).filter(([, v]) => v !== ''));
    command.mutate(
      { command: 'source.register', data },
      {
        onSuccess: () => {
          const name = String(data.name ?? 'The source');
          setAdded(name);
          setValues({});
          announce(`Added “${name}”.`);
        },
      },
    );
  };
  const change = (key: string, value: string) => {
    setAdded(null);
    setValues((v) => ({ ...v, [key]: value }));
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-fg">
          Add a source
        </h2>
        <p className="text-sm text-fg-2">Paste what DEMIURGO should read: notes, rules, a survey.</p>
      </div>
      <form aria-labelledby={`${id}-title`} onSubmit={submit} className="flex flex-col gap-4">
        {!catalog ? (
          <Skeleton label="Loading the form" className="flex flex-col gap-3">
            <Bone className="h-9 w-full rounded-md" />
            <Bone className="h-40 w-full rounded-md" />
          </Skeleton>
        ) : (
          fields.map((f) => {
            const value = values[f.key] ?? '';
            return (
              <Field
                key={f.key}
                label={f.label}
                hint={f.hint}
                optional={!f.required}
                {...(f.maxLength && f.long ? { count: [value.length, f.maxLength] as [number, number] } : {})}
              >
                {(p) =>
                  f.long ? (
                    <TextArea
                      {...p}
                      rows={10}
                      value={value}
                      maxLength={f.maxLength}
                      onChange={(e) => change(f.key, e.target.value)}
                    />
                  ) : (
                    <TextInput {...p} value={value} maxLength={f.maxLength} onChange={(e) => change(f.key, e.target.value)} />
                  )
                }
              </Field>
            );
          })
        )}
        {command.error ? <ErrorNotice error={command.error} /> : null}
        {added ? (
          <Notice tone="success" title={`Added “${added}”.`}>
            It is at the top of the list.
          </Notice>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          disabled={!complete}
          pending={command.isPending}
          pendingLabel="Adding…"
          className="self-end"
        >
          Add a source
        </Button>
      </form>
    </div>
  );
}
