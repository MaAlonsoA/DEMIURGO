// Lectura y escritura del formato fijo de `design/`.
// Regla central: un documento es válido solo si `renderizar(parsear(texto)) === texto`.
// Así la exportación desde la v2 reproduce `design/` byte a byte.

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
// Un enlace apunta a un registro (no a una taxonomía) y a una versión que empieza en 1.
const RE_REFERENCE = /^((?:DEC|ADR|FDR|BUG)-[A-Z]{3}-\d{3})@([1-9]\d*)$/;
const RE_AC_CODE = /^AC-[A-Z]{3}-\d{3}-\d{2}$/;
// Encabezado de Markdown (de `#` a `######`) cuyo texto empieza por un código de AC.
const RE_AC_HEADING = /^ {0,3}#{1,6}[ \t]+AC-[A-Z]{3}-\d{3}-\d{2}(?![\w-])/;
// Espacio en blanco de cualquier tipo al final de una línea (incluido el espacio duro U+00A0).
const RE_TRAILING_SPACE = /[^\S\n]$/;
const SEPARATOR = ' · ';

const recordFrontSchema = z
  .object({
    code: z.string().regex(RE_RECORD_CODE, 'El código debe tener la forma TIP-DOM-NNN'),
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
          target: z.string().regex(RE_REFERENCE, 'Referencia CODIGO@version a un registro, con la versión desde 1'),
        })
        .strict(),
    ),
    annexes: z.array(z.string().regex(/^datos\/[a-z0-9-]+\.yaml$/)),
  })
  .strict();

const taxonomyFrontSchema = z
  .object({
    code: z.string().regex(RE_TAXONOMY_CODE, 'El código debe tener la forma TAX-NNN'),
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
 * Arregla lo que el formato no admite y la regla canónica no corrige sola: CRLF, espacios en
 * blanco de cualquier tipo al final de línea y varias líneas en blanco seguidas. `canonizar`
 * lo aplica antes de leer cada documento.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replaceAll('\r\n', '\n')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * CRLF y espacios finales en un archivo de texto de `design/` (documento o anexo). Sobreviven
 * a parsear y renderizar, así que la regla canónica no los detecta: se rechazan aquí.
 */
export function whitespaceProblems(text: string, path: string): Problem[] {
  if (text.includes('\r')) return [{ path, message: 'El archivo usa finales de línea CRLF; el formato exige LF.' }];
  const withSpaces = text.split('\n').findIndex((l) => RE_TRAILING_SPACE.test(l));
  if (withSpaces >= 0) {
    return [{ path, message: `La línea ${withSpaces + 1} termina con espacios; el formato no los admite.` }];
  }
  return [];
}

/** Lee YAML; un error de sintaxis se devuelve como problema en español, sin traza de pila. */
export function readYaml(text: string, path: string, what: string): Result<unknown> {
  try {
    return { ok: true, value: parseYaml(text) as unknown };
  } catch (e) {
    const { code, linePos } = e as { code?: unknown; linePos?: readonly { line: number; col: number }[] };
    const pos = linePos?.[0];
    const where = pos ? ` en la línea ${pos.line}, columna ${pos.col}` : '';
    const codeSuffix = typeof code === 'string' ? ` (${code})` : '';
    return failure(path, `${what} no es YAML válido: error de sintaxis${where}${codeSuffix}.`);
  }
}

function splitFrontMatter(text: string, path: string): Result<{ front: unknown; body: string }> {
  const spaces = whitespaceProblems(text, path);
  if (spaces.length > 0) return { ok: false, problems: spaces };
  if (!text.startsWith('---\n')) return failure(path, 'Falta el frontmatter: el archivo debe empezar por «---».');
  const end = text.indexOf('\n---\n', 3);
  if (end < 0) return failure(path, 'El frontmatter no está cerrado con «---».');
  const front = readYaml(text.slice(4, end + 1), path, 'El frontmatter');
  if (!front.ok) return front;
  return { ok: true, value: { front: front.value, body: text.slice(end + 5) } };
}

function failure<T>(path: string, message: string): Result<T> {
  return { ok: false, problems: [{ path, message }] };
}

function zodProblems(path: string, error: z.ZodError): Problem[] {
  return error.issues.map((i) => ({ path, message: `Frontmatter: ${i.path.join('.') || '(raíz)'}: ${i.message}` }));
}

type Block = { title: string; lines: string[] };

/** Divide un cuerpo en bloques por encabezados con el prefijo dado («## » o «### »). */
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
    return failure(path, `El título del cuerpo debe ser exactamente «${expected}».`);
  }
  const sections: Section[] = [];
  let criteriaText: string | null = null;
  const problems: Problem[] = [];
  const visited = new Set<string>();
  for (const [i, b] of blocks.entries()) {
    const content = trim(b.lines);
    if (visited.has(b.title)) problems.push({ path, message: `La sección «${b.title}» está repetida.` });
    visited.add(b.title);
    if (content.includes('\n\n\n')) {
      problems.push({ path, message: `La sección «${b.title}» tiene más de una línea en blanco seguida.` });
    }
    if (b.title !== CRITERIA_SECTION) {
      // Un criterio solo existe dentro de «Criterios de aceptación»: en otra sección, un
      // encabezado con su código parecería un criterio sin serlo.
      const withAc = [`## ${b.title}`, ...b.lines].find((l) => RE_AC_HEADING.test(l));
      if (withAc !== undefined) {
        problems.push({
          path,
          message: `El encabezado «${withAc.trim()}» empieza por un código de criterio fuera de «${CRITERIA_SECTION}».`,
        });
      }
    }
    if (b.title === CRITERIA_SECTION) {
      if (i !== blocks.length - 1) problems.push({ path, message: `«${CRITERIA_SECTION}» debe ser la última sección.` });
      criteriaText = content;
      continue;
    }
    if (content === '') problems.push({ path, message: `La sección «${b.title}» está vacía.` });
    sections.push({ title: b.title, content });
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: { sections, criteriaText } };
}

