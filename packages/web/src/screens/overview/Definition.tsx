// The product definition at the top of the Product page: what the product is, what it builds first
// and how. It reads as a document, not a dashboard: each section with, in the margin, the question it
// comes from and how the person settled it (and the words of the idea DEMIURGO read it in). A
// proposed definition, or its next version, waits above with what changed and why; nothing is
// recorded until the person approves it. "Change" reopens the section's question with a reason and
// confirms the new answer: the system then proposes the next version.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { definitionQuery } from '../../api/queries.ts';
import type { DefinitionSource, DefinitionVersion, ProductDefinition } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { Field, TextArea } from '../../components/Field.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Section } from '../../components/Page.tsx';
import { DayTime } from '../../components/Time.tsx';
import { whoName } from '../../components/Who.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useReading } from '../../i18n/reading.tsx';
import { whoOf } from '../../words.ts';
import {
  type SectionChange,
  currentVersion,
  keyOfSection,
  previousVersion,
  reasonsOf,
  sectionChanges,
  sourceOf,
} from './definition.ts';
import { DEFINITION } from './words.i18n.ts';

type View = 'document' | 'changes' | 'history';

export function ProductDefinitionSection({ projectId }: { projectId: string }) {
  const t = useMessages(DEFINITION);
  const q = useQuery(definitionQuery(projectId));
  const [view, setView] = useState<View>('document');
  const d = q.data;
  if (q.error) return <ErrorNotice error={q.error} compact onRetry={() => void q.refetch()} />;
  const current = currentVersion(d);
  if (!d || (!current && !d.proposal)) return null;
  const previous = current ? previousVersion(d, current) : null;
  const toggle = (v: View) => setView((was) => (was === v ? 'document' : v));
  const approver = current?.approved_by ? whoOf(current.approved_by) : null;
  return (
    <Section
      id="definition"
      title={t.title}
      note={
        current && d.record ? (
          <>
            {t.inForce(d.record.code, current.n)}
            {approver ? ` · ${t.approvedBy(approver.kind === 'you' ? t.you : whoName(approver))} ` : ' '}
            <DayTime iso={current.approved_at ?? current.created_at} />
          </>
        ) : null
      }
      actions={
        current ? (
          <>
            {previous ? (
              <Button size="sm" variant="quiet" aria-pressed={view === 'changes'} onClick={() => toggle('changes')}>
                {t.changesSince(previous.n)}
              </Button>
            ) : null}
            <Button size="sm" variant="quiet" aria-pressed={view === 'history'} onClick={() => toggle('history')}>
              {t.history}
            </Button>
          </>
        ) : null
      }
    >
      <div data-definition className="flex flex-col gap-8">
        {d.proposal ? <Proposed projectId={projectId} d={d} current={current} /> : null}
        {current ? (
          view === 'history' ? (
            <History d={d} />
          ) : (
            <Document
              projectId={projectId}
              version={current}
              previous={view === 'changes' ? previous : null}
              canChange={!d.proposal}
            />
          )
        ) : null}
      </div>
    </Section>
  );
}

