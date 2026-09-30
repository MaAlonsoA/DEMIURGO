// Public design systems a project can start from, and how a design-system thread says which path it
// takes. URLs and licenses were checked on 2026-09-30 against each project's repository:
//   Primer (GitHub): https://primer.style, github.com/primer/react, MIT.
//   Carbon (IBM): https://www.carbondesignsystem.com, github.com/carbon-design-system/carbon, Apache-2.0.
//   Material 3 (Google): https://m3.material.io (guidelines); github.com/material-components/material-web, Apache-2.0
//     (the license is that of the Material Web code; the guidelines site has its own terms).
//   shadcn/ui: https://ui.shadcn.com, github.com/shadcn-ui/ui, MIT.

export const PUBLIC_DESIGN_SYSTEMS = [
  { name: 'Primer', by: 'GitHub', url: 'https://primer.style', license: 'MIT' },
  { name: 'Carbon', by: 'IBM', url: 'https://www.carbondesignsystem.com', license: 'Apache-2.0' },
  { name: 'Material 3', by: 'Google', url: 'https://m3.material.io', license: 'Apache-2.0 (Material Web code)' },
  { name: 'shadcn/ui', by: 'community', url: 'https://ui.shadcn.com', license: 'MIT' },
] as const;

// Convention nuestra: explorations have no kind field, so a design-system thread is marked by its
// purpose, which always starts with this prefix. The path is in the rest of the purpose.
export const DESIGN_SYSTEM_PURPOSE = 'Design system';

export const designSystemPurpose = (base: string | null): string =>
  base ? `${DESIGN_SYSTEM_PURPOSE}: start from ${base}` : `${DESIGN_SYSTEM_PURPOSE}: from scratch`;

/** The path a design-system thread takes, or null when the purpose is not a design-system thread's. */
export function designSystemPathOf(purpose: string): { kind: 'public'; name: string } | { kind: 'scratch' } | null {
  if (!purpose.startsWith(`${DESIGN_SYSTEM_PURPOSE}:`)) return null;
  const from = /^Design system: start from (.+?)\s*$/m.exec(purpose)?.[1];
  return from ? { kind: 'public', name: from } : { kind: 'scratch' };
}

/** The prefix of the message with which a person picks a visual direction. */
export const CHOOSE_DIRECTION_PREFIX = 'I choose direction: ';
