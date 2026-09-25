// The Idea checks tab (DESIGN.md §3.8, INV-KNOW-15…18): every idea an agent proposes is compared
// with what DEMIURGO knows. Each check shows the proposal (its state, and the way to its batch,
// where the person decides) and its findings: the verdict in words, the cited node with how sure it
// is, and the classifier's confidence and reason. A contradiction says "Conflict" in words.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ideaAssessmentsQuery } from '../../api/queries.ts';
import type { IdeaAssessment } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { Card } from '../../components/Card.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ArrowRightIcon, IdeaIcon } from '../../components/icons.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { Certainty, EntityState, StatusBadge } from '../../components/status.tsx';
import { RelativeTime } from '../../components/Time.tsx';
import { TypeIcon } from '../../components/types.tsx';
import { Who } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { verdictWord } from './graph.ts';

const IDEA_TYPES: Record<string, { word: string; icon: string }> = {
  decision: { word: 'Decision', icon: 'decision' },
  fdr: { word: 'Feature', icon: 'fdr' },
  exploration: { word: 'Thread', icon: 'thread' },
};

export function IdeaChecksTab({ projectId }: { projectId: string }) {
  const list = useQuery(ideaAssessmentsQuery(projectId));
  if (list.error) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;
  if (list.isPending) {
    return (
      <Skeleton label="Loading the idea checks" className="flex flex-col gap-3">
        {[0, 1].map((i) => (
          <Bone key={i} className="h-40 w-full rounded-lg" />
        ))}
      </Skeleton>
    );
  }
  const checks = list.data ?? [];
  if (checks.length === 0) {
    return (
      <EmptyState icon={<IdeaIcon size={24} />} title="No idea has been checked yet">
        When an agent proposes a decision, a feature or a thread, DEMIURGO compares it with what it knows and shows here what it
        duplicates, contradicts or relates to.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-2">
        Each idea an agent proposes is compared with what DEMIURGO knows. It recommends; you decide in the batch.
      </p>
      {checks.map((a) => (
        <IdeaCheck key={a.id} projectId={projectId} check={a} />
      ))}
    </div>
  );
}

function IdeaCheck({ projectId, check: a }: { projectId: string; check: IdeaAssessment }) {
  const type = IDEA_TYPES[a.proposal.type] ?? { word: a.proposal.type, icon: 'idea' };
  const title = a.proposal.title ?? type.word;
  const conflict = a.findings.some((f) => verdictWord(f.verdict).conflict);
  return (
    <Card
      as="article"
      aria-label={`Idea check: ${title}`}
      padding="none"
      className={cn('grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]', conflict && 'border-danger-edge')}
    >
      <div className="flex flex-col gap-2 border-b border-edge-subtle px-4 py-4 md:border-r md:border-b-0">
        {conflict ? <StatusBadge kind="conflict" size="md" className="self-start" /> : null}
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
          <TypeIcon type={type.icon} size={15} className="text-fg-3" />
          <span>Idea · {type.word}</span>
          <EntityState entity="proposal" state={a.proposal.state} />
        </div>
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <div className="mt-auto flex flex-col gap-1 pt-2 text-xs text-fg-3">
          <Who actor={`system:${a.classifier}`} size={16} className="text-fg-2" />
          <span>
            Checked against graph v{a.graph_version} · <RelativeTime iso={a.created_at} />
          </span>
        </div>
        <Link
          to="/p/$projectId/batches/$batchId"
          params={{ projectId, batchId: a.proposal.batch_id }}
          className="inline-flex items-center gap-1 self-start text-sm font-medium text-accent-text underline-offset-2 hover:underline"
        >
          Open its batch
          <ArrowRightIcon size={14} />
        </Link>
      </div>
      <div className="px-4 py-4">
        {a.error ? (
          <Notice tone="danger" title="It couldn't be checked">
            {a.error}
          </Notice>
        ) : a.findings.length === 0 ? (
          <p className="text-sm text-fg-2">Nothing DEMIURGO knows duplicates, contradicts or relates to this idea.</p>
        ) : (
          <ul aria-label="Findings" className="flex flex-col divide-y divide-edge-subtle">
            {a.findings.map((f) => {
              const v = verdictWord(f.verdict);
              return (
                <li key={`${f.verdict}-${f.citation}`} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                      v.conflict ? 'bg-danger-soft text-danger-text' : 'bg-sunken text-fg-2',
                    )}
                  >
                    {v.symbol}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={cn('text-sm font-semibold', v.conflict ? 'text-danger-text' : 'text-fg')}>{v.word}</span>
                      {f.record ? (
                        <Link
                          to="/p/$projectId/records/$code"
                          params={{ projectId, code: f.record.code }}
                          search={{ v: f.record.version }}
                          className="flex min-w-0 items-baseline gap-2 text-sm text-fg underline decoration-edge-strong underline-offset-2 hover:text-accent-text"
                        >
                          <span className="min-w-0">{f.label ?? f.citation}</span>
                          <Code className="shrink-0">{f.citation}</Code>
                        </Link>
                      ) : (
                        <span className="flex min-w-0 items-baseline gap-2 text-sm text-fg">
                          <span className="min-w-0">{f.label ?? f.citation}</span>
                          <Code className="shrink-0">{f.citation}</Code>
                        </span>
                      )}
                      {f.epistemic_status ? <Certainty status={f.epistemic_status} /> : null}
                      {f.confidence !== null ? (
                        <span className="ml-auto shrink-0 text-xs text-fg-3 tabular-nums">
                          {Math.round(f.confidence * 100)}% sure
                        </span>
                      ) : null}
                    </div>
                    {f.justification ? <p className="text-sm text-fg-2">{f.justification}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
