// The "Design system" page of Product: the approved version of the project's DSY record, drawn
// deterministically from its `spec` (no AI). The colors, sizes, radii and easings below are the
// system's own data, so they go in inline styles; the page's own look stays on the app tokens.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type CSSProperties, useEffect, useState } from 'react';
import { recordQuery, stateQuery } from '../../api/queries.ts';
import type { DesignSystemSpec, RecordDetail, RecordVersion } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { ProductIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, usePageTitle } from '../../components/Page.tsx';
import { SandboxedPreview } from '../../components/SandboxedPreview.tsx';
import { EntityState } from '../../components/status.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { ProductTabs } from '../../shell/ProductTabs.tsx';
import { DESIGN_SYSTEM } from './words.i18n.ts';
import { DesignSystemStart } from './Start.tsx';

type Tokens = DesignSystemSpec['tokens'];

/** The version to show: the current (approved) one, else the latest draft. */
function shownVersion(d: RecordDetail): RecordVersion | null {
  return d.versions.find((v) => v.n === d.current) ?? d.versions.find((v) => v.current) ?? d.versions[0] ?? null;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export function DesignSystemScreen() {
  const t = useMessages(DESIGN_SYSTEM);
  const projectId = useProjectId();
  const state = useQuery(stateQuery(projectId));
  const row = state.data?.designs.find((r) => r.type === 'design_system') ?? null;
  const record = useQuery({ ...recordQuery(projectId, row?.code ?? ''), enabled: Boolean(row) });
  usePageTitle([t.pageTitle]);
  const version = record.data ? shownVersion(record.data) : null;
  const failed = state.error ?? record.error;

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <ProductIcon size={15} className="text-fg-3" />
            <span>{t.product}</span>
          </>
        }
        title={t.pageTitle}
        meta={
          row && version ? (
            <>
              <Code>{row.code}</Code>
              <span>{t.version(version.n)}</span>
              <EntityState entity="record_version" state={version.state} />
              <Link to="/p/$projectId/records/$code" params={{ projectId, code: row.code }} className="text-accent hover:underline">
                {t.fullRecord}
              </Link>
            </>
          ) : (
            t.meta
          )
        }
        tabs={<ProductTabs active="design-system" />}
      />
      <PageBody width="full">
        {failed ? (
          <ErrorNotice error={failed} onRetry={() => void (state.error ? state.refetch() : record.refetch())} />
        ) : !state.data ? (
          <p role="status" className="text-fg-2">
            {t.loading}
          </p>
        ) : !row ? (
          <DesignSystemStart projectId={projectId} />
        ) : !record.data || !version ? (
          <p role="status" className="text-fg-2">
            {t.loading}
          </p>
        ) : (
          <SystemDocument detail={record.data} version={version} />
        )}
      </PageBody>
    </>
  );
}

