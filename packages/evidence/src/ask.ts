// `pnpm evidence ask <question> [--param value …]` (§10): runs `questions/<question>.sql` with its
// `:param` placeholders bound as parameters, and prints an aligned table.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

export const QUESTIONS_DIR = fileURLToPath(new URL('../questions/', import.meta.url));

// `:name` outside `::casts` and quoted strings is a parameter.
const RE_PARAM = /(?<![:\w'])(:)([a-z][a-z0-9_]*)\b/g;

export type PreparedQuestion = { text: string; params: string[]; values: unknown[]; header: string };

/** The SQL with `$n` placeholders in place of `:name`, and the values in that order. */
export function prepareQuestion(sql: string, given: Record<string, string>): PreparedQuestion {
  const params: string[] = [];
  const text = sql.replace(RE_PARAM, (_m, _colon: string, name: string) => {
    let index = params.indexOf(name);
    if (index < 0) {
      params.push(name);
      index = params.length - 1;
    }
    return `$${index + 1}`;
  });
  const missing = params.filter((p) => given[p] === undefined);
  if (missing.length > 0) throw new Error(`The question needs --${missing.join(', --')}.`);
  const header = sql
    .split('\n')
    .filter((l) => l.startsWith('--'))
    .map((l) => l.replace(/^--\s?/, ''))
    .join('\n');
  return { text, params, values: params.map((p) => given[p]), header };
}

export async function listQuestions(dir = QUESTIONS_DIR): Promise<string[]> {
  return (await readdir(dir)).filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -4));
}

export async function ask(
  pool: Pool,
  question: string,
  given: Record<string, string>,
  dir = QUESTIONS_DIR,
): Promise<{ columns: string[]; rows: unknown[][]; header: string }> {
  if (!/^[a-z0-9-]+$/.test(question)) throw new Error(`Unknown question: ${question}`);
  const sql = await readFile(join(dir, `${question}.sql`), 'utf8');
  const prepared = prepareQuestion(sql, given);
  const result = await pool.query({ text: prepared.text, values: prepared.values, rowMode: 'array' });
  return { columns: result.fields.map((f) => f.name), rows: result.rows as unknown[][], header: prepared.header };
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return JSON.stringify(v) ?? '';
}

/** The rows as an aligned text table. */
export function formatTable(columns: string[], rows: unknown[][]): string {
  const cells = rows.map((r) => r.map(cell));
  const widths = columns.map((c, i) => Math.max(c.length, ...cells.map((r) => (r[i] ?? '').length)));
  const line = (r: string[]) => r.map((v, i) => v.padEnd(widths[i] ?? 0)).join('  ');
  const out = [line(columns), widths.map((w) => '-'.repeat(w)).join('  '), ...cells.map(line)];
  return `${out.join('\n')}\n(${rows.length} row${rows.length === 1 ? '' : 's'})\n`;
}
