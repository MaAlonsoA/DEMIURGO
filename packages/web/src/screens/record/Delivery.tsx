// The pages of the delivery records (epic, feature, task) without overwhelming the person: one status
// word, one primary action for the state, at most one banner (Needs you, or the blocking problem), a
// short body with fixed headings and a properties rail. Sources: Carbon (one primary button per page),
// Primer (one banner per page), GitHub pull request checks (a small state glyph + word per criterion).
// What is computed here is only reading of what the server sends; nothing is stored.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { recordQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type {
  Criterion,
  CriterionState,
  FeatureTask,
  Readiness,
  RecordDetail,
  RecordVersion,
  TaskBuildState,
  TaskDraft,
} from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { checkAnchor, SectionContent, stepsOf } from '../../components/BehaviorSteps.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { useAllows } from '../../components/actions.tsx';
import { ConfirmDialog, PromptDialog } from '../../components/Dialog.tsx';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleHalfIcon,
  CircleIcon,
  PlusIcon,
  XCircleIcon,
} from '../../components/icons.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { KNOWLEDGE_WAIT } from '../../components/words.i18n.ts';
import { QueuedNotice } from '../../components/QueuedNotice.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { useTables } from '../../lib/hooks.ts';
import { effortTotals } from '../../sizes.ts';
import { AgentBuildButton, BuildStepper, ConnectGithubLine, isBuildRunning, lastOutcome, needsRebuild } from './AgentBuild.tsx';
import { DesignNextButton } from '../epics/DesignNext.tsx';
import type { EpicLine } from '../epics/logic.ts';
import type { EpicRef } from '../epics/DesignNext.tsx';
import { type Recording, EvidenceLine } from './Checks.tsx';
import { CopyBriefButton } from './CopyBrief.tsx';
import { ReasonText } from './RecordAside.tsx';
import { DELIVERY } from './words.i18n.ts';

export type Words = (typeof DELIVERY)['en'];
export type StatusTone = 'neutral' | 'accent' | 'warning' | 'success' | 'danger';
export type Status = { word: string; tone: StatusTone };

export const TONE_TEXT: Record<StatusTone, string> = {
  neutral: 'text-fg-2',
  accent: 'text-accent-text',
  warning: 'text-warning-text',
  success: 'text-success-text',
  danger: 'text-danger-text',
};

const TONE_GLYPH: Record<StatusTone, ReactNode> = {
  neutral: <CircleIcon size={14} />,
  accent: <CircleDotIcon size={14} />,
  warning: <CircleHalfIcon size={14} />,
  success: <CheckCircleIcon size={14} />,
  danger: <XCircleIcon size={14} />,
};

/** The one status word of a page, with its small glyph. */
export function StatusWord({ status }: { status: Status }) {
  return (
    <span data-status className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', TONE_TEXT[status.tone])}>
      {TONE_GLYPH[status.tone]}
      {status.word}
    </span>
  );
}

// ---------------------------------------------------------------- what the page says and offers

export type BannerAction = { label: string } & ({ anchor: string } | { code: string } | { href: string });
export type Banner = { tone: 'accent' | 'danger'; text: string; action: BannerAction | null };

export type Primary =
  | { kind: 'draft_tasks' }
  | { kind: 'design_screens'; code: string; review?: boolean }
  | { kind: 'build_next'; code: string }
  | { kind: 'start_build'; code: string; title: string }
  | { kind: 'follow_build' }
  | { kind: 'agent_build'; code: string; again: boolean; review?: boolean }
  | { kind: 'pr'; url: string }
  | { kind: 'design'; epic: EpicRef; line: EpicLine; label: string }
  | { kind: 'thread'; id: string };

export type Delivery = { status: Status; banner: Banner | null; primary: Primary | null };

export const BUILD_TONE: Record<TaskBuildState, StatusTone> = {
  to_do: 'neutral',
  requested: 'accent',
  in_pr: 'warning',
  merged: 'success',
  failing: 'danger',
};

