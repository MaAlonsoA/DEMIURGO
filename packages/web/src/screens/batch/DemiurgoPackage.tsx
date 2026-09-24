// A package from DEMIURGO (a design_proposal: a feature with its checks), shown like a record page,
// with the run that produced it at the top. It is accepted or rejected whole: Accept package,
// Accept and approve (one action, its two effects said before confirming) or Reject package.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { inboxQuery, runQuery, stateQuery } from '../../api/queries.ts';
import type { BatchDetail, ProductRow } from '../../api/types.ts';
import { between, dayTime } from '../../lib/time.ts';
import { ACTION_WORDS, stateWord } from '../../words.ts';
import { useAllows } from '../../ui/ActionBar.tsx';
import { Button } from '../../ui/Button.tsx';
import { ConfirmDialog, TextDialog } from '../../ui/dialogs.tsx';
import { ArrowRight } from '../../ui/icons.tsx';
import { Breadcrumbs, Page } from '../../ui/layout.tsx';
import { Markdown } from '../../ui/Markdown.tsx';
import { Mark, StateMark } from '../../ui/marks.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { acceptedRecord, obsoleteReason, PROPOSAL_TYPE_WORDS, proposalTitle } from './model.ts';
import { CheckCards, type CheckLike, Dot, Eyebrow, EyebrowWord, IdeaCheck, OutOfDate, RecordChip, TypeLabel } from './parts.tsx';
import { PROPOSAL_ICON, type ProposalView } from './ProposalCard.tsx';
import { withInbox } from './ItemBatch.tsx';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const SECTIONS: [string, string][] = [
  ['goal', 'Goal'],
  ['scope', 'Scope'],
  ['out_of_scope', 'Out of scope'],
  ['behavior', 'Behavior'],
];

export function DemiurgoPackage({ projectId, batch }: { projectId: string; batch: BatchDetail }) {
  const inbox = useQuery(inboxQuery(projectId)).data;
  const state = useQuery(stateQuery(projectId)).data;
  const rows: ProductRow[] = state ? [...state.decisions, ...state.designs] : [];
  const proposals = withInbox(batch, inbox?.batches.find((b) => b.id === batch.id)?.proposals ?? []);
  const single = proposals.length === 1 ? proposals[0] : undefined;
  const title = single ? proposalTitle(single) : 'A package from DEMIURGO';
  const n = proposals.length;
  return (
    <Page className="pt-4" aside={<PackageActions projectId={projectId} batch={batch} proposals={proposals} rows={rows} />}>
      <Breadcrumbs
        items={[{ label: 'Needs you', to: '/p/$projectId/needs-you', params: { projectId } }, { label: 'Package from DEMIURGO' }]}
      />
      <header className="mb-5 flex max-w-[860px] items-start gap-3.5">
        <WhoMark actor={batch.producer} size={40} />
        <div className="flex min-w-0 flex-col gap-1">
          <Eyebrow>
            Package from DEMIURGO <Dot /> {n} {n === 1 ? 'proposal' : 'proposals'} <Dot />
            <EyebrowWord>
              <StateMark entity="batch" state={batch.state} />
            </EyebrowWord>
          </Eyebrow>
          <h1 className="text-2xl leading-tight font-semibold">{title}</h1>
          {batch.summary && <p className="text-sm text-ink-3">{batch.summary} It is accepted or rejected whole.</p>}
        </div>
      </header>
      {batch.run_id && <RunLine projectId={projectId} runId={batch.run_id} />}
      <div className="flex max-w-[860px] flex-col gap-8">
        {proposals.map((p) => (
          <ProposedRecord key={p.id} projectId={projectId} proposal={p} rows={rows} />
        ))}
      </div>
    </Page>
  );
}

