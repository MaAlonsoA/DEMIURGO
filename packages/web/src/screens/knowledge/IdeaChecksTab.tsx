// Idea checks (spec §4.10): every idea an agent proposes is checked against the knowledge. Each
// check shows the proposal (with its batch) and its findings: the verdict and the cited node,
// which links to its record. A contradiction takes the conflict look of the canvas (S6B).

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ideaAssessmentsQuery } from '../../api/queries.ts';
import type { IdeaAssessment } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { ago } from '../../lib/time.ts';
import { Code } from '../../ui/Card.tsx';
import { ArrowRight, type IconKind, TypeIcon, WarningIcon } from '../../ui/icons.tsx';
import { EmptyState, Skeleton } from '../../ui/layout.tsx';
import { EpistemicMark, StateMark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { verdictWord } from './graph.ts';

const IDEA_TYPES: Record<string, { word: string; icon: IconKind }> = {
  decision: { word: 'Decision', icon: 'decision' },
  fdr: { word: 'Feature', icon: 'feature' },
  exploration: { word: 'Thread', icon: 'thread' },
};

export function IdeaChecksTab({ projectId }: { projectId: string }) {
  const list = useQuery(ideaAssessmentsQuery(projectId));
  if (list.error) return <Reasons error={list.error} />;
  if (list.isPending) {
    return (
      <div role="status" aria-label="Loading the idea checks" className="flex flex-col gap-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-40 w-full rounded-[var(--radius-card)]" />
        ))}
      </div>
    );
  }
  const checks = list.data ?? [];
  if (checks.length === 0) {
    return (
      <EmptyState>
        No idea has been checked yet. When an agent proposes a decision, a feature or a thread, DEMIURGO compares it with what it
        knows and shows here what it duplicates, contradicts or relates to.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-ink-2">
        Each idea an agent proposes is compared with what DEMIURGO knows. It recommends; you decide in the batch.
      </p>
      {checks.map((a) => (
        <IdeaCheck key={a.id} projectId={projectId} check={a} />
      ))}
    </div>
  );
}

function IdeaCheck({ projectId, check: a }: { projectId: string; check: IdeaAssessment }) {
  const type = IDEA_TYPES[a.proposal.type] ?? { word: a.proposal.type, icon: 'idea' as const };
  const title = a.proposal.title ?? type.word;
  const conflict = a.findings.some((f) => verdictWord(f.verdict).conflict);
  return (
    <article
      aria-label={`Idea check: ${title}`}
      className={cn(
        'grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] rounded-[var(--radius-card)] border bg-surface',
        conflict ? 'border-problem-line' : 'border-line',
      )}
    >
      <div className="flex flex-col gap-2 border-r border-line-soft px-[18px] py-4">
        {conflict && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-problem uppercase">
            <WarningIcon size={13} />
            Conflict
          </span>
        )}
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
          <TypeIcon kind={type.icon} size={14} />
          Idea · {type.word}
          <span className="tracking-normal normal-case">
            <StateMark entity="proposal" state={a.proposal.state} />
          </span>
        </span>
        <strong className="text-[15px] leading-snug font-semibold">{title}</strong>
        <span className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-2 text-xs text-muted">
          <WhoMark actor={`system:${a.classifier}`} size={16} />
          Checked against graph v{a.graph_version} · {ago(a.created_at)}
        </span>
        <Link
          to="/p/$projectId/batches/$batchId"
          params={{ projectId, batchId: a.proposal.batch_id }}
          className="flex items-center gap-1 self-start text-[13px] font-semibold text-needs hover:text-needs-hover"
        >
          Open its batch
          <ArrowRight size={13} />
        </Link>
      </div>
      <div className="px-[18px] py-4">
        {a.error ? (
          <p className="flex items-start gap-1.5 text-[13px] text-problem">
            <WarningIcon size={14} className="mt-[3px] shrink-0" />
            It couldn’t be checked: {a.error}
          </p>
        ) : a.findings.length === 0 ? (
          <p className="text-[13px] text-ink-3">Nothing DEMIURGO knows duplicates, contradicts or relates to this idea.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {a.findings.map((f) => {
              const v = verdictWord(f.verdict);
              return (
                <li key={`${f.verdict}-${f.citation}`} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold',
                      v.conflict ? 'bg-problem-bg text-problem' : 'bg-line-soft text-ink-2',
                    )}
                  >
                    {v.symbol}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn('shrink-0 text-[13px] font-semibold', v.conflict ? 'text-problem' : 'text-ink-2')}>
                        {v.word}
                      </span>
                      {f.epistemic_status && <EpistemicMark status={f.epistemic_status} />}
                      {f.record ? (
                        <Link
                          to="/p/$projectId/records/$code"
                          params={{ projectId, code: f.record.code }}
                          search={{ v: f.record.version }}
                          className="flex min-w-0 items-baseline gap-2 text-[13px] text-ink hover:text-needs"
                        >
                          <span className="truncate underline decoration-line-strong underline-offset-2">
                            {f.label ?? f.citation}
                          </span>
                          <Code className="shrink-0">{f.citation}</Code>
                        </Link>
                      ) : (
                        <span className="flex min-w-0 items-baseline gap-2 text-[13px]">
                          <span className="truncate">{f.label ?? f.citation}</span>
                          <Code className="shrink-0">{f.citation}</Code>
                        </span>
                      )}
                      {f.confidence !== null && (
                        <span className="ml-auto shrink-0 text-xs text-muted tabular-nums">
                          {Math.round(f.confidence * 100)}% sure
                        </span>
                      )}
                    </div>
                    {f.justification && <p className="text-xs text-ink-3">{f.justification}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </article>
  );
}
