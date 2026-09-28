// The guided review of a draft (canvas S5A and S5B, design doc §6): a pass over the same page in
// five parts (context, what it is for, how it works, the checks and what DEMIURGO assumed). The
// parts only guide: Confirm approves the whole version. Pure part: the parts and their words.

import type { RecordType, RecordVersion } from '../../api/types.ts';
import { REVIEW } from './words.i18n.ts';

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

type ReviewWords = (typeof REVIEW)['en'];

/**
 * The two middle parts of each type: which section titles go in each (as the record always writes
 * them, in English) and their words in the language shown.
 */
const featureOf = (words: ReviewWords): Middle => ({
  what: ['goal', 'scope', 'out of scope'],
  how: ['behavior', 'behaviour'],
  names: [words.featureWhatName, words.featureHowName],
  words: [
    { question: words.featureWhatQuestion, hint: words.featureWhatHint },
    { question: words.featureHowQuestion, hint: words.featureHowHint },
  ],
});
const techOf = (words: ReviewWords): Middle => ({
  what: ['context', 'options'],
  how: ['decision', 'consequences'],
  names: [words.techWhatName, words.techHowName],
  words: [
    { question: words.techWhatQuestion, hint: words.techWhatHint },
    { question: words.techHowQuestion, hint: words.techHowHint },
  ],
});
const middleOf = (type: RecordType, words: ReviewWords): Middle => (type === 'adr' ? techOf(words) : featureOf(words));

export function canReview(type: RecordType, state: string, approveAllowed: boolean, earlierDraft: boolean): boolean {
  return REVIEWABLE.includes(type) && state === 'draft' && approveAllowed && !earlierDraft;
}

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

function checksWords(criteria: Content['criteria'], words: ReviewWords): Words {
  const n = criteria.length;
  if (n === 0) return { question: words.noChecksQuestion, hint: words.noChecksHint };
  const automatic = criteria.filter((c) => c.verification !== 'manual').length;
  const manual = n - automatic;
  const parts = [automatic ? words.automaticCount(automatic) : '', manual ? words.manualCount(manual) : ''].filter(Boolean);
  return { question: words.checksQuestion(n), hint: parts.join(' ') };
}

export function reviewParts(type: RecordType, version: Content, words: ReviewWords = REVIEW.en): ReviewPart[] {
  const m = middleOf(type, words);
  const { what, how } = sectionParts(
    m,
    version.sections.map((s) => s.title),
  );
  const assumed = version.inferred_questions.length;
  const checks = checksWords(version.criteria, words);
  return [
    {
      n: 1,
      key: 'context',
      name: words.contextName,
      question: words.contextQuestion,
      hint: words.contextHint,
      sections: [],
      quiet: false,
    },
    { n: 2, key: 'what', name: m.names[0], ...m.words[0], sections: what, quiet: what.length === 0 },
    { n: 3, key: 'how', name: m.names[1], ...m.words[1], sections: how, quiet: how.length === 0 },
    { n: 4, key: 'checks', name: words.checksName, ...checks, sections: [], quiet: false },
    assumed > 0
      ? {
          n: 5,
          key: 'assumed',
          name: words.assumedName,
          question: words.assumedQuestion(assumed),
          hint: words.assumedHint,
          sections: [],
          quiet: false,
        }
      : {
          n: 5,
          key: 'assumed',
          name: words.assumedName,
          question: words.nothingAssumedQuestion,
          hint: words.nothingAssumedHint,
          sections: [],
          quiet: true,
        },
  ];
}

export type ReviewStep = { label: string; question: string; hint: string; final: boolean };

/** The words of the bar at a step: parts 1 to 5, then 6, the end, where the version is confirmed. */
export function reviewStep(
  parts: readonly ReviewPart[],
  step: number,
  title: string,
  words: ReviewWords = REVIEW.en,
): ReviewStep {
  const part = parts[step - 1];
  if (!part) {
    return {
      label: words.allPartsReviewed(parts.length),
      question: words.confirmTitle(title),
      hint: words.confirmHint,
      final: true,
    };
  }
  return { label: words.partLabel(part.n, parts.length, part.name), question: part.question, hint: part.hint, final: false };
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** About how long it takes: reading its content (200 words a minute), and a minute to decide. */
export function reviewMinutes(version: Content): number {
  const total =
    version.sections.reduce((n, s) => n + wordCount(s.content), 0) +
    version.criteria.reduce((n, c) => n + wordCount(`${c.title} ${c.statement} ${c.check}`), 0) +
    version.inferred_questions.reduce((n, q) => n + wordCount(`${q.question} ${q.conclusion ?? ''}`), 0);
  return Math.ceil(total / 200) + 1;
}

export function reviewBanner(version: Content, words: ReviewWords = REVIEW.en): { title: string; detail: string } {
  const n = version.criteria.length;
  const minutes = reviewMinutes(version);
  return {
    title: n === 0 ? words.reviewTitleNoChecks : words.reviewTitleWithChecks(n),
    detail: words.reviewDetail(minutes),
  };
}
