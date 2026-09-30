// "Changes since vN" on a draft version: what it changes against the last approved one, section by
// section and check by check, like a PR's "Files changed". The approved version comes from the
// record itself; nothing is stored.

import type { Criterion, RecordDetail, RecordVersion } from '../../api/types.ts';
import { Markdown } from '../../components/Markdown.tsx';
import { useMessages } from '../../i18n/define.ts';
import { CHANGES } from './words.i18n.ts';

type SectionDiff = {
  title: string;
  kind: 'added' | 'changed' | 'removed';
  now: string | null;
  before: string | null;
};
type CheckDiff = {
  code: string;
  kind: 'added' | 'changed' | 'removed';
  now: Criterion | null;
  before: Criterion | null;
};

export type VersionDiff = {
  sections: SectionDiff[];
  checks: CheckDiff[];
  title: boolean;
};

/** The last approved version older than the draft (the one the draft is a change of). */
export function baseVersion(record: RecordDetail, version: RecordVersion): RecordVersion | undefined {
  if (version.state !== 'draft') return undefined;
  return record.versions.filter((v) => v.state === 'approved' && v.n < version.n).sort((a, b) => b.n - a.n)[0];
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

export function diffVersions(base: RecordVersion, draft: RecordVersion): VersionDiff {
  const sections: SectionDiff[] = [];
  for (const s of draft.sections) {
    const old = base.sections.find((b) => b.title === s.title);
    if (!old)
      sections.push({
        title: s.title,
        kind: 'added',
        now: s.content,
        before: null,
      });
    else if (norm(old.content) !== norm(s.content))
      sections.push({
        title: s.title,
        kind: 'changed',
        now: s.content,
        before: old.content,
      });
  }
  for (const b of base.sections) {
    if (!draft.sections.some((s) => s.title === b.title))
      sections.push({
        title: b.title,
        kind: 'removed',
        now: null,
        before: b.content,
      });
  }
  const checks: CheckDiff[] = [];
  const same = (a: Criterion, b: Criterion) =>
    norm(a.title) === norm(b.title) &&
    norm(a.statement) === norm(b.statement) &&
    norm(a.check) === norm(b.check) &&
    a.verification === b.verification &&
    (a.step ?? null) === (b.step ?? null);
  for (const c of draft.criteria) {
    const old = base.criteria.find((b) => b.code === c.code);
    if (!old) checks.push({ code: c.code, kind: 'added', now: c, before: null });
    else if (!same(old, c)) checks.push({ code: c.code, kind: 'changed', now: c, before: old });
  }
  for (const b of base.criteria) {
    if (!draft.criteria.some((c) => c.code === b.code)) checks.push({ code: b.code, kind: 'removed', now: null, before: b });
  }
  return { sections, checks, title: norm(base.title) !== norm(draft.title) };
}

export const hasChanges = (d: VersionDiff) => d.sections.length > 0 || d.checks.length > 0 || d.title;

/** What changed in this draft since the last approved version; nothing when there is none to compare. */
export function ChangesSince({ record, version }: { record: RecordDetail; version: RecordVersion }) {
  const t = useMessages(CHANGES);
  const base = baseVersion(record, version);
  if (!base) return null;
  const d = diffVersions(base, version);
  const count = (k: CheckDiff['kind']) => d.checks.filter((c) => c.kind === k).length;
  const word = { added: t.added, changed: t.changed, removed: t.removed };
  return (
    <section aria-label={t.title(base.n)} data-changes-since={base.n} className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold text-fg">{t.title(base.n)}</h2>
        <p className="text-sm text-fg-2">
          {hasChanges(d)
            ? t.summary(d.sections.length + (d.title ? 1 : 0), count('added'), count('changed'), count('removed'))
            : t.none(base.n)}
        </p>
      </div>
      {d.title ? (
        <div className="flex flex-col gap-1" data-change="title">
          <h3 className="text-base font-semibold text-fg">{t.titleChanged}</h3>
          <p className="text-fg">{version.title}</p>
          <p className="text-sm text-fg-3 line-through">{base.title}</p>
        </div>
      ) : null}
      {d.sections.map((s) => (
        <div key={s.title} className="flex flex-col gap-2" data-change="section" data-change-kind={s.kind}>
          <h3 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-fg">
            {s.title}
            <span className="text-sm font-medium text-fg-2">
              {s.kind === 'added' ? t.sectionAdded : s.kind === 'removed' ? t.sectionRemoved : t.changed}
            </span>
          </h3>
          {s.now ? <Markdown className="max-w-prose">{s.now}</Markdown> : null}
          {s.before ? (
            <div className="flex flex-col gap-1">
              <h4 className="text-sm font-semibold text-fg-2">{t.before}</h4>
              <Markdown className="max-w-prose text-fg-3 line-through">{s.before}</Markdown>
            </div>
          ) : null}
        </div>
      ))}
      {d.checks.length > 0 ? (
        <div className="flex flex-col gap-2" data-change="checks">
          <h3 className="text-base font-semibold text-fg">{t.checksHeading}</h3>
          <ol className="flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge bg-panel">
            {d.checks.map((c) => (
              <li key={c.code} className="flex flex-col gap-1 px-3.5 py-3" data-change-kind={c.kind}>
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium text-fg-2">{word[c.kind]}</span>
                  <span className="font-mono text-xs text-fg-3">{c.code}</span>
                </p>
                {c.now ? (
                  <>
                    <p className="font-medium text-fg">{c.now.title}</p>
                    <p className="text-sm text-fg-2">{c.now.statement}</p>
                    <p className="text-xs text-fg-2">
                      <span className="text-fg-3">{t.checkWord}</span>
                      {c.now.check}
                    </p>
                  </>
                ) : null}
                {c.before ? <p className="text-xs text-fg-3 line-through">{`${c.before.title}: ${c.before.statement}`}</p> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
