// Reading and writing of the fixed `design/` format.
// Core rule: a document is valid only if `render(parse(text)) === text`.
// This way the export from the v2 reproduces `design/` byte for byte.

import { parse as parseYaml, stringify as serializeYaml } from 'yaml';
import { z } from 'zod';
import {
  DOCUMENT_STATUSES,
  PREFIXES,
  CRITERIA_SECTION,
  LINK_TYPES,
  RECORD_TYPES,
  VERIFICATIONS,
  type Criterion,
  type Document,
  type RecordDocument,
  type TaxonomyDocument,
  type Link,
  type Problem,
  type Reference,
  type Result,
  type Section,
} from './types.ts';

const RE_RECORD_CODE = /^(DEC|ADR|FDR|BUG)-[A-Z]{3}-\d{3}$/;
const RE_TAXONOMY_CODE = /^TAX-\d{3}$/;
// A link points to a record (not a taxonomy) and to a version starting at 1.
const RE_REFERENCE = /^((?:DEC|ADR|FDR|BUG)-[A-Z]{3}-\d{3})@([1-9]\d*)$/;
const RE_AC_CODE = /^AC-[A-Z]{3}-\d{3}-\d{2}$/;
// A Markdown heading (from `#` to `######`) whose text starts with an AC code.
const RE_AC_HEADING = /^ {0,3}#{1,6}[ \t]+AC-[A-Z]{3}-\d{3}-\d{2}(?![\w-])/;
// Whitespace of any kind at the end of a line (including the hard space U+00A0).
const RE_TRAILING_SPACE = /[^\S\n]$/;
const SEPARATOR = ' · ';

const recordFrontSchema = z
  .object({
    code: z.string().regex(RE_RECORD_CODE, 'The code must have the form TYPE-DOM-NNN'),
    type: z.enum(RECORD_TYPES),
    title: z.string().min(3),
    version: z.number().int().positive(),
    state: z.enum(DOCUMENT_STATUSES),
    domain: z.string().regex(/^[a-z][a-z0-9_]*$/),
    increment: z
      .string()
      .regex(/^(D|S|H)\d+$/)
      .optional(),
    change_note: z.string().min(1).optional(),
    links: z.array(
      z
        .object({
          type: z.enum(LINK_TYPES),
          target: z.string().regex(RE_REFERENCE, 'Reference CODE@version to a record, with the version starting at 1'),
        })
        .strict(),
    ),
    annexes: z.array(z.string().regex(/^data\/[a-z0-9-]+\.yaml$/)),
  })
  .strict();

