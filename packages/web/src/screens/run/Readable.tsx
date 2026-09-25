// A human-readable view of structured data (DESIGN.md §3.4; INVENTORY §2 #13): what a run read
// and what it answered, as labelled facts and lists instead of a JSON dump. Keys become words
// ("untrusted_sources" → "Untrusted sources · 2"), long text folds behind "Show all", and deep
// structure falls back to compact JSON. The raw JSON stays one disclosure away (R28, R05).

import { type ReactNode, useState } from 'react';
import { cn } from '../../lib/cn.ts';
import { ChevronRightIcon } from '../../components/icons.tsx';

/** "question_in_progress" → "Question in progress". */
export function humanize(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words ? words[0]?.toUpperCase() + words.slice(1) : key;
}

/** The field that best names an item of a list (its title, question, text…). */
const TITLE_KEYS = ['title', 'question', 'purpose', 'name', 'label', 'answer', 'text', 'reply', 'code', 'id'];

function titleKeyOf(o: Record<string, unknown>): string | null {
  return (
    TITLE_KEYS.find((k) => {
      const v = o[k];
      return typeof v === 'string' && v.trim() !== '';
    }) ?? null
  );
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isScalar = (v: unknown) => v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v);

function LongText({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  const long = text.length > 480 || text.split('\n').length > 8;
  return (
    <span className="flex flex-col items-start gap-1">
      <span className={cn('whitespace-pre-wrap break-words', long && !all && 'line-clamp-6')}>{text}</span>
      {long ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((a) => !a)}
          className="cursor-pointer text-sm font-medium text-accent-text hover:underline"
        >
          {all ? 'Show less' : 'Show all'}
        </button>
      ) : null}
    </span>
  );
}

function Scalar({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-fg-3">None</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'number') return <span className="tabular-nums">{value.toLocaleString('en-GB')}</span>;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.trim() === '') return <span className="text-fg-3">Empty</span>;
  return <LongText text={text} />;
}

function Compact({ value }: { value: unknown }) {
  return <code className="font-code text-xs break-all text-fg-2">{JSON.stringify(value)}</code>;
}

/** A value of any shape, `depth` levels deep; below three levels it is compact JSON. */
export function ReadableValue({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (isScalar(value)) return <Scalar value={value} />;
  if (depth >= 3) return <Compact value={value} />;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-fg-3">None</span>;
    if (value.every(isScalar))
      return (
        <ul className="flex flex-col gap-1">
          {value.map((v, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the list is shown as it came
            <li key={i} className="flex gap-2">
              <span aria-hidden className="text-fg-3">
                ·
              </span>
              <Scalar value={v} />
            </li>
          ))}
        </ul>
      );
    return (
      <ol className="flex flex-col gap-2">
        {value.map((v, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is shown as it came
          <li key={i} className="rounded-md border border-edge-subtle bg-sunken px-3 py-2">
            <Item value={v} index={i} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  if (isPlain(value)) return <Facts object={value} depth={depth + 1} />;
  return <Compact value={value} />;
}

/** Ids name things for the machine: an item that has a title leaves them to the raw JSON. */
const isId = (key: string) => key === 'id' || key.endsWith('_id');

/** A fact short enough to sit on one line with others ("State pending · Impact high"). */
const isShort = (v: unknown) =>
  v === null ||
  v === undefined ||
  typeof v === 'boolean' ||
  typeof v === 'number' ||
  (typeof v === 'string' && v.length <= 48 && !v.includes('\n'));

function Item({ value, index, depth }: { value: unknown; index: number; depth: number }) {
  if (!isPlain(value)) return <ReadableValue value={value} depth={depth} />;
  const key = titleKeyOf(value);
  const rest = Object.entries(value).filter(([k]) => k !== key && !(key && isId(k)));
  const short = rest.filter(([, v]) => isShort(v));
  const long = Object.fromEntries(rest.filter(([, v]) => !isShort(v)));
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex gap-1.5 text-sm font-medium text-fg">
        <span className="shrink-0 text-fg-3 tabular-nums">{index + 1}.</span>
        {key ? <LongText text={String(value[key])} /> : null}
      </p>
      {short.length > 0 ? (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {short.map(([k, v]) => (
            <div key={k} className="flex gap-1">
              <dt className="text-fg-3">{humanize(k)}</dt>
              <dd className="text-fg-2">
                <Scalar value={v} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {Object.keys(long).length > 0 ? <Facts object={long} depth={depth} /> : null}
    </div>
  );
}

function label(key: string, value: unknown): string {
  return Array.isArray(value) ? `${humanize(key)} · ${value.length}` : humanize(key);
}

/** An object as label → value pairs, stacked under 640 px. */
export function Facts({ object, depth = 0 }: { object: Record<string, unknown>; depth?: number }) {
  const entries = Object.entries(object);
  if (entries.length === 0) return <span className="text-fg-3">Nothing</span>;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(120px,auto)_1fr]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="pt-px font-medium text-fg-2">{label(k, v)}</dt>
          <dd className="min-w-0 text-fg">
            <ReadableValue value={v} depth={depth} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The raw JSON, one disclosure away. */
export function RawJson({
  value,
  label: summary = 'Raw JSON',
  ...rest
}: { value: unknown; label?: string } & Record<`data-${string}`, unknown>) {
  return (
    <details className="group rounded-md border border-edge" {...rest}>
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon size={14} className="shrink-0 transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <pre className="max-h-[480px] overflow-auto border-t border-edge bg-sunken px-3 py-2 font-code text-xs leading-relaxed text-fg-2">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
