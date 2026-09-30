// The page of a screen design (SCR): the feature's flow as an ordered list of transitions, and each
// screen with its purpose, the steps it serves, the design-system components it uses and its four
// states (empty, loading, error, with data) drawn in a sandbox. Wireflow: Nielsen Norman Group.
// The machine part is `spec` of the version, immutable; a missing component blocks accepting it.

import { useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { recordQuery } from '../../api/queries.ts';
import { Button } from '../../components/Button.tsx';
import type { Inbox, ProductState, RecordDetail, RecordVersion } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { SandboxedPreview } from '../../components/SandboxedPreview.tsx';
import { LinkTabs } from '../../components/Tabs.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { HistoryTab } from '../blueprint/HistoryTab.tsx';
import { SECTIONS } from '../blueprint/words.i18n.ts';
import { Block, Prop } from './Delivery.tsx';
import { RecordHeader } from './Header.tsx';
import { ancestorsOf } from './hierarchy.ts';
import { Columns } from './Layout.tsx';
import { ContextPanel, VersionsPanel } from './RecordAside.tsx';
import { versionIndex } from './logic.ts';
import { PasteScreens } from './PasteScreens.tsx';
import { PASTE } from './paste.i18n.ts';
import { useApprovedSystem } from './ScreensTab.tsx';
import { SCREENS } from './words.i18n.ts';

type ScreenState = 'empty' | 'loading' | 'error' | 'data';
const STATES: ScreenState[] = ['empty', 'loading', 'error', 'data'];

export type ScreenSpec = {
  feature: { code: string; version: number };
  no_ui: null | { reason: string };
  screens: {
    id: string;
    name: string;
    purpose: string;
    steps: number[];
    components: string[];
    states: Record<ScreenState, string>;
  }[];
  flow: { from: string; to: string; trigger: string; step: number | null }[];
};

export function ScreenDesignPage({
  projectId,
  record,
  version,
  state,
  inbox,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  state: ProductState | undefined;
  inbox: Inbox | undefined;
}) {
  const t = useMessages(SCREENS);
  const s = useMessages(SECTIONS);
  const p = useMessages(PASTE);
  const [pasting, setPasting] = useState(false);
  const { system } = useApprovedSystem(projectId, state);
  const featureCode = ((version.spec ?? null) as ScreenSpec | null)?.feature.code ?? '';
  const featureRecord = useQuery({ ...recordQuery(projectId, featureCode), enabled: featureCode !== '' });
  const feature = featureRecord.data;
  const featureVersion = feature && feature.current !== null ? feature.versions.find((v) => v.n === feature.current) : undefined;
  const search = useSearch({ strict: false }) as { tab?: string; v?: number };
  const tab = search.tab === 'history' ? 'history' : 'overview';
  const spec = (version.spec ?? null) as ScreenSpec | null;
  const missing = record.missing_components ?? [];
  const thread = version.origin_exploration
    ? (state?.explorations.find((e) => e.id === version.origin_exploration)?.purpose ?? null)
    : null;
  const link = (forTab: 'overview' | 'history') => ({
    to: '/p/$projectId/records/$code' as const,
    params: { projectId, code: record.code },
    search: {
      ...(search.v === undefined ? {} : { v: search.v }),
      ...(forTab === 'overview' ? {} : { tab: forTab }),
    } as never,
    resetScroll: false,
    activeOptions: { exact: true },
  });
  const tabs = (
    <LinkTabs
      label={s.recordSectionsLabel}
      tabs={[
        { key: 'overview', label: s.tabOverview, current: tab === 'overview', link: link('overview') },
        { key: 'history', label: s.tabHistory, current: tab === 'history', link: link('history') },
      ]}
    />
  );
  return (
    <>
      <RecordHeader
        projectId={projectId}
        record={record}
        version={version}
        tab="overview"
        onApproved={() => {}}
        ancestors={ancestorsOf(state, record.code)}
        tabs={tabs}
      />
      <Columns
        aside={
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @4xl:grid-cols-1">
              <Prop label={t.fromFeature}>
                {spec ? (
                  <Link
                    to="/p/$projectId/records/$code"
                    params={{ projectId, code: spec.feature.code }}
                    className="text-accent-text hover:underline"
                  >
                    <Code>
                      {spec.feature.code} · v{spec.feature.version}
                    </Code>
                  </Link>
                ) : (
                  '—'
                )}
              </Prop>
              <Prop label={t.designSystem}>
                {record.dsy ? (
                  <Link to="/p/$projectId/design-system" params={{ projectId }} className="text-accent-text hover:underline">
                    <Code>
                      {record.dsy.code} · v{record.dsy.version}
                    </Code>
                  </Link>
                ) : (
                  '—'
                )}
              </Prop>
            </dl>
            <VersionsPanel projectId={projectId} record={record} shown={version} />
            <ContextPanel
              projectId={projectId}
              code={record.code}
              version={version}
              thread={thread}
              targets={state ? versionIndex(state, inbox) : undefined}
              incoming={record.incoming}
            />
          </>
        }
        main={
          tab === 'history' ? (
            <HistoryTab projectId={projectId} record={record} />
          ) : !spec ? (
            <p className="text-sm text-fg-2">{t.noSpec}</p>
          ) : (
            <>
              {/* The design handoff: a new version from the screens designed in Claude Design. */}
              {pasting && feature && featureVersion && system ? (
                <Block title={p.newVersion}>
                  <PasteScreens
                    target={{
                      projectId,
                      feature: {
                        code: feature.code,
                        version: featureVersion.n,
                        domain: feature.domain,
                        title: featureVersion.title,
                        behavior: featureVersion.sections.find((x) => x.title === 'Behavior')?.content ?? '',
                      },
                      components: system.spec.components.map((c) => c.name),
                      existing: { recordId: record.id, title: version.title, spec },
                    }}
                    onClose={() => setPasting(false)}
                  />
                </Block>
              ) : feature && featureVersion && system ? (
                <div>
                  <Button size="sm" variant="primary" onClick={() => setPasting(true)} data-paste-screens-open>
                    {p.newVersion}
                  </Button>
                </div>
              ) : null}
              {missing.length > 0 ? <MissingBanner projectId={projectId} names={missing} /> : null}
              {spec.no_ui ? (
                <Block title={t.noUiTitle}>
                  <p data-no-ui className="max-w-prose text-sm text-fg-2">
                    {spec.no_ui.reason}
                  </p>
                </Block>
              ) : (
                <>
                  <FlowBlock spec={spec} />
                  <ScreensBlock projectId={projectId} spec={spec} missing={missing} />
                </>
              )}
            </>
          )
        }
      />
    </>
  );
}

function MissingBanner({ projectId, names }: { projectId: string; names: string[] }) {
  const t = useMessages(SCREENS);
  return (
    <div data-missing-components role="status" className="flex flex-col gap-1 rounded-lg border border-danger-edge bg-danger-soft px-4 py-3 text-sm">
      <p className="font-medium text-danger-text">{t.missingTitle(names.join(', '))}</p>
      <p className="text-fg-2">{t.missingBody}</p>
      <div>
        <Link to="/p/$projectId/design-system" params={{ projectId }} className="font-medium text-accent-text hover:underline">
          {t.proposeAdding}
        </Link>
      </div>
    </div>
  );
}

/** The flow as an ordered list: from, to, the trigger and the step it serves. */
export function FlowBlock({ spec }: { spec: ScreenSpec }) {
  const t = useMessages(SCREENS);
  const name = (id: string) => spec.screens.find((x) => x.id === id)?.name ?? t.unknownScreen;
  return (
    <Block id="flow" title={t.flow}>
      {spec.flow.length === 0 ? <p className="text-sm text-fg-2">{t.flowEmpty}</p> : null}
      <ol className="flex flex-col divide-y divide-edge-subtle">
        {spec.flow.map((f, i) => (
          <li key={`${f.from}-${f.to}-${i}`} data-flow-step={i + 1} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5 text-sm">
            <span className="w-6 tabular-nums text-fg-3">{i + 1}.</span>
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-medium text-fg">
              <a href={`#screen-${f.from}`} className="hover:underline">
                {name(f.from)}
              </a>
              <span aria-hidden className="text-fg-3">
                →
              </span>
              <a href={`#screen-${f.to}`} className="hover:underline">
                {name(f.to)}
              </a>
            </span>
            <span className="min-w-0 flex-1 basis-60 text-fg-2">
              {t.trigger}: {f.trigger}
            </span>
            {f.step ? <span className="text-fg-3">{t.step(f.step)}</span> : null}
          </li>
        ))}
      </ol>
    </Block>
  );
}

export function ScreensBlock({ projectId, spec, missing }: { projectId: string; spec: ScreenSpec; missing: string[] }) {
  const t = useMessages(SCREENS);
  return (
    <Block id="screens" title={t.screens} note={t.screenCount(spec.screens.length)}>
      <div className="flex flex-col gap-10">
        {spec.screens.map((sc) => (
          <ScreenView key={sc.id} projectId={projectId} screen={sc} missing={missing} />
        ))}
      </div>
    </Block>
  );
}

function ScreenView({ projectId, screen, missing }: { projectId: string; screen: ScreenSpec['screens'][number]; missing: string[] }) {
  const t = useMessages(SCREENS);
  const [shown, setShown] = useState<ScreenState>('data');
  const label: Record<ScreenState, string> = { empty: t.stateEmpty, loading: t.stateLoading, error: t.stateError, data: t.stateData };
  return (
    <section id={`screen-${screen.id}`} data-screen={screen.id} className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-fg">{screen.name}</h3>
      <p className="max-w-prose text-sm text-fg-2">{screen.purpose}</p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Prop label={t.servesSteps}>{screen.steps.length > 0 ? screen.steps.join(', ') : '—'}</Prop>
        <Prop label={t.components}>
          {screen.components.length > 0 ? (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {screen.components.map((c) => (
                <Link
                  key={c}
                  to="/p/$projectId/design-system"
                  params={{ projectId }}
                  className={cn('hover:underline', missing.includes(c) ? 'text-danger-text' : 'text-accent-text')}
                >
                  {c}
                </Link>
              ))}
            </span>
          ) : (
            t.noComponents
          )}
        </Prop>
      </dl>
      <div role="group" aria-label={t.statesLabel(screen.name)} className="flex flex-wrap gap-1">
        {STATES.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={shown === k}
            data-screen-state={k}
            onClick={() => setShown(k)}
            className={cn(
              'cursor-pointer rounded-md px-2.5 py-1 text-sm',
              shown === k ? 'bg-sunken font-medium text-fg' : 'text-fg-2 hover:text-fg',
            )}
          >
            {label[k]}
          </button>
        ))}
      </div>
      <SandboxedPreview html={screen.states[shown]} title={t.previewTitle(screen.name, label[shown])} height={360} />
    </section>
  );
}