function SystemDocument({ detail, version }: { detail: RecordDetail; version: RecordVersion }) {
  const t = useMessages(DESIGN_SYSTEM);
  const spec = version.spec;
  if (!spec) return <p className="text-fg-2">{t.noSpec}</p>;
  return (
    <div className="flex flex-col gap-10">
      {version.n !== detail.current ? <p className="text-sm text-fg-2">{t.draftNote}</p> : null}
      {detail.warnings && detail.warnings.length > 0 ? (
        <Section title={t.warnings} id="ds-warnings">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-fg-2">
            {detail.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      <SystemSpecView spec={spec} />
    </div>
  );
}

/** A design system's spec drawn deterministically: shared by the living page and the proposal that drafts it. */
export function SystemSpecView({ spec }: { spec: DesignSystemSpec }) {
  const { tokens } = spec;
  return (
    <div className="flex flex-col gap-10">
      <Base base={spec.base} />
      <Principles items={spec.principles} />
      <Colors colors={tokens.color} />
      <Typography type={tokens.typography} />
      <Scales tokens={tokens} />
      <Motion motion={tokens.motion} />
      <Components items={spec.components} />
      <Patterns items={spec.patterns} />
    </div>
  );
}

function Base({ base }: { base: DesignSystemSpec['base'] }) {
  const t = useMessages(DESIGN_SYSTEM);
  return (
    <Section title={t.base} id="ds-base">
      {base.kind === 'scratch' ? (
        <p className="text-fg-2">{t.baseScratch}</p>
      ) : (
        <p className="text-fg-2">
          {t.basePublic}{' '}
          {base.url ? (
            <a href={base.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {base.name ?? base.url}
            </a>
          ) : (
            <strong className="font-semibold text-fg">{base.name}</strong>
          )}
          {base.license ? ` · ${t.license}: ${base.license}` : ''}
        </p>
      )}
    </Section>
  );
}

function Principles({ items }: { items: string[] }) {
  const t = useMessages(DESIGN_SYSTEM);
  if (items.length === 0) return null;
  return (
    <Section title={t.principles} id="ds-principles">
      <ol className="flex max-w-prose list-decimal flex-col gap-1 pl-5 text-fg">
        {items.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ol>
    </Section>
  );
}

function Swatch({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {/* Data: the token's own color, not app styling. */}
      <span aria-hidden="true" style={{ background: value }} className="size-8 shrink-0 rounded-md border border-edge" />
      <span className="flex flex-col text-xs leading-tight">
        <span className="text-fg-2">{label}</span>
        <span className="font-code text-fg tabular-nums">{value}</span>
      </span>
    </div>
  );
}

function Colors({ colors }: { colors: Tokens['color'] }) {
  const t = useMessages(DESIGN_SYSTEM);
  return (
    <Section title={t.color} note={t.colorNote} id="ds-color">
      <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries(colors).map(([name, c]) => (
          <li key={name} className="flex flex-col gap-1">
            <span className="font-code text-sm text-fg">{name}</span>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <Swatch value={c.$value.light} label={t.light} />
              <Swatch value={c.$value.dark} label={t.dark} />
            </div>
            {c.$description ? <span className="text-xs text-fg-2">{c.$description}</span> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

const familyCss = (v: string | string[]) => (Array.isArray(v) ? v.join(', ') : v);

function Typography({ type }: { type: Tokens['typography'] }) {
  const t = useMessages(DESIGN_SYSTEM);
  const families = Object.entries(type.family);
  const first = families[0]?.[1].$value;
  const lh = Object.entries(type.lineHeight);
  return (
    <Section title={t.typography} id="ds-type">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg-2">{t.families}</h3>
          {families.map(([name, f]) => (
            <div key={name} className="flex flex-col">
              <span className="font-code text-xs text-fg-2">
                {name} · {familyCss(f.$value)}
              </span>
              {/* Data: the system's own font family. */}
              <span className="text-lg text-fg" style={{ fontFamily: familyCss(f.$value) }}>
                {t.sample}
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg-2">{t.sizes}</h3>
          {Object.entries(type.size).map(([name, s]) => (
            <div key={name} className="flex flex-col">
              <span className="font-code text-xs text-fg-2">
                {name} · {s.$value}
              </span>
              {/* Data: the system's own size. */}
              <span className="text-fg" style={{ fontSize: s.$value, ...(first ? { fontFamily: familyCss(first) } : {}) }}>
                {t.sample}
              </span>
            </div>
          ))}
        </div>
        {lh.length > 0 ? (
          <p className="font-code text-xs text-fg-2">
            {t.lineHeight}: {lh.map(([n, v]) => `${n} ${v.$value}`).join(' · ')}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function Scales({ tokens }: { tokens: Tokens }) {
  const t = useMessages(DESIGN_SYSTEM);
  return (
    <>
      <Section title={t.space} id="ds-space">
        <ul className="flex flex-col gap-1">
          {Object.entries(tokens.space).map(([name, s]) => (
            <li key={name} className="flex items-center gap-3">
              <span className="w-24 shrink-0 font-code text-xs text-fg-2">
                {name} · {s.$value}
              </span>
              {/* Data: a bar as long as the space token. */}
              <span aria-hidden="true" className="h-3 bg-fg-3" style={{ width: s.$value }} />
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t.radius} id="ds-radius">
        <ul className="flex flex-wrap gap-6">
          {Object.entries(tokens.radius).map(([name, r]) => (
            <li key={name} className="flex flex-col items-start gap-1">
              {/* Data: a box with the radius token. */}
              <span aria-hidden="true" className="size-16 border border-edge-strong bg-sunken" style={{ borderRadius: r.$value }} />
              <span className="font-code text-xs text-fg-2">
                {name} · {r.$value}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t.shadow} id="ds-shadow">
        <ul className="flex flex-wrap gap-8">
          {Object.entries(tokens.shadow).map(([name, s]) => (
            <li key={name} className="flex flex-col items-start gap-2">
              {/* Data: a box with the shadow token. */}
              <span aria-hidden="true" className="size-16 border border-edge bg-panel" style={{ boxShadow: s.$value }} />
              <span className="font-code text-xs text-fg-2">{name}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function Motion({ motion }: { motion: Tokens['motion'] }) {
  const t = useMessages(DESIGN_SYSTEM);
  const reduced = usePrefersReducedMotion();
  const [round, setRound] = useState(0);
  const durations = Object.entries(motion.duration);
  const easings = Object.entries(motion.easing);
  return (
    <Section
      title={t.motion}
      id="ds-motion"
      actions={
        <Button size="sm" disabled={reduced} onClick={() => setRound((n) => n + 1)}>
          {t.play}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="max-w-prose text-fg-2">
          {t.scheme}: {motion.scheme === 'productive' ? t.productive : t.expressive}
        </p>
        <p className="max-w-prose text-fg-2">
          {t.reducedRule}: {motion.reduced}
        </p>
        {reduced ? <p className="text-sm text-fg-2">{t.reducedNow}</p> : null}
        <div className="flex flex-col gap-2">
          {durations.flatMap(([dName, d]) =>
            easings.map(([eName, e]) => {
              const curve = `cubic-bezier(${e.$value.join(', ')})`;
              const style: CSSProperties = reduced
                ? {}
                : { transition: `transform ${d.$value} ${curve}`, transform: round % 2 === 1 ? 'translateX(12rem)' : 'none' };
              return (
                <div key={`${dName}-${eName}`} className="flex items-center gap-3">
                  <span className="w-56 shrink-0 font-code text-xs text-fg-2">
                    {t.duration} {dName} ({d.$value}) · {t.easing} {eName}
                  </span>
                  <div className="w-64 border-b border-edge-subtle py-1">
                    {/* Data: the transition comes from the spec's duration and cubic-bezier. */}
                    <span aria-hidden="true" className="block size-4 rounded-xs bg-accent" style={style} />
                  </div>
                </div>
              );
            }),
          )}
        </div>
      </div>
    </Section>
  );
}

function Facts({ label, values, none }: { label: string; values: string[]; none: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold text-fg-2">{label}</dt>
      <dd className="text-fg">{values.length > 0 ? values.join(', ') : none}</dd>
    </div>
  );
}

function Components({ items }: { items: DesignSystemSpec['components'] }) {
  const t = useMessages(DESIGN_SYSTEM);
  return (
    <Section title={t.components} note={String(items.length)} id="ds-components">
      <div className="flex flex-col gap-8">
        {items.map((c) => (
          <article key={c.name} className="flex flex-col gap-3 border-t border-edge-subtle pt-4">
            <h3 className="text-base font-semibold text-fg">
              {c.name}
              {c.interactive ? <span className="ml-2 text-xs font-normal text-fg-2">{t.interactive}</span> : null}
            </h3>
            <p className="max-w-prose text-fg-2">{c.purpose}</p>
            <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              <Facts label={t.variants} values={c.variants} none={t.none} />
              <Facts label={t.states} values={c.states} none={t.none} />
            </dl>
            <p className="max-w-prose text-sm text-fg-2">
              <span className="font-semibold">{t.accessibility}: </span>
              {c.accessibility}
            </p>
            <SandboxedPreview html={c.specimen_html} title={t.specimen(c.name)} />
          </article>
        ))}
      </div>
    </Section>
  );
}

function Patterns({ items }: { items: DesignSystemSpec['patterns'] }) {
  const t = useMessages(DESIGN_SYSTEM);
  if (items.length === 0) return null;
  return (
    <Section title={t.patterns} id="ds-patterns">
      <ul className="flex flex-col gap-4">
        {items.map((p) => (
          <li key={p.name} className="flex flex-col gap-0.5">
            <span className="font-semibold text-fg">{p.name}</span>
            <span className="max-w-prose text-fg-2">{p.purpose}</span>
            <span className="text-sm text-fg-2">
              {t.uses}: {p.uses.length > 0 ? p.uses.join(', ') : t.none}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
