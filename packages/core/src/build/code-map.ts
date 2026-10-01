// A deterministic, symbol-level map of a project's repository at a commit, so the builder knows which
// existing code to extend instead of re-creating it, and so the queue can later reason about module
// overlap between tasks. Inspired by Aider's repo map (https://aider.chat/docs/repomap.html): the
// definitions of each file ranked by a graph of references (PageRank) and rendered compactly within
// a budget. No model is involved: the same commit and query always give the same text.
//
// Sources: ranking is BM25 (Robertson & Zaragoza, "The Probabilistic Relevance Framework: BM25 and
// Beyond", 2009; k1 = 1.2 and b = 0.75 are its usual defaults) over symbol and path tokens, mixed with
// a personalized PageRank (Page & Brin, 1998; damping 0.85) over the import graph. The mixing weights,
// the 200 KB file cap, the module kinds and the symbol caps are our convention. `typescript` here is
// the native 7.x package: it ships no compiler API, so symbols are read with careful line-anchored
// patterns instead of an AST (top-level declarations start at column 0 in formatted code).

import { execFile, spawn } from 'node:child_process';
import { posix } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
// The repositories under /projects are DEMIURGO's own: git must not refuse them for ownership.
const gitArgs = (dir: string, args: string[]) => ['-c', 'safe.directory=*', '-C', dir, ...args];
const git = (dir: string, args: string[]) => run('git', gitArgs(dir, args), { maxBuffer: 64 * 1024 * 1024 });

/** Files above this size say little per byte and slow the map down (our convention). */
export const MAX_MAP_FILE_BYTES = 200 * 1024;
/** Most source files read for one map (our convention: a guard against vendored trees). */
const MAX_MAP_FILES = 4000;
/** Maps kept in memory by commit (our convention). */
const CACHE_SIZE = 8;

export type ModuleKind = 'table' | 'route' | 'page' | 'component' | 'server_action' | 'server_module' | 'lib' | 'test' | 'config';
export type SymbolKind = 'function' | 'component' | 'class' | 'const' | 'type' | 'interface' | 'enum' | 'default' | 'table' | 'model' | 'export';

export type CodeSymbol = {
  name: string;
  kind: SymbolKind;
  exported: boolean;
  /** Call signature or heading shown in the map (`name(params)`), when known. */
  signature?: string;
  /** Columns of a table or model, as `name type`. */
  columns?: string[];
};

export type CodeFile = {
  path: string;
  kind: ModuleKind;
  /** Module ids this file belongs to (see `moduleIdsOf`). */
  modules: string[];
  symbols: CodeSymbol[];
  /** Repository files this file imports (resolved best-effort), without duplicates. */
  imports: string[];
  /** URL of a page or route (`/meals/[id]`, `/api/meals`). */
  route?: string;
};

export type CodeMap = {
  commit: string;
  files: CodeFile[];
  byPath: Map<string, CodeFile>;
  /** Module id → paths of its files. */
  modules: Map<string, string[]>;
  /** Table name → its columns (created and added) and the migrations that touch it. */
  tables: Map<string, { columns: string[]; files: string[] }>;
  /** Importer → imported edges between repository files. */
  edges: Array<[string, string]>;
};

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const SKIP_PATH = [
  /(^|\/)(node_modules|\.git|\.next|\.nuxt|\.svelte-kit|\.turbo|\.worktrees|dist|build|out|coverage|\.cache|vendor)\//,
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/,
  /\.min\.(js|css)$/,
  /\.d\.ts$/,
  /(^|\/)generated\//,
  /(^|\/)__snapshots__\//,
];

const isCode = (p: string) => CODE_EXT.test(p);
const isSql = (p: string) => p.endsWith('.sql');
const isPrisma = (p: string) => p.endsWith('.prisma');

