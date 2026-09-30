import { describe, expect, it } from 'vitest';
import { applyPreviewTheme, supportsDark } from '../../src/lib/preview-theme.ts';

const MEDIA = '<style>body{color:#111}@media (prefers-color-scheme: dark){body{color:#eee}}</style><p>x</p>';

describe('preview theme', () => {
  it('detects the dark hooks the agents draw', () => {
    expect(supportsDark(MEDIA)).toBe(true);
    expect(supportsDark('<style>[data-theme="dark"] body{}</style>')).toBe(true);
    expect(supportsDark('<style>.dark .a{}</style>')).toBe(true);
    expect(supportsDark('<style>.dark-blue{}</style><p>plain</p>')).toBe(false);
    expect(supportsDark('<p>plain</p>')).toBe(false);
  });

  it('makes the dark media query always match in dark and never in light', () => {
    const dark = applyPreviewTheme(MEDIA, 'dark');
    expect(dark).toContain('@media (min-width: 0px)');
    expect(dark).not.toContain('prefers-color-scheme');
    expect(dark).toContain('data-theme="dark"');
    expect(dark).toContain('color-scheme:dark');
    const light = applyPreviewTheme(MEDIA, 'light');
    expect(light).toContain('@media (max-width: -1px)');
    expect(light).toContain('color-scheme:light');
  });

  it('keeps compound queries valid and flips the light query', () => {
    const html = '@media screen and (prefers-color-scheme:dark){a{}} @media (prefers-color-scheme: light){b{}}';
    const dark = applyPreviewTheme(html, 'dark');
    expect(dark).toContain('screen and (min-width: 0px)');
    expect(dark).toContain('(max-width: -1px)');
  });
});
