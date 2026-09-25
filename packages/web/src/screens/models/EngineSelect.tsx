// Provider → model → effort, only from what discovery found: the person never types a model name
// (FDR-AGE-002, INV-MODELS-17). A fieldset named after what it chooses for ("Explorer,
// everywhere"), three selects with visible labels, "(not ready)" and "(gone)" on what can no
// longer run. Side by side from 640 px, one under the other below.

import { type ReactNode, useId } from 'react';
import type { Catalog, Engine } from '../../api/models.ts';
import { Select } from '../../components/Field.tsx';
import { cn } from '../../lib/cn.ts';
import { choosableProviders, effortsOf, modelsOf, withModel, withProvider } from './engines.ts';

export function EngineSelect({
  catalogs,
  value,
  onChange,
  disabled,
  label,
  layout = 'row',
  className,
}: {
  catalogs: readonly Catalog[];
  value: Engine | null;
  onChange: (engine: Engine) => void;
  disabled?: boolean;
  /** Accessible name of the group, such as «Explorer, everywhere» or «Retry with». */
  label: string;
  /** row: side by side, wrapping when narrow; stack: one under the other (a popover). */
  layout?: 'row' | 'stack';
  className?: string;
}) {
  const id = useId();
  const providers = choosableProviders(catalogs);
  const models = value ? modelsOf(catalogs, value.provider) : [];
  const efforts = value ? effortsOf(catalogs, value.provider, value.model) : [];
  const known = value && providers.some((p) => p.provider === value.provider);
  const field = (key: string, word: string, control: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={`${id}-${key}`} className="text-xs font-medium text-fg-2">
        {word}
      </label>
      {control}
    </div>
  );
  return (
    <fieldset
      aria-label={label}
      disabled={disabled}
      className={cn(
        'grid min-w-0',
        layout === 'row' ? 'grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)]' : 'gap-3',
        className,
      )}
    >
      {field(
        'provider',
        'Provider',
        <Select
          id={`${id}-provider`}
          aria-label={`${label}: provider`}
          value={value?.provider ?? ''}
          onChange={(e) => {
            const next = withProvider(catalogs, e.target.value);
            if (next) onChange(next);
          }}
        >
          {!known ? <option value={value?.provider ?? ''}>{value ? `${value.provider} (gone)` : 'Choose…'}</option> : null}
          {providers.map((p) => (
            <option key={p.provider} value={p.provider}>
              {p.label}
              {p.ready ? '' : ' (not ready)'}
            </option>
          ))}
        </Select>,
      )}
      {field(
        'model',
        'Model',
        <Select
          id={`${id}-model`}
          aria-label={`${label}: model`}
          value={value?.model ?? ''}
          disabled={!value || models.length === 0}
          onChange={(e) => value && onChange(withModel(catalogs, value, e.target.value))}
        >
          {!value ? <option value="">—</option> : null}
          {value && !models.some((m) => m.id === value.model) ? <option value={value.model}>{value.model} (gone)</option> : null}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>,
      )}
      {field(
        'effort',
        'Effort',
        <Select
          id={`${id}-effort`}
          aria-label={`${label}: effort`}
          value={value?.effort ?? ''}
          disabled={!value || efforts.length === 0}
          onChange={(e) => value && onChange({ ...value, effort: e.target.value || null })}
        >
          {efforts.length === 0 ? <option value="">—</option> : null}
          {efforts.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </Select>,
      )}
    </fieldset>
  );
}
