// The package imported from design/ and its ratification (spec §4.2, stop 1): its counts next to
// design/'s, what ratifying does, and its documents, each one opened in place. Ratify accepts the
// whole package (a decisive command: it asks first); Reject package asks for a reason.

import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { BatchDetail, Proposal } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { ago, dayTime } from '../../lib/time.ts';
import { useAllows } from '../../ui/ActionBar.tsx';
import { Button, buttonStyles } from '../../ui/Button.tsx';
import { Code } from '../../ui/Card.tsx';
import { ConfirmDialog, TextDialog } from '../../ui/dialogs.tsx';
import { ArrowRight, ChevronDown, ChevronRight, TypeIcon } from '../../ui/icons.tsx';
import { Breadcrumbs, Page, Panel } from '../../ui/layout.tsx';
import { stateWord } from '../../words.ts';
import { Mark, StateMark } from '../../ui/marks.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import {
  acceptedRecord,
  countRows,
  documentGroups,
  importedDocument,
  importedTaxonomy,
  type ImportedDocument,
  type ImportedTaxonomy,
} from './model.ts';
import { ChecksList, Dot, Eyebrow, OutOfDate, Sections } from './parts.tsx';

export function ImportPackage({ projectId, batch }: { projectId: string; batch: BatchDetail }) {
  const n = batch.proposals.length;
  const approvedInDesign = batch.proposals.filter((p) => importedDocument(p)?.state === 'approved').length;
  return (
    <Page className="pt-4 [&>*]:max-w-[1200px]">
      <Breadcrumbs
        items={[{ label: 'Needs you', to: '/p/$projectId/needs-you', params: { projectId } }, { label: 'Imported from design/' }]}
      />
      <header className="mb-6 flex items-start gap-3.5">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border-[1.5px] border-ink bg-surface">
          <TypeIcon kind="package" size={20} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <Eyebrow>
            Package <Dot /> {n} proposals
          </Eyebrow>
          <h1 className="text-2xl leading-tight font-semibold">Imported from design/</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <WhoMark actor={batch.producer} size={18} withName />
            <Code>{batch.producer.replace(/^system:/, '')}</Code>
            <Dot />
            <StateMark entity="batch" state={batch.state} className="text-sm" />
            <Dot />
            <span className="text-muted">imported {dayTime(batch.created_at)}</span>
          </p>
        </div>
      </header>

      <div className="mb-8 grid grid-cols-[minmax(0,1fr)_440px] items-start gap-5">
        <Counts batch={batch} />
        <Ratification projectId={projectId} batch={batch} approvedInDesign={approvedInDesign} />
      </div>

      <Documents projectId={projectId} proposals={batch.proposals} />
    </Page>
  );
}

