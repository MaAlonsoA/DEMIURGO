// Automatic build of a task: start it (after one confirmation) and follow its stages. The server
// runs everything; this only reads its steps (GitHub checks style: a glyph and a word per stage).

import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { BuildOutcome, BuildStep, RecordDetail } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { AlertTriangleIcon, CheckCircleIcon, CircleDotIcon, CircleHalfIcon, XCircleIcon } from '../../components/icons.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { AGENT_BUILD } from './agentBuild.i18n.ts';

/** The steps of the latest attempt, in the order the server sent them. */
export function latestAttempt(steps: BuildStep[] | undefined): BuildStep[] {
  if (!steps || steps.length === 0) return [];
  const n = Math.max(...steps.map((s) => s.attempt));
  return steps.filter((s) => s.attempt === n);
}

/** The outcome of the last step of the latest attempt, or null without any. */
export function lastOutcome(steps: BuildStep[] | undefined): BuildOutcome | null {
  return latestAttempt(steps).at(-1)?.outcome ?? null;
}

export function isBuildRunning(steps: BuildStep[] | undefined): boolean {
  const o = lastOutcome(steps);
  return o === 'started' || o === 'waiting';
}

export function isBuildRunningOf(record: RecordDetail | undefined): boolean {
  return isBuildRunning(record?.build?.steps);
}

/** True after a finished attempt that did not merge: the primary reads "Build again". */
export function needsRebuild(steps: BuildStep[] | undefined): boolean {
  const o = lastOutcome(steps);
  return o === 'failed' || o === 'changes_requested';
}

/** "Build with an agent" / "Build again" with its confirmation. */
export function AgentBuildButton({
  projectId,
  code,
  again = false,
  variant = 'primary',
  size,
}: {
  projectId: string;
  code: string;
  again?: boolean;
  variant?: 'primary' | 'secondary';
  size?: 'sm';
}) {
  const t = useMessages(AGENT_BUILD);
  const [confirming, setConfirming] = useState(false);
  const command = useCommand(projectId);
  const client = useQueryClient();
  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => {
          command.reset();
          setConfirming(true);
        }}
        data-primary={variant === 'primary' ? 'agent-build' : undefined}
        data-agent-build={code}
        aria-label={size ? `${again ? t.buildAgain : t.build} ${code}` : undefined}
      >
        {again ? t.buildAgain : t.build}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => {
          if (!o && !command.isPending) {
            command.reset();
            setConfirming(false);
          }
        }}
        title={t.confirmTitle(code)}
        description={<p>{t.confirmText}</p>}
        confirm={again ? t.buildAgain : t.build}
        pendingLabel={t.building}
        pending={command.isPending}
        error={confirming ? command.error : null}
        onConfirm={() =>
          command.mutate(
            { command: 'build.start', data: { task: code } },
            {
              onSuccess: () => {
                setConfirming(false);
                void client.invalidateQueries({ queryKey: ['p', projectId] });
                announce(t.build);
              },
            },
          )
        }
      />
    </>
  );
}

function Glyph({ outcome }: { outcome: BuildOutcome }) {
  switch (outcome) {
    case 'ok':
      return <CheckCircleIcon size={14} />;
    case 'started':
      return <CircleDotIcon size={14} />;
    case 'waiting':
      return <CircleHalfIcon size={14} />;
    case 'failed':
      return <XCircleIcon size={14} />;
    case 'changes_requested':
      return <AlertTriangleIcon size={14} />;
  }
}

const OUTCOME_TEXT: Record<BuildOutcome, string> = {
  ok: 'text-fg-2',
  started: 'text-accent-text',
  waiting: 'text-fg-2',
  failed: 'text-danger-text',
  changes_requested: 'text-danger-text',
};

type DesignViolationView = { rule: number; path: string; line: number; message: string };

/** Components the builder asked for («NEEDS COMPONENT: <Name>») and the ones rule 3 found outside the manifest. */
export function neededComponents(steps: BuildStep[]): string[] {
  const names = new Set<string>();
  for (const s of steps) {
    const d = s.detail as { report?: { notes?: string } | null; violations?: DesignViolationView[] } | null;
    for (const m of (d?.report?.notes ?? '').matchAll(/NEEDS COMPONENT:\s*([A-Z][A-Za-z0-9]*)/g)) names.add(m[1] as string);
    for (const v of d?.violations ?? []) {
      const m = v.rule === 3 ? /^([A-Z][A-Za-z0-9]*) is not in the approved design system/.exec(v.message) : null;
      if (m) names.add(m[1] as string);
    }
  }
  return [...names];
}

/** One line per stage of the latest attempt (its latest step), the PR link and the review verdict. */
export function BuildStepper({ build }: { build: NonNullable<RecordDetail['build']> }) {
  const t = useMessages(AGENT_BUILD);
  const attempt = latestAttempt(build.steps);
  if (attempt.length === 0 && !build.pr_url) return null;
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const byStage = new Map<string, BuildStep>();
  for (const s of attempt) byStage.set(s.stage, s);
  const url = build.pr_url ?? build.request?.pr_url ?? null;
  return (
    <div className="flex flex-col gap-2 text-sm" data-build-stepper>
      <ol className="flex flex-col gap-1" aria-label={t.stages}>
        {[...byStage.values()].map((s) => (
          <li key={s.stage} className={cn('flex items-center gap-2', OUTCOME_TEXT[s.outcome])} data-stage={s.stage} data-outcome={s.outcome}>
            <Glyph outcome={s.outcome} />
            <span className="font-medium">{t[`s_${s.stage}` as const]}</span>
            <span>{t[`o_${s.outcome}` as const]}</span>
            {s.stage === 'design' ? <DesignDetail step={s} /> : null}
          </li>
        ))}
      </ol>
      {projectId
        ? neededComponents(attempt).map((name) => (
            <Link
              key={name}
              to="/p/$projectId/design-system"
              params={{ projectId }}
              className={buttonClass({ variant: 'secondary', size: 'sm', className: 'self-start' })}
              data-propose-component={name}
            >
              {t.proposeComponent(name)}
            </Link>
          ))
        : null}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
          {t.pullRequest}: {url}
        </a>
      ) : null}
      {build.review ? (
        <p className="text-fg-2" data-review>
          <span className="font-medium text-fg">{build.review.verdict === 'approve' ? t.verdictApprove : t.verdictChanges}</span>
          {build.review.comments_count > 0 ? ` · ${t.comments(build.review.comments_count)}` : ''}
          {build.review.summary ? ` — ${build.review.summary}` : ''}
        </p>
      ) : null}
    </div>
  );
}

function DesignDetail({ step }: { step: BuildStep }) {
  const t = useMessages(AGENT_BUILD);
  const d = step.detail as { note?: string; violations?: DesignViolationView[] } | null;
  const violations = d?.violations ?? [];
  if (violations.length === 0) return d?.note ? <span className="text-fg-3">{d.note === 'no design system yet' ? t.noDesign : d.note}</span> : null;
  return (
    <details className="text-fg-2" data-design-violations>
      <summary className="cursor-pointer">{t.violations(violations.length)}</summary>
      <ul className="mt-1 flex flex-col gap-0.5 pl-4">
        {violations.map((v, i) => (
          <li key={`${v.path}:${v.line}:${i}`}>
            <code>
              {v.path}
              {v.line ? `:${v.line}` : ''}
            </code>{' '}
            {v.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ConnectGithubLine() {
  const t = useMessages(AGENT_BUILD);
  return <p className="text-sm text-fg-3">{t.connect}</p>;
}
