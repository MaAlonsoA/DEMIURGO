# design-sync notes

- **Source: the canvas, not the app.** The design system synced here is `.design-sync/source/`, a small package (`@demiurgo/design-system`) that translates the visual language agreed in the canvas «DEMIURGO · UX» into React components. It is not `packages/web`: the person did not want the current frontend synced (25-09-2026).
- **What the package holds:**
  - `src/index.tsx`: 21 components that render the `dm-*` classes;
  - `demiurgo.css`: every token and class (the `cssEntry`);
  - `fonts.css` and `fonts/`: Instrument Sans and JetBrains Mono, latin subset, SIL OFL, from Google Fonts;
  - `docs/*.md`: the `.prompt.md` source, whose frontmatter `category` sets the group;
  - `guides/*.md`: the guidelines.
- **Build:** `node .design-sync/source/build.mjs` writes `dist/index.js` (esbuild) and `dist/index.d.ts` (ts-morph's bundled TypeScript: TypeScript 7 has no JS API, and a bare `ts.createProgram` can't find the lib files). `dist/` is gitignored; `buildCmd` rebuilds it.
- **`@types/react` resolution:** the converter walks up from the package dir looking for `node_modules/@types/react`. Recreate the link on each clone, or `Button`/`Chip` lose their inherited props:
  - Windows: `New-Item -ItemType Junction .design-sync/node_modules -Target .ds-sync/node_modules`;
  - elsewhere: `ln -sfn ../.ds-sync/node_modules .design-sync/node_modules`.
- **Hand-written props:** `dtsPropsFor.Button` and `dtsPropsFor.Chip` add `onClick`, `disabled` and `type`, which the extractor filters from `ButtonHTMLAttributes`.
- **Wide cards:** `Legend`, `Choice`, `Header` and `CheckRow` use `cardMode: "column"`. The `Header` preview is 640px wide; the component never wraps its text.
- **Guidelines are Markdown only:** the converter skips anything else in `guidelinesGlob`. The 35 reference screens live in the Design System artifact «DEMIURGO» (https://claude.ai/artifact/Aswa8s2WME9aE5M4hsaVLf); `guides/40-screens.md` indexes them.
- **First upload was tokens-only;** the second added the components into the same project.
- Known render warns: none.

## Re-sync risks

- **Two sources of truth for the look.** `demiurgo.css` and `src/index.tsx` come from the canvas; `packages/web` has its own UI. If the app becomes the source later, switch `pkg`/`entry` to it, keep `projectId`, re-verify everything, and retire `.design-sync/source/`.
- **`conventions.md` names components, props, classes and tokens.** Re-validate every name against the fresh build on each sync.
- **The previews use the club example from the canvas.** It is illustrative, not DEMIURGO's own records.
- **Toolchain:**
  - the build and capture used Playwright 1.63.0 with the cached Chromium 1243;
  - fonts were downloaded once from Google Fonts;
  - npm blocked esbuild's postinstall; it still works through its platform package.
