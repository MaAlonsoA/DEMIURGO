// The deterministic design-system guard (`demiurgo/design`): pure checks that the code of a web
// project uses the approved design system. It never calls a model. Scope: web files (.css, .scss,
// .html, .jsx, .tsx, .vue, .svelte), our convention; other stacks come later.
//
// The rules adapt real linters as DEMIURGO checks (the adaptation is our convention):
//   1. raw values           <- stylelint-declaration-strict-value (only tokens as values).
//   2. raw elements/libs    <- eslint-plugin-primer-react and ESLint `no-restricted-imports`.
//   3. components = manifest and 4. tokens = approval: our convention (nothing in a linter does it;
//      it is what makes "one design system" checkable, so a second SidePanel cannot appear unseen).

import type { DesignSystemSpec } from './design-system.ts';
import { sha256Hex } from './observe.ts';

export type DesignManifest = {
  /** `<record code>@<version number>`, e.g. `DSY-001@2`. */
  version: string;
  paths: { system: string };
  components: { name: string; variants: string[]; states: string[] }[];
  /** sha256 of the canonical tokens.json. */
  tokens_hash: string;
  /** The public base system, if any: its UI library is the only foreign one allowed (rule 2). */
  base?: { kind: 'public' | 'scratch'; name?: string };
};

export type GuardFile = { path: string; content: string };
export type DesignViolation = { rule: 1 | 2 | 3 | 4; path: string; line: number; message: string };
export type DesignGuardResult = { ok: boolean; violations: DesignViolation[] };

/** Where DEMIURGO writes the approved system inside the project's repository. */
export const DESIGN_SYSTEM_DIR = 'design/design-system';
export const DESIGN_MANIFEST_PATH = `${DESIGN_SYSTEM_DIR}/manifest.json`;
export const DESIGN_TOKENS_PATH = `${DESIGN_SYSTEM_DIR}/tokens.json`;

// ── Canonical JSON and the files written to the repo ───────────────────────────────────────────

const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return v;
};

/** Canonical JSON: keys sorted at every level, two spaces, a final newline. */
export const canonicalPrettyJson = (v: unknown): string => `${JSON.stringify(sortKeys(v), null, 2)}\n`;


/** Trailing slash, no leading `./`. */
export const normalizeSystemPath = (p: string | undefined): string => {
  const clean = (p ?? 'src/design-system/').trim().replace(/^\.\//, '').replace(/^\/+/, '');
  return clean.endsWith('/') ? clean : `${clean}/`;
};

/** The manifest and the canonical tokens.json of an approved version. */
export function designSystemArtifacts(
  code: string,
  n: number,
  spec: DesignSystemSpec,
): { manifest: DesignManifest; manifestJson: string; tokensJson: string } {
  const tokensJson = canonicalPrettyJson(spec.tokens);
  const manifest: DesignManifest = {
    version: `${code}@${n}`,
    paths: { system: normalizeSystemPath(spec.paths?.system) },
    components: spec.components.map((c) => ({ name: c.name, variants: c.variants, states: c.states })),
    tokens_hash: sha256Hex(tokensJson),
    base: { kind: spec.base.kind, ...(spec.base.name ? { name: spec.base.name } : {}) },
  };
  return { manifest, manifestJson: canonicalPrettyJson(manifest), tokensJson };
}

export const designSystemReadme = (manifest: DesignManifest): string =>
  [
    '# Design system',
    '',
    `Written by DEMIURGO from the approved version ${manifest.version}. Do not edit these files: change the system in DEMIURGO, approve a new version and they are rewritten.`,
    '',
    '- `tokens.json`: the design tokens (W3C Design Tokens format, canonical JSON with sorted keys).',
    '- `manifest.json`: the version, where the system lives, its components with variants and states, and the sha256 of `tokens.json`.',
    '',
    'Rules the build checks (`demiurgo/design`, our convention adapted from stylelint-declaration-strict-value and eslint-plugin-primer-react):',
    '',
    '1. Outside the system folder, no raw colors, durations, easings, font sizes, radii or shadows: use tokens.',
    '2. Outside the system folder, no raw `<button>`, `<input>`, `<select>`, `<textarea>` or `<dialog>` and no other UI library: use the system components.',
    `3. \`${manifest.paths.system}\` holds exactly the components of the manifest, one file per component named like it. A new component needs a new approved version.`,
    '4. A `tokens.json` inside the system folder must be the approved one (same sha256 as `tokens_hash`).',
    '',
  ].join('\n');

// ── Rule helpers ────────────────────────────────────────────────────────────────────────────────

const WEB_FILE = /\.(css|scss|html|jsx|tsx|vue|svelte)$/;
const SKIPPED = /(^|\/)(node_modules|design|\.demiurgo|\.git|dist|build)\//;
const TEST_FILE = /(\.(test|spec|stories)\.[a-z]+$)|(^|\/)(__tests__|tests?|e2e|stories)\//;

const isCssLike = (path: string) => /\.(css|scss)$/.test(path);

// Rule 2 (eslint `no-restricted-imports`): the UI libraries a project must not bring beside its system.
const FOREIGN_LIBS: { prefix: string; id: string; aliases: string[] }[] = [
  { prefix: '@mui/', id: 'mui', aliases: ['mui', 'materialui'] },
  { prefix: 'antd', id: 'antd', aliases: ['antd', 'antdesign'] },
  { prefix: '@chakra-ui/', id: 'chakra', aliases: ['chakra'] },
  { prefix: '@mantine/', id: 'mantine', aliases: ['mantine'] },
  { prefix: 'react-bootstrap', id: 'bootstrap', aliases: ['bootstrap'] },
  { prefix: '@headlessui/', id: 'headlessui', aliases: ['headlessui'] },
  { prefix: '@radix-ui/', id: 'radix', aliases: ['radix', 'shadcn'] },
  { prefix: 'primereact', id: 'primereact', aliases: ['primereact', 'primefaces'] },
];

const RAW_ELEMENT = /<(button|input|select|textarea|dialog)(?=[\s>/])/g;

const NON_ZERO_NUMBER = /(?<![\w.-])(\d*\.?\d+)(px|rem|em|pt|%|ms|s)?(?![\w-])/g;
const hasNonZero = (value: string): boolean => {
  for (const m of value.matchAll(NON_ZERO_NUMBER)) if (Number.parseFloat(m[1] as string) !== 0) return true;
  return false;
};
const stripVars = (s: string) => s.replace(/var\([^)]*\)/g, '').replace(/env\([^)]*\)/g, '');