export const liveTasks = (r: RecordDetail): FeatureTask[] => (r.tasks ?? []).filter((x) => !x.dropped);

/**
 * Status, banner and primary action of a record page. The banner comes first and takes the person's
 * attention (a pending proposal, a check by hand, something failing); with a banner that offers an
 * action, the header has no primary of its own, so a page never has two.
 */
export function deliveryOf(input: {
  t: Words;
  record: RecordDetail;
  version: RecordVersion;
  ready: Readiness | null;
  /** Codes with a pending proposal that concern this page (itself, or the features of an epic). */
  pending: string[];
  epic: { status: 'not_started' | 'in_progress' | 'done'; next: EpicLine | null; ref: EpicRef | null } | null;
  canRequestBuild: boolean;
  stateWord: string;
}): Delivery {
  const { t, record, version, ready, pending, epic } = input;
  const current = version.state === 'approved' && version.n === record.current;
  const tasks = liveTasks(record);
  const failingCriteria = version.criteria.filter((c) => c.state === 'failing').map((c) => c.code);
  const byHand = version.criteria.find((c) => c.state === 'check_by_hand');
  let status: Status;
  let banner: Banner | null = null;
  let primary: Primary | null = null;

  if (version.state === 'draft') status = { word: t.st_draft, tone: 'accent' };
  else if (!current) status = { word: input.stateWord, tone: 'neutral' };
  else if (record.type === 'epic' && epic) {
    status = {
      word: epic.status === 'done' ? t.st_done : epic.status === 'in_progress' ? t.st_in_progress : t.st_not_started,
      tone: epic.status === 'done' ? 'success' : epic.status === 'in_progress' ? 'warning' : 'neutral',
    };
  } else if (record.type === 'task' && record.build) {
    const b = record.build.state;
    status = { word: t[`st_${b}` as const], tone: BUILD_TONE[b] };
  } else if (record.type === 'fdr') {
    const anyBuilt = tasks.some((x) => x.build !== 'to_do');
    const failing = tasks.some((x) => x.build === 'failing') || failingCriteria.length > 0;
    status = failing
      ? { word: t.st_failing, tone: 'danger' }
      : record.dod?.done
        ? { word: t.st_built, tone: 'success' }
        : anyBuilt
          ? { word: t.st_building, tone: 'warning' }
          : { word: t.st_approved, tone: 'neutral' };
  } else status = { word: t.st_approved, tone: 'neutral' };

  const own = pending.includes(record.code);
  const other = pending.find((c) => c !== record.code);
  if (own) banner = { tone: 'accent', text: t.proposalWaiting(record.code), action: { label: t.reviewProposal, anchor: 'proposal' } };
  else if (other) banner = { tone: 'accent', text: t.proposalWaiting(other), action: { label: t.reviewProposal, code: other } };
  else if (current && record.type === 'fdr') {
    const failingTask = tasks.find((x) => x.build === 'failing');
    if (failingCriteria.length > 0 || failingTask)
      banner = {
        tone: 'danger',
        text: failingTask && failingCriteria.length === 0 ? t.failingTask(failingTask.code) : t.failingChecks(failingCriteria.join(', ')),
        action: failingTask ? { label: t.openCode(failingTask.code), code: failingTask.code } : null,
      };
    else if (byHand && tasks.length > 0 && tasks.every((x) => x.build === 'merged'))
      banner = { tone: 'accent', text: t.byHand(byHand.code), action: { label: t.checkIt, anchor: checkAnchor(byHand.code) } };
  } else if (current && record.type === 'task' && record.build?.state === 'failing') {
    const url = record.build.request?.pr_url ?? null;
    // When the next attempt can address it (red CI or the reviewer's changes), that is the action, not the link.
    const addressable = !!record.build.github && !isBuildRunning(record.build.steps) && lastOutcome(record.build.steps) === 'changes_requested';
    banner = { tone: 'danger', text: t.failingTask(record.code), action: url && !addressable ? { label: t.openPr, href: url } : null };
  } else if (current && record.type === 'epic' && byHand && epic?.status === 'done')
    banner = { tone: 'accent', text: t.byHand(byHand.code), action: { label: t.checkIt, anchor: checkAnchor(byHand.code) } };

  // The primary of the state, only when no banner asks for the person's action.
  if (!banner?.action && current) {
    if (record.type === 'fdr') {
      const next = tasks.find((x) => x.build === 'to_do');
      // With an approved design system the screens come before the tasks (Cagan and Patton, SVPG).
      const screensFirst = !!record.dsy && record.screens?.state !== 'approved';
      // Even with tasks from an older version: the current version still needs its screens.
      if (screensFirst) primary = { kind: 'design_screens', code: record.code, review: !!record.screens };
      else if (tasks.length === 0 && (record.task_drafts ?? []).length === 0) primary = { kind: 'draft_tasks' };
      else if (next) primary = { kind: 'build_next', code: next.code };
    } else if (record.type === 'task' && record.build) {
      const b = record.build;
      if (b.state === 'to_do' && ready?.ready && input.canRequestBuild) primary = { kind: 'start_build', code: record.code, title: version.title };
      else if (b.state === 'requested' && b.github) {
        // Running: no primary, the stages are shown. Otherwise build (or build again after a stop).
        if (!isBuildRunning(b.steps)) primary = { kind: 'agent_build', code: record.code, again: needsRebuild(b.steps) };
      } else if (b.state === 'requested') primary = { kind: 'follow_build' };
      else if ((b.state === 'in_pr' || b.state === 'failing') && b.github && !isBuildRunning(b.steps) && lastOutcome(b.steps) === 'changes_requested')
        // The reviewer (or red CI) asked for changes: the next attempt continues on the same branch and pull request.
        primary = { kind: 'agent_build', code: record.code, again: true, review: true };
      else if (b.state === 'in_pr' && b.request?.pr_url) primary = { kind: 'pr', url: b.request.pr_url };
    } else if (record.type === 'epic' && epic?.next && epic.ref)
      primary = { kind: 'design', epic: epic.ref, line: epic.next, label: t.designNext };
  }
  return { status, banner, primary };
}

