// Provider → model → effort, only from what discovery found: the person never types a model name.

import type { Catalog, Engine } from '../../api/models.ts';
import { cn } from '../../lib/cn.ts';
import { choosableProviders, effortsOf, modelsOf, withModel, withProvider } from './engines.ts';

const select =
  'dm-text-small h-8 min-w-0 rounded-control border border-line-strong bg-surface px-2 text-ink focus:border-needs focus:outline-none disabled:opacity-45';

export function EngineSelect({
  catalogs,
  value,
  onChange,
  disabled,
  label,
}: {
  catalogs: readonly Catalog[];
  value: Engine | null;
  onChange: (engine: Engine) => void;
  disabled?: boolean;
  /** Accessible name of the group, such as «Everywhere» or «This project». */
  label: string;
}) {
  const providers = choosableProviders(catalogs);
  const models = value ? modelsOf(catalogs, value.provider) : [];
  const efforts = value ? effortsOf(catalogs, value.provider, value.model) : [];
  const known = value && providers.some((p) => p.provider === value.provider);
  return (
    <fieldset aria-label={label} className="flex min-w-0 flex-wrap items-center gap-1.5" disabled={disabled}>
      <select
        aria-label={`${label}: provider`}
        className={cn(select, 'w-[118px]')}
        value={value?.provider ?? ''}
        onChange={(e) => {
          const next = withProvider(catalogs, e.target.value);
          if (next) onChange(next);
        }}
      >
        {!known && <option value={value?.provider ?? ''}>{value ? `${value.provider} (gone)` : 'Choose…'}</option>}
        {providers.map((p) => (
          <option key={p.provider} value={p.provider}>
            {p.label}
            {p.ready ? '' : ' (not ready)'}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label}: model`}
        className={cn(select, 'w-[178px]')}
        value={value?.model ?? ''}
        disabled={!value || models.length === 0}
        onChange={(e) => value && onChange(withModel(catalogs, value, e.target.value))}
      >
        {value && !models.some((m) => m.id === value.model) && <option value={value.model}>{value.model} (gone)</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label}: effort`}
        className={cn(select, 'w-[92px]')}
        value={value?.effort ?? ''}
        disabled={!value || efforts.length === 0}
        onChange={(e) => value && onChange({ ...value, effort: e.target.value || null })}
      >
        {efforts.length === 0 && <option value="">—</option>}
        {efforts.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </fieldset>
  );
}