/** Lines that are only a comment. */
const isCommentLine = (line: string) => /^\s*(\/\/|\/\*|\*|<!--)/.test(line);

function rawValues(path: string, line: string): string[] {
  const out: string[] = [];
  const body = stripVars(line);
  const css = isCssLike(path);

  // Colors: hex (not an id selector or anchor), rgb/hsl/oklch functions with literal arguments.
  if (!(css && /^\s*#/.test(line))) {
    for (const m of body.matchAll(/(?<=[[\s:'"`(,=])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g)) {
      const before = body.slice(0, m.index);
      if (/(href|to|src|for|id|htmlFor|hash)\s*=\s*['"{]*$/.test(before)) continue;
      out.push(`Raw color ${m[0]}: use a color token.`);
    }
  }
  for (const m of body.matchAll(/\b(rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(([^)]*)\)/g)) {
    out.push(`Raw color ${m[0]}: use a color token.`);
  }

  // Motion: durations in transition/animation declarations, and literal cubic-bezier curves.
  if (/cubic-bezier\(/.test(body)) out.push('Raw easing cubic-bezier(...): use a motion.easing token.');
  const motion = /\b(transition|animation)[\w-]*\s*[:=]\s*(.*)$/i.exec(body);
  if (motion) {
    for (const m of (motion[2] as string).matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)(?![\w-])/g)) {
      if (Number.parseFloat(m[1] as string) !== 0) out.push(`Raw duration ${m[0]}: use a motion.duration token.`);
    }
  }

  // Sizes: font-size, border-radius and box-shadow literals (`0`, `none`, `inherit` are fine).
  const props: { re: RegExp; what: string; token: string }[] = [
    { re: /(?:^|[\s;{"'])(font-size|fontSize)\s*[:=]\s*([^;}]*)/i, what: 'font size', token: 'typography.size' },
    { re: /(?:^|[\s;{"'])(border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius|borderRadius)\s*[:=]\s*([^;}]*)/i, what: 'radius', token: 'radius' },
    { re: /(?:^|[\s;{"'])(box-shadow|boxShadow)\s*[:=]\s*([^;}]*)/i, what: 'shadow', token: 'shadow' },
  ];
  for (const { re, what, token } of props) {
    const m = re.exec(body);
    if (!m) continue;
    const value = (m[2] as string).trim();
    if (/^['"`]?\s*(none|inherit|initial|unset)\s*['"`]?[,]?$/i.test(value)) continue;
    if (hasNonZero(value)) out.push(`Raw ${what} (${m[1]}: ${value.replace(/[,{]\s*$/, '')}): use a ${token} token.`);
  }
  return out;
}

function importsIn(line: string): string[] {
  const found: string[] = [];
  for (const re of [/\bfrom\s+['"]([^'"]+)['"]/, /\bimport\s+['"]([^'"]+)['"]/, /\brequire\(\s*['"]([^'"]+)['"]\s*\)/, /@import\s+(?:url\()?['"]([^'"]+)['"]/]) {
    const m = re.exec(line);
    if (m) found.push(m[1] as string);
  }
  return found;
}

const compact = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function libraryAllowed(lib: { aliases: string[] }, manifest: DesignManifest): boolean {
  const base = compact(manifest.base?.name);
  return base !== '' && lib.aliases.some((a) => base.includes(a));
}

const COMPONENT_FILE = /^([A-Z][A-Za-z0-9]*)\.(tsx|jsx|vue|svelte)$/;
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

// ── The guard ──────────────────────────────────────────────────────────────────────────────────

/**
 * Checks the web files of a project against the approved design system. `tokens` is the approved
 * tokens.json content (parsed); the manifest is the one written next to it.
 */
export function designGuard(files: GuardFile[], manifest: DesignManifest, tokens: unknown): DesignGuardResult {
  const violations: DesignViolation[] = [];
  const system = normalizeSystemPath(manifest.paths.system);
  const inSystem = (path: string) => path.startsWith(system);
  const add = (rule: DesignViolation['rule'], path: string, line: number, message: string) => violations.push({ rule, path, line, message });

  // Rule 4: the approved tokens themselves are intact (the repo copy is the one DEMIURGO wrote).
  if (sha256Hex(canonicalPrettyJson(tokens)) !== manifest.tokens_hash) {
    add(4, DESIGN_TOKENS_PATH, 1, `${DESIGN_TOKENS_PATH} does not match the approved tokens of ${manifest.version}: change tokens in DEMIURGO, not in the repo.`);
  }

  const seen = new Map<string, string>();
  for (const file of files) {
    const path = file.path.replace(/^\.\//, '');
    if (SKIPPED.test(path) || TEST_FILE.test(path)) continue;

    if (inSystem(path)) {
      // Rule 3: one PascalCase component file per manifest component.
      const m = COMPONENT_FILE.exec(basename(path));
      if (m && !seen.has(m[1] as string)) seen.set(m[1] as string, path);
      // Rule 4: a tokens file inside the system must be the approved one.
      if (basename(path) === 'tokens.json') {
        let hash: string | null = null;
        try {
          hash = sha256Hex(canonicalPrettyJson(JSON.parse(file.content)));
        } catch {
          hash = null;
        }
        if (hash !== manifest.tokens_hash) add(4, path, 1, `${path} does not match the approved tokens (${manifest.version}): tokens_hash differs.`);
      }
      continue;
    }

    if (!WEB_FILE.test(path)) continue;
    const lines = file.content.split('\n');
    lines.forEach((text, i) => {
      if (isCommentLine(text)) return;
      const n = i + 1;
      // Rule 1: raw values.
      for (const message of rawValues(path, text)) add(1, path, n, message);
      // Rule 2: raw elements and foreign UI libraries.
      if (!isCssLike(path)) {
        for (const el of text.matchAll(RAW_ELEMENT)) add(2, path, n, `Raw <${el[1]}>: use the design system's component (${system}) instead.`);
      }
      for (const spec of importsIn(text)) {
        const lib = FOREIGN_LIBS.find((l) => spec === l.prefix || spec.startsWith(l.prefix));
        if (lib && !libraryAllowed(lib, manifest)) add(2, path, n, `Import of "${spec}": another UI library, not the approved design system.`);
      }
    });
  }

  // Rule 3: every component under paths.system is in the manifest. An approved component with no
  // file yet is fine: components are built when a task first needs them (our convention), so the
  // walking skeleton is not blocked by the whole library.
  const approved = new Set(manifest.components.map((c) => c.name));
  for (const [name, path] of seen) {
    if (!approved.has(name)) add(3, path, 1, `${name} is not in the approved design system: propose adding it in DEMIURGO`);
  }

  violations.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.rule - b.rule);
  return { ok: violations.length === 0, violations };
}
