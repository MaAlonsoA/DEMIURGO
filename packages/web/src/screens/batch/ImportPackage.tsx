// The import of design/ and its ratification (DESIGN.md §3.2): its counts next to design/'s, with
// "Same as design/" or "Differs" written out, not an icon alone; what ratifying does, and Ratify or
// Reject package; then its documents, each opened in place. Every document says its state in a
// word (the old list showed only a mark). Ratify is decisive: it asks first (INV-BATCH-16…22).

import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { BatchDetail, Proposal } from '../../api/types.ts';
import { useAllows } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Tag, Code } from '../../components/Badge.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { Card } from '../../components/Card.tsx';
import { ConfirmDialog, PromptDialog } from '../../components/Dialog.tsx';
import { ArrowRightIcon, ChevronDownIcon, ChevronRightIcon, PackageIcon } from '../../components/icons.tsx';
import { PageBody, PageHeader } from '../../components/Page.tsx';
import { EntityState, StateIcon, StatusBadge } from '../../components/status.tsx';
import { RelativeTime } from '../../components/Time.tsx';
import { Who } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { useBatchCrumbs } from './Batch.tsx';
import {
  acceptedRecord,
  countRows,
  documentGroups,
  type ImportedDocument,
  type ImportedTaxonomy,
  importedDocument,
  importedTaxonomy,
} from './model.ts';
import { ChecksList, linkClass, OutOfDate, Sections } from './parts.tsx';

export function ImportPackage({ projectId, batch }: { projectId: string; batch: BatchDetail }) {
  const n = batch.proposals.length;
  const approvedInDesign = batch.proposals.filter((p) => importedDocument(p)?.state === 'approved').length;
  const crumbs = useBatchCrumbs(projectId, 'Imported from design/');
  return (
    <>
      <PageHeader
        crumbs={crumbs}
        eyebrow={
          <>
            <span className="inline-flex items-center gap-1.5">
              <PackageIcon size={16} className="text-fg-3" />
              Package
            </span>
            <span aria-hidden>·</span>
            <span>
              {n} {n === 1 ? 'document' : 'documents'}
            </span>
          </>
        }
        title="Imported from design/"
        meta={
          <>
            <Who actor={batch.producer} size={18} />
            <Code>{batch.producer.replace(/^system:/, '')}</Code>
            <EntityState entity="batch" state={batch.state} />
            <RelativeTime iso={batch.created_at} prefix="imported" />
          </>
        }
      />
      <PageBody>
        <div className="flex flex-col gap-8">
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Counts batch={batch} />
            <Ratification projectId={projectId} batch={batch} approvedInDesign={approvedInDesign} />
          </div>
          <Documents projectId={projectId} proposals={batch.proposals} />
        </div>
      </PageBody>
    </>
  );
}