/** A definition waiting for the person: the first one, or the next version with its changes and why. */
function Proposed({ projectId, d, current }: { projectId: string; d: ProductDefinition; current: DefinitionVersion | null }) {
  const t = useMessages(DEFINITION);
  const accept = useCommand(projectId);
  const p = d.proposal;
  const reading = useReading(projectId, 'proposal', p?.id);
  if (!p) return null;
  const next = current ? current.n + 1 : 1;
  const base = p.base && current ? current.sections : null;
  const changes = sectionChanges(base, p.sections);
  const reasons = reasonsOf(p.change_note);
  return (
    <div data-trace={`proposal:${p.id}`} data-definition-proposal className="flex flex-col gap-3 border-l-2 border-accent pl-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-fg">{p.base ? t.proposedNextTitle(next) : t.proposedTitle}</h3>
        <p className="max-w-prose text-sm text-fg-2">{p.base ? t.proposedNextNote : t.proposedNote}</p>
        {reading.mark ? <div>{reading.mark}</div> : null}
      </div>
      <Sections
        projectId={projectId}
        changes={p.base ? changes.filter((c) => c.changed) : changes}
        folded={p.base ? changes.filter((c) => !c.changed) : []}
        text={(c) => reading.text(`sections.${p.sections.findIndex((s) => s.title === c.title)}.content`, c.content)}
        reasons={reasons}
        sources={p.sources}
        showBefore={!!p.base}
        canChange={false}
      />
      {accept.error ? <ErrorNotice error={accept.error} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          pending={accept.isPending}
          pendingLabel={t.approving}
          onClick={() =>
            accept.mutate(
              { command: 'proposal.accept', entityId: p.id, data: { approve: true } },
              { onSuccess: () => announce(t.approved(next)) },
            )
          }
        >
          {p.base ? t.approveNext(next) : t.approve}
        </Button>
        <Link
          to="/p/$projectId/batches/$batchId"
          params={{ projectId, batchId: p.batch_id }}
          className={buttonClass({ variant: 'quiet' })}
        >
          {t.reviewIt}
        </Link>
      </div>
    </div>
  );
}

/** The version in force as a document; with `previous`, only what changed from it, and why. */
function Document({
  projectId,
  version,
  previous,
  canChange,
}: {
  projectId: string;
  version: DefinitionVersion;
  previous: DefinitionVersion | null;
  canChange: boolean;
}) {
  const reading = useReading(projectId, 'record_version', version.id);
  const changes = sectionChanges(previous?.sections ?? null, version.sections);
  return (
    <article data-trace={`record_version:${version.id}`} data-definition-version={version.n} className="flex flex-col gap-3">
      {reading.mark ? <div>{reading.mark}</div> : null}
      <Sections
        projectId={projectId}
        changes={previous ? changes.filter((c) => c.changed) : changes}
        folded={previous ? changes.filter((c) => !c.changed) : []}
        text={(c) => reading.text(`sections.${version.sections.findIndex((s) => s.title === c.title)}.content`, c.content)}
        reasons={previous ? reasonsOf(version.change_note) : new Map()}
        sources={version.sources}
        showBefore={!!previous}
        canChange={canChange && !previous}
      />
    </article>
  );
}

function Sections({
  projectId,
  changes,
  folded,
  text,
  reasons,
  sources,
  showBefore,
  canChange,
}: {
  projectId: string;
  changes: SectionChange[];
  folded: SectionChange[];
  text: (c: SectionChange) => string;
  reasons: Map<string, string>;
  sources: DefinitionSource[];
  showBefore: boolean;
  canChange: boolean;
}) {
  const t = useMessages(DEFINITION);
  const label = (title: string) => {
    const key = keyOfSection(title);
    return key ? t.section(key) : title;
  };
  return (
    <div className="flex flex-col">
      {folded.length > 0 ? (
        <p className="border-t border-edge py-4 text-sm text-fg-2" data-definition-unchanged>
          <span className="font-medium text-fg">{t.unchanged}</span>
          {` · ${folded.map((c) => label(c.title)).join(' · ')}`}
        </p>
      ) : null}
      {changes.map((c) => (
        <DefinitionSection
          key={c.title}
          projectId={projectId}
          label={label(c.title)}
          change={c}
          content={text(c)}
          why={reasons.get(c.title) ?? null}
          source={sourceOf(sources, c.title)}
          showBefore={showBefore}
          canChange={canChange}
        />
      ))}
    </div>
  );
}

function DefinitionSection({
  projectId,
  label,
  change,
  content,
  why,
  source,
  showBefore,
  canChange,
}: {
  projectId: string;
  label: string;
  change: SectionChange;
  content: string;
  why: string | null;
  source: DefinitionSource | null;
  showBefore: boolean;
  canChange: boolean;
}) {
  const t = useMessages(DEFINITION);
  const [editing, setEditing] = useState(false);
  const question = source?.question ?? null;
  return (
    <section
      data-definition-section={keyOfSection(change.title) ?? change.title}
      className="grid gap-x-10 gap-y-3 border-t border-edge py-5 md:grid-cols-[minmax(0,1fr)_15rem]"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-base font-semibold text-fg">
            {label}
            {showBefore && change.changed ? <span className="font-normal text-fg-2">{` · ${t.changed}`}</span> : null}
          </h3>
          {canChange && question && !editing ? (
            <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>
              {t.change}
            </Button>
          ) : null}
        </div>
        {editing && question ? (
          <ChangeForm
            projectId={projectId}
            questionId={question.id}
            label={label}
            initial={change.content}
            onDone={() => setEditing(false)}
          />
        ) : (
          <Markdown size="sm" className="max-w-prose">
            {content}
          </Markdown>
        )}
        {showBefore && change.before !== null ? (
          <div className="grid max-w-prose grid-cols-[4rem_minmax(0,1fr)] gap-x-3 text-sm" data-definition-before>
            <span className="font-medium text-fg-2">{t.before}</span>
            <Markdown size="sm" className="text-fg-3 line-through">
              {change.before}
            </Markdown>
          </div>
        ) : null}
      </div>
      <SideNote source={source} why={why} />
    </section>
  );
}

/** The margin note: why it changed, and where it comes from. */
function SideNote({ source, why }: { source: DefinitionSource | null; why: string | null }) {
  const t = useMessages(DEFINITION);
  const q = source?.question ?? null;
  return (
    <aside className="flex flex-col gap-1.5 text-sm text-fg-2" {...(q ? { 'data-trace': `question:${q.id}` } : {})}>
      {why ? (
        <p data-definition-why>
          <span className="font-medium text-fg">{t.why}</span>
          {` · ${why}`}
        </p>
      ) : null}
      {!q ? (
        <p>{source ? t.notAsked : null}</p>
      ) : (
        <>
          <p data-settled={q.settled ?? ''}>
            {q.settled ? t.settled(q.settled) : null}
            {q.settled_at ? (
              <>
                {' · '}
                <DayTime iso={q.settled_at} />
              </>
            ) : null}
          </p>
          {q.evidence.map((e) => (
            <p key={`${e.message_id}:${e.quote}`} className="text-fg-3" data-trace={`message:${e.message_id}`}>
              <q>{e.quote}</q>
            </p>
          ))}
          <p className="text-xs text-fg-3">{`${t.from} · ${q.question}`}</p>
        </>
      )}
    </aside>
  );
}

/** Changing a section: the new text and why. Reopens its question with the reason, then confirms the new answer. */
function ChangeForm({
  projectId,
  questionId,
  label,
  initial,
  onDone,
}: {
  projectId: string;
  questionId: string;
  label: string;
  initial: string;
  onDone: () => void;
}) {
  const t = useMessages(DEFINITION);
  const command = useCommand(projectId);
  const [text, setText] = useState(initial);
  const [why, setWhy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!why.trim()) {
      setError(t.whyRequired);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await command.mutateAsync({ command: 'question.reopen', entityId: questionId, data: { reason: why.trim() } });
      await command.mutateAsync({ command: 'question.confirm', entityId: questionId, data: { conclusion: text.trim() } });
      announce(t.changeProposed);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="flex max-w-prose flex-col gap-3" onSubmit={(e) => void submit(e)} data-definition-change>
      <Field label={t.changeLabel(label)}>
        {(p) => <TextArea {...p} autoGrow rows={3} value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
      <Field label={t.whyLabel} hint={t.whyHint} error={error}>
        {(p) => <TextArea {...p} autoGrow rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" pending={pending} pendingLabel={t.proposing} disabled={!text.trim()}>
          {t.proposeChange}
        </Button>
        <Button type="button" variant="quiet" size="sm" onClick={onDone}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}

/** Every version, newest first: when, what changed and who approved it. The versions are never deleted. */
function History({ d }: { d: ProductDefinition }) {
  const t = useMessages(DEFINITION);
  return (
    <ol className="flex flex-col" data-definition-history>
      {d.versions.map((v) => {
        const approver = v.approved_by ? whoOf(v.approved_by) : null;
        return (
          <li
            key={v.id}
            data-trace={`record_version:${v.id}`}
            className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 border-t border-edge py-3 text-sm first:border-t-0"
          >
            <span className="font-mono text-fg">{t.versionLine(v.n)}</span>
            <span className="flex flex-col gap-0.5 text-fg-2">
              <span className="whitespace-pre-line text-fg">{v.change_note ?? t.firstVersion}</span>
              <span>
                <DayTime iso={v.approved_at ?? v.created_at} />
                {approver ? ` · ${t.approvedBy(approver.kind === 'you' ? t.you : whoName(approver))}` : ''}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
