// The Screens tab of a feature: the screen design (SCR) it is built from, or the two ways to make one.
// The design goes one step ahead of the tasks (Cagan and Patton, SVPG: discovery then delivery; wireflow
// from Nielsen Norman Group). With Claude Design the person designs there from a brief built here.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { recordQuery, stateQuery } from '../../api/queries.ts';
import type { DesignSystemSpec, ProductState, RecordDetail, RecordVersion } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { CopyIcon } from '../../components/icons.tsx';
import { useMessages } from '../../i18n/define.ts';
import { stateWord } from '../../words.ts';
import { featureEpicThread } from '../epics/logic.ts';
import { copyText } from './brief.ts';
import { Block } from './Delivery.tsx';
import { buildScreenBrief } from './screenBrief.ts';
import { SCREENS } from './words.i18n.ts';

/** The approved design system of the project, loaded like its own page does. */
function useApprovedSystem(projectId: string, state: ProductState | undefined) {
  const row = state?.designs.find((r) => r.type === 'design_system') ?? null;
  const record = useQuery({ ...recordQuery(projectId, row?.code ?? ''), enabled: Boolean(row) });
  const d = record.data;
  const version: RecordVersion | undefined = d && d.current !== null ? d.versions.find((v) => v.n === d.current) : undefined;
  const spec = (version?.spec ?? null) as DesignSystemSpec | null;
  const loading = !state || (Boolean(row) && record.isPending);
  return { loading, system: d && version && spec ? { code: d.code, version: version.n, spec } : null };
}

export function ScreensTab({
  projectId,
  record,
  version,
  state,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  state: ProductState | undefined;
}) {
  const t = useMessages(SCREENS);
  const { loading, system } = useApprovedSystem(projectId, state);
  const screens = record.screens ?? null;
  return (
    <Block id="screens" title={t.screensTitle} note={screens ? t.summaryNote : undefined}>
      {screens ? (
        <div data-screens-summary className="flex flex-col gap-2 text-sm">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-fg">
            <Code>
              {screens.code} · v{screens.version}
            </Code>
            <span className="font-medium">{stateWord('record_version', screens.state).word}</span>
            <span className="text-fg-2">{screens.no_ui ? t.noUi : t.screenCount(screens.screen_count)}</span>
          </p>
          {screens.missing_components.length > 0 ? (
            <p className="text-danger-text">{t.missingSummary(screens.missing_components.join(', '))}</p>
          ) : null}
          <div>
            <Link
              to="/p/$projectId/records/$code"
              params={{ projectId, code: screens.code }}
              className={buttonClass({ variant: 'secondary', size: 'sm' })}
              data-open-screens
            >
              {t.openScreens}
            </Link>
          </div>
        </div>
      ) : loading ? (
        <p role="status" className="text-sm text-fg-2">
          {t.loadingSystem}
        </p>
      ) : !system ? (
        <div data-screens-no-system className="flex max-w-prose flex-col gap-2 text-sm">
          <h3 className="font-semibold text-fg">{t.noSystemTitle}</h3>
          <p className="text-fg-2">{t.noSystemBody}</p>
          <div>
            <Link to="/p/$projectId/design-system" params={{ projectId }} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              {t.openDesignSystem}
            </Link>
          </div>
        </div>
      ) : (
        <Start projectId={projectId} record={record} version={version} state={state} system={system} />
      )}
    </Block>
  );
}

function Start({
  projectId,
  record,
  version,
  state,
  system,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  state: ProductState | undefined;
  system: { code: string; version: number; spec: DesignSystemSpec };
}) {
  const t = useMessages(SCREENS);
  const [busy, setBusy] = useState(false);
  const thread = version.origin_exploration ?? (state ? featureEpicThread(state, record.code) : null);
  const copy = async () => {
    setBusy(true);
    try {
      await copyText(
        buildScreenBrief({
          code: record.code,
          title: version.title,
          sections: version.sections,
          criteria: version.criteria,
          system,
        }),
      );
      announce(t.copied);
    } catch {
      announce(t.briefFailed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-screens-start className="flex flex-col gap-6">
      <p className="max-w-prose text-sm text-fg-2">{t.startIntro}</p>
      <section className="flex flex-col gap-2">
        {thread ? (
          <div>
            <Link
              to="/p/$projectId/threads/$explorationId"
              params={{ projectId, explorationId: thread }}
              className={buttonClass({ variant: 'secondary', size: 'sm' })}
              data-design-with-demiurgo
            >
              {t.withDemiurgo}
            </Link>
          </div>
        ) : null}
        <p className="max-w-prose text-sm text-fg-2">{t.withDemiurgoHint}</p>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-fg">{t.withClaudeDesign}</h3>
        <p className="max-w-prose text-sm text-fg-2">{t.briefHint}</p>
        <div>
          <Button size="sm" icon={<CopyIcon size={14} />} pending={busy} onClick={() => void copy()} data-copy-screen-brief>
            {t.copyBrief}
          </Button>
        </div>
        <h4 className="mt-2 text-xs font-medium text-fg-3">{t.guideTitle}</h4>
        <ol className="flex max-w-prose list-decimal flex-col gap-1 pl-5 text-sm text-fg-2">
          <li>{t.guide1}</li>
          <li>{t.guide2}</li>
          <li>{t.guide3}</li>
          <li>{t.guide4}</li>
          <li>{t.guide5}</li>
        </ol>
      </section>
    </div>
  );
}