export function kindOfPath(path: string, source = ''): ModuleKind {
  const file = posix.basename(path);
  if (/(^|\/)(tests?|__tests__|e2e|cypress|playwright)\//.test(path) || /\.(test|spec)\.[a-z]+$/.test(file)) return 'test';
  if (isSql(path) || isPrisma(path)) return 'table';
  if (/^(\.?[\w-]+\.)?config\.[a-z]+$/.test(file) || /^\.[\w-]*rc(\.[a-z]+)?$/.test(file) || /^(tsconfig|vite\.config|next\.config|tailwind\.config|postcss\.config|drizzle\.config|vitest\.config|playwright\.config|eslint\.config)/.test(file)) return 'config';
  if (/^route\.(ts|js|mjs)$/.test(file) || /(^|\/)pages\/api\//.test(path)) return 'route';
  if (/^(page|layout)\.(tsx|jsx|ts|js)$/.test(file) || (/(^|\/)pages\//.test(path) && /\.(tsx|jsx)$/.test(file))) return 'page';
  if (/actions?(\.[a-z]+)?$/.test(file.replace(CODE_EXT, '')) || /^['"]use server['"]/m.test(source.slice(0, 400))) return 'server_action';
  if (/\.(tsx|jsx)$/.test(file)) return 'component';
  if (/(^|\/)(server|api|services?|db|database|repositories|repository|queries|models|domain|jobs|workers?)\//.test(path)) return 'server_module';
  return 'lib';
}

/** URL of an app-router page or route, or of a pages-router file; null when the path is not one. */
export function routeOfPath(path: string): string | null {
  const m = /(?:^|\/)(?:src\/)?(app|pages)\/(.*)$/.exec(path);
  if (!m) return null;
  const router = m[1];
  const rest = (m[2] ?? '').replace(CODE_EXT, '');
  let segs = rest.split('/').filter((s) => s !== '');
  if (router === 'app') {
    const last = segs.at(-1);
    if (last === 'page' || last === 'route' || last === 'layout') segs = segs.slice(0, -1);
    else return null;
  } else if (segs.at(-1) === 'index') {
    segs = segs.slice(0, -1);
  }
  segs = segs.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  return `/${segs.join('/')}`;
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '');

/** The balanced parentheses that start at or after `from`, collapsed to one line and shortened. */
function paramsFrom(text: string, from: number): string {
  const open = text.indexOf('(', from);
  if (open < 0 || open - from > 80) return '()';
  let depth = 0;
  let i = open;
  for (; i < Math.min(text.length, open + 400); i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) break;
  }
  const inner = text.slice(open + 1, i).replace(/\s+/g, ' ').replace(/,\s*$/, '').trim();
  if (inner === '') return '()';
  return inner.length > 70 ? '(…)' : `(${inner})`;
}

const isComponentName = (name: string, path: string) => /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(name) && /\.(tsx|jsx)$/.test(path);

export function extractSymbols(path: string, source: string): CodeSymbol[] {
  const text = stripComments(source);
  const out: CodeSymbol[] = [];
  const at = new Map<CodeSymbol, number>();
  let pos = 0;
  const seen = new Set<string>();
  const add = (s: CodeSymbol) => {
    const key = `${s.kind}:${s.name}`;
    if (seen.has(key) || s.name === '') return;
    seen.add(key);
    at.set(s, pos);
    out.push(s);
  };
  const fn = (name: string, at: number, exported: boolean) =>
    add({ name, kind: isComponentName(name, path) ? 'component' : 'function', exported, signature: `${name}${paramsFrom(text, at)}` });

  for (const m of text.matchAll(/^(export\s+)?(default\s+)?(?:declare\s+)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?/gm)) {
    pos = m.index;
    if (m[1] === undefined && m[2] !== undefined) continue;
    const name = m[4] ?? (m[2] ? defaultName(path) : '');
    if (m[2]) add({ name, kind: 'default', exported: true, signature: `default ${name}${paramsFrom(text, m.index)}` });
    else if (name) fn(name, m.index + m[0].length, m[1] !== undefined);
  }
  for (const m of text.matchAll(/^(export\s+)?(default\s+)?(?:declare\s+)?(abstract\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([\w$.]+))?/gm)) {
    pos = m.index;
    add({ name: m[4] as string, kind: m[2] ? 'default' : 'class', exported: m[1] !== undefined, signature: `class ${m[4]}${m[5] ? ` extends ${m[5]}` : ''}` });
  }
  for (const m of text.matchAll(/^(export\s+)?(?:declare\s+)?(const\s+)?(type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm)) {
    pos = m.index;
    if (m[3] === 'type' && m[2]) continue;
    add({ name: m[4] as string, kind: m[3] as SymbolKind, exported: m[1] !== undefined });
  }
  for (const m of text.matchAll(/^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(async\s+)?(\(|function\b|[A-Za-z_$][\w$]*\s*=>|(?:React\.)?(?:memo|forwardRef)\s*[(<]|(?:pg|sqlite|mysql)Table\s*\()?/gm)) {
    pos = m.index;
    const name = m[2] as string;
    const exported = m[1] !== undefined;
    const head = m[4] ?? '';
    if (/Table\s*\($/.test(head)) {
      const t = /\(\s*['"`]([\w."]+)['"`]\s*,\s*\{([\s\S]*?)\n\}/.exec(text.slice(m.index + m[0].length - 1, m.index + m[0].length + 3000));
      add({ name: t?.[1] ?? name, kind: 'table', exported, columns: t ? [...t[2]!.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(\w+)\(/gm)].map((c) => `${c[1]} ${c[2]}`) : [] });
    } else if (head.startsWith('(') || head.startsWith('function') || head.includes('=>')) {
      const params = head.startsWith('(') ? paramsFrom(text, m.index + m[0].length - 1) : head.startsWith('function') ? paramsFrom(text, m.index + m[0].length) : `(${head.replace(/\s*=>$/, '')})`;
      add({ name, kind: isComponentName(name, path) ? 'component' : 'function', exported, signature: `${name}${params}` });
    } else if (/memo|forwardRef/.test(head) && isComponentName(name, path)) add({ name, kind: 'component', exported });
    else if (exported || /^[A-Z][A-Z0-9_]*$/.test(name) || isComponentName(name, path)) add({ name, kind: isComponentName(name, path) ? 'component' : 'const', exported });
  }
  for (const m of text.matchAll(/^export\s+default\s+(?!function\b|class\b|async\b)([A-Za-z_$][\w$]*)\s*;?\s*$/gm)) {
    pos = m.index;
    add({ name: m[1] as string, kind: 'default', exported: true, signature: `default ${m[1]}` });
  }
  for (const m of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}(\s*from\s*['"][^'"]+['"])?/gm)) {
    pos = m.index;
    for (const part of (m[1] as string).split(',')) {
      const names = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
      const name = (names[1] ?? names[0] ?? '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add({ name, kind: 'export', exported: true });
    }
  }
  for (const m of text.matchAll(/^(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/gm)) {
    pos = m.index;
    add({ name: m[1] as string, kind: 'export', exported: true });
  }
  return out.sort((x, y) => (at.get(x) ?? 0) - (at.get(y) ?? 0));
}

const defaultName = (path: string) => {
  const base = posix.basename(path).replace(CODE_EXT, '');
  return base === 'page' || base === 'route' || base === 'layout' || base === 'index' ? posix.basename(posix.dirname(path)) || base : base;
};

const splitTop = (s: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p !== '');
};

const unquote = (n: string) => n.replace(/"/g, '').replace(/^public\./i, '').toLowerCase();
const CONSTRAINT = /^(constraint|primary|foreign|unique|check|like|exclude|index|key)\b/i;

/** `CREATE TABLE name (columns)` and `ALTER TABLE name ADD COLUMN …` of a migration. */
export function extractSql(source: string): CodeSymbol[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, '');
  const byName = new Map<string, CodeSymbol>();
  const table = (name: string): CodeSymbol => {
    let s = byName.get(name);
    if (!s) byName.set(name, (s = { name, kind: 'table', exported: true, columns: [] }));
    return s;
  };
  for (const m of text.matchAll(/create\s+(?:unlogged\s+|temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(/gi)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
    }
    const cols = splitTop(text.slice(start, i - 1))
      .filter((p) => !CONSTRAINT.test(p))
      .map((p) => /^("?\w+"?)\s+(\w+(?:\s*\([^)]*\))?)/.exec(p))
      .filter((c): c is RegExpExecArray => c !== null)
      .map((c) => `${(c[1] as string).replace(/"/g, '')} ${(c[2] as string).replace(/\s+/g, '')}`);
    table(unquote(m[1] as string)).columns!.push(...cols);
  }
  for (const m of text.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+([^;]*);/gi)) {
    for (const part of splitTop(m[2] as string)) {
      const a = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?("?[\w]+"?)\s+(\w+(?:\([^)]*\))?)/i.exec(part);
      if (a && !CONSTRAINT.test(a[1] as string) && !/^add\s+constraint/i.test(part)) table(unquote(m[1] as string)).columns!.push(`${(a[1] as string).replace(/"/g, '')} ${a[2]}`);
    }
  }
  return [...byName.values()];
}

/** `model Name { field Type }` blocks of a Prisma schema. */
export function extractPrisma(source: string): CodeSymbol[] {
  return [...source.matchAll(/^model\s+(\w+)\s*\{([^}]*)\}/gm)].map((m) => ({
    name: (m[1] as string).toLowerCase(),
    kind: 'model' as const,
    exported: true,
    columns: (m[2] as string)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('@') && !l.startsWith('//'))
      .map((l) => l.split(/\s+/).slice(0, 2).join(' ')),
  }));
}

/** Module specifiers a source file imports or requires. */
export function importSpecifiers(source: string): string[] {
  const text = stripComments(source);
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g)) out.add(m[1] as string);
  for (const m of text.matchAll(/\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g)) out.add(m[1] as string);
  return [...out];
}

type Aliases = Array<{ prefix: string; suffix: string; targets: string[] }>;

function aliasesOf(tsconfig: string | undefined): Aliases {
  if (!tsconfig) return [];
  try {
    const json = JSON.parse(stripComments(tsconfig).replace(/,(\s*[}\]])/g, '$1')) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
    const base = (json.compilerOptions?.baseUrl ?? '.').replace(/^\.\/?/, '');
    return Object.entries(json.compilerOptions?.paths ?? {}).map(([pattern, targets]) => {
      const [prefix = '', suffix = ''] = pattern.split('*');
      return { prefix, suffix, targets: targets.map((t) => posix.join(base, t.replace('*', '\u0000'))) };
    });
  } catch {
    return [];
  }
}

const TRY_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js'];

function resolveImport(from: string, spec: string, paths: ReadonlySet<string>, aliases: Aliases): string | null {
  const candidates: string[] = [];
  if (spec.startsWith('.')) candidates.push(posix.join(posix.dirname(from), spec));
  else {
    for (const a of aliases) {
      if (spec.startsWith(a.prefix) && spec.endsWith(a.suffix) && (a.prefix !== '' || a.suffix !== '')) {
        const mid = spec.slice(a.prefix.length, spec.length - a.suffix.length);
        for (const t of a.targets) candidates.push(posix.normalize(t.replace('\u0000', mid)));
      }
    }
    if (spec.startsWith('@/') || spec.startsWith('~/')) candidates.push(`src/${spec.slice(2)}`, spec.slice(2));
  }
  for (const c of candidates) {
    const swapped = c.replace(/\.(js|jsx|mjs)$/, (_, e: string) => (e === 'js' ? '.ts' : e === 'jsx' ? '.tsx' : '.ts'));
    for (const base of [c, swapped]) {
      for (const ext of TRY_EXT) {
        const p = posix.normalize(base + ext);
        if (paths.has(p)) return p;
      }
    }
  }
  return null;
}

function moduleIdsOf(file: { path: string; kind: ModuleKind; symbols: CodeSymbol[]; route?: string }): string[] {
  switch (file.kind) {
    case 'table': {
      const tables = file.symbols.filter((s) => s.kind === 'table' || s.kind === 'model').map((s) => `table:${s.name}`);
      return tables.length > 0 ? tables : [`table:${file.path}`];
    }
    case 'route':
      return [`route:${file.route ?? file.path}`];
    case 'page':
      return [`page:${file.route ?? file.path}`];
    case 'server_action':
      return [`server_action:${file.path}`];
    case 'config':
    case 'test':
      return [`${file.kind}:${file.path}`];
    default:
      return [`${file.kind}:${posix.dirname(file.path)}`];
  }
}

/** Reads many blobs through one `git cat-file --batch`. */
function readBlobs(repo: string, shas: string[]): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', gitArgs(repo, ['cat-file', '--batch']), { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', reject);
    child.on('close', () => {
      const buf = Buffer.concat(chunks);
      const out = new Map<string, string>();
      let pos = 0;
      while (pos < buf.length) {
        const eol = buf.indexOf(10, pos);
        if (eol < 0) break;
        const [sha, type, size] = buf.toString('utf8', pos, eol).split(' ');
        if (type === 'missing' || size === undefined) {
          pos = eol + 1;
          continue;
        }
        const n = Number(size);
        out.set(sha as string, buf.toString('utf8', eol + 1, eol + 1 + n));
        pos = eol + 1 + n + 1;
      }
      resolve(out);
    });
    child.stdin.end(`${shas.join('\n')}\n`);
  });
}

