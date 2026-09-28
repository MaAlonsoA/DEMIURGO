// The interface speaks the person's language: its words live in the typed catalogs (words.i18n.ts,
// i18n/define.ts), never as literal text in the components. This scans every .tsx for literal
// prose in JSX text and in the attributes a person reads (aria-label, title, placeholder, label…).
// Product names, codes and punctuation are not prose.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../../src');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(path);
    return e.name.endsWith('.tsx') ? [path] : [];
  });
}

/** Without comments, so a comment never counts as interface text. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// Words that are the same in every language: names of the product and its engines.
const NAMES = new Set(['DEMIURGO', 'Claude', 'Codex', 'OpenCode', 'Qwen', 'English', 'Español', 'MCP', 'FDR', 'ADR', 'AC', 'Esc']);

/** Prose: at least two words of letters, or one capitalized word that isn't a known name. */
function isProse(text: string): boolean {
  const t = text.trim();
  if (!/\p{L}{2,}/u.test(t)) return false;
  // Code, not text: operators, member access, a leading punctuation mark, or a lowercase key.
  if (/[=;(){}]|=>|&&|\|\||\w\.\w/.test(t) || /^[,:?.|&]/.test(t) || /^[a-z0-9-]+$/.test(t)) return false;
  const words = t.match(/\p{L}+/gu) ?? [];
  if (words.every((w) => NAMES.has(w))) return false;
  return words.length >= 2 || /^\p{Lu}\p{Ll}+$/u.test(words[0] ?? '');
}

function offenders(): string[] {
  const found: string[] = [];
  for (const file of tsxFiles(SRC)) {
    const text = code(readFileSync(file, 'utf8'));
    const name = relative(SRC, file);
    // JSX text follows a tag's `>`; a `=>` or `->` before it is code (a generic, an arrow).
    for (const m of text.matchAll(/(?<![=-])>([^<>{}]+)</g)) {
      const t = m[1] ?? '';
      if (t.includes('\n') && !t.trim()) continue;
      if (isProse(t)) found.push(`${name}: >${t.trim()}<`);
    }
    for (const m of text.matchAll(/\b(aria-label|title|placeholder|label|legend|hint|alt|pendingLabel)="([^"]+)"/g)) {
      if (isProse(m[2] ?? '')) found.push(`${name}: ${m[1]}="${m[2]}"`);
    }
  }
  return found;
}

describe('interface words', () => {
  it('no component carries literal prose: every word goes through a typed catalog', () => {
    expect(offenders()).toEqual([]);
  });
});
