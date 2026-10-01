// The page of an issue: what happened, where (task, feature, PR), what the reviewer said when it
// is an escalation, and what a person can do while it is open (resolve with a task, close with a
// reason) or after (reopen).

import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { issueQuery, projectsQuery, stateQuery } from '../../api/queries.ts';
import type { IssueReviewComment, IssueView } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { Dialog, PromptDialog } from '../../components/Dialog.tsx';
import { Field, TextInput } from '../../components/Field.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, READING_COLUMN, Section, usePageTitle } from '../../components/Page.tsx';
import { PageSkeleton } from '../../components/Spinner.tsx';
import { DayTime } from '../../components/Time.tsx';
import { Who } from '../../components/Who.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { NotFound } from '../not-found/NotFound.tsx';
import { codeOf, commentsPersonFirst, versionOf } from './logic.ts';
import { ISSUE, ISSUES } from './words.i18n.ts';

const link = 'text-accent-text hover:underline';

export function IssueScreen() {
  const { projectId, code } = useParams({ strict: false }) as { projectId: string; code: string };
  const issue = useQuery(issueQuery(projectId, code));
  const t = useMessages(ISSUE);
  const w = useMessages(ISSUES);
  const project = useQuery(projectsQuery).data?.find((p) => p.id === projectId);
  usePageTitle([issue.data ? `${issue.data.code} ${issue.data.title}` : code, w.title, project?.name]);

  if (issue.isPending) return <PageSkeleton label={t.loading} />;
  if (!issue.data) {
    if (issue.error instanceof ApiError && issue.error.status === 404) return <NotFound />;
    return (
      <PageBody>
        <ErrorNotice error={issue.error} onRetry={() => void issue.refetch()} />
      </PageBody>
    );
  }
  return <IssuePage projectId={projectId} issue={issue.data} />;
}

