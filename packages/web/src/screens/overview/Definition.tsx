// The product definition at the top of the Product page: what the product is, what it builds first
// and how. It reads as a document, not a dashboard: one definition that keeps up to date, each section
// with, in the margin, the question it comes from, how the person settled it, their own words and the
// words of the idea DEMIURGO read it in. What waits for the person sits above it: a definition drafted
// from the answers, or its change, and the changes decided in threads. Nothing is recorded until the
// person approves it. "Change" reopens the section's question with a reason and confirms the new
// answer: the system then proposes the change. The versions only show in the history.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { definitionQuery } from '../../api/queries.ts';
import type {
  DefinitionChange,
  DefinitionEvidence,
  DefinitionReason,
  DefinitionSource,
  DefinitionVersion,
  ProductDefinition,
} from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { Field, TextArea } from '../../components/Field.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Section } from '../../components/Page.tsx';
import { DayTime } from '../../components/Time.tsx';
import { whoName } from '../../components/Who.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useLocale } from '../../i18n/locale.ts';
import { cn } from '../../lib/cn.ts';
import { useReading } from '../../i18n/reading.tsx';
import { whoOf } from '../../words.ts';
import {
  type DefinitionKey,
  type SectionChange,
  currentVersion,
  draftVersion,
  keyOfSection,
  previousVersion,
  reasonFor,
  sectionChanges,
  sectionTrace,
  sourceOf,
} from './definition.ts';
import { DEFINITION } from './words.i18n.ts';
import { Quote } from '../../components/Quote.tsx';

type View = 'document' | 'changes' | 'history';

/** A thread a section changed in, with the person's words there. */
type FromThread = {
  explorationId: string | null;
  evidence: DefinitionEvidence[];
};