function Counts({ batch }: { batch: BatchDetail }) {
  const id = useId();
  if (!batch.import_counts) return null;
  const rows = countRows(batch.import_counts);
  const differ = rows.some((r) => !r.same);
  return (
    <Panel className="p-0">
      <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
        <h2 id={id} className="text-[15px] font-semibold">
          What&apos;s inside
        </h2>
        <span className={cn('text-xs', differ ? 'font-semibold text-problem' : 'text-muted')}>
          {batch.import_counts.origin === null
            ? 'design/ gave no counts'
            : differ
              ? 'Some counts differ from design/'
              : 'Everything in design/ is here'}
        </span>
      </div>
      <table aria-labelledby={id} className="w-full text-[13.5px] tabular-nums">
        <thead>
          <tr className="border-y border-line-soft text-left text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
            <th scope="col" className="px-5 py-2 font-semibold">
              Kind
            </th>
            <th scope="col" className="w-36 px-3 py-2 text-right font-semibold">
              In design/
            </th>
            <th scope="col" className="w-44 px-5 py-2 text-right font-semibold">
              In this package
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.kind} className={cn('border-b border-line-soft last:border-b-0', !r.same && 'bg-problem-bg text-problem')}>
              <th scope="row" className="px-5 py-2 text-left font-medium">
                {r.kind}
              </th>
              <td className="px-3 py-2 text-right text-ink-2">{r.origin ?? '—'}</td>
              <td className="px-5 py-2 text-right font-semibold">
                <span className="inline-flex items-center justify-end gap-2">
                  {r.inPackage}
                  {r.same ? (
                    <span role="img" aria-label="Same as design/" className="inline-flex w-3.5 justify-center text-ink">
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                        <path
                          d="M2.5 6.5l2.3 2.3L9.5 3.8"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                  ) : (
                    <span role="img" aria-label="Differs from design/" className="inline-flex w-3.5 justify-center">
                      <Mark kind="problem" size={8} />
                    </span>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function Ratification({
  projectId,
  batch,
  approvedInDesign,
}: {
  projectId: string;
  batch: BatchDetail;
  approvedInDesign: number;
}) {
  const command = useCommand(projectId);
  const allows = useAllows('batch', batch.state);
  const [dialog, setDialog] = useState<null | 'ratify' | 'reject'>(null);
  const n = batch.proposals.length;
  const open = (d: 'ratify' | 'reject') => {
    command.reset();
    setDialog(d);
  };
  const run = (name: string, data: Record<string, unknown>) =>
    command.mutate({ command: name, entityId: batch.id, data }, { onSuccess: () => setDialog(null) });

  if (batch.state === 'superseded') {
    return (
      <OutOfDate title="Out of date: a newer import replaced it">
        Only the latest import of design/ can be ratified. Open it from Needs you.
      </OutOfDate>
    );
  }
  if (batch.state === 'accepted') {
    return (
      <Panel className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Mark kind="confirmed" label="Ratified" /> Ratified
        </h2>
        <p className="text-sm text-ink-2">
          DEMIURGO is now the home of your design{batch.resolved_at ? ` (${ago(batch.resolved_at)})` : ''}. From now on, design/
          is an export. Each record keeps the state it had in design/: approve the versions you agree with.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/p/$projectId" params={{ projectId }} className={buttonStyles({ variant: 'ink', size: 'lg' })}>
            Open the product <ArrowRight size={14} />
          </Link>
          <Link
            to="/p/$projectId/needs-you"
            params={{ projectId }}
            className="text-[13px] font-semibold text-needs hover:text-needs-hover"
          >
            What needs you
          </Link>
        </div>
      </Panel>
    );
  }
  if (batch.state === 'rejected') {
    const reason = batch.proposals.find((p) => typeof p.resolution?.reason === 'string')?.resolution?.reason;
    return (
      <Panel className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Mark kind="dropped" label="Rejected" /> Rejected
        </h2>
        <p className="text-sm text-ink-2">Nothing was imported. design/ stays as it is.</p>
        {typeof reason === 'string' && <p className="text-[13px] text-muted">Reason: {reason}</p>}
      </Panel>
    );
  }
  return (
    <Panel className="flex flex-col gap-3">
      <h2 className="text-[15px] font-semibold">What ratifying does</h2>
      <p className="text-sm leading-relaxed text-ink-2">
        Everything becomes DEMIURGO&apos;s, as it is in design/. What is proposed stays proposed:{' '}
        {approvedInDesign === 0
          ? 'ratifying approves nothing.'
          : `only the ${approvedInDesign} ${approvedInDesign === 1 ? 'document' : 'documents'} design/ marks as approved stay approved.`}{' '}
        From then on, design/ is an export.
      </p>
      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        {allows('batch.accept_package') && (
          <Button size="lg" variant="needs" data-command="batch.accept_package" onClick={() => open('ratify')}>
            Ratify
          </Button>
        )}
        {allows('batch.reject_package') && (
          <Button size="lg" variant="ghost" data-command="batch.reject_package" onClick={() => open('reject')}>
            Reject package
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={dialog === 'ratify'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Ratify ${n} proposals?`}
        description={
          <div className="flex flex-col gap-1.5">
            <p>This makes DEMIURGO the home of your design.</p>
            <p className="text-muted">Every document keeps the state it has in design/. You approve versions afterwards.</p>
          </div>
        }
        confirm="Ratify"
        pending={command.isPending}
        error={command.error}
        onConfirm={() => run('batch.accept_package', {})}
      />
      <TextDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Reject this package?"
        description="Nothing is imported and design/ stays as it is. Say why, if you want."
        label="Reason"
        submit="Reject package"
        pending={command.isPending}
        error={command.error}
        onSubmit={(text) => run('batch.reject_package', text ? { reason: text } : {})}
      />
    </Panel>
  );
}

function Documents({ projectId, proposals }: { projectId: string; proposals: Proposal[] }) {
  const id = useId();
  const groups = documentGroups(proposals);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h2 id={id} className="text-[15px] font-semibold">
          Documents
        </h2>
        <span className="text-xs text-muted">Names first; open one to read it here.</span>
      </div>
      <div className="flex flex-col rounded-[var(--radius-panel)] border border-line bg-surface">
        {groups.map((g) => (
          <div key={g.key} className="grid grid-cols-[180px_minmax(0,1fr)] border-b border-line-soft last:border-b-0">
            <h3 className="px-5 pt-3.5 text-[13px] font-semibold text-ink-2">
              {g.label} <span className="font-normal text-muted">({g.items.length})</span>
            </h3>
            <ul className="flex flex-col divide-y divide-line-soft">
              {g.items.map((p) => (
                <DocumentRow key={p.id} projectId={projectId} proposal={p} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function DocumentRow({ projectId, proposal: p }: { projectId: string; proposal: Proposal }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const doc = importedDocument(p);
  const tax = importedTaxonomy(p);
  const title = doc?.title ?? tax?.title ?? '';
  const code = doc?.code ?? tax?.code ?? '';
  const version = doc?.version ?? tax?.version ?? 1;
  const effect = acceptedRecord(p);
  return (
    <li className="flex flex-col" data-document={code}>
      <div className="flex min-h-11 items-center gap-3 py-2 pr-4 pl-1">
        <StateMarkOnly state={p.state} />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <strong className="truncate text-[14px] font-semibold">{title}</strong>
          <Code className="shrink-0">{code}</Code>
        </span>
        <span className="flex shrink-0 items-center gap-3 text-xs text-muted">
          <span>v{version}</span>
          {doc && doc.criteria.length > 0 && (
            <span>
              {doc.criteria.length} {doc.criteria.length === 1 ? 'check' : 'checks'}
            </span>
          )}
          {doc && doc.state === 'approved' && <span className="font-semibold text-ink-2">approved in design/</span>}
          {effect && (
            <Link
              to="/p/$projectId/records/$code"
              params={{ projectId, code: effect.code }}
              search={{ v: effect.version }}
              className="font-semibold text-needs hover:text-needs-hover"
            >
              {effect.approved ? 'Open the record' : 'Open the draft'}
            </Link>
          )}
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          aria-controls={panel}
          aria-label={`${open ? 'Close' : 'Open'} ${title}`}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Close' : 'Open'}
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </Button>
      </div>
      {open && (
        <div id={panel} className="mr-4 mb-3 flex flex-col gap-4 rounded-[10px] bg-surface-2 px-5 py-4">
          {doc && <DocumentBody doc={doc} />}
          {tax && <TaxonomyBody tax={tax} />}
        </div>
      )}
    </li>
  );
}

/** The mark of a proposal's state; its word is the mark's label (the row is dense). */
function StateMarkOnly({ state }: { state: string }) {
  const w = stateWord('proposal', state);
  return (
    <span className="flex w-5 shrink-0 justify-center">
      <Mark kind={w.mark} label={w.word} />
    </span>
  );
}

function DocumentBody({ doc }: { doc: ImportedDocument }) {
  return (
    <>
      <Sections sections={doc.sections} />
      {doc.criteria.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-ink-2">Checks ({doc.criteria.length})</h3>
          <ChecksList checks={doc.criteria} />
        </section>
      )}
      {(doc.links.length > 0 || doc.annexes.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
          {doc.links.map((l) => (
            <span key={`${l.type}-${l.target.code}`}>
              <span className="text-muted">{l.type === 'based_on' ? 'Based on' : l.type.replace('_', ' ')}</span>{' '}
              <Code>
                {l.target.code} v{l.target.version}
              </Code>
            </span>
          ))}
          {doc.annexes.map((a) => (
            <span key={a}>
              <span className="text-muted">Annex</span> <Code>{a}</Code>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function TaxonomyBody({ tax }: { tax: ImportedTaxonomy }) {
  return (
    <>
      {tax.axes.map((axis) => (
        <section key={axis.code} className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-ink-2">
            {axis.name} <Code>{axis.code}</Code>
          </h3>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {axis.categories.map((c) => (
              <li key={c.code} className="text-[13px]">
                <strong className="font-semibold">{c.name}</strong>
                {c.description && <span className="text-ink-3"> · {c.description}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Sections sections={tax.sections} />
    </>
  );
}