const RE_AC_HEADER = /^(AC-[A-Z]{3}-\d{3}-\d{2}) · (.+)$/;

function parseCriteria(text: string, path: string): Result<Criterion[]> {
  const { before, blocks } = split(text.split('\n'), '### ');
  if (trim(before) !== '') return failure(path, `Hay texto en «${CRITERIA_SECTION}» antes del primer criterio.`);
  const criteria: Criterion[] = [];
  const problems: Problem[] = [];
  for (const b of blocks) {
    const m = RE_AC_HEADER.exec(b.title);
    if (!m?.[1] || !m[2]) {
      problems.push({ path, message: `Cabecera de criterio inválida: «### ${b.title}». Forma: «### AC-DOM-NNN-NN · Título».` });
      continue;
    }
    const code = m[1];
    const lines = b.lines;
    let k = 0;
    while (k < lines.length && lines[k]?.trim() === '') k++;
    const verif = /^- Verificación: (.+)$/.exec(lines[k] ?? '');
    const check = /^- Comprobación: (.+)$/.exec(lines[k + 1] ?? '');
    if (!verif?.[1] || !check?.[1]) {
      problems.push({ path, message: `${code}: faltan «- Verificación:» y «- Comprobación:» justo después de la cabecera.` });
      continue;
    }
    if (!(VERIFICATIONS as readonly string[]).includes(verif[1])) {
      problems.push({ path, message: `${code}: la verificación debe ser «automática» o «manual».` });
      continue;
    }
    k += 2;
    let derivedFrom: string | undefined;
    const derivation = /^- Deriva de: (.+)$/.exec(lines[k] ?? '');
    if (derivation?.[1]) {
      derivedFrom = derivation[1];
      k++;
      if (!RE_AC_CODE.test(derivedFrom))
        problems.push({ path, message: `${code}: «Deriva de» debe ser un código de criterio.` });
    }
    const statement = trim(lines.slice(k));
    if (statement === '') {
      problems.push({ path, message: `${code}: falta el enunciado observable.` });
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
    if (c.value.criteriaText !== null) return failure(path, 'Una taxonomía no lleva criterios de aceptación.');
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
    return failure(path, `El código ${f.code} no corresponde al tipo «${f.type}» (prefijo ${PREFIXES[f.type]}).`);
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
    if (seen.has(key)) return failure(path, `Enlace repetido: ${key}.`);
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
  const lines = [
    `### ${c.code}${SEPARATOR}${c.title}`,
    '',
    `- Verificación: ${c.verification}`,
    `- Comprobación: ${c.check}`,
  ];
  if (c.derivedFrom) lines.push(`- Deriva de: ${c.derivedFrom}`);
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
