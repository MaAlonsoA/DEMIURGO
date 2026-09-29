// The brief "Build outside" (spec «Entrega por épicas», 2c): what a ready feature needs to be built by
// someone else (a person or an agent in the project's repository), in English, from its record.

import type { ProductRow, RecordDetail, RecordVersion } from '../../api/types.ts';
import { epicOf } from '../epics/logic.ts';

/** Folder of each record type in the project's `design/` (packages/core/src/design/export.ts). */
const FOLDERS: Record<string, string> = {
  decision: 'decisions',
  adr: 'adr',
  fdr: 'fdr',
  bug: 'bugs',
  epic: 'epics',
  product_definition: 'product',
};

export const designPath = (type: string, code: string) => `design/${FOLDERS[type] ?? 'records'}/${code}.md`;

/** First paragraph of the first section with content, as plain text. */
function goalOf(sections: readonly { title: string; content: string }[]): string {
  const text = sections.find((s) => s.content.trim() !== '')?.content ?? '';
  const paragraph = text.split(/\n\s*\n/).find((x) => x.trim() !== '') ?? '';
  return paragraph
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const sentence = (s: string) => s.trim().replace(/[.\s]+$/, '');

export function buildBrief(record: RecordDetail, version: RecordVersion, rows: readonly ProductRow[]): string {
  const row = rows.find((r) => r.code === record.code);
  const epic = row ? epicOf(row, rows.filter((r) => r.type === 'epic')) : undefined;
  const kind = record.type === 'adr' ? 'decision' : 'feature';
  const lines = [
    `Build ${record.code} "${version.title}" (v${version.n})${epic ? `, a ${kind} of epic ${epic.code} "${epic.title}"` : ''}.`,
    `Design in this repository: ${[designPath(record.type, record.code), ...(epic ? [designPath('epic', epic.code)] : [])].join(' and ')}.`,
    `Goal: ${goalOf(version.sections)}`,
    'Acceptance criteria:',
    ...version.criteria.map(
      (c) => `- ${c.code} · ${c.title}: ${sentence(c.statement)}. Check (${c.verification}): ${sentence(c.check)}.`,
    ),
  ];
  const needs = row?.needs ?? [];
  if (needs.length > 0) {
    const built = (code: string) => rows.find((r) => r.code === code)?.implementation === 'implemented';
    lines.push(`Depends on: ${needs.map((c) => `${c} (${built(c) ? 'built' : 'not built yet'})`).join(', ')}.`);
  }
  lines.push(
    'When done, list each criterion with how it was checked (test name or steps) and the commit.',
    'I will record the evidence in DEMIURGO.',
  );
  return lines.join('\n');
}

/** Copies text, with the old way for pages that are not a secure context. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}
