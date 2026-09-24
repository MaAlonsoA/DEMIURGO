// The guided review of a draft (canvas S5A and S5B, design doc §6): a pass over the same page in
// five parts (context, what it is for, how it works, the checks and what DEMIURGO assumed). The
// parts only guide: Confirm approves the whole version. Pure part: the parts and their words.

import type { RecordType, RecordVersion } from '../../api/types.ts';

export type ReviewPartKey = 'context' | 'what' | 'how' | 'checks' | 'assumed';

export type ReviewPart = {
  n: number;
  key: ReviewPartKey;
  name: string;
  question: string;
  hint: string;
  /** Indexes of the record's sections that belong to this part. */
  sections: number[];
  /** Nothing on the page to look at: the part is quick. */
  quiet: boolean;
};

type Content = Pick<RecordVersion, 'sections' | 'criteria' | 'inferred_questions'>;

const REVIEWABLE: RecordType[] = ['fdr', 'adr'];

type Words = { question: string; hint: string };
type Middle = { what: string[]; how: string[]; names: [string, string]; words: [Words, Words] };

/** The two middle parts of each type: which section titles go in each (as the record wrote them) and their words. */
const FEATURE: Middle = {
  what: ['goal', 'scope', 'out of scope'],
  how: ['behavior', 'behaviour'],
  names: ["What it's for", 'How it works'],
  words: [
    { question: 'Is this what you meant?', hint: 'What it is for, what it covers and what it leaves out.' },
    { question: 'Is this how it should work?', hint: 'How it behaves, as it is written.' },
  ],
};
const TECH: Middle = {
  what: ['context', 'options'],
  how: ['decision', 'consequences'],
  names: ["Why it's needed", 'What it decides'],
  words: [
    { question: 'Is this why it is needed?', hint: 'The context and the options it weighed.' },
    { question: 'Is this the right decision?', hint: 'What it decides and what follows from it.' },
  ],
};
const middleOf = (type: RecordType): Middle => (type === 'adr' ? TECH : FEATURE);

export function canReview(type: RecordType, state: string, approveAllowed: boolean, earlierDraft: boolean): boolean {
  return REVIEWABLE.includes(type) && state === 'draft' && approveAllowed && !earlierDraft;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Each section goes to the part its title says; one it does not know goes with the part before it. */
function sectionParts(m: Middle, titles: readonly string[]): { what: number[]; how: number[] } {
  const what: number[] = [];
  const how: number[] = [];
  let last: 'what' | 'how' = 'what';
  titles.forEach((title, i) => {
    const t = title.trim().toLowerCase();
    if (m.how.includes(t)) last = 'how';
    else if (m.what.includes(t)) last = 'what';
    (last === 'what' ? what : how).push(i);
  });
  return { what, how };
}

function checksWords(criteria: Content['criteria']): Words {
  const n = criteria.length;
  if (n === 0) return { question: 'It has no checks yet.', hint: 'Without checks, nothing can prove it works.' };
  const automatic = criteria.filter((c) => c.verification !== 'manual').length;
  const manual = n - automatic;
  const parts = [
    automatic ? `${automatic} ${automatic === 1 ? 'is' : 'are'} automatic.` : '',
    manual ? `${manual} ${manual === 1 ? 'is' : 'are'} yours to try, once it is built.` : '',
  ].filter(Boolean);
  return { question: `Would ${n === 1 ? 'this check' : `these ${n} checks`} prove it works?`, hint: parts.join(' ') };
}

export function reviewParts(type: RecordType, version: Content): ReviewPart[] {
  const m = middleOf(type);
  const { what, how } = sectionParts(
    m,
    version.sections.map((s) => s.title),
  );
  const assumed = version.inferred_questions.length;
  const checks = checksWords(version.criteria);
  return [
    {
      n: 1,
      key: 'context',
      name: 'Context',
      question: 'Is this the right context?',
      hint: 'Where it comes from, what it changes and what it touches.',
      sections: [],
      quiet: false,
    },
    { n: 2, key: 'what', name: m.names[0], ...m.words[0], sections: what, quiet: what.length === 0 },
    { n: 3, key: 'how', name: m.names[1], ...m.words[1], sections: how, quiet: how.length === 0 },
    { n: 4, key: 'checks', name: 'Checks', ...checks, sections: [], quiet: false },
    assumed > 0
      ? {
          n: 5,
          key: 'assumed',
          name: 'What DEMIURGO assumed',
          question: `DEMIURGO assumed ${plural(assumed, 'answer')}. ${assumed === 1 ? 'Is it' : 'Are they'} right?`,
          hint: 'Confirm or change them in its thread. Until then they stay as warnings.',
          sections: [],
          quiet: false,
        }
      : {
          n: 5,
          key: 'assumed',
          name: 'What DEMIURGO assumed',
          question: 'Nothing assumed',
          hint: "DEMIURGO didn't assume any answer for this version. This part is quick.",
          sections: [],
          quiet: true,
        },
  ];
}

export type ReviewStep = { label: string; question: string; hint: string; final: boolean };

/** The words of the bar at a step: parts 1 to 5, then 6, the end, where the version is confirmed. */
export function reviewStep(parts: readonly ReviewPart[], step: number, title: string): ReviewStep {
  const part = parts[step - 1];
  if (!part) {
    return {
      label: `All ${parts.length} parts reviewed`,
      question: `Confirm ${title}?`,
      hint: 'It becomes the current version. It is Ready to build if nothing else blocks it.',
      final: true,
    };
  }
  return { label: `Part ${part.n} of ${parts.length} · ${part.name}`, question: part.question, hint: part.hint, final: false };
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** About how long it takes: reading its content (200 words a minute), and a minute to decide. */
export function reviewMinutes(version: Content): number {
  const total =
    version.sections.reduce((n, s) => n + words(s.content), 0) +
    version.criteria.reduce((n, c) => n + words(`${c.title} ${c.statement} ${c.check}`), 0) +
    version.inferred_questions.reduce((n, q) => n + words(`${q.question} ${q.conclusion ?? ''}`), 0);
  return Math.ceil(total / 200) + 1;
}

export function reviewBanner(version: Content): { title: string; detail: string } {
  const n = version.criteria.length;
  const minutes = reviewMinutes(version);
  return {
    title: n === 0 ? 'Review it: context and details' : `Review it: context, details and ${plural(n, 'check')}`,
    detail: `5 short parts · about ${plural(minutes, 'minute')}. Nothing is final until you confirm.`,
  };
}
