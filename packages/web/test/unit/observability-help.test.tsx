import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HELP_TOPICS, OBS_HELP } from '../../src/screens/observability/help.i18n.ts';
import { SectionHelp } from '../../src/screens/observability/help.tsx';

describe('Observability section help', () => {
  it('renders a help button with an accessible name for every topic', () => {
    for (const topic of HELP_TOPICS) {
      const html = renderToStaticMarkup(<SectionHelp topic={topic} title="Some section" />);
      expect(html).toContain(`data-help-topic="${topic}"`);
      expect(html).toContain('aria-label="Help: Some section"');
      expect(html).toContain('<button type="button"');
    }
  });

  it('has the four parts, in English and Spanish, for every topic', () => {
    for (const locale of ['en', 'es'] as const) {
      const t = OBS_HELP[locale];
      for (const topic of HELP_TOPICS) {
        for (const part of ['Measures', 'How', 'Read', 'Source'] as const) {
          const text = t[`${topic}${part}`];
          expect(text.length, `${locale} ${topic}${part}`).toBeGreaterThan(20);
        }
        // the source says whose convention it is, or cites a work
        expect(t[`${topic}Source`], `${locale} ${topic}`).toMatch(/convención nuestra|decisión de la persona|Google|Kan|Brier|Guo|DORA|Kohavi|FinOps/);
      }
    }
  });
});
