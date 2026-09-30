// One proposal, read in full (DESIGN.md §3.1.1), the same in Needs you, Catch up and the batch page:
// where it sits in its batch; its noun and aspect tag (which the person can change), its state, its
// title and why; what it changes, by type (prose for text, rows for checks); what it is based on,
// what DEMIURGO knows about it, how it was made (folded), and then the decision. Once decided, the decision gives way to what happened; out of date, to why (R22,
// R67, P3 evidence before narration).

import { type Aspect, aspectOfProposal } from '../../aspects.ts';
import { ProposalKind } from '../../components/AspectTag.tsx';
import { useAllows } from '../../components/actions.tsx';
import { useLocale } from '../../i18n/locale.ts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { definitionQuery, recordQuery } from '../../api/queries.ts';
import type { ProductRow, TaskSize } from '../../api/types.ts';
import { SIZE_POINTS } from '../../sizes.ts';
import { ArrowRightIcon } from '../../components/icons.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { EntityState, StatusBadge } from '../../components/status.tsx';
import { RelativeTime } from '../../components/Time.tsx';
import { TypeIcon } from '../../components/types.tsx';
import { useReadingOf } from '../../i18n/reading.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { acceptedRecord, obsoleteReason, proposalTitle, recordChangeParts, recordChangeWhat, rowOfVersion } from './model.ts';
import { AspectDoubt, AspectPicker, BasedOn, HowItWasMade, RETAGGABLE } from './Basis.tsx';
import { BlockedNotice, ChecksList, Evidence, IdeaCheck, linkClass, OutOfDate, RecordChip, Sections } from './parts.tsx';
import { ProposalDecision } from './ProposalActions.tsx';
import {
  outOfDateText,
  payloadChecks,
  payloadSections,
  type ProposalView as ProposalData,
  proposalIconType,
  proposalWhy,
  resolvedText,
} from './proposal.ts';
import { DEFINITION } from '../overview/words.i18n.ts';
import { keyOfSection } from '../overview/definition.ts';
import { PROPOSAL_VIEW } from './words.i18n.ts';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A text field of the payload as prose under its heading; nothing when it is empty. */
function Prose({ title, text }: { title: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold text-fg-2">{title}</h3>
      <Markdown>{text}</Markdown>
    </section>
  );
}

function Checks({ proposal: p }: { proposal: ProposalData }) {
  const t = useMessages(PROPOSAL_VIEW);
  const checks = payloadChecks(p.payload);
  if (checks.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-sm font-semibold text-fg-2">{t.checksCount(checks.length)}</h3>
        {p.state === 'pending' ? <span className="text-xs text-fg-3">{t.codesGivenOnAccept}</span> : null}
      </div>
      <ChecksList checks={checks} />
    </section>
  );
}

/** A change to a section of the definition: what it would say and what it says now (its evidence is under "Based on"). */
function DefinitionChangeBody({ projectId, proposal: p }: { projectId: string; proposal: ProposalData }) {
  const t = useMessages(PROPOSAL_VIEW);
  const words = useMessages(DEFINITION);
  const definition = useQuery(definitionQuery(projectId)).data;
  const base = p.payload.record as { version?: number } | undefined;
  const title = str(p.payload.section);
  const key = keyOfSection(title);
  const now = definition?.versions.find((v) => v.n === base?.version)?.sections.find((s) => s.title === title)?.content ?? null;
  return (
    <div className="flex flex-col gap-4" data-body="definition_change">
      <p className="text-sm text-fg-2">{t.definitionChangeOf(key ? words.section(key) : title)}</p>
      <Prose title={t.itWouldSay} text={str(p.payload.content)} />
      {now ? (
        <section className="flex flex-col gap-1" data-definition-before>
          <h3 className="text-sm font-semibold text-fg-2">{t.nowItSays}</h3>
          <Markdown className="text-fg-3 line-through">{now}</Markdown>
        </section>
      ) : null}
    </div>
  );
}