/** The run that produced the package, with DEMIURGO's model. */
function RunLine({ projectId, runId }: { projectId: string; runId: string }) {
  const run = useQuery(runQuery(projectId, runId)).data;
  if (!run) return <div className="mb-6 h-[52px] max-w-[860px] rounded-xl border border-line bg-surface" aria-hidden="true" />;
  return (
    <div className="mb-6 flex max-w-[860px] items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-[13px]">
      <WhoMark actor={`agent:run:${run.id}`} model={run.model} size={22} />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-ink-2">
        <strong className="font-semibold text-ink">
          {run.action === 'design_proposal' ? 'Drafted by DEMIURGO' : `${ACTION_WORDS[run.action] ?? run.action} with DEMIURGO`}
        </strong>
        {run.model && <span className="text-muted">· {run.model}</span>}
        <Dot />
        <StateMark entity="ai_run" state={run.state} />
        <Dot />
        <span className="text-muted">
          {dayTime(run.created_at)}
          {run.started_at && run.finished_at ? ` · took ${between(run.started_at, run.finished_at)}` : ''}
        </span>
      </span>
      <Link
        to="/p/$projectId/runs/$runId"
        params={{ projectId, runId: run.id }}
        className="inline-flex shrink-0 items-center gap-1 font-semibold text-needs hover:text-needs-hover"
      >
        Open the run <ArrowRight size={12} />
      </Link>
    </div>
  );
}