const taxonomyFrontSchema = z
  .object({
    code: z.string().regex(RE_TAXONOMY_CODE, 'The code must have the form TAX-NNN'),
    type: z.literal('taxonomy'),
    title: z.string().min(3),
    version: z.number().int().positive(),
    state: z.enum(DOCUMENT_STATUSES),
    axes: z
      .array(
        z
          .object({
            code: z.string().regex(/^[a-z][a-z0-9_]*$/),
            name: z.string().min(1),
            categories: z
              .array(
                z
                  .object({
                    code: z.string().regex(/^[a-z][a-z0-9_]*$/),
                    name: z.string().min(1),
                    description: z.string().min(1),
                  })
                  .strict(),
              )
              .min(2),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export function parseReference(text: string): Reference | null {
  const m = RE_REFERENCE.exec(text);
  if (!m?.[1] || !m[2]) return null;
  return { code: m[1], version: Number(m[2]) };
}

export function formatReference(ref: Reference): string {
  return `${ref.code}@${ref.version}`;
}

/**
 * Fixes what the format doesn't allow and the canonical rule doesn't correct on its own: CRLF,
 * whitespace of any kind at the end of a line, and several blank lines in a row. `canonicalize`
 * applies it before reading each document.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replaceAll('\r\n', '\n')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * CRLF and trailing whitespace in a `design/` text file (document or annex). They survive
 * parsing and rendering, so the canonical rule doesn't detect them: they are rejected here.
 */
export function whitespaceProblems(text: string, path: string): Problem[] {
  if (text.includes('\r')) return [{ path, message: 'The file uses CRLF line endings; the format requires LF.' }];
  const withSpaces = text.split('\n').findIndex((l) => RE_TRAILING_SPACE.test(l));
  if (withSpaces >= 0) {
    return [{ path, message: `Line ${withSpaces + 1} ends with spaces; the format doesn't allow them.` }];
  }
  return [];
}

/** Reads YAML; a syntax error is returned as a plain problem, without a stack trace. */
export function readYaml(text: string, path: string, what: string): Result<unknown> {
  try {
    return { ok: true, value: parseYaml(text) as unknown };
  } catch (e) {
    const { code, linePos } = e as { code?: unknown; linePos?: readonly { line: number; col: number }[] };
    const pos = linePos?.[0];
    const where = pos ? ` at line ${pos.line}, column ${pos.col}` : '';
    const codeSuffix = typeof code === 'string' ? ` (${code})` : '';
    return failure(path, `${what} is not valid YAML: syntax error${where}${codeSuffix}.`);
  }
}

function splitFrontMatter(text: string, path: string): Result<{ front: unknown; body: string }> {
  const spaces = whitespaceProblems(text, path);
  if (spaces.length > 0) return { ok: false, problems: spaces };
  if (!text.startsWith('---\n')) return failure(path, 'Missing frontmatter: the file must start with "---".');
  const end = text.indexOf('\n---\n', 3);
  if (end < 0) return failure(path, 'The frontmatter is not closed with "---".');
  const front = readYaml(text.slice(4, end + 1), path, 'The frontmatter');
  if (!front.ok) return front;
  return { ok: true, value: { front: front.value, body: text.slice(end + 5) } };
}

function failure<T>(path: string, message: string): Result<T> {
  return { ok: false, problems: [{ path, message }] };
}

function zodProblems(path: string, error: z.ZodError): Problem[] {
  return error.issues.map((i) => ({ path, message: `Frontmatter: ${i.path.join('.') || '(root)'}: ${i.message}` }));
}

type Block = { title: string; lines: string[] };

/** Splits a body into blocks by headings with the given prefix ("## " or "### "). */
function split(lines: string[], prefix: string): { before: string[]; blocks: Block[] } {
  const before: string[] = [];
  const blocks: Block[] = [];
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      blocks.push({ title: line.slice(prefix.length), lines: [] });
    } else if (blocks.length === 0) {
      before.push(line);
    } else {
      blocks[blocks.length - 1]?.lines.push(line);
    }
  }
  return { before, blocks };
}

function trim(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === '') start++;
  while (end > start && lines[end - 1]?.trim() === '') end--;
  return lines.slice(start, end).join('\n');
}

function parseBody(
  body: string,
  path: string,
  code: string,
  title: string,
): Result<{ sections: Section[]; criteriaText: string | null }> {
  const lines = body.split('\n');
  const { before, blocks } = split(lines, '## ');
  const header = trim(before);
  const expected = `# ${code}${SEPARATOR}${title}`;
  if (header !== expected) {
    return failure(path, `The body's title must be exactly "${expected}".`);
  }
  const sections: Section[] = [];
  let criteriaText: string | null = null;
  const problems: Problem[] = [];
  const visited = new Set<string>();
  for (const [i, b] of blocks.entries()) {
    const content = trim(b.lines);
    if (visited.has(b.title)) problems.push({ path, message: `The section "${b.title}" is repeated.` });
    visited.add(b.title);
    if (content.includes('\n\n\n')) {
      problems.push({ path, message: `The section "${b.title}" has more than one blank line in a row.` });
    }
    if (b.title !== CRITERIA_SECTION) {
      // A criterion only exists inside "Acceptance criteria": in another section, a
      // heading with its code would look like a criterion without being one.
      const withAc = [`## ${b.title}`, ...b.lines].find((l) => RE_AC_HEADING.test(l));
      if (withAc !== undefined) {
        problems.push({
          path,
          message: `The heading "${withAc.trim()}" starts with a criterion code outside "${CRITERIA_SECTION}".`,
        });
      }
    }
    if (b.title === CRITERIA_SECTION) {
      if (i !== blocks.length - 1) problems.push({ path, message: `"${CRITERIA_SECTION}" must be the last section.` });
      criteriaText = content;
      continue;
    }
    if (content === '') problems.push({ path, message: `The section "${b.title}" is empty.` });
    sections.push({ title: b.title, content });
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: { sections, criteriaText } };
}

const RE_AC_HEADER = /^(AC-[A-Z]{3}-\d{3}-\d{2}) · (.+)$/;

function parseCriteria(text: string, path: string): Result<Criterion[]> {
  const { before, blocks } = split(text.split('\n'), '### ');
  if (trim(before) !== '') return failure(path, `There is text in "${CRITERIA_SECTION}" before the first criterion.`);
  const criteria: Criterion[] = [];
  const problems: Problem[] = [];
  for (const b of blocks) {
    const m = RE_AC_HEADER.exec(b.title);
    if (!m?.[1] || !m[2]) {
      problems.push({ path, message: `Invalid criterion header: "### ${b.title}". Form: "### AC-DOM-NNN-NN · Title".` });
      continue;
    }
    const code = m[1];
    const lines = b.lines;
    let k = 0;
    while (k < lines.length && lines[k]?.trim() === '') k++;
    const verif = /^- Verification: (.+)$/.exec(lines[k] ?? '');
    const check = /^- Check: (.+)$/.exec(lines[k + 1] ?? '');
    if (!verif?.[1] || !check?.[1]) {
      problems.push({ path, message: `${code}: missing "- Verification:" and "- Check:" right after the header.` });
      continue;
    }
    if (!(VERIFICATIONS as readonly string[]).includes(verif[1])) {
      problems.push({ path, message: `${code}: verification must be "automatic" or "manual".` });
      continue;
    }
    k += 2;
    let derivedFrom: string | undefined;
    const derivation = /^- Derived from: (.+)$/.exec(lines[k] ?? '');
    if (derivation?.[1]) {
      derivedFrom = derivation[1];
      k++;
      if (!RE_AC_CODE.test(derivedFrom)) problems.push({ path, message: `${code}: "Derived from" must be a criterion code.` });
    }
    const statement = trim(lines.slice(k));
    if (statement === '') {
      problems.push({ path, message: `${code}: missing the observable statement.` });
      continue;
    }
    const criterion: Criterion = {
      code,
      title: m[2],
      verification: verif[1] as Criterion['verification'],
      check: check[1],
      statement,
    };
    if (derivedFrom) criterion.derivedFrom = derivedFrom;
    criteria.push(criterion);
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: criteria };
}

export function parseDocument(text: string, path: string): Result<Document> {
  const sep = splitFrontMatter(text, path);
  if (!sep.ok) return sep;
  const { front, body } = sep.value;
  const type = (front as { type?: unknown } | null)?.type;
  if (type === 'taxonomy') {
    const r = taxonomyFrontSchema.safeParse(front);
    if (!r.success) return { ok: false, problems: zodProblems(path, r.error) };
    const c = parseBody(body, path, r.data.code, r.data.title);
    if (!c.ok) return c;
    if (c.value.criteriaText !== null) return failure(path, 'A taxonomy has no acceptance criteria.');
    const doc: TaxonomyDocument = {
      kind: 'taxonomy',
      code: r.data.code,
      title: r.data.title,
      version: r.data.version,
      state: r.data.state,
      axes: r.data.axes,
      sections: c.value.sections,
    };
    return { ok: true, value: doc };
  }
  const r = recordFrontSchema.safeParse(front);
  if (!r.success) return { ok: false, problems: zodProblems(path, r.error) };
  const f = r.data;
  if (!f.code.startsWith(`${PREFIXES[f.type]}-`)) {
    return failure(path, `The code ${f.code} doesn't match type "${f.type}" (prefix ${PREFIXES[f.type]}).`);
  }
  const c = parseBody(body, path, f.code, f.title);
  if (!c.ok) return c;
  let criteria: Criterion[] = [];
  if (c.value.criteriaText !== null) {
    const pc = parseCriteria(c.value.criteriaText, path);
    if (!pc.ok) return pc;
    criteria = pc.value;
  }
  const links: Link[] = f.links.map((e) => ({
    type: e.type,
    target: parseReference(e.target) as Reference,
  }));
  const seen = new Set<string>();
  for (const e of links) {
    const key = `${e.type} → ${e.target.code}`;
    if (seen.has(key)) return failure(path, `Repeated link: ${key}.`);
    seen.add(key);
  }
  const doc: RecordDocument = {
    kind: 'record',
    type: f.type,
    code: f.code,
    title: f.title,
    version: f.version,
    state: f.state,
    domain: f.domain,
    links,
    annexes: f.annexes,
    sections: c.value.sections,
    criteria,
  };
  if (f.increment) doc.increment = f.increment;
  if (f.change_note) doc.changeNote = f.change_note;
  return { ok: true, value: doc };
}

function toYaml(object: Record<string, unknown>): string {
  return serializeYaml(object, { lineWidth: 0, indent: 2, indentSeq: true });
}

function renderCriterion(c: Criterion): string {
  const lines = [`### ${c.code}${SEPARATOR}${c.title}`, '', `- Verification: ${c.verification}`, `- Check: ${c.check}`];
  if (c.derivedFrom) lines.push(`- Derived from: ${c.derivedFrom}`);
  lines.push('', c.statement);
  return lines.join('\n');
}

export function renderDocument(doc: Document): string {
  let front: Record<string, unknown>;
  if (doc.kind === 'taxonomy') {
    front = {
      code: doc.code,
      type: 'taxonomy',
      title: doc.title,
      version: doc.version,
      state: doc.state,
      axes: doc.axes,
    };
  } else {
    front = {
      code: doc.code,
      type: doc.type,
      title: doc.title,
      version: doc.version,
      state: doc.state,
      domain: doc.domain,
    };
    if (doc.increment) front.increment = doc.increment;
    if (doc.changeNote) front.change_note = doc.changeNote;
    front.links = doc.links.map((e) => ({ type: e.type, target: formatReference(e.target) }));
    front.annexes = doc.annexes;
  }
  const parts = [`---\n${toYaml(front)}---`, `# ${doc.code}${SEPARATOR}${doc.title}`];
  for (const s of doc.sections) parts.push(`## ${s.title}\n\n${s.content}`);
  if (doc.kind === 'record' && doc.criteria.length > 0) {
    parts.push(`## ${CRITERIA_SECTION}\n\n${doc.criteria.map(renderCriterion).join('\n\n')}`);
  }
  return `${parts.join('\n\n')}\n`;
}