/** A change to a record decided in its thread: each section as it would say and says now, then its criteria. */
function RecordChangeBody({ projectId, proposal: p }: { projectId: string; proposal: ProposalData }) {
  const t = useMessages(PROPOSAL_VIEW);
  const locale = useLocale();
  const base = p.payload.record as { code?: string; version?: number } | undefined;
  const { sections, criteria } = recordChangeParts(p.payload);
  const record = useQuery({ ...recordQuery(projectId, base?.code ?? ''), enabled: !!base?.code }).data;
  const version = record?.versions.find((v) => v.n === base?.version);
  return (
    <div className="flex flex-col gap-4" data-body="record_change">
      <p className="text-sm text-fg-2">{t.recordChangeOf(base?.code ?? '', recordChangeWhat(p.payload, locale))}</p>
      {sections.map((x) => {
        const now = version?.sections.find((s) => s.title === x.section)?.content ?? null;
        return (
          <section key={x.section} className="flex flex-col gap-2" data-record-section={x.section}>
            <h3 className="text-base font-semibold text-fg">{x.section}</h3>
            <Prose title={t.itWouldSay} text={x.content} />
            {now ? (
              <section className="flex flex-col gap-1" data-record-before>
                <h4 className="text-sm font-semibold text-fg-2">{t.nowItSays}</h4>
                <Markdown className="text-fg-3 line-through">{now}</Markdown>
              </section>
            ) : null}
          </section>
        );
      })}
      {criteria.length > 0 ? (
        <section className="flex flex-col gap-2" data-record-criteria>
          <h3 className="text-sm font-semibold text-fg-2">{t.checksCount(criteria.length)}</h3>
          <ol className="flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge bg-panel">
            {criteria.map((k, i) => {
              const before = k.code ? version?.criteria.find((c) => c.code === k.code) : undefined;
              return (
                <li key={`${k.code}-${i}`} className="flex flex-col gap-1 px-3.5 py-3" data-criterion-change={k.action}>
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium text-fg-2">{t.criterionAction(k.action)}</span>
                    {k.code ? <span className="font-mono text-xs text-fg-3">{k.code}</span> : null}
                  </p>
                  {k.action === 'drop' ? (
                    <p className="text-sm text-fg-3 line-through">{before ? `${before.title}: ${before.statement}` : k.code}</p>
                  ) : (
                    <>
                      <p className="font-medium text-fg">{k.title}</p>
                      <p className="text-sm text-fg-2">{k.statement}</p>
                      <p className="text-xs text-fg-2">
                        <span className="text-fg-3">{t.checkWord}</span>
                        {k.check}
                      </p>
                      {before ? <p className="text-xs text-fg-3 line-through">{`${before.title}: ${before.statement}`}</p> : null}
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

/** A change to an epic's list of features decided in its thread: what it does to the list. */
function FeaturePlanBody({ proposal: p }: { proposal: ProposalData }) {
  const t = useMessages(PROPOSAL_VIEW);
  const epic = str((p.payload.epic as { code?: unknown } | undefined)?.code);
  const action = str(p.payload.action);
  const code = str(p.payload.code);
  const name = str(p.payload.name);
  const position = typeof p.payload.position === 'number' ? p.payload.position : null;
  return (
    <div className="flex flex-col gap-2" data-body="feature_plan">
      <p className="text-sm text-fg-2">{t.featurePlanOf(epic)}</p>
      <p className="text-md text-fg" data-feature-plan={action}>
        {action === 'add'
          ? t.featurePlanAdd(name, position, str(p.payload.summary))
          : action === 'drop'
            ? t.featurePlanDrop(code, name)
            : t.featurePlanMove(code, name, position)}
      </p>
    </div>
  );
}

/** What a proposal changes, by its type (INV-PROP-10). The title and the why are above it. */
export function ProposalBody({
  projectId,
  proposal: p,
  rows,
  withGoal = false,
}: {
  projectId: string;
  proposal: ProposalData;
  rows: readonly ProductRow[];
  /** Show a feature's goal here too (the package page has no "why" line). */
  withGoal?: boolean;
}) {
  const t = useMessages(PROPOSAL_VIEW);
  const needs = (Array.isArray(p.payload.needs) ? p.payload.needs : []) as { code: string; version?: number }[];
  const features = (Array.isArray(p.payload.features) ? p.payload.features : []) as { name?: unknown; summary?: unknown }[];
  if (p.type === 'decision') {
    return (
      <div className="flex flex-col gap-4" data-body="decision">
        {withGoal ? <Prose title={t.context} text={str(p.payload.context)} /> : null}
        <Prose title={t.decision} text={str(p.payload.decision)} />
        <Prose title={t.consequences} text={str(p.payload.consequences)} />
      </div>
    );
  }
  if (p.type === 'fdr') {
    return (
      <div className="flex flex-col gap-4" data-body="fdr">
        {withGoal ? <Prose title={t.goal} text={str(p.payload.goal)} /> : null}
        <Prose title={t.scope} text={str(p.payload.scope)} />
        <Prose title={t.outOfScope} text={str(p.payload.out_of_scope)} />
        <Prose title={t.behavior} text={str(p.payload.behavior)} />
        <Checks proposal={p} />
      </div>
    );
  }
  if (p.type === 'design_record' || p.type === 'product_definition') {
    return (
      <div className="flex flex-col gap-4" data-body="design_record">
        {needs.length > 0 ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-fg-2" data-needs>
            {t.needs}
            {needs.map((n) => (
              <RecordChip key={n.code} projectId={projectId} code={n.code} version={n.version ?? null} rows={rows} />
            ))}
          </p>
        ) : null}
        {p.payload.record_type === 'task' && typeof p.payload.size === 'string' ? (
          <section className="flex flex-col gap-1" data-proposed-size={p.payload.size}>
            <h3 className="text-sm font-semibold text-fg-2">
              {t.proposedSize(p.payload.size, SIZE_POINTS[p.payload.size as TaskSize] ?? 0)}
            </h3>
            {p.payload.size_reason ? <p className="text-md text-fg">{str(p.payload.size_reason)}</p> : null}
            {p.payload.split ? (
              <p className="text-md text-fg" data-split>
                <span className="font-medium">{t.splitHow}:</span> {str(p.payload.split)}
              </p>
            ) : null}
          </section>
        ) : null}
        <Sections sections={payloadSections(p.payload)} />
        {features.length > 0 ? (
          <section className="flex flex-col gap-1" data-features>
            <h3 className="text-sm font-semibold text-fg-2">{t.features(features.length)}</h3>
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-md text-fg">
              {features.map((f, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: an epic lists its features in order, and two may share a name
                <li key={`${str(f.name)}-${i}`}>
                  <span className="font-medium">{str(f.name)}</span>: {str(f.summary)}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <Checks proposal={p} />
      </div>
    );
  }
  if (p.type === 'definition_change') return <DefinitionChangeBody projectId={projectId} proposal={p} />;
  if (p.type === 'record_change') return <RecordChangeBody projectId={projectId} proposal={p} />;
  if (p.type === 'feature_plan') return <FeaturePlanBody proposal={p} />;
  if (p.type === 'exploration') {
    return (
      <div className="flex flex-col gap-1" data-body="exploration">
        <h3 className="text-sm font-semibold text-fg-2">{t.newThread}</h3>
        <p className="text-md text-fg">{str(p.payload.purpose)}</p>
      </div>
    );
  }
  if (p.type === 'record_translation') {
    const r = p.payload.record as { code?: string; version?: number } | undefined;
    return (
      <div className="flex flex-col gap-4" data-body="record_translation">
        <p className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
          {t.englishVersionOf}
          {r?.code ? <RecordChip projectId={projectId} code={r.code} version={r.version ?? null} rows={rows} /> : null}
        </p>
        <p className="text-sm text-fg-2">{t.englishVersionNote}</p>
        <Sections sections={payloadSections(p.payload)} />
        <Checks proposal={p} />
      </div>
    );
  }
  if (p.type === 'review') {
    const r = p.payload.record as { code?: string; version?: number } | undefined;
    const c = p.payload.change as { id?: string; version?: number | null } | undefined;
    const change = c?.id ? rowOfVersion(rows, c.id) : undefined;
    return (
      <div className="flex flex-col gap-2 text-sm" data-body="review">
        <h3 className="font-semibold text-fg-2">{t.whatItAsks}</h3>
        <p className="flex flex-wrap items-center gap-2 text-fg-2">
          {t.review}
          {r?.code ? <RecordChip projectId={projectId} code={r.code} version={r.version ?? null} rows={rows} /> : null}
          <span>· {t.sure(Math.round(Number(p.payload.confidence ?? 0) * 100))}</span>
        </p>
        {change ? (
          <p className="flex flex-wrap items-center gap-2 text-fg-2">
            {t.becauseOf}
            <RecordChip projectId={projectId} code={change.code} version={c?.version ?? null} rows={rows} />
          </p>
        ) : null}
        <p className="text-fg-2">{t.reviewOpensThread}</p>
      </div>
    );
  }
  return null;
}

export function ProposalView({
  projectId,
  proposal: p,
  position,
  count,
  producer,
  createdAt,
  runId,
  rows,
  titleId,
  meta,
  children,
  footer,
  onDone,
  className,
}: {
  projectId: string;
  proposal: ProposalData;
  position: number;
  count: number;
  producer: string;
  createdAt?: string | undefined;
  /** The run that drafted its batch, when DEMIURGO did. */
  runId?: string | null | undefined;
  rows: readonly ProductRow[];
  /** The id of its title (h2), the focus target after a decision elsewhere. */
  titleId: string;
  /** More on the author line ("Open the batch"). */
  meta?: ReactNode;
  /** Shown after what it changes (e.g. "What it unblocks"). */
  children?: ReactNode;
  /** Shown once it is decided or out of date (e.g. "Next"). */
  footer?: ReactNode;
  onDone?: (said: string) => void;
  className?: string;
}) {
  const t = useMessages(PROPOSAL_VIEW);
  // Read in the person's language; the actions always work on the English proposal.
  const reading = useReadingOf(projectId, 'proposal', p.id, p.payload);
  const shown = { ...p, payload: reading.value };
  const title = proposalTitle(shown);
  const why = proposalWhy(shown);
  const allows = useAllows('proposal', p.state);
  // The aspect the person picked for it (task: one click before accepting); null keeps its own.
  const [picked, setPicked] = useState<Aspect | null>(null);
  const own = aspectOfProposal(p);
  const retaggable = p.state === 'pending' && RETAGGABLE.has(p.type) && allows('proposal.accept_edited');
  const aspect = retaggable && picked ? picked : own;
  const tagged = { ...p, payload: { ...p.payload, ...(aspect ? { aspect } : {}) } };
  const obsolete = obsoleteReason(p);
  const outOfDate = p.state === 'superseded';
  const warnings = p.state === 'pending' ? (p.obsolescence ?? []) : [];
  const deps = p.dependencies.filter((d) => d.code);

  return (
    <article
      aria-labelledby={titleId}
      data-proposal={p.id}
      data-trace={`proposal:${p.id}`}
      data-state={p.state}
      className={cn('flex flex-col gap-5', className)}
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-2">
          <span className="tabular-nums">{t.positionOf(position, count)}</span>
          {createdAt ? (
            <>
              <span aria-hidden>·</span>
              <RelativeTime iso={createdAt} />
            </>
          ) : null}
          {meta}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium text-fg-2">
            <TypeIcon type={proposalIconType(p)} size={15} className="text-fg-3" />
            <ProposalKind proposal={tagged} />
          </span>
          {retaggable ? <AspectPicker value={aspect} onChange={setPicked} /> : null}
          {outOfDate ? <StatusBadge kind="stale" word="Out of date" /> : <EntityState entity="proposal" state={p.state} />}
        </div>
        {retaggable && !picked ? <AspectDoubt current={own} check={p.aspect_check} onChoose={setPicked} /> : null}
        <h2 id={titleId} tabIndex={-1} className="text-xl font-semibold text-fg outline-none">
          {title}
        </h2>
        {why ? <p className="max-w-prose text-md text-fg-2">“{why}”</p> : null}
      </header>

      {outOfDate ? <OutOfDate>{outOfDateText(obsolete)}</OutOfDate> : null}

      {reading.mark ? <div>{reading.mark}</div> : null}
      <ProposalBody projectId={projectId} proposal={shown} rows={rows} />

      {children}

      {deps.length > 0 ? (
        <Evidence title={t.startsFrom}>
          <div className="flex flex-wrap gap-2">
            {deps.map((d) => (
              <RecordChip
                key={`${d.id}-${d.version}`}
                projectId={projectId}
                code={d.code ?? ''}
                version={d.version}
                rows={rows}
              />
            ))}
          </div>
        </Evidence>
      ) : null}
      <BasedOn projectId={projectId} type={p.type} payload={p.payload} refs={p.basis_refs} rows={rows} />
      {p.type !== 'review' ? <IdeaCheck projectId={projectId} assessment={p.assessment} rows={rows} /> : null}
      <HowItWasMade projectId={projectId} producer={producer} runId={runId} />

      {/* Direct children of the article, so the decision bar sticks along the whole proposal. */}
      {p.state === 'pending' ? (
        <>
          <BlockedNotice reasons={warnings} />
          <ProposalDecision
            projectId={projectId}
            proposal={p}
            aspect={retaggable && picked && picked !== own ? picked : null}
            blocked={warnings}
            {...(p.type === 'review' ? { labels: { accept: t.openReview, reject: t.keepAsIs } } : {})}
            {...(onDone ? { onDone } : {})}
          />
        </>
      ) : outOfDate ? (
        footer ? (
          <div className="flex justify-end border-t border-edge pt-3">{footer}</div>
        ) : null
      ) : (
        <Resolved projectId={projectId} proposal={p} footer={footer} />
      )}
    </article>
  );
}

/** A decided proposal: what happened, the reason, and the record it made (INV-PROP-20). */
function Resolved({ projectId, proposal: p, footer }: { projectId: string; proposal: ProposalData; footer?: ReactNode }) {
  const t = useMessages(PROPOSAL_VIEW);
  const locale = useLocale();
  const effect = acceptedRecord(p);
  const reason = typeof p.resolution?.reason === 'string' ? p.resolution.reason : '';
  return (
    <div data-resolved className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge pt-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium text-fg">{resolvedText(p.state, effect, locale)}</p>
        {reason ? <p className="text-sm text-fg-2">{t.reasonPrefix(reason)}</p> : null}
        {effect ? (
          <Link
            to="/p/$projectId/records/$code"
            params={{ projectId, code: effect.code }}
            search={{ v: effect.version }}
            className={cn(linkClass, 'inline-flex min-h-6 w-fit items-center gap-1 text-sm')}
          >
            {t.openRecord(effect.code)} <ArrowRightIcon size={13} />
          </Link>
        ) : null}
      </div>
      {footer}
    </div>
  );
}
