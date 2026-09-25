# design-sync notes

- **Source: the design-system package, used by the app.** The design system synced here is `packages/design-system` (`@demiurgo/design-system`), which translates the visual language agreed in the canvas «DEMIURGO · UX» into React components. `packages/web` imports it and uses all of it: its components, its `dm-*` classes and its tokens, and nothing else of its own look (`packages/web/test/unit/design-system.test.ts` guards it). It started as `.design-sync/source/` on the `v2-design-sync` branch (25-09-2026) and moved into the monorepo when the web adopted it.
- **What the package holds:**
  - `src/index.tsx`: 22 components (the 21 of the canvas and `Icon`) that render the `dm-*` classes;
  - `demiurgo.css`: every token and class (the `cssEntry`);
  - `fonts.css` and `fonts/`: Instrument Sans and JetBrains Mono, latin subset, SIL OFL, from Google Fonts;
  - `docs/*.md`: the `.prompt.md` source, whose frontmatter `category` sets the group;
  - `guides/*.md`: the guidelines.
- **What the app added (all optional; without them every component renders as in the canvas):**
  - `Header`: `link` (renders the tabs and Needs you as the app's links; Needs you is then always there) and `actions` (search, status, the person's menu); `project` takes any node;
  - `FeatureCard`: `type` (every type uses the template), optional `stage`, `mark`, `bars` and `whoMark` (the app's marks with their tooltips), `width` as any CSS width;
  - `Node`: `mark`; its title keeps one line; `Panel`, `Readiness`, `Proposal`, `WhileAway`: `width` as any CSS width;
  - `Legend`: `onGotIt`, `onToggle`, `onPoint`, `footer`, entry `id`; the ⓘ says "1 new mark" in the singular; the panel scrolls past half the window (52vh, at most 480px);
  - `Readiness`: only warnings means ready (warnings never block); each line carries `data-kind`; item `mark`; `track` (the app's track, or `false`);
  - `Proposal`: `actions` (`null` for none), `children`, `whoMark`, `mark`; no quote when there is no why;
  - `WhileAway`: `title`, `onShowAll`, `note`, item `trailing`, `whoMark` and `id` (as `data-id`); times in `muted`, as the token says for times (`inactive` failed text contrast, 3.6:1);
  - `CheckRow`: `how`, `whoMark` and `warnings` (under the statement, which stays); `Choice`: keyboard (Space, Enter) and `aria-label`;
  - `CertaintyDot`, `StatusMark`, `StageBars`, `WhoMark`: `title` (pass '' when a Tooltip explains the mark);
  - `Button`, `Chip`: `ref` (React 19); `Icon` exported; the `bug` type;
  - `demiurgo.css`: a card title keeps one line and its line two, so a 146px card never overflows.
- **Pending:** the Claude Design project still has the canvas version (bundle `c1e307f2f0ed`). Re-sync it from this package with `/design-sync` when the person asks; the rendered previews do not change, the types and docs gain the props above.
- **Build:** `node packages/design-system/build.mjs` writes `dist/index.js` (esbuild) and `dist/index.d.ts` (ts-morph's bundled TypeScript: TypeScript 7 has no JS API, and a bare `ts.createProgram` can't find the lib files). `dist/` is gitignored; `buildCmd` rebuilds it. The app doesn't need it: it imports `src/index.tsx` directly.
- **`@types/react` resolution:** the converter walks up from the package dir looking for `node_modules/@types/react`; the package has its own now (devDependencies). The build still uses the converter's toolchain in `.ds-sync/node_modules` (esbuild, ts-morph), recreated on each clone.
- **Hand-written props:** `dtsPropsFor.Button` and `dtsPropsFor.Chip` add `onClick`, `disabled` and `type`, which the extractor filters from `ButtonHTMLAttributes`.
- **Wide cards:** `Legend`, `Choice`, `Header` and `CheckRow` use `cardMode: "column"`. The `Header` preview is 640px wide; the component never wraps its text.
- **Guidelines are Markdown only:** the converter skips anything else in `guidelinesGlob`. The 35 reference screens live in the Design System artifact «DEMIURGO» (https://claude.ai/artifact/Aswa8s2WME9aE5M4hsaVLf); `guides/40-screens.md` indexes them.
- Known render warns: none.

## Re-sync risks

- **One source of truth for the look.** The app no longer has a UI of its own: a change to the visual language is a change to `packages/design-system`, which the web picks up and the sync publishes.
- **`conventions.md` names components, props, classes and tokens.** Re-validate every name against the fresh build on each sync.
- **The previews use the club example from the canvas.** It is illustrative, not DEMIURGO's own records.
- **Toolchain:**
  - the build and capture used Playwright 1.63.0 with the cached Chromium 1243;
  - fonts were downloaded once from Google Fonts;
  - npm blocked esbuild's postinstall; it still works through its platform package.