// ---------------------------------------------------------------- draft the tasks

/** "Draft the tasks": asks the task-planning agent for the tasks of the approved feature. */
export function useDraftTasks(projectId: string, versionId: string) {
  const t = useMessages(DELIVERY);
  const command = useCommand(projectId);
  const [asked, setAsked] = useState(false);
  const run = () => {
    if (command.isPending) return;
    command.mutate(
      { command: 'run.request', data: { action: 'task_plan', scope: { type: 'record_version', id: versionId } } },
      {
        onSuccess: () => {
          setAsked(true);
          announce(t.draftAsked);
        },
      },
    );
  };
  return { run, pending: command.isPending, waiting: command.waiting, queued: command.queued, error: command.error, asked };
}
export type DraftTasks = ReturnType<typeof useDraftTasks>;

export function PrimaryAction({
  projectId,
  primary,
  draft,
}: {
  projectId: string;
  primary: Primary;
  draft: DraftTasks;
}) {
  const t = useMessages(DELIVERY);
  const w = useMessages(KNOWLEDGE_WAIT);
  const [confirming, setConfirming] = useState(false);
  const request = useCommand(projectId);
  switch (primary.kind) {
    case 'draft_tasks':
      return (
        <div className="flex flex-col items-start gap-2">
          <Button variant="primary" pending={draft.pending} pendingLabel={draft.waiting ? w.waiting : t.drafting} onClick={draft.run} data-primary="draft-tasks">
            {t.draftTasks}
          </Button>
          <QueuedNotice queued={draft.queued} />
          {draft.error ? <ErrorNotice error={draft.error} compact /> : null}
        </div>
      );
    case 'design_screens':
      return (
        <Link
          to="/p/$projectId/records/$code"
          params={{ projectId, code: primary.code }}
          search={{ tab: 'screens' } as never}
          className={buttonClass({ variant: 'primary' })}
          data-primary="design-screens"
        >
          {primary.review ? t.reviewDraft : t.designScreens}
        </Link>
      );
    case 'build_next':
      return (
        <Link
          to="/p/$projectId/records/$code"
          params={{ projectId, code: primary.code }}
          className={buttonClass({ variant: 'primary' })}
          data-primary="build-next"
        >
          {t.buildNext}
        </Link>
      );
    case 'agent_build':
      return <AgentBuildButton projectId={projectId} code={primary.code} again={primary.again} review={primary.review} />;
    case 'follow_build':
      return (
        <Link to="/p/$projectId/build" params={{ projectId }} className={buttonClass({ variant: 'primary' })}>
          {t.followBuild}
        </Link>
      );
    case 'pr':
      return (
        <a href={primary.url} target="_blank" rel="noreferrer" className={buttonClass({ variant: 'primary' })}>
          {t.openPr}
        </a>
      );
    case 'thread':
      return (
        <Link
          to="/p/$projectId/threads/$explorationId"
          params={{ projectId, explorationId: primary.id }}
          className={buttonClass({ variant: 'primary' })}
        >
          {t.openThread}
        </Link>
      );
    case 'design':
      return <DesignNextButton projectId={projectId} epic={primary.epic} line={primary.line} label={primary.label} />;
    case 'start_build':
      return (
        <>
          <Button variant="primary" onClick={() => setConfirming(true)} data-primary="start-build">
            {t.startBuild}
          </Button>
          <ConfirmDialog
            open={confirming}
            onOpenChange={(o) => {
              if (!o) {
                request.reset();
                setConfirming(false);
              }
            }}
            title={t.startBuildTitle(primary.title)}
            description={t.startBuildText}
            confirm={t.startBuild}
            pendingLabel={t.starting}
            pending={request.isPending}
            error={confirming ? request.error : null}
            onConfirm={() =>
              request.mutate(
                { command: 'build_request.request', data: { task: primary.code } },
                { onSuccess: () => setConfirming(false) },
              )
            }
          />
        </>
      );
  }
}

