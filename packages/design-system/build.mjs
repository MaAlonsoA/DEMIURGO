// Builds the DEMIURGO design-system package: dist/index.js (ESM, React external) and dist/index.d.ts.
// Uses the converter's own toolchain in .ds-sync/node_modules (esbuild, typescript, @types/react).
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const nm = resolve(here, '..', '..', '.ds-sync', 'node_modules');
const require = createRequire(join(nm, 'noop.js'));
const esbuild = require('esbuild');
const { ts } = require('@ts-morph/common');

await esbuild.build({
  entryPoints: [join(here, 'src', 'index.tsx')],
  outfile: join(here, 'dist', 'index.js'),
  bundle: true,
  format: 'esm',
  target: 'es2020',
  jsx: 'transform',
  external: ['react', 'react-dom'],
  logLevel: 'warning'
});

// ts-morph carries the TypeScript lib files in memory; a bare ts.createProgram can't find them on disk.
const { Project } = require('ts-morph');
const project = new Project({
  compilerOptions: {
    declaration: true,
    emitDeclarationOnly: true,
    outDir: join(here, 'dist'),
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2020,
    lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
    strict: true,
    skipLibCheck: true,
    typeRoots: [join(nm, '@types')],
    paths: { react: [join(nm, '@types', 'react')] }
  }
});
project.addSourceFileAtPath(join(here, 'src', 'index.tsx'));
const diags = project.getPreEmitDiagnostics();
if (diags.length) {
  console.error(project.formatDiagnosticsWithColorAndContext(diags));
  process.exit(1);
}
await project.emit();
console.log('built dist/index.js and dist/index.d.ts');
