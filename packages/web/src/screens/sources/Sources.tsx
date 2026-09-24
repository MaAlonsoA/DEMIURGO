// Sources (spec §4.11, with the brief's correction: a source has a name, a content hash, who
// registered it and when). An agent's source is untrusted input, and says so. "Add a source"
// is the form of source.register, built from its JSON Schema.

import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { sourcesQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { JsonSchema, Source } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { useCatalog, useProjectId, useTables } from '../../lib/hooks.ts';
import { ago, dayTime } from '../../lib/time.ts';
import { Button } from '../../ui/Button.tsx';
import { TypeIcon } from '../../ui/icons.tsx';
import { EmptyState, Page, PageTitle, Skeleton } from '../../ui/layout.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { Tip } from '../../ui/Tip.tsx';
import { whoOf } from '../../words.ts';

export function SourcesScreen() {
  const projectId = useProjectId();
  const sources = useQuery(sourcesQuery(projectId));
  const tables = useTables();
  const canAdd = tables ? canCreate(tables, 'source.register') : false;
  const rows = (sources.data ?? []).toReversed();
  return (
    <Page aside={canAdd ? <AddSource projectId={projectId} /> : undefined}>
      <PageTitle
        title="Sources"
        subtitle="What you and your agents give DEMIURGO to read. A source is input for its work, never a decision."
      />
      {sources.error ? (
        <Reasons error={sources.error} />
      ) : sources.isPending ? (
        <div role="status" aria-label="Loading the sources" className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState>No sources yet. Add notes, rules or anything else DEMIURGO should read.</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full border-collapse text-left text-[13px]">
            <caption className="sr-only">Sources</caption>
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  Name
                </th>
                <th scope="col" className="w-[230px] px-4 py-2.5 font-semibold">
                  Registered by
                </th>
                <th scope="col" className="w-[140px] px-4 py-2.5 font-semibold">
                  When
                </th>
                <th scope="col" className="w-[170px] px-4 py-2.5 font-semibold">
                  Content hash
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((s) => (
                <SourceRow key={s.id} source={s} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

function SourceRow({ source: s }: { source: Source }) {
  const who = whoOf(s.registered_by);
  const untrusted = who.kind === 'agent';
  return (
    <tr className="align-middle">
      <td className="px-4 py-3">
        <span className="flex items-center gap-2">
          <TypeIcon kind="source" size={14} className="shrink-0 text-muted" />
          <span className="font-semibold text-ink">{s.name}</span>
          {untrusted && (
            <Tip text="An agent registered it. DEMIURGO reads it as input to check, never as something you decided.">
              <span className="shrink-0 rounded-full border border-line-strong px-2 py-px text-[11px] font-medium text-ink-2">
                Untrusted input
              </span>
            </Tip>
          )}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="flex items-center gap-1.5 text-[13px]">
          <WhoMark actor={s.registered_by} size={18} withName />
          {untrusted && <span className="text-muted">· agent</span>}
        </span>
      </td>
      <td className="px-4 py-3 text-ink-2">
        <time dateTime={s.created_at} title={dayTime(s.created_at)}>
          {ago(s.created_at)}
        </time>
      </td>
      <td className="px-4 py-3">
        <span className="font-mono text-[11px] text-muted" title={s.content_hash}>
          {s.content_hash.slice(0, 12)}…
        </span>
      </td>
    </tr>
  );
}

type Field = { key: string; label: string; required: boolean; maxLength: number | undefined; long: boolean };

/** The fields of a command from its JSON Schema: strings, long ones as a text area. */
function fieldsOf(schema: JsonSchema | null | undefined): Field[] {
  const required = new Set(schema?.required ?? []);
  return Object.entries(schema?.properties ?? {})
    .filter(([, p]) => p.type === 'string')
    .map(([key, p]) => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1).replaceAll('_', ' '),
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
  const [added, setAdded] = useState<string | null>(null);
  const id = useId();
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(null), 5000);
    return () => clearTimeout(t);
  }, [added]);
  const complete = fields.length > 0 && fields.every((f) => !f.required || (values[f.key] ?? '').trim() !== '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!complete) return;
    const data = Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? '']).filter(([, v]) => v !== ''));
    command.mutate(
      { command: 'source.register', data },
      {
        onSuccess: () => {
          setAdded(String(data.name ?? 'The source'));
          setValues({});
        },
      },
    );
  };
  return (
    <form aria-labelledby={`${id}-title`} onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <h2 id={`${id}-title`} className="text-[15px] font-semibold">
          Add a source
        </h2>
        <p className="mt-0.5 text-xs text-muted">Paste what DEMIURGO should read: notes, rules, a survey.</p>
      </div>
      {!catalog ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        fields.map((f) => {
          const common = {
            id: `${id}-${f.key}`,
            value: values[f.key] ?? '',
            maxLength: f.maxLength,
            onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [f.key]: e.target.value })),
            className:
              'w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-needs focus:outline-none',
          };
          return (
            <div key={f.key} className="flex flex-col gap-1">
              <label htmlFor={`${id}-${f.key}`} className="text-xs font-semibold text-ink-2">
                {f.label}
                {!f.required && <span className="font-normal text-muted"> · optional</span>}
              </label>
              {f.long ? (
                <textarea {...common} rows={10} className={cn(common.className, 'resize-y py-2 leading-relaxed')} />
              ) : (
                <input {...common} className={cn(common.className, 'h-9')} />
              )}
            </div>
          );
        })
      )}
      {command.error ? <Reasons error={command.error} /> : null}
      <div className="flex items-center justify-between gap-3">
        <span role="status" className="text-xs text-muted">
          {added ? `Added “${added}”.` : ''}
        </span>
        <Button type="submit" variant="ink" disabled={!complete || command.isPending}>
          {command.isPending ? 'Adding…' : 'Add a source'}
        </Button>
      </div>
    </form>
  );
}
