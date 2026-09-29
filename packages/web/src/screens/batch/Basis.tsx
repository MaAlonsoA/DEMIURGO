// What a proposal is based on (the person's words, the questions of a thread, records), how it was
// made (folded: the run, or composed without AI), and its aspect tag, which the person can change
// before accepting. Provenance is what it rests on, never "who proposed it": everything comes from
// DEMIURGO.

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { AspectCheck, BasisRefs, ProductRow } from '../../api/types.ts';
import { type Aspect, ASPECTS, isAspect } from '../../aspects.ts';
import { ASPECT_WORDS } from '../../aspects.i18n.ts';
import { AspectTag } from '../../components/AspectTag.tsx';
import { Button } from '../../components/Button.tsx';
import { ChevronDownIcon } from '../../components/icons.tsx';
import { Menu, MenuRadioItems } from '../../components/Menu.tsx';
import { Quote } from '../../components/Quote.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { whoOf } from '../../words.ts';
import { Disclosure, Evidence, linkClass, RecordChip, RunLine } from './parts.tsx';
import { PROPOSAL_VIEW } from './words.i18n.ts';

/** The proposal types whose aspect the person can change before accepting. */
export const RETAGGABLE = new Set(['decision', 'fdr', 'design_record']);

type Item =
  | { kind: 'message'; id: string; quote: string }
  | { kind: 'question'; id: string }
  | { kind: 'record'; code: string; version: number | null }
  | { kind: 'source'; quote: string };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const clip = (text: string, n = 80): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** Everything the payload says it rests on, in order and without repeats. */