/** The one banner of the page: Needs you, or the blocking problem. */
export function DeliveryBanner({ projectId, banner }: { projectId: string; banner: Banner }) {
  const t = useMessages(DELIVERY);
  const a = banner.action;
  const action = !a ? undefined : 'anchor' in a ? (
    // It points to a place on the page whose own action (Accept, record the check) is the primary one.
    <a href={`#${a.anchor}`} className={buttonClass({ variant: 'secondary' })}>
      {a.label}
    </a>
  ) : 'code' in a ? (
    <Link
      to="/p/$projectId/records/$code"
      params={{ projectId, code: a.code }}
      hash={banner.tone === 'accent' ? 'proposal' : ''}
      className={buttonClass({ variant: banner.tone === 'accent' ? 'primary' : 'secondary' })}
    >
      {a.label}
    </Link>
  ) : (
    <a href={a.href} target="_blank" rel="noreferrer" className={buttonClass({ variant: 'secondary' })}>
      {a.label}
    </a>
  );
  return (
    <div data-delivery-banner={banner.tone}>
      <Notice tone={banner.tone} title={banner.tone === 'danger' ? t.problem : t.needsYou} action={action}>
        {banner.text}
      </Notice>
    </div>
  );
}

// ---------------------------------------------------------------- criteria as checks

export const CRITERION: Record<CriterionState, { tone: string; icon: ReactNode }> = {
  verified: { tone: 'text-success-text', icon: <CheckCircleIcon size={16} /> },
  failing: { tone: 'text-danger-text', icon: <XCircleIcon size={16} /> },
  in_pr: { tone: 'text-warning-text', icon: <CircleHalfIcon size={16} /> },
  no_evidence: { tone: 'text-fg-3', icon: <CircleDashedIcon size={16} /> },
  check_by_hand: { tone: 'text-accent-text', icon: <CircleDotIcon size={16} /> },
  not_started: { tone: 'text-fg-3', icon: <CircleIcon size={16} /> },
};