function IssuePage({ projectId, issue }: { projectId: string; issue: IssueView }) {
  const t = useMessages(ISSUE);
  const w = useMessages(ISSUES);
  const comments = commentsPersonFirst(issue.review?.comments ?? []);
  const needing = comments.filter((c) => c.needs_person);
  const others = comments.filter((c) => !c.needs_person);
  return (
    <>
      <PageHeader
        crumbs={[{ label: t.back, link: { to: '/p/$projectId/issues', params: { projectId } } }]}
        eyebrow={
          <>
            <Code>{issue.code}</Code>
            <span>{w[`kind_${issue.kind}`]}</span>
            <span className="font-medium text-fg" data-issue-state={issue.state}>
              {w[`state_${issue.state}`]}
            </span>
          </>
        }
        title={issue.title}
        meta={
          <>
            <Who actor={issue.opened_by} size={14} prefix={t.opened} />
            <DayTime iso={issue.opened_at} />
          </>
        }
        actions={<Actions projectId={projectId} issue={issue} />}
      />
      <PageBody width="wide" className="flex flex-col gap-8">
        <div className={cn('flex flex-col gap-8', READING_COLUMN)}>
          <p className="text-sm text-fg-2" data-issue-options>
            {issue.state === 'open' ? (issue.kind === 'review_escalation' ? t.optionsEscalation : t.optionsBug) : null}
          </p>
          <Outcome issue={issue} projectId={projectId} />
          <Where projectId={projectId} issue={issue} />
          <Section title={t.description}>
            {issue.body.trim() ? <Markdown className="max-w-prose">{issue.body}</Markdown> : <p className="text-sm text-fg-3">{t.noBody}</p>}
          </Section>
          {issue.review ? (
            <>
              <Section title={t.reviewSummary}>
                <p className="max-w-prose whitespace-pre-wrap text-base text-fg">{issue.review.summary}</p>
              </Section>
              {needing.length > 0 ? (
                <Section title={t.needsYou} level={3}>
                  <CommentList comments={needing} />
                </Section>
              ) : null}
              {others.length > 0 ? (
                <Section title={needing.length > 0 ? t.otherComments : t.reviewSummary} level={3}>
                  <CommentList comments={others} />
                </Section>
              ) : null}
            </>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}

function CommentList({ comments }: { comments: IssueReviewComment[] }) {
  const t = useMessages(ISSUE);
  return (
    <ul className="flex flex-col divide-y divide-edge-subtle" data-issue-comments>
      {comments.map((c, i) => (
        <li key={`${c.path}:${c.line ?? ''}:${i}`} className="flex flex-col gap-1 py-2.5">
          <span className="flex flex-wrap items-baseline gap-x-3 text-sm">
            <Code>{t.inFile(c.path, c.line)}</Code>
            <span className="text-fg-2">{c.severity}</span>
          </span>
          <p className="max-w-prose whitespace-pre-wrap text-base text-fg">{c.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** How it ended: the task that resolved it, or the reason it was closed. */
function Outcome({ issue, projectId }: { issue: IssueView; projectId: string }) {
  const t = useMessages(ISSUE);
  if (issue.state === 'resolved' && issue.resolution) {
    const r = issue.resolution;
    return (
      <Section title={t.resolvedBy(r.task_code)} level={3}>
        <p className="flex flex-wrap items-baseline gap-x-3 text-base text-fg" data-issue-resolution>
          <Link to="/p/$projectId/records/$code" params={{ projectId, code: r.task_code }} className={link}>
            <Code className="mr-1.5">{r.task_code}</Code>
            {r.task_title}
          </Link>
          {r.version_n !== null ? <span className="text-sm text-fg-2">{t.resolvedVersion(r.version_n)}</span> : null}
        </p>
        {issue.resolved_by ? (
          <span className="flex flex-wrap items-center gap-x-2 text-sm text-fg-2">
            {t.resolvedAt} <Who actor={issue.resolved_by} size={14} /> <DayTime iso={issue.resolved_at} />
          </span>
        ) : null}
      </Section>
    );
  }
  if (issue.state === 'closed') {
    return (
      <Section title={t.closeReason} level={3}>
        <p className="max-w-prose whitespace-pre-wrap text-base text-fg" data-issue-close-reason>
          {issue.close_reason}
        </p>
        {issue.closed_by ? (
          <span className="flex flex-wrap items-center gap-x-2 text-sm text-fg-2">
            {t.closedAt} <Who actor={issue.closed_by} size={14} /> <DayTime iso={issue.closed_at} />
          </span>
        ) : null}
      </Section>
    );
  }
  return null;
}

function Where({ projectId, issue }: { projectId: string; issue: IssueView }) {
  const t = useMessages(ISSUE);
  const rows: { label: string; node: React.ReactNode }[] = [];
  if (issue.task)
    rows.push({
      label: t.task,
      node: (
        <Link to="/p/$projectId/records/$code" params={{ projectId, code: issue.task.code }} className={link}>
          <Code className="mr-1.5">{issue.task.code}</Code>
          {issue.task.title}
        </Link>
      ),
    });
  if (issue.feature)
    rows.push({
      label: t.feature,
      node: (
        <Link to="/p/$projectId/records/$code" params={{ projectId, code: issue.feature.code }} className={link}>
          <Code className="mr-1.5">{issue.feature.code}</Code>
          {issue.feature.title}
        </Link>
      ),
    });
  if (issue.criterion_code) rows.push({ label: t.criterion, node: <Code>{issue.criterion_code}</Code> });
  if (issue.pr_url || issue.pr_number !== null)
    rows.push({
      label: t.pr,
      node: (
        <span>
          {issue.pr_url ? (
            <a href={issue.pr_url} target="_blank" rel="noreferrer" className={link}>
              {issue.pr_number !== null ? t.prNumber(issue.pr_number) : issue.pr_url}
            </a>
          ) : (
            <span>{issue.pr_number !== null ? t.prNumber(issue.pr_number) : null}</span>
          )}
          {issue.attempt !== null ? <span className="text-fg-2"> · {t.attempt(issue.attempt)}</span> : null}
        </span>
      ),
    });
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm" data-issue-where>
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-fg-2">{r.label}</dt>
          <dd className="min-w-0 text-fg">{r.node}</dd>
        </div>
      ))}
    </dl>
  );
}

function Actions({ projectId, issue }: { projectId: string; issue: IssueView }) {
  const t = useMessages(ISSUE);
  const [dialog, setDialog] = useState<'resolve' | 'close' | 'reopen' | null>(null);
  const close = useCommand(projectId);
  const reopen = useCommand(projectId);
  if (issue.state === 'open')
    return (
      <>
        <Button variant="primary" data-issue-resolve onClick={() => setDialog('resolve')}>
          {t.resolve}
        </Button>
        <Button data-issue-close onClick={() => setDialog('close')}>
          {t.close}
        </Button>
        <ResolveDialog projectId={projectId} issue={issue} open={dialog === 'resolve'} onOpenChange={(o) => setDialog(o ? 'resolve' : null)} />
        <PromptDialog
          open={dialog === 'close'}
          onOpenChange={(o) => {
            if (!close.isPending) setDialog(o ? 'close' : null);
          }}
          title={t.closeTitle}
          description={t.closeDescription}
          label={t.closeLabel}
          submit={t.closeSubmit}
          pendingLabel={t.closePending}
          required
          pending={close.isPending}
          error={close.error}
          onSubmit={(reason) =>
            close.mutate(
              { command: 'issue.close', entityId: issue.id, data: { reason } },
              {
                onSuccess: () => {
                  setDialog(null);
                  announce(t.closed(issue.code));
                },
              },
            )
          }
        />
      </>
    );
  return (
    <>
      <Button data-issue-reopen onClick={() => setDialog('reopen')}>
        {t.reopen}
      </Button>
      <PromptDialog
        open={dialog === 'reopen'}
        onOpenChange={(o) => {
          if (!reopen.isPending) setDialog(o ? 'reopen' : null);
        }}
        title={t.reopenTitle}
        description={t.reopenDescription}
        label={t.reopenLabel}
        submit={t.reopenSubmit}
        pendingLabel={t.reopenPending}
        pending={reopen.isPending}
        error={reopen.error}
        onSubmit={(reason) =>
          reopen.mutate(
            { command: 'issue.reopen', entityId: issue.id, data: reason ? { reason } : {} },
            {
              onSuccess: () => {
                setDialog(null);
                announce(t.reopened(issue.code));
              },
            },
          )
        }
      />
    </>
  );
}

function ResolveDialog({
  projectId,
  issue,
  open,
  onOpenChange,
}: {
  projectId: string;
  issue: IssueView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useMessages(ISSUE);
  const command = useCommand(projectId);
  const state = useQuery({ ...stateQuery(projectId), enabled: open });
  const tasks = [...(state.data?.designs ?? []), ...(state.data?.decisions ?? [])].filter((r) => r.type === 'task');
  const [task, setTask] = useState('');
  const [version, setVersion] = useState('');
  const [tried, setTried] = useState(false);
  const fix = codeOf(task);
  const n = versionOf(version);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (command.isPending) return;
    setTried(true);
    if (!fix || n === null) return;
    command.mutate(
      { command: 'issue.resolve', entityId: issue.id, data: { fix_task: fix, ...(n !== undefined ? { version: n } : {}) } },
      {
        onSuccess: () => {
          onOpenChange(false);
          announce(t.resolved(issue.code));
        },
      },
    );
  };
  const listId = `tasks-${issue.id}`;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!command.isPending) {
          if (o) {
            setTask('');
            setVersion('');
            setTried(false);
            command.reset();
          }
          onOpenChange(o);
        }
      }}
      title={t.resolveTitle}
      description={t.resolveDescription}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t.taskLabel} hint={t.taskHint} error={tried && !fix ? t.taskRequired : undefined}>
          {(p) => <TextInput {...p} list={listId} value={task} onChange={(e) => setTask(e.target.value)} autoFocus />}
        </Field>
        <datalist id={listId} aria-label={t.taskListLabel}>
          {tasks.map((r) => (
            <option key={r.code} value={r.code}>
              {r.title}
            </option>
          ))}
        </datalist>
        <Field label={t.versionLabel} hint={t.versionHint} optional error={tried && n === null ? t.versionInvalid : undefined}>
          {(p) => <TextInput {...p} inputMode="numeric" value={version} onChange={(e) => setVersion(e.target.value)} />}
        </Field>
        {command.error ? <ErrorNotice error={command.error} compact /> : null}
        <div className="flex justify-end gap-2">
          <Button variant="quiet" disabled={command.isPending} onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button type="submit" variant="primary" pending={command.isPending} pendingLabel={t.resolvePending}>
            {t.resolveSubmit}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