/** A proposed record, as its page will look: sections, checks and what it is based on. */
function ProposedRecord({
  projectId,
  proposal: p,
  rows,
}: {
  projectId: string;
  proposal: ProposalView;
  rows: readonly ProductRow[];
}) {
  const based = p.payload.based_on as { code?: string; version?: number } | undefined;
  const criteria = Array.isArray(p.payload.criteria) ? (p.payload.criteria as CheckLike[]) : [];
  const obsolete = obsoleteReason(p);
  return (
    <article aria-label={proposalTitle(p)} className="flex flex-col gap-5" data-proposal={p.id}>
      <div className="flex flex-col gap-1.5">
        <Eyebrow>
          <TypeLabel icon={PROPOSAL_ICON[p.type] ?? 'idea'}>{PROPOSAL_TYPE_WORDS[p.type] ?? p.type}</TypeLabel>
          <Dot />
          <EyebrowWord>
            <StateMark entity="proposal" state={p.state} />
          </EyebrowWord>
        </Eyebrow>
        {based?.code && (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            Based on <RecordChip projectId={projectId} code={based.code} version={based.version ?? null} rows={rows} />
          </div>
        )}
      </div>
      {obsolete && <OutOfDate>{obsolete} It can&apos;t be accepted any more.</OutOfDate>}
      {p.type === 'fdr' ? (
        <div className="flex flex-col gap-5">
          {SECTIONS.map(([key, label]) =>
            str(p.payload[key]) ? (
              <section key={key} className="flex flex-col gap-1">
                <h2 className="text-[13px] font-semibold text-ink-2">{label}</h2>
                <Markdown>{str(p.payload[key])}</Markdown>
              </section>
            ) : null,
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-2">{str(p.payload.decision) || str(p.payload.purpose)}</p>
      )}
      {criteria.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold text-ink-2">Checks ({criteria.length})</h2>
            <span className="text-xs text-muted">Codes are given when it is accepted</span>
          </div>
          <CheckCards checks={criteria} />
        </section>
      )}
      <IdeaCheck projectId={projectId} assessment={p.assessment} rows={rows} />
    </article>
  );
}

function PackageActions({
  projectId,
  batch,
  proposals,
  rows,
}: {
  projectId: string;
  batch: BatchDetail;
  proposals: ProposalView[];
  rows: readonly ProductRow[];
}) {
  const command = useCommand(projectId);
  const allows = useAllows('batch', batch.state);
  const [dialog, setDialog] = useState<null | 'accept' | 'approve' | 'reject'>(null);
  const warnings = [...new Set(proposals.flatMap((p) => (p.state === 'pending' ? (p.obsolescence ?? []) : [])))];
  const what = proposals
    .map((p) => {
      const checks = Array.isArray(p.payload.criteria) ? p.payload.criteria.length : 0;
      const noun = p.type === 'fdr' ? 'the feature' : p.type === 'decision' ? 'the decision' : 'the item';
      return `${noun} “${proposalTitle(p)}”${checks ? `, with its ${checks} ${checks === 1 ? 'check' : 'checks'}` : ''}`;
    })
    .join('; ');
  const open = (d: 'accept' | 'approve' | 'reject') => {
    command.reset();
    setDialog(d);
  };
  const run = (name: string, data: Record<string, unknown>) =>
    command.mutate({ command: name, entityId: batch.id, data }, { onSuccess: () => setDialog(null) });
  const effects = proposals.map(acceptedRecord).filter((e) => e !== null);
  const w = stateWord('batch', batch.state);

  return (
    <>
      <section className="flex flex-col gap-3" aria-label="Decide the package">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          {batch.state === 'pending' ? (
            'Accept it whole'
          ) : (
            <>
              <Mark kind={w.mark} label={w.word} /> {w.word}
            </>
          )}
        </h2>
        {batch.state === 'pending' ? (
          <>
            <p className="text-[13px] text-ink-2">
              Accepting records {what} as a draft. <strong className="font-semibold">Accept and approve</strong> also approves it:
              it becomes the current version. Nothing changes until you decide.
            </p>
            {warnings.length > 0 && (
              <ul className="list-disc rounded-[10px] border border-problem-line bg-problem-bg py-2 pr-3 pl-7 text-[13px] text-problem">
                {warnings.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-2">
              {allows('batch.accept_package') && warnings.length === 0 && (
                <>
                  <Button size="lg" variant="needs" data-command="batch.accept_package" onClick={() => open('accept')}>
                    Accept package
                  </Button>
                  <Button size="lg" variant="outline" data-command="batch.accept_package" onClick={() => open('approve')}>
                    Accept and approve
                  </Button>
                </>
              )}
              {allows('batch.reject_package') && (
                <Button size="lg" variant="ghost" data-command="batch.reject_package" onClick={() => open('reject')}>
                  Reject package
                </Button>
              )}
            </div>
          </>
        ) : batch.state === 'superseded' ? (
          <p className="text-[13px] text-ink-2">What it was based on changed. It can&apos;t be accepted any more.</p>
        ) : (
          <div className="flex flex-col gap-2 text-[13px] text-ink-2">
            {effects.map((e) => (
              <p key={e.code} className="flex flex-wrap items-center gap-2">
                <RecordChip projectId={projectId} code={e.code} version={e.version} rows={rows} />
                {e.approved ? 'is approved and current.' : 'is a draft: approve it on its page.'}
              </p>
            ))}
            {batch.state === 'rejected' && <p>Nothing was recorded.</p>}
          </div>
        )}
      </section>
      {batch.dependencies.length > 0 && (
        <section className="flex flex-col gap-2 text-[13px]" aria-label="Starts from">
          <h2 className="text-xs font-semibold text-muted">Starts from</h2>
          <div className="flex flex-wrap gap-2">
            {batch.dependencies.map((d) =>
              d.code ? <RecordChip key={d.id} projectId={projectId} code={d.code} version={d.version} rows={rows} /> : null,
            )}
          </div>
          <p className="text-xs text-muted">If it gets a newer version before you decide, the package goes out of date.</p>
        </section>
      )}
      <ConfirmDialog
        open={dialog === 'accept' || dialog === 'approve'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === 'approve' ? 'Accept and approve this package?' : 'Accept this package?'}
        description={
          dialog === 'approve' ? (
            <div className="flex flex-col gap-1.5">
              <p>Two things happen:</p>
              <ol className="list-decimal pl-5">
                <li>DEMIURGO records {what}.</li>
                <li>You approve it: it becomes the current version.</li>
              </ol>
            </div>
          ) : (
            <p>DEMIURGO records {what} as a draft. You approve it later, on its page.</p>
          )
        }
        confirm={dialog === 'approve' ? 'Accept and approve' : 'Accept package'}
        pending={command.isPending}
        error={command.error}
        onConfirm={() => run('batch.accept_package', dialog === 'approve' ? { approve: true } : {})}
      />
      <TextDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Reject this package?"
        description="Nothing is recorded. Say why, if you want: the reason is kept with the package."
        label="Reason"
        submit="Reject package"
        pending={command.isPending}
        error={command.error}
        onSubmit={(text) => run('batch.reject_package', text ? { reason: text } : {})}
      />
    </>
  );
}