export function ProductDefinitionSection({
  projectId,
  whyOpen,
  onWhy,
}: {
  projectId: string;
  /** The title of the section whose provenance shows in the side column, if any. */
  whyOpen: string | null;
  onWhy: (title: string | null) => void;
}) {
  const t = useMessages(DEFINITION);
  const q = useQuery(definitionQuery(projectId));
  const [view, setView] = useState<View>('document');
  const d = q.data;
  if (q.error) return <ErrorNotice error={q.error} compact onRetry={() => void q.refetch()} />;
  const current = currentVersion(d);
  const draft = draftVersion(d);
  if (!d || (!current && !d.proposal && !draft)) return null;
  const previous = current ? previousVersion(d, current) : null;
  const toggle = (v: View) => setView((was) => (was === v ? 'document' : v));
  const approver = current?.approved_by ? whoOf(current.approved_by) : null;
  const who = approver ? (approver.kind === 'you' ? t.you : whoName(approver)) : null;
  return (
    <Section
      id="definition"
      title={t.title}
      note={
        current && who ? (
          <>
            {previous ? t.changedNote(who) : t.approvedNote(who)}
            {' · '}
            <DayTime iso={current.approved_at ?? current.created_at} />
          </>
        ) : null
      }
      actions={
        current ? (
          <>
            {previous ? (
              <Button size="sm" variant="quiet" aria-pressed={view === 'changes'} onClick={() => toggle('changes')}>
                {t.lastChange}
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
        {current && d.changes.length > 0 ? <ThreadChanges projectId={projectId} changes={d.changes} current={current} /> : null}
        {d.proposal ? <Proposed projectId={projectId} d={d} current={current} /> : null}
        {!d.proposal && draft ? <Draft projectId={projectId} version={draft} current={current} /> : null}
        {current ? (
          view === 'history' ? (
            <History d={d} />
          ) : (
            <Document
              projectId={projectId}
              version={current}
              previous={view === 'changes' ? previous : null}
              canChange={!d.proposal}
              whyOpen={whyOpen}
              onWhy={onWhy}
            />
          )
        ) : null}
      </div>
    </Section>
  );
}

/** Changes to a section decided in threads, each one approved on its own. */
function ThreadChanges({
  projectId,
  changes,
  current,
}: {
  projectId: string;
  changes: DefinitionChange[];
  current: DefinitionVersion;
}) {
  const t = useMessages(DEFINITION);
  return (
    <div data-definition-changes className="flex flex-col gap-3 border-l-2 border-accent pl-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-fg">{t.threadChangesTitle}</h3>
        <p className="max-w-prose text-sm text-fg-2">{t.threadChangesNote}</p>
      </div>
      <div className="flex flex-col">
        {changes.map((c) => (
          <ThreadChange key={c.id} projectId={projectId} change={c} current={current} />
        ))}
      </div>
    </div>
  );
}

function ThreadChange({
  projectId,
  change,
  current,
}: {
  projectId: string;
  change: DefinitionChange;
  current: DefinitionVersion;
}) {
  const t = useMessages(DEFINITION);
  const accept = useCommand(projectId);
  const reading = useReading(projectId, 'proposal', change.id);
  const key = keyOfSection(change.section);
  const before = current.sections.find((s) => s.title === change.section)?.content ?? null;
  return (
    <section
      data-definition-thread-change={key ?? change.section}
      data-trace={`proposal:${change.id}`}
      className="grid gap-x-10 gap-y-3 border-t border-edge py-5 md:grid-cols-[minmax(0,1fr)_15rem]"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <h4 className="text-base font-semibold text-fg">{key ? t.section(key) : change.section}</h4>
        {reading.mark ? <div>{reading.mark}</div> : null}
        <Markdown size="sm" className="max-w-prose">
          {reading.text('content', change.content)}
        </Markdown>
        {before !== null ? <Before text={before} /> : null}
        {accept.error ? <ErrorNotice error={accept.error} /> : null}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant="primary"
            size="sm"
            pending={accept.isPending}
            pendingLabel={t.approving}
            onClick={() =>
              accept.mutate(
                { command: 'proposal.accept', entityId: change.id, data: {} },
                { onSuccess: () => announce(t.changeApproved) },
              )
            }
          >
            {t.approveNext}
          </Button>
          <Link
            to="/p/$projectId/batches/$batchId"
            params={{ projectId, batchId: change.batch_id }}
            className={buttonClass({ variant: 'quiet', size: 'sm' })}
          >
            {t.reviewIt}
          </Link>
        </div>
      </div>
      <aside className="flex flex-col gap-1.5 text-sm text-fg-2">
        <p data-definition-why>
          <span className="font-medium text-fg">{t.why}</span>
          {` · ${reading.text('reason', change.reason)}`}
        </p>
        <ThreadNote
          projectId={projectId}
          from={{
            explorationId: change.exploration_id,
            evidence: change.evidence,
          }}
          label={t.decidedInThread}
        />
      </aside>
    </section>
  );
}

/** Where in a thread a section was decided, with the person's words there. */
function ThreadNote({ projectId, from, label }: { projectId: string; from: FromThread; label: string }) {
  const t = useMessages(DEFINITION);
  return (
    <>
      <p>
        {label}
        {from.explorationId ? (
          <>
            {' · '}
            <Link
              to="/p/$projectId/threads/$explorationId"
              params={{ projectId, explorationId: from.explorationId }}
              className="font-medium text-accent-text hover:underline"
            >
              {t.openThread}
            </Link>
          </>
        ) : null}
      </p>
      {from.evidence.map((e) => (
        <p key={`${e.message_id}:${e.quote}`} className="text-fg-3" data-trace={`message:${e.message_id}`}>
          <Quote text={e.quote} />
        </p>
      ))}
    </>
  );
}

/** A version accepted without approving it: it only counts once the person approves it. */
function Draft({
  projectId,
  version,
  current,
}: {
  projectId: string;
  version: DefinitionVersion;
  current: DefinitionVersion | null;
}) {
  const t = useMessages(DEFINITION);
  const approve = useCommand(projectId);
  return (
    <div
      data-trace={`record_version:${version.id}`}
      data-definition-draft
      className="flex flex-col gap-3 border-l-2 border-accent pl-5"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-fg">{current ? t.draftNextTitle : t.draftTitle}</h3>
        <p className="max-w-prose text-sm text-fg-2">{t.draftNote}</p>
      </div>
      <Document projectId={projectId} version={version} previous={current} canChange={false} />
      {approve.error ? <ErrorNotice error={approve.error} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          pending={approve.isPending}
          pendingLabel={t.approving}
          onClick={() =>
            approve.mutate(
              {
                command: 'record_version.approve',
                entityId: version.id,
                data: {},
              },
              {
                onSuccess: () => announce(current ? t.changeApproved : t.approved),
              },
            )
          }
        >
          {current ? t.approveNext : t.approve}
        </Button>
      </div>
    </div>
  );
}

/** A definition waiting for the person: the first one, or its change with what changed and why. */
function Proposed({ projectId, d, current }: { projectId: string; d: ProductDefinition; current: DefinitionVersion | null }) {
  const t = useMessages(DEFINITION);
  const accept = useCommand(projectId);
  const p = d.proposal;
  const reading = useReading(projectId, 'proposal', p?.id);
  if (!p) return null;
  const base = p.base && current ? current.sections : null;
  const changes = sectionChanges(base, p.sections);
  return (
    <div data-trace={`proposal:${p.id}`} data-definition-proposal className="flex flex-col gap-3 border-l-2 border-accent pl-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-fg">{p.base ? t.proposedNextTitle : t.proposedTitle}</h3>
        <p className="max-w-prose text-sm text-fg-2">{p.base ? t.proposedNextNote : t.proposedNote}</p>
        {reading.mark ? <div>{reading.mark}</div> : null}
      </div>
      <Sections
        projectId={projectId}
        changes={p.base ? changes.filter((c) => c.changed) : changes}
        folded={p.base ? changes.filter((c) => !c.changed) : []}
        text={(c) => reading.text(`sections.${p.sections.findIndex((s) => s.title === c.title)}.content`, c.content)}
        reasons={p.reasons}
        sources={p.sources}
        fromThread={null}
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
              {
                command: 'proposal.accept',
                entityId: p.id,
                data: { approve: true },
              },
              {
                onSuccess: () => announce(p.base ? t.changeApproved : t.approved),
              },
            )
          }
        >
          {p.base ? t.approveNext : t.approve}
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

/** The definition in force as a document; with `previous`, only what its last change changed, and why. */
function Document({
  projectId,
  version,
  previous,
  canChange,
  whyOpen = null,
  onWhy,
}: {
  projectId: string;
  version: DefinitionVersion;
  previous: DefinitionVersion | null;
  canChange: boolean;
  whyOpen?: string | null;
  onWhy?: (title: string | null) => void;
}) {
  const reading = useReading(projectId, 'record_version', version.id);
  const changes = sectionChanges(previous?.sections ?? null, version.sections);
  const fromThread = version.from_thread
    ? {
        explorationId: version.from_thread.exploration_id,
        evidence: version.from_thread.evidence,
      }
    : null;
  return (
    <article data-trace={`record_version:${version.id}`} data-definition-version={version.n} className="flex flex-col gap-3">
      {reading.mark ? <div>{reading.mark}</div> : null}
      {!previous && onWhy ? (
        <Canvas
          projectId={projectId}
          changes={changes}
          text={(c) => reading.text(`sections.${version.sections.findIndex((s) => s.title === c.title)}.content`, c.content)}
          sources={version.sources}
          canChange={canChange}
          whyOpen={whyOpen}
          onWhy={onWhy}
        />
      ) : (
        <Sections
          projectId={projectId}
          changes={previous ? changes.filter((c) => c.changed) : changes}
          folded={previous ? changes.filter((c) => !c.changed) : []}
          text={(c) => reading.text(`sections.${version.sections.findIndex((s) => s.title === c.title)}.content`, c.content)}
          reasons={previous ? version.reasons : []}
          sources={version.sources}
          fromThread={previous ? fromThread : null}
          showBefore={!!previous}
          canChange={canChange && !previous}
        />
      )}
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
  fromThread,
  showBefore,
  canChange,
}: {
  projectId: string;
  changes: SectionChange[];
  folded: SectionChange[];
  text: (c: SectionChange) => string;
  reasons: readonly DefinitionReason[];
  sources: DefinitionSource[];
  /** The thread the changed sections were decided in, when they were. */
  fromThread: FromThread | null;
  showBefore: boolean;
  canChange: boolean;
}) {
  const t = useMessages(DEFINITION);
  const locale = useLocale();
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
          why={reasonFor(reasons, c.title, locale)}
          source={sourceOf(sources, c.title)}
          fromThread={c.changed ? fromThread : null}
          showBefore={showBefore}
          canChange={canChange}
        />
      ))}
    </div>
  );
}

/** Where each section sits on the canvas: its cell's width in a grid of six columns, in reading order. */
const CANVAS: { key: DefinitionKey; span: string }[] = [
  { key: 'purpose', span: 'md:col-span-6' },
  { key: 'problem', span: 'md:col-span-2' },
  { key: 'stakeholders', span: 'md:col-span-2' },
  { key: 'outcomes', span: 'md:col-span-2' },
  { key: 'features', span: 'md:col-span-4' },
  { key: 'principles', span: 'md:col-span-2' },
  { key: 'constraints', span: 'md:col-span-3' },
  { key: 'scope_out', span: 'md:col-span-3' },
];

/** The definition in force on one screen: a grid of six columns split by hairlines, the full text of every section. */
function Canvas({
  projectId,
  changes,
  text,
  sources,
  canChange,
  whyOpen,
  onWhy,
}: {
  projectId: string;
  changes: SectionChange[];
  text: (c: SectionChange) => string;
  sources: DefinitionSource[];
  canChange: boolean;
  whyOpen: string | null;
  onWhy: (title: string | null) => void;
}) {
  const t = useMessages(DEFINITION);
  const placed = new Set<string>();
  const cells = CANVAS.flatMap(({ key, span }) => {
    const c = changes.find((x) => keyOfSection(x.title) === key);
    if (!c) return [];
    placed.add(c.title);
    return [{ c, key, span }];
  });
  // Sections the template does not know still show, full width, after the rest.
  const extra = changes.filter((c) => !placed.has(c.title)).map((c) => ({ c, key: null, span: 'md:col-span-6' }));
  return (
    <div className="grid grid-cols-1 border-l border-t border-edge md:grid-cols-6" data-definition-canvas>
      {[...cells, ...extra].map(({ c, key, span }) => (
        <CanvasCell
          key={c.title}
          projectId={projectId}
          label={key ? t.section(key) : c.title}
          change={c}
          content={text(c)}
          question={sourceOf(sources, c.title)?.question ?? null}
          className={span}
          large={key === 'purpose'}
          canChange={canChange}
          whyOpen={whyOpen === c.title}
          onWhy={() => onWhy(whyOpen === c.title ? null : c.title)}
        />
      ))}
    </div>
  );
}

function CanvasCell({
  projectId,
  label,
  change,
  content,
  question,
  className,
  large,
  canChange,
  whyOpen,
  onWhy,
}: {
  projectId: string;
  label: string;
  change: SectionChange;
  content: string;
  question: DefinitionSource['question'] | null;
  className: string;
  large: boolean;
  canChange: boolean;
  whyOpen: boolean;
  onWhy: () => void;
}) {
  const t = useMessages(DEFINITION);
  const [editing, setEditing] = useState(false);
  return (
    <section
      data-definition-section={keyOfSection(change.title) ?? change.title}
      className={cn('flex min-w-0 flex-col gap-2 border-b border-r border-edge px-4 py-4', large && 'bg-sunken', className)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-fg">{label}</h3>
        <div className="flex shrink-0 items-baseline gap-1">
          {canChange && question && !editing ? (
            <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>
              {t.change}
            </Button>
          ) : null}
          <Button size="sm" variant="quiet" aria-pressed={whyOpen} onClick={onWhy}>
            {t.whyLink}
          </Button>
        </div>
      </div>
      {editing && question ? (
        <ChangeForm
          projectId={projectId}
          questionId={question.id}
          label={label}
          initial={question.own_words ?? change.content}
          onDone={() => setEditing(false)}
        />
      ) : (
        <Markdown size={large ? 'md' : 'sm'} className={large ? 'max-w-prose' : undefined}>
          {content}
        </Markdown>
      )}
    </section>
  );
}

/**
 * The side column while a section's "Why" is open: why it says what it says, how it was settled, the
 * person's words and the versions that changed it.
 */
export function DefinitionWhyPanel({ projectId, title, onClose }: { projectId: string; title: string; onClose: () => void }) {
  const t = useMessages(DEFINITION);
  const locale = useLocale();
  const d = useQuery(definitionQuery(projectId)).data;
  const current = currentVersion(d);
  if (!d || !current) return null;
  const key = keyOfSection(title);
  const label = key ? t.section(key) : title;
  const previous = previousVersion(d, current);
  const changed = !!previous && sectionChanges(previous.sections, current.sections).find((c) => c.title === title)?.changed;
  const fromThread =
    changed && current.from_thread
      ? {
          explorationId: current.from_thread.exploration_id,
          evidence: current.from_thread.evidence,
        }
      : null;
  const trace = sectionTrace(d.versions, title);
  return (
    <div className="flex flex-col gap-4 border-l border-edge pl-5" data-definition-why-panel={key ?? title}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-fg">
          {t.whyPanelTitle}
          <span className="font-normal text-fg-2">{` · ${label}`}</span>
        </h3>
        <Button size="sm" variant="quiet" onClick={onClose}>
          {t.close}
        </Button>
      </div>
      <SideNote
        projectId={projectId}
        source={sourceOf(current.sources, title)}
        why={reasonFor(current.reasons, title, locale)}
        fromThread={fromThread}
      />
      {trace.length > 0 ? (
        <div className="flex flex-col gap-1.5 text-sm text-fg-2">
          <span className="font-medium text-fg">{t.trace}</span>
          <ol className="flex flex-col">
            {trace.map((v) => (
              <li
                key={v.id}
                data-trace={`record_version:${v.id}`}
                className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2 border-t border-edge py-2 first:border-t-0"
              >
                <span className="font-mono text-fg">{t.versionLine(v.n)}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="whitespace-pre-line text-fg">{v.change_note ?? t.firstVersion}</span>
                  <DayTime iso={v.approved_at ?? v.created_at} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
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
  fromThread,
  showBefore,
  canChange,
}: {
  projectId: string;
  label: string;
  change: SectionChange;
  content: string;
  why: string | null;
  source: DefinitionSource | null;
  fromThread: FromThread | null;
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
            initial={question.own_words ?? change.content}
            onDone={() => setEditing(false)}
          />
        ) : (
          <Markdown size="sm" className="max-w-prose">
            {content}
          </Markdown>
        )}
        {showBefore && change.before !== null ? <Before text={change.before} /> : null}
      </div>
      <SideNote projectId={projectId} source={source} why={why} fromThread={fromThread} />
    </section>
  );
}

function Before({ text }: { text: string }) {
  const t = useMessages(DEFINITION);
  return (
    <div className="grid max-w-prose grid-cols-[4rem_minmax(0,1fr)] gap-x-3 text-sm" data-definition-before>
      <span className="font-medium text-fg-2">{t.before}</span>
      <Markdown size="sm" className="text-fg-3 line-through">
        {text}
      </Markdown>
    </div>
  );
}

/** The margin note: why it changed, and where it comes from. */
function SideNote({
  projectId,
  source,
  why,
  fromThread,
}: {
  projectId: string;
  source: DefinitionSource | null;
  why: string | null;
  fromThread: FromThread | null;
}) {
  const t = useMessages(DEFINITION);
  const q = source?.question ?? null;
  return (
    <div className="flex flex-col gap-1.5 text-sm text-fg-2" {...(q ? { 'data-trace': `question:${q.id}` } : {})}>
      {why ? (
        <p data-definition-why>
          <span className="font-medium text-fg">{t.why}</span>
          {` · ${why}`}
        </p>
      ) : null}
      {fromThread ? <ThreadNote projectId={projectId} from={fromThread} label={t.changedInThread} /> : null}
      {!q ? (
        <p>{source ? t.notAsked : null}</p>
      ) : (
        <>
          {fromThread ? null : (
            <p data-settled={q.settled ?? ''}>
              {q.settled ? t.settled(q.settled) : null}
              {q.settled_at ? (
                <>
                  {' · '}
                  <DayTime iso={q.settled_at} />
                </>
              ) : null}
            </p>
          )}
          {q.own_words ? (
            <p data-definition-own-words>
              <span className="font-medium text-fg">{t.ownWords}</span>
              {' · '}
              <q>{q.own_words}</q>
            </p>
          ) : null}
          {fromThread
            ? null
            : q.evidence.map((e) => (
                <p key={`${e.message_id}:${e.quote}`} className="text-fg-3" data-trace={`message:${e.message_id}`}>
                  <Quote text={e.quote} />
                </p>
              ))}
          <p className="text-xs text-fg-3">{`${t.from} · ${q.question}`}</p>
        </>
      )}
    </div>
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
      await command.mutateAsync({
        command: 'question.reopen',
        entityId: questionId,
        data: { reason: why.trim() },
      });
      await command.mutateAsync({
        command: 'question.confirm',
        entityId: questionId,
        data: { conclusion: text.trim() },
      });
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
      <Field label={t.changeLabel(label)} hint={t.changeHint}>
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

/** Every change, newest first: when, what changed and who approved it. The versions are never deleted. */
function History({ d }: { d: ProductDefinition }) {
  const t = useMessages(DEFINITION);
  return (
    <div className="flex flex-col gap-3">
      {d.record ? <p className="text-sm text-fg-2">{t.historyOf(d.record.code)}</p> : null}
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
    </div>
  );
}
