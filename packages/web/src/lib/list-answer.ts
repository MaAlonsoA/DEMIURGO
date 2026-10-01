// A list answer ("name two or three things") is kept as one item per line. The thread joins the
// options it picks with « · » (screens/thread/answers.ts), so both are read as items. Pure.

const BULLET = /^\s*(?:[-*•]\s+)/;

/** The items of a list answer: one per line or joined with « · ». Bullet marks and empty lines are dropped. */
export function listItems(text: string): string[] {
  return text
    .split(/\n| · /)
    .map((l) => l.replace(BULLET, '').trim())
    .filter(Boolean);
}

/** Whether a line is already one of the lines typed in the box. */
export function hasLine(text: string, line: string): boolean {
  const wanted = line.trim();
  return text.split('\n').some((l) => l.trim() === wanted);
}

/**
 * The box after clicking a suggestion of a list question: its line is added at the end, or removed when
 * it is already there. What the person typed stays.
 */
export function toggleLine(text: string, line: string): string {
  const wanted = line.trim();
  if (!wanted) return text;
  const lines = text.split('\n');
  if (hasLine(text, wanted)) return lines.filter((l) => l.trim() !== wanted).join('\n').trim();
  const kept = text.replace(/\s+$/, '');
  return kept ? `${kept}\n${wanted}` : wanted;
}

/** The text as Markdown for reading: several items become a bullet list; one stays as written. */
export function asBullets(text: string): string {
  const items = listItems(text);
  return items.length < 2 ? text : items.map((i) => `- ${i}`).join('\n');
}
