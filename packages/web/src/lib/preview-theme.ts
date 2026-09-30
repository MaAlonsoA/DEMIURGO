// Theme control for the sandboxed previews. The agents draw dark themes with
// `@media (prefers-color-scheme: dark)` or a hook (`[data-theme="dark"]`, `.dark`). The sandboxed
// frame cannot be told to emulate the media feature, so the media condition is rewritten: it always
// matches when the person asks for dark and never when they ask for light (so the OS theme does not
// leak in). The hook is driven on <html>. Pure, no DOM.

export type PreviewTheme = 'light' | 'dark';

const DARK_MEDIA = /\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi;
const LIGHT_MEDIA = /\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi;
const ALWAYS = '(min-width: 0px)';
// A negative length is invalid in a media query, so the query never matches.
const NEVER = '(max-width: -1px)';

/** Whether the HTML draws a dark theme the viewer can drive. */
export function supportsDark(html: string): boolean {
  return (
    /prefers-color-scheme\s*:\s*dark/i.test(html) ||
    /\[\s*data-theme\s*=\s*["']?dark/i.test(html) ||
    /\.dark(?![\w-])/.test(html)
  );
}

/** The HTML ready to show in the requested theme. */
export function applyPreviewTheme(html: string, theme: PreviewTheme): string {
  const dark = theme === 'dark';
  const rewritten = html
    .replace(DARK_MEDIA, dark ? ALWAYS : NEVER)
    .replace(LIGHT_MEDIA, dark ? NEVER : ALWAYS);
  const hook = dark ? '<html data-theme="dark" class="dark">' : '<html data-theme="light" class="light">';
  const scheme = `<style>:root{color-scheme:${theme}}</style>`;
  return `${hook}${scheme}${rewritten}`;
}