/** "What's inside": each kind in design/ and in this package, and whether they match, in words. */
function Counts({ batch }: { batch: BatchDetail }) {
  const id = useId();
  if (!batch.import_counts) return null;
  const rows = countRows(batch.import_counts);
  const differ = rows.some((r) => !r.same);
  const summary =
    batch.import_counts.origin === null
      ? 'design/ gave no counts'
      : differ
        ? 'Some counts differ from design/'
        : 'Everything in design/ is here';
  return (
    <Card padding="none" as="section" aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4 pb-3">
        <h2 id={id} className="text-lg font-semibold text-fg">
          What&apos;s inside
        </h2>
        <span className={cn('text-sm', differ ? 'font-medium text-warning-text' : 'text-fg-2')}>{summary}</span>
      </div>
      <div className="overflow-x-auto">
        <table aria-labelledby={id} className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-y border-edge bg-sunken text-left text-xs text-fg-2">
              <th scope="col" className="px-4 py-2 font-medium">
                Kind
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                In design/
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                In this package
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Compared
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kind} className={cn('border-b border-edge-subtle last:border-b-0', !r.same && 'bg-warning-soft')}>
                <th scope="row" className="px-4 py-2 text-left font-medium text-fg">
                  {r.kind}
                </th>
                <td className="px-3 py-2 text-right text-fg-2">{r.origin ?? '—'}</td>
                <td className="px-3 py-2 text-right font-medium text-fg">{r.inPackage}</td>
                <td className="px-4 py-2">
                  <span className={cn('inline-flex items-center gap-1.5', r.same ? 'text-success-text' : 'text-warning-text')}>
                    <StateIcon kind={r.same ? 'done' : 'conflict'} size={14} />
                    {r.same ? 'Same as design/' : 'Differs'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
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
  const headingId = useId();
  const n = batch.proposals.length;
  const open = (d: 'ratify' | 'reject') => {
    command.reset();
    setDialog(d);
  };
  const run = (name: string, data: Record<string, unknown>, said: string) =>
    command.mutate(
      { command: name, entityId: batch.id, data },
      {
        onSuccess: () => {
          setDialog(null);
          announce(said);
          // The panel changes to what happened: the focus goes to its heading.
          setTimeout(() => document.getElementById(headingId)?.focus(), 60);
        },
      },
    );

  if (batch.state === 'superseded') {
    return (
      <OutOfDate title="Out of date: a newer import replaced it">
        Only the latest import of design/ can be ratified. Open it from Needs you.
      </OutOfDate>
    );
  }
  if (batch.state === 'accepted') {
    return (
      <Card as="section" aria-labelledby={headingId} tone="success" className="flex flex-col gap-3">
        <h2 id={headingId} tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold text-fg outline-none">
          <StateIcon kind="confirmed" size={18} />
          Ratified
        </h2>
        <p className="text-fg">
          DEMIURGO is now the home of your design
          {batch.resolved_at ? (
            <>
              {' '}
              (<RelativeTime iso={batch.resolved_at} />)
            </>
          ) : null}
          . From now on, design/ is an export. Each record keeps the state it had in design/: approve the versions you agree with.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/p/$projectId" params={{ projectId }} className={buttonClass({ variant: 'secondary' })}>
            Open the product <ArrowRightIcon size={14} />
          </Link>
          <Link to="/p/$projectId/needs-you" params={{ projectId }} className={cn(linkClass, 'text-sm')}>
            What needs you
          </Link>
        </div>
      </Card>
    );
  }
  if (batch.state === 'rejected') {
    const reason = batch.proposals.map((p) => p.resolution?.reason).find((r): r is string => typeof r === 'string' && r !== '');
    return (
      <Card as="section" aria-labelledby={headingId} className="flex flex-col gap-2">
        <h2 id={headingId} tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold text-fg outline-none">
          <StateIcon kind="dropped" size={18} />
          Rejected
        </h2>
        <p className="text-fg-2">Nothing was imported. design/ stays as it is.</p>
        {reason ? <p className="text-sm text-fg-2">Reason: {reason}</p> : null}
      </Card>
    );
  }
  return (
    <Card as="section" aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} tabIndex={-1} className="text-lg font-semibold text-fg outline-none">
        What ratifying does
      </h2>
      <p className="text-fg-2">
        Everything becomes DEMIURGO&apos;s, as it is in design/. What is proposed stays proposed:{' '}
        {approvedInDesign === 0
          ? 'ratifying approves nothing.'
          : `only the ${approvedInDesign} ${approvedInDesign === 1 ? 'document' : 'documents'} design/ marks as approved stay approved.`}{' '}
        From then on, design/ is an export.
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {allows('batch.accept_package') ? (
          <Button variant="primary" data-command="batch.accept_package" onClick={() => open('ratify')}>
            Ratify
          </Button>
        ) : null}
        {allows('batch.reject_package') ? (
          <Button variant="quiet-danger" data-command="batch.reject_package" onClick={() => open('reject')}>
            Reject package
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={dialog === 'ratify'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Ratify ${n} ${n === 1 ? 'document' : 'documents'}?`}
        description={
          <>
            <p>This makes DEMIURGO the home of your design.</p>
            <p>Every document keeps the state it has in design/. You approve versions afterwards.</p>
          </>
        }
        confirm="Ratify"
        pendingLabel="Ratifying…"
        pending={command.isPending}
        error={dialog === 'ratify' ? command.error : null}
        onConfirm={() => run('batch.accept_package', {}, 'Ratified. DEMIURGO is now the home of your design.')}
      />
      <PromptDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Reject this package?"
        description="Nothing is imported and design/ stays as it is. Say why, if you want."
        label="Reason"
        submit="Reject package"
        pendingLabel="Rejecting…"
        tone="danger"
        maxLength={2000}
        pending={command.isPending}
        error={dialog === 'reject' ? command.error : null}
        onSubmit={(text) => run('batch.reject_package', text ? { reason: text } : {}, 'Package rejected.')}
      />
    </Card>
  );
}

function Documents({ projectId, proposals }: { projectId: string; proposals: Proposal[] }) {
  const id = useId();
  const groups = documentGroups(proposals);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="text-lg font-semibold text-fg">
          Documents
        </h2>
        <span className="text-sm text-fg-2">Names first; open one to read it here.</span>
      </div>
      <div className="flex flex-col rounded-lg border border-edge bg-panel">
        {groups.map((g) => (
          <div
            key={g.key}
            className="flex flex-col border-b border-edge last:border-b-0 lg:grid lg:grid-cols-[180px_minmax(0,1fr)]"
          >
            <h3 className="px-4 pt-3 text-sm font-semibold text-fg-2 lg:pb-3">
              {g.label} <span className="font-normal text-fg-3">({g.items.length})</span>
            </h3>
            <ul className="flex flex-col divide-y divide-edge-subtle">
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
  const checks = doc?.criteria.length ?? 0;
  return (
    <li className="flex flex-col" data-document={code}>
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2">
        {p.state === 'superseded' ? (
          <StatusBadge kind="stale" word="Out of date" />
        ) : (
          <EntityState entity="proposal" state={p.state} />
        )}
        <span className="flex min-w-0 flex-1 basis-60 items-baseline gap-2">
          <span className="truncate font-medium text-fg">{title}</span>
          <Code className="shrink-0">{code}</Code>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-3 text-sm text-fg-2">
          <span className="tabular-nums">v{version}</span>
          {checks > 0 ? (
            <span className="tabular-nums">
              {checks} {checks === 1 ? 'check' : 'checks'}
            </span>
          ) : null}
          {doc?.state === 'approved' ? <Tag>approved in design/</Tag> : null}
          {effect ? (
            <Link
              to="/p/$projectId/records/$code"
              params={{ projectId, code: effect.code }}
              search={{ v: effect.version }}
              className={linkClass}
            >
              {effect.approved ? 'Open the record' : 'Open the draft'}
            </Link>
          ) : null}
          <Button
            variant="quiet"
            size="sm"
            aria-expanded={open}
            aria-controls={panel}
            aria-label={`${open ? 'Close' : 'Open'} ${title}`}
            trailing={open ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Close' : 'Open'}
          </Button>
        </span>
      </div>
      <div
        id={panel}
        hidden={!open}
        className="mx-4 mb-3 flex flex-col gap-4 rounded-md border border-edge-subtle bg-sunken px-4 py-4"
      >
        {open && doc ? <DocumentBody doc={doc} /> : null}
        {open && tax ? <TaxonomyBody tax={tax} /> : null}
      </div>
    </li>
  );
}

function DocumentBody({ doc }: { doc: ImportedDocument }) {
  return (
    <>
      <Sections sections={doc.sections} level={4} />
      {doc.criteria.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-fg-2">Checks ({doc.criteria.length})</h4>
          <ChecksList checks={doc.criteria} />
        </section>
      ) : null}
      {doc.links.length > 0 || doc.annexes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-2">
          {doc.links.map((l) => (
            <span key={`${l.type}-${l.target.code}`}>
              <span>{l.type === 'based_on' ? 'Based on' : l.type.replace('_', ' ')}</span>{' '}
              <Code>
                {l.target.code} v{l.target.version}
              </Code>
            </span>
          ))}
          {doc.annexes.map((a) => (
            <span key={a}>
              <span>Annex</span> <Code>{a}</Code>
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function TaxonomyBody({ tax }: { tax: ImportedTaxonomy }) {
  return (
    <>
      {tax.axes.map((axis) => (
        <section key={axis.code} className="flex flex-col gap-2">
          <h4 className="flex items-baseline gap-2 text-sm font-semibold text-fg-2">
            {axis.name} <Code>{axis.code}</Code>
          </h4>
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {axis.categories.map((c) => (
              <li key={c.code} className="text-sm">
                <span className="font-medium text-fg">{c.name}</span>
                {c.description ? <span className="text-fg-2"> · {c.description}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Sections sections={tax.sections} level={4} />
    </>
  );
}