export function basisItems(
  type: string,
  payload: Record<string, unknown>,
  refs: BasisRefs | undefined,
  rows: readonly ProductRow[],
): Item[] {
  const items: Item[] = [];
  const seen = new Set<string>();
  const add = (key: string, item: Item) => {
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  const bodyOf = (id: string) => refs?.messages.find((m) => m.id === id)?.body ?? '';
  for (const b of Array.isArray(payload.basis) ? (payload.basis as { type?: string; id?: string; quote?: string }[]) : []) {
    const id = str(b.id);
    if (b.type === 'message') add(`m:${id}:${str(b.quote)}`, { kind: 'message', id, quote: str(b.quote) || bodyOf(id) });
    else if (b.type === 'question') add(`q:${id}`, { kind: 'question', id });
    else if (b.type === 'record') {
      const row = rows.find((r) => r.latest_id === id || r.current_id === id);
      if (row) add(`r:${row.code}`, { kind: 'record', code: row.code, version: null });
    } else if (b.type === 'source') add(`s:${id}`, { kind: 'source', quote: str(b.quote) });
  }
  if ((type === 'definition_change' || type === 'record_change' || type === 'feature_plan') && Array.isArray(payload.evidence))
    for (const e of payload.evidence as { message_id?: string; quote?: string }[])
      add(`m:${str(e.message_id)}:${str(e.quote)}`, { kind: 'message', id: str(e.message_id), quote: str(e.quote) });
  if (type === 'product_definition' && Array.isArray(payload.sources))
    for (const s of payload.sources as { question_id?: string }[])
      if (s.question_id) add(`q:${s.question_id}`, { kind: 'question', id: s.question_id });
  const record = (payload.record ?? payload.based_on) as { code?: string; version?: number } | undefined;
  if ((type === 'review' || type === 'fdr') && record?.code)
    add(`r:${record.code}`, { kind: 'record', code: record.code, version: record.version ?? null });
  return items.filter((i) => i.kind !== 'question' || refs?.questions.some((q) => q.id === i.id));
}

/** "Based on": the person's words with their thread, the questions, the records. Nothing when empty. */
export function BasedOn({
  projectId,
  type,
  payload,
  refs,
  rows,
}: {
  projectId: string;
  type: string;
  payload: Record<string, unknown>;
  refs: BasisRefs | undefined;
  rows: readonly ProductRow[];
}) {
  const t = useMessages(PROPOSAL_VIEW);
  const items = basisItems(type, payload, refs, rows);
  if (items.length === 0) return null;
  const records = items.filter((i) => i.kind === 'record');
  return (
    <Evidence title={t.basedOnHeading}>
      <ul className="flex flex-col gap-2.5 text-sm" data-based-on>
        {items.map((i) => {
          if (i.kind === 'message') {
            const m = refs?.messages.find((x) => x.id === i.id);
            return (
              <li key={`m:${i.id}:${i.quote}`} className="flex flex-col gap-0.5" data-trace={`message:${i.id}`}>
                <span className="flex flex-wrap items-start gap-2 text-fg-2">
                  {i.quote ? <Quote text={i.quote} /> : null}
                  {m && isAspect(m.aspect) ? <AspectTag aspect={m.aspect} /> : null}
                </span>
                {m ? (
                  <ThreadLine
                    projectId={projectId}
                    label={t.saidIn}
                    explorationId={m.exploration_id}
                    purpose={m.exploration_purpose}
                    parent={m.parent_purpose}
                    hash={`message-${m.id}`}
                  />
                ) : null}
              </li>
            );
          }
          if (i.kind === 'question') {
            const q = refs?.questions.find((x) => x.id === i.id);
            if (!q) return null;
            return (
              <li key={`q:${i.id}`} className="flex flex-col gap-0.5" data-trace={`question:${i.id}`}>
                <Link
                  to="/p/$projectId/threads/$explorationId"
                  params={{ projectId, explorationId: q.exploration_id }}
                  search={{ question: q.id }}
                  className={cn(linkClass, 'w-fit')}
                >
                  {q.question}
                </Link>
                <span className="text-xs text-fg-3">
                  {t.questionIn} “{clip(q.exploration_purpose)}”
                </span>
              </li>
            );
          }
          if (i.kind === 'source') {
            return (
              <li key={`s:${i.quote}`} className="flex flex-col gap-0.5 text-fg-2">
                <span className="text-xs text-fg-3">{t.aSource}</span>
                {i.quote ? <Quote text={i.quote} /> : null}
              </li>
            );
          }
          return null;
        })}
        {records.length > 0 ? (
          <li className="flex flex-wrap gap-2">
            {records.map((r) =>
              r.kind === 'record' ? (
                <RecordChip key={r.code} projectId={projectId} code={r.code} version={r.version} rows={rows} />
              ) : null,
            )}
          </li>
        ) : null}
      </ul>
    </Evidence>
  );
}

function ThreadLine({
  projectId,
  label,
  explorationId,
  purpose,
  parent,
  hash,
}: {
  projectId: string;
  label: string;
  explorationId: string;
  purpose: string;
  parent: string | null;
  hash?: string;
}) {
  const t = useMessages(PROPOSAL_VIEW);
  return (
    <span className="text-xs text-fg-3">
      {label}{' '}
      <Link
        to="/p/$projectId/threads/$explorationId"
        params={{ projectId, explorationId }}
        {...(hash ? { hash } : {})}
        className={linkClass}
      >
        “{clip(purpose)}”
      </Link>
      {parent ? <span> · {t.derivedFrom(clip(parent))}</span> : null}
    </span>
  );
}

/** "How it was made", folded: the run that drafted it, or how it was composed without one. */
export function HowItWasMade({
  projectId,
  producer,
  runId,
}: {
  projectId: string;
  producer: string;
  runId?: string | null | undefined;
}) {
  const t = useMessages(PROPOSAL_VIEW);
  let body: ReactNode = null;
  if (runId) body = <RunLine projectId={projectId} runId={runId} />;
  else if (/^system:(definition|quality)@/.test(producer)) body = <p>{t.composedWithoutAi}</p>;
  else if (producer.startsWith('system:knowledge')) body = <p>{t.knowledgeReview}</p>;
  else if (producer.startsWith('system:')) body = <p>{t.preparedByDemiurgo}</p>;
  else {
    const who = whoOf(producer);
    if (who.kind === 'agent') body = <p>{t.addedByAgent(who.name)}</p>;
    else if (who.kind === 'you') body = <p>{t.writtenByYou}</p>;
  }
  if (!body) return null;
  return (
    <div data-how-it-was-made>
      <Disclosure label={t.howItWasMade}>
        <div className="max-w-none pt-1">{body}</div>
      </Disclosure>
    </div>
  );
}

/** A small menu next to the tag: the aspect the person wants it recorded as. */
export function AspectPicker({ value, onChange }: { value: Aspect | null; onChange: (a: Aspect) => void }) {
  const t = useMessages(PROPOSAL_VIEW);
  const words = useMessages(ASPECT_WORDS);
  return (
    <Menu
      label={t.tagMenu}
      trigger={
        <Button variant="quiet" size="sm" aria-label={t.changeTag} data-aspect-picker trailing={<ChevronDownIcon size={12} />}>
          {value ? words[value] : t.withoutTag}
        </Button>
      }
    >
      <MenuRadioItems
        value={value ?? ''}
        onChange={(v) => isAspect(v) && onChange(v)}
        options={ASPECTS.filter((a) => a !== 'epic').map((a) => ({ value: a, label: words[a] }))}
      />
    </Menu>
  );
}

/** Jev's doubt, when it is sure the proposal's own text is about another aspect: two buttons to settle it. */
export function AspectDoubt({
  current,
  check,
  onChoose,
}: {
  current: Aspect | null;
  check: AspectCheck | null | undefined;
  onChoose: (a: Aspect) => void;
}) {
  const t = useMessages(PROPOSAL_VIEW);
  const words = useMessages(ASPECT_WORDS);
  if (!check || !isAspect(check.aspect) || check.aspect === current || check.confidence < 0.8) return null;
  const other = check.aspect;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-sm text-fg-2" data-aspect-doubt>
      <span>{t.doubtBefore}</span>
      {current ? (
        <>
          <Button variant="quiet" size="sm" onClick={() => onChoose(current)}>
            {words[current]}
          </Button>
          <span>{t.doubtOr}</span>
        </>
      ) : null}
      <Button variant="quiet" size="sm" onClick={() => onChoose(other)}>
        {words[other]}
      </Button>
      <span aria-hidden>?</span>
    </p>
  );
}