const cache = new Map<string, CodeMap>();

/** The code map of the repository at a commit (a branch name, tag or sha); cached by sha. */
export async function buildCodeMap(repoPath: string, commitish: string): Promise<CodeMap> {
  const sha = (await git(repoPath, ['rev-parse', '--verify', '--quiet', `${commitish}^{commit}`])).stdout.trim();
  const key = `${repoPath}\u0000${sha}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const tree = (await git(repoPath, ['ls-tree', '-r', '-l', '--full-tree', sha])).stdout;
  const entries: Array<{ path: string; blob: string }> = [];
  let tsconfigBlob: string | undefined;
  const allPaths = new Set<string>();
  for (const line of tree.split('\n')) {
    const m = /^\d+ blob ([0-9a-f]+)\s+(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    const path = m[3] as string;
    if (SKIP_PATH.some((re) => re.test(path))) continue;
    allPaths.add(path);
    if (path === 'tsconfig.json') tsconfigBlob = m[1] as string;
    if (!isCode(path) && !isSql(path) && !isPrisma(path)) continue;
    if (Number(m[2]) > MAX_MAP_FILE_BYTES) continue;
    if (entries.length < MAX_MAP_FILES) entries.push({ path, blob: m[1] as string });
  }
  const blobs = await readBlobs(repoPath, [...new Set([...entries.map((e) => e.blob), ...(tsconfigBlob ? [tsconfigBlob] : [])])]);
  const aliases = aliasesOf(tsconfigBlob ? blobs.get(tsconfigBlob) : undefined);
  const codePaths = new Set(entries.filter((e) => isCode(e.path)).map((e) => e.path));
  const files: CodeFile[] = [];
  for (const { path, blob } of entries.sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const source = blobs.get(blob) ?? '';
    const kind = kindOfPath(path, source);
    const symbols = isSql(path) ? extractSql(source) : isPrisma(path) ? extractPrisma(source) : extractSymbols(path, source);
    const imports = isCode(path)
      ? [...new Set(importSpecifiers(source).map((s) => resolveImport(path, s, codePaths, aliases)).filter((p): p is string => p !== null && p !== path))]
      : [];
    const route = kind === 'page' || kind === 'route' ? (routeOfPath(path) ?? undefined) : undefined;
    const file: CodeFile = { path, kind, modules: [], symbols, imports, ...(route ? { route } : {}) };
    // Drizzle-style `pgTable(...)` in a TypeScript file is a table too.
    if (kind !== 'table' && symbols.some((s) => s.kind === 'table')) file.kind = 'table';
    file.modules = moduleIdsOf(file);
    files.push(file);
  }
  const map = assemble(sha, files);
  cache.set(key, map);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return map;
}

/** Builds the indexes of a map from its files (also used by tests). */
export function assemble(commit: string, files: CodeFile[]): CodeMap {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const modules = new Map<string, string[]>();
  const tables = new Map<string, { columns: string[]; files: string[] }>();
  const edges: Array<[string, string]> = [];
  for (const f of files) {
    for (const id of f.modules) modules.set(id, [...(modules.get(id) ?? []), f.path]);
    for (const s of f.symbols) {
      if (s.kind !== 'table' && s.kind !== 'model') continue;
      const t = tables.get(s.name) ?? { columns: [], files: [] };
      for (const c of s.columns ?? []) if (!t.columns.some((x) => x.split(' ')[0] === c.split(' ')[0])) t.columns.push(c);
      t.files.push(f.path);
      tables.set(s.name, t);
    }
    for (const to of f.imports) if (byPath.has(to)) edges.push([f.path, to]);
  }
  return { commit, files, byPath, modules, tables, edges };
}

// ---------------------------------------------------------------------------------------------
// Ranking

const STOP = new Set(
  'a an and are as at be by can for from has have in into is it its of on or that the then this to when with without given should must will not no if so than then there their them they we you your user users able one all any each per via only also new add adds added show shows see use uses used make makes need needs task tasks criterion criteria check checks test tests build built existing code'.split(' '),
);

/** English stemming-lite: lowercase and drop a plural `s` (`meals` → `meal`, `categories` → `category`). */
const stem = (w: string) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Words of an identifier, a path or a text: camelCase, snake_case and kebab-case are split. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2)
    .map(stem);
}

export type RankedFile = { file: CodeFile; score: number; symbols: CodeSymbol[] };

export type RankOptions = {
  /** Paths changed by merged tasks of the same feature or dependencies: boosted. */
  footprintFiles?: readonly string[];
  limit?: number;
  /** Most symbols kept per file (our convention). */
  maxSymbols?: number;
};

const K1 = 1.2;
const B = 0.75;
const DAMPING = 0.85;
const W_RELEVANCE = 1;
const W_GRAPH = 0.5;
const W_FOOTPRINT = 0.5;

function pageRank(paths: string[], edges: Array<[string, string]>, personalization: Map<string, number>): Map<string, number> {
  const n = paths.length;
  const out = new Map<string, string[]>();
  for (const [a, b] of edges) out.set(a, [...(out.get(a) ?? []), b]);
  const total = [...personalization.values()].reduce((x, y) => x + y, 0);
  const tele = (p: string) => (total > 0 ? (personalization.get(p) ?? 0) / total : 1 / n);
  let rank = new Map(paths.map((p) => [p, 1 / n]));
  for (let it = 0; it < 20; it++) {
    const next = new Map(paths.map((p) => [p, (1 - DAMPING) * tele(p)]));
    let dangling = 0;
    for (const p of paths) {
      const r = rank.get(p) ?? 0;
      const targets = out.get(p);
      if (!targets || targets.length === 0) dangling += r;
      else for (const t of targets) next.set(t, (next.get(t) ?? 0) + (DAMPING * r) / targets.length);
    }
    for (const p of paths) next.set(p, (next.get(p) ?? 0) + DAMPING * dangling * tele(p));
    rank = next;
  }
  return rank;
}

/** Files of the map ranked for a task text: BM25 over symbol and path tokens, personalized PageRank over imports, and a boost for the footprint. */
export function rankCodeMap(map: CodeMap, query: string, options: RankOptions = {}): RankedFile[] {
  const limit = options.limit ?? 25;
  const maxSymbols = options.maxSymbols ?? 12;
  const docs = map.files.filter((f) => f.kind !== 'test' && f.kind !== 'config');
  if (docs.length === 0) return [];
  const qTokens = [...new Set(tokenize(query).filter((t) => !STOP.has(t)))];
  const foot = new Set(options.footprintFiles ?? []);
  const termsOf = (f: CodeFile): Map<string, number> => {
    const tf = new Map<string, number>();
    const bump = (text: string, w: number) => {
      for (const t of tokenize(text)) tf.set(t, (tf.get(t) ?? 0) + w);
    };
    bump(f.path.replace(CODE_EXT, ''), 1);
    if (f.route) bump(f.route, 1.5);
    for (const s of f.symbols) {
      bump(s.name, 2);
      for (const c of s.columns ?? []) bump(c.split(' ')[0] as string, 1);
    }
    return tf;
  };
  const tfs = docs.map(termsOf);
  const lens = tfs.map((tf) => [...tf.values()].reduce((a, b) => a + b, 0));
  const avg = lens.reduce((a, b) => a + b, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const q of qTokens) df.set(q, tfs.filter((tf) => tf.has(q)).length);
  const bm25 = docs.map((_, i) => {
    let score = 0;
    for (const q of qTokens) {
      const f = tfs[i]!.get(q) ?? 0;
      if (f === 0) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * lens[i]!) / avg));
    }
    return score;
  });
  const maxBm = Math.max(...bm25, 0);
  const rel = new Map(docs.map((d, i) => [d.path, maxBm > 0 ? (bm25[i] as number) / maxBm : 0]));
  const personalization = new Map<string, number>();
  for (const d of docs) {
    const p = (rel.get(d.path) ?? 0) + (foot.has(d.path) ? 1 : 0);
    if (p > 0) personalization.set(d.path, p);
  }
  const paths = docs.map((d) => d.path);
  const pathSet = new Set(paths);
  const pr = pageRank(paths, map.edges.filter(([a, b]) => pathSet.has(a) && pathSet.has(b)), personalization);
  const maxPr = Math.max(...pr.values(), 0) || 1;
  const hasSignal = maxBm > 0 || foot.size > 0;
  // Files next to a matched one in the import graph (either direction) may be relevant without matching.
  const seeds = new Set([...personalization.keys()]);
  const near = new Set<string>();
  for (const [a, b] of map.edges) {
    if (seeds.has(a)) near.add(b);
    if (seeds.has(b)) near.add(a);
  }
  const ranked: RankedFile[] = [];
  for (const d of docs) {
    const r = rel.get(d.path) ?? 0;
    const f = foot.has(d.path) ? 1 : 0;
    const g = (pr.get(d.path) ?? 0) / maxPr;
    // Without any match or footprint, only the import graph speaks: files nothing imports are noise.
    if (hasSignal && r === 0 && f === 0 && !near.has(d.path)) continue;
    if (!hasSignal && g < 0.1) continue;
    const score = W_RELEVANCE * r + W_FOOTPRINT * f + W_GRAPH * g;
    if (score <= 0) continue;
    const matches = (s: CodeSymbol) => tokenize(s.name).some((t) => qTokens.includes(t));
    const symbols = [...d.symbols]
      .map((s, i) => ({ s, i }))
      .sort((a, b) => Number(matches(b.s)) - Number(matches(a.s)) || Number(b.s.exported) - Number(a.s.exported) || a.i - b.i)
      .slice(0, maxSymbols)
      .sort((a, b) => a.i - b.i)
      .map(({ s }) => s);
    ranked.push({ file: d, score, symbols });
  }
  const top = ranked.sort((a, b) => b.score - a.score || (a.file.path < b.file.path ? -1 : 1)).slice(0, limit);
  // A table is shown whole (every column the migrations gave it) the first time; later files that touch it list only their own columns, marked `+`.
  const shown = new Set<string>();
  return top.map((r) => ({
    ...r,
    symbols: r.symbols.map((s) => {
      if (s.kind !== 'table' && s.kind !== 'model') return s;
      const first = !shown.has(s.name);
      shown.add(s.name);
      return first ? { ...s, columns: map.tables.get(s.name)?.columns ?? s.columns ?? [] } : { ...s, columns: (s.columns ?? []).map((c) => `+${c}`) };
    }),
  }));
}

// ---------------------------------------------------------------------------------------------
// Rendering

const symbolLine = (s: CodeSymbol): string => {
  if (s.kind === 'table' || s.kind === 'model') {
    const cols = (s.columns ?? []).slice(0, 14).join(', ');
    return `${s.kind} ${s.name}(${cols}${(s.columns?.length ?? 0) > 14 ? ', …' : ''})`;
  }
  if (s.signature) return `${s.kind === 'function' || s.kind === 'default' ? '' : `${s.kind} `}${s.signature}`.trim();
  return `${s.kind} ${s.name}`;
};

/** Aider-style compact text: a path, then its symbols indented, within a character budget. */
export function renderCodeMap(ranked: readonly RankedFile[], budgetChars: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const { file, symbols } of ranked) {
    const tag = file.route ? ` [${file.kind} ${file.route}]` : file.kind === 'lib' ? '' : ` [${file.kind}]`;
    const head = `${file.path}${tag}`;
    if (used + head.length + 1 > budgetChars) break;
    const block = [head];
    let size = head.length + 1;
    for (const s of symbols) {
      const line = `  ${symbolLine(s).slice(0, 160)}`;
      if (used + size + line.length + 1 > budgetChars) break;
      block.push(line);
      size += line.length + 1;
    }
    lines.push(...block);
    used += size;
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Overlap (for the queue, not wired yet)

/**
 * What two predicted file sets share in the map: the same files and the same modules (a table, a
 * route, a page, a server action or the lib/component folder). Tests and config do not count.
 */
export function moduleOverlap(filesA: readonly string[], filesB: readonly string[], map: CodeMap): { files: string[]; modules: string[] } {
  const modulesOf = (paths: readonly string[]) => {
    const ids = new Set<string>();
    for (const p of paths) {
      const f = map.byPath.get(p);
      if (f && f.kind !== 'test' && f.kind !== 'config') for (const id of f.modules) ids.add(id);
    }
    return ids;
  };
  const b = new Set(filesB);
  const mb = modulesOf(filesB);
  return {
    files: [...new Set(filesA)].filter((p) => b.has(p)).sort(),
    modules: [...modulesOf(filesA)].filter((id) => mb.has(id)).sort(),
  };
}

/** Characters of the code map in a builder brief: our convention (Aider's default map budget is 1k tokens, about 4k characters, https://aider.chat/docs/repomap.html). */
export const BRIEF_MAP_CHARS = 6000;

/** The brief's lines for the code map, or [] when there is no repository, no commit or nothing relevant. */
export async function codeMapLines(repoPath: string | null, query: string, footprintFiles: readonly string[]): Promise<string[]> {
  if (!repoPath) return [];
  try {
    let ref = 'main';
    try {
      await git(repoPath, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main']);
      ref = 'refs/remotes/origin/main';
    } catch {
      // no remote copy: the local main
    }
    const map = await buildCodeMap(repoPath, ref);
    const text = renderCodeMap(rankCodeMap(map, query, { footprintFiles }), BRIEF_MAP_CHARS);
    return text === '' ? [] : text.split('\n');
  } catch {
    return [];
  }
}