/** A criterion like a pull request check: a state glyph and word, Given / When / Then in three short lines. */
export function CriterionRow({ c, recording }: { c: Criterion; recording: Recording }) {
  const t = useMessages(DELIVERY);
  const s: CriterionState = c.state ?? 'not_started';
  const meta = CRITERION[s];
  const parts = c.given && c.when && c.then ? ([['given', c.given], ['when', c.when], ['then', c.then]] as const) : null;
  return (
    <li
      id={checkAnchor(c.code)}
      data-check={c.code}
      data-criterion-state={s}
      className="flex scroll-mt-16 gap-2.5 border-t border-edge-subtle py-2.5 first:border-t-0"
    >
      <span className={cn('mt-0.5 shrink-0', meta.tone)}>{meta.icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Code>{c.code}</Code>
          <span className="text-sm font-medium text-fg">{c.title}</span>
          <span className={cn('ml-auto text-xs font-medium', meta.tone)}>{t[`cs_${s}` as const]}</span>
        </div>
        {parts ? (
          <div className="flex flex-col gap-0.5 text-sm text-fg-2">
            {parts.map(([k, text]) => (
              <p key={k}>
                <span className="mr-1.5 text-xs font-medium text-fg-3">{t[k]}</span>
                {text}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-2">{c.statement}</p>
        )}
        {c.evidence || (recording && s === 'check_by_hand') ? <EvidenceLine criterion={c} recording={recording} /> : null}
      </div>
    </li>
  );
}

export function CriteriaList({ criteria, recording }: { criteria: Criterion[]; recording: Recording }) {
  if (criteria.length === 0) return null;
  return (
    <ul className="flex flex-col">
      {criteria.map((c) => (
        <CriterionRow key={c.id} c={c} recording={recording} />
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- body pieces

/** A section of the body: a fixed short heading, and what it holds. */
export function Block({
  title,
  note,
  children,
  id,
}: {
  title: string;
  /** One quiet line on the heading's right (a rollup, a count). */
  note?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const h = useId();
  return (
    <section aria-labelledby={h} id={id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h2 id={h} className="text-lg font-semibold text-fg">
          {title}
        </h2>
        {note ? <span className="text-sm tabular-nums text-fg-2">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

export const sectionOf = (v: RecordVersion, title: string) =>
  v.sections.find((s) => s.title.toLowerCase() === title.toLowerCase());

/** A prose section under its own heading; nothing when it is empty. */
export function Prose({ version, title, label, empty }: { version: RecordVersion; title: string; label: string; empty?: string }) {
  const s = sectionOf(version, title);
  const text = s?.content.trim();
  if (!text && !empty) return null;
  return (
    <Block title={label}>
      {text ? <Markdown className="max-w-prose">{text}</Markdown> : <p className="text-sm text-fg-3">{empty}</p>}
    </Block>
  );
}

/** The sections that have no place of their own, folded so nothing written is lost. */
export function OtherSections({ version, used }: { version: RecordVersion; used: string[] }) {
  const t = useMessages(DELIVERY);
  const skip = new Set(used.map((u) => u.toLowerCase()));
  const rest = version.sections.filter((s) => !skip.has(s.title.toLowerCase()) && s.content.trim());
  if (rest.length === 0) return null;
  return (
    <details className="group flex flex-col gap-3">
      <summary className="cursor-pointer text-sm text-fg-2 hover:text-fg">
        {t.moreSections(rest.map((s) => s.title).join(', '))}
      </summary>
      <div className="mt-3 flex flex-col gap-5">
        {rest.map((s) => (
          <section key={s.title} className="flex flex-col gap-1.5">
            <h3 className="text-base font-semibold text-fg">{s.title}</h3>
            <SectionContent title={s.title} text={s.content} className="max-w-prose" criteria={version.criteria} />
          </section>
        ))}
      </div>
    </details>
  );
}

/** The main flow: each step with the criteria that check it under it; the rest as "Other checks". */
export function Flow({ version, recording }: { version: RecordVersion; recording: Recording }) {
  const t = useMessages(DELIVERY);
  const text = sectionOf(version, 'Behavior')?.content ?? '';
  const steps = stepsOf(text);
  const criteria = version.criteria;
  const verified = criteria.filter((c) => c.state === 'verified').length;
  const failing = criteria.filter((c) => c.state === 'failing').length;
  const tied = (n: number) => criteria.filter((c) => c.step === n);
  const loose = criteria.filter((c) => c.step == null || c.step < 1 || c.step > steps.length);
  if (steps.length === 0 && criteria.length === 0) return null;
  return (
    <Block
      title={steps.length > 0 ? t.flow : t.checks}
      note={criteria.length > 0 ? t.checkSummary(criteria.length, verified, failing) : undefined}
    >
      {steps.length > 0 ? (
        <ol className="flex flex-col gap-4" data-behavior-steps>
          {steps.map((s) => (
            <li key={s.n} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
              <span className="text-sm font-medium text-fg-3 tabular-nums">{s.n}.</span>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-md font-semibold text-fg">{s.title}</p>
                {s.detail.map((d) => (
                  <p key={d} className="text-sm text-fg-2">
                    {d}
                  </p>
                ))}
                <CriteriaList criteria={tied(s.n)} recording={recording} />
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {loose.length > 0 ? (
        <div className="flex flex-col gap-1">
          {steps.length > 0 ? <h3 className="text-sm font-medium text-fg-2">{t.otherChecks}</h3> : null}
          <CriteriaList criteria={loose} recording={recording} />
        </div>
      ) : null}
    </Block>
  );
}

/** Tasks of a feature on its overview: one line (done, in PR, to do, drafts waiting) and a link to its Tasks tab. */
export function TasksRollup({
  projectId,
  record,
  primaryIsDraft,
}: {
  projectId: string;
  record: RecordDetail;
  /** The header's primary is "Draft the tasks": this section only says what comes next. */
  primaryIsDraft: boolean;
}) {
  const t = useMessages(DELIVERY);
  const tasks = liveTasks(record);
  const done = tasks.filter((x) => x.build === 'merged').length;
  const inPr = tasks.filter((x) => x.build === 'in_pr' || x.build === 'requested').length;
  const failing = tasks.filter((x) => x.build === 'failing').length;
  const todo = tasks.length - done - inPr - failing;
  const effort = effortTotals(tasks.map((x) => ({ size: (x.size as never) ?? null, built: x.build === 'merged' })));
  const drafts = (record.task_drafts ?? []).length;
  const uncovered = tasks.length > 0 ? (record.uncovered ?? []) : [];
  const summary = [
    tasks.length > 0 ? t.rollup(done, inPr, todo) : null,
    failing > 0 ? t.failingN(failing) : null,
    drafts > 0 ? t.draftsNote(drafts) : null,
    effort.total > 0 ? effort.summary : null,
  ].filter(Boolean);
  return (
    <Block id="tasks" title={t.tasks}>
      {summary.length === 0 ? (
        <p className="text-sm text-fg-2">{primaryIsDraft ? t.noTasksNext : t.noTasks}</p>
      ) : (
        <p className="text-sm text-fg-2">
          {summary.join(' · ')}{' '}
          <Link
            to="/p/$projectId/records/$code"
            params={{ projectId, code: record.code }}
            search={{ tab: 'tasks' } as never}
            className="font-medium text-accent-text hover:underline"
            data-open-tasks
          >
            {t.openTasks}
          </Link>
        </p>
      )}
      {uncovered.length > 0 ? <p className="text-sm text-fg-2">{t.uncovered(uncovered.join(', '))}</p> : null}
    </Block>
  );
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The practices the version says it rests on (free-form objects), each a link with what it was used for. */
export function PracticeSources({ version }: { version: RecordVersion }) {
  const t = useMessages(DELIVERY);
  const list = (version.practice_sources ?? []).flatMap((raw) => {
    if (typeof raw === 'string') return [{ title: raw, url: null as string | null, used: null as string | null }];
    if (!raw || typeof raw !== 'object') return [];
    const o = raw as Record<string, unknown>;
    const title = str(o.title) ?? str(o.name) ?? str(o.source) ?? str(o.url);
    return title ? [{ title, url: str(o.url) ?? str(o.link), used: str(o.used_for) ?? str(o.usedFor) }] : [];
  });
  if (list.length === 0) return null;
  return (
    <Block title={t.practices} note={<span className="text-fg-3">{t.unverified}</span>}>
      <ul className="flex flex-col gap-1.5">
        {list.map((p) => (
          <li key={`${p.title}-${p.url}`} className="flex flex-col text-sm">
            {p.url ? (
              <a href={p.url} target="_blank" rel="noreferrer" className="font-medium text-accent-text hover:underline">
                {p.title}
              </a>
            ) : (
              <span className="font-medium text-fg">{p.title}</span>
            )}
            {p.used ? <span className="text-fg-2">{p.used}</span> : null}
          </li>
        ))}
      </ul>
    </Block>
  );
}

// ---------------------------------------------------------------- bodies per type

export function FeatureBody({
  projectId,
  record,
  version,
  recording,
  primaryIsDraft,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  recording: Recording;
  primaryIsDraft: boolean;
}) {
  const t = useMessages(DELIVERY);
  return (
    <>
      <Prose version={version} title="Goal" label={t.goal} />
      <Prose version={version} title="Scope" label={t.scope} />
      <Flow version={version} recording={recording} />
      <Prose version={version} title="Out of scope" label={t.outOfScope} />
      {version.state === 'draft' ? null : (
        <TasksRollup projectId={projectId} record={record} primaryIsDraft={primaryIsDraft} />
      )}
      <PracticeSources version={version} />
      <OtherSections version={version} used={['Goal', 'Scope', 'Behavior', 'Out of scope']} />
    </>
  );
}

/** The feature codes a task rests on, from the links of its version. */
const parentOf = (v: RecordVersion): string | null =>
  v.links.find((l) => l.type === 'based_on' && l.to_code?.startsWith('FDR-'))?.to_code ?? null;

export function TaskBody({
  projectId,
  record,
  version,
  recording,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  recording: Recording;
}) {
  const t = useMessages(DELIVERY);
  const covers = record.covers ?? [];
  const parentCode = parentOf(version);
  const parent = useQuery({ ...recordQuery(projectId, parentCode ?? ''), enabled: !!parentCode && covers.length > 0 }).data;
  const parentVersion = parent?.versions.find((v) => v.n === parent.current);
  const covered = (parentVersion?.criteria ?? []).filter((c) => covers.includes(c.code));
  const build = record.build;
  return (
    <>
      <Prose version={version} title="Goal" label={t.goal} />
      <Prose version={version} title="Scope" label={t.scope} />
      {covers.length > 0 ? (
        <Block title={t.covers} note={parentCode ? <span className="font-mono text-xs">{parentCode}</span> : undefined}>
          {covered.length > 0 ? (
            <CriteriaList criteria={covered} recording={null} />
          ) : (
            <p className="text-sm text-fg-2 font-mono">{covers.join(', ')}</p>
          )}
        </Block>
      ) : null}
      {version.criteria.length > 0 ? (
        <Block title={t.checks}>
          <CriteriaList criteria={version.criteria} recording={recording} />
        </Block>
      ) : null}
      {build && version.n === record.current && version.state === 'approved' ? (
        <Block title={t.build}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className={cn('font-semibold', TONE_TEXT[BUILD_TONE[build.state]])}>{t[`st_${build.state}` as const]}</span>
            {build.request?.pr_url ? (
              <a href={build.request.pr_url} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
                {build.request.pr_url}
              </a>
            ) : null}
            {build.state === 'to_do' ? <CopyBriefButton projectId={projectId} code={record.code} size="sm" /> : null}
          </div>
          {build.github ? <BuildStepper build={build} /> : <ConnectGithubLine />}
        </Block>
      ) : null}
      <OtherSections version={version} used={['Goal', 'Scope']} />
    </>
  );
}

// ---------------------------------------------------------------- the properties rail

export function Prop({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', wide && 'col-span-2 @4xl:col-span-1')}>
      <dt className="text-xs font-medium text-fg-3">{label}</dt>
      <dd className="text-sm text-fg">{children}</dd>
    </div>
  );
}

export function CodeLinks({
  projectId,
  items,
  limit = 4,
}: {
  projectId: string;
  items: { code: string; title: string }[];
  limit?: number;
}) {
  const t = useMessages(DELIVERY);
  const link = (i: { code: string; title: string }) => (
    <li key={i.code}>
      <Link to="/p/$projectId/records/$code" params={{ projectId, code: i.code }} className="text-accent-text hover:underline">
        <span className="mr-1.5 font-mono text-xs text-fg-3">{i.code}</span>
        {i.title}
      </Link>
    </li>
  );
  const rest = items.slice(limit);
  return (
    <ul className="flex flex-col gap-1">
      {items.slice(0, limit).map(link)}
      {rest.length > 0 ? (
        <li>
          <details>
            <summary className="cursor-pointer text-fg-2 hover:text-fg">{t.more(rest.length)}</summary>
            <ul className="mt-1 flex flex-col gap-1">{rest.map(link)}</ul>
          </details>
        </li>
      ) : null}
    </ul>
  );
}

/** Properties: state, size, what it rests on, what depends on it, readiness and (features) the Definition of Done. */
export function Rail({
  projectId,
  record,
  version,
  ready,
  status,
  extra,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  ready: Readiness | null;
  status: Status;
  extra?: ReactNode;
}) {
  const t = useMessages(DELIVERY);
  const basedOn = version.links
    .filter((l) => l.type === 'based_on' && l.to_code)
    .map((l) => ({ code: l.to_code as string, title: l.to_title ?? (l.to_code as string) }));
  const child = record.type === 'fdr' ? 'task' : record.type === 'epic' ? 'fdr' : null;
  const seen = new Set<string>();
  const depends = record.incoming
    .filter((l) => l.relation !== null && l.from_type !== child && !seen.has(l.from_code) && seen.add(l.from_code))
    .map((l) => ({ code: l.from_code, title: l.from_title }));
  const sized = record.type === 'fdr' || record.type === 'task';
  const left = ready?.reasons.length ?? 0;
  return (
    <div className="flex flex-col gap-4" data-rail>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @4xl:grid-cols-1">
        <Prop label={t.state}>
          <StatusWord status={status} />
        </Prop>
        {sized ? <Prop label={t.size}>{record.size ?? <span className="text-fg-3">{t.noSize}</span>}</Prop> : null}
        {basedOn.length > 0 ? (
          <Prop label={t.basedOn} wide>
            <CodeLinks projectId={projectId} items={basedOn} />
          </Prop>
        ) : null}
        <Prop label={t.dependsOn} wide>
          {depends.length > 0 ? <CodeLinks projectId={projectId} items={depends} /> : <span className="text-fg-3">{t.nothingDepends}</span>}
        </Prop>
        {ready ? (
          <Prop label={t.readiness} wide>
            {left === 0 ? (
              <span className="text-fg-2">{t.nothingBlocks}</span>
            ) : (
              <details>
                <summary className="cursor-pointer text-fg-2 hover:text-fg">{t.left(left)}</summary>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {ready.reasons.map((r) => (
                    <li key={r} className="flex items-start gap-1.5 text-fg">
                      <AlertTriangleIcon size={13} className="mt-0.5 shrink-0 text-fg-3" />
                      <span>
                        <ReasonText projectId={projectId} text={r} />
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Prop>
        ) : null}
        {record.dod ? (
          <Prop label={t.dod} wide>
            <details>
              <summary className="cursor-pointer text-fg-2 hover:text-fg">{t.dodText(record.dod.missing.length)}</summary>
              {record.dod.missing.length > 0 ? (
                <ul className="mt-1.5 flex flex-col gap-1 text-fg-2">
                  {record.dod.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : null}
            </details>
          </Prop>
        ) : null}
      </dl>
      {extra}
    </div>
  );
}
