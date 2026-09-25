# Decisions log: frontend rebuild

Autonomous run started 2026-09-25 on branch `ux/frontend-rebuild-2026-09-25` (created from `v2.1`
at `5a3243d`). Every decision that would normally be a question for Marcos is logged here with the
alternatives, the reason and its source. Newest decisions go at the bottom.

Format: **D-NNN · title**, then *Decision*, *Alternatives*, *Why* and *Source*.

---

**D-001 · The product is DEMIURGO v2 as the repo describes it, not the brief's "SDLC orchestrator"**
- *Decision:* treat the repository (VISION.md, AGENTS.md, CLAUDE.md, the v2.1 patch log) as the
  source of truth for what the product is. The brief describes "an 11-state Linear state machine
  (Backlog → … → Failed) across design, implementation, adversarial review and integration, with
  agents in git worktrees". No such thing exists in this codebase or its API. The "pipeline state"
  that DESIGN.md must represent is DEMIURGO's own set of state machines: agent runs, proposals and
  batches, record certainty and readiness, knowledge updates and the live connection.
- *Alternatives:* (a) invent the 11 states in the UI, with no data behind them; this would break
  parity and add features. (b) Stop and ask, which the brief forbids.
- *Why:* when Marcos pasted the brief he added, in the session: "tienes toda la visión de que
  estamos construyendo en el repo y los últimos cambios" ("you have the whole vision of what we're
  building in the repo, and the latest changes"). The brief's context section is stale. It matches
  the discarded v1 (`git show v1-referencia:…`).
- *Source:* session message; `AGENTS.md` §1; `VISION.md` §1–3; `git log v2..v2.1`.

**D-002 · Frontend boundary**
- *Decision:* IN = `packages/web` (every screen, component, style and test). OUT = `packages/api`,
  `core`, `domain`, `design`, `mcp` (backend: consumed as-is). `packages/design-system` (the
  published "DEMIURGO" design system synced with Claude Design through `.design-sync/`) is **not
  reused and not modified**: the brief forbids reusing existing tokens, styles and components, and
  the package is a published asset that other tools read. `packages/web` stops depending on it.
  `frontend/` and `app/` at the repo root are gitignored v1 leftovers: OUT.
- *Alternatives:* rewrite `packages/design-system` in place. That would silently change what is
  published to Claude Design and break the `.design-sync` flow.
- *Why:* smallest scope that satisfies "fresh visual language" without touching shared assets.
- *Source:* brief §Scope; CLAUDE.md §Arquitectura (`packages/design-system`).

**D-003 · Work in the shared folder, on a branch, without a worktree**
- *Decision:* create `ux/frontend-rebuild-2026-09-25` in `D:\Dev\Demiurgo` itself. At the end,
  switch the folder back to `v2.1`.
- *Consequence:* the live instance on port 8100 runs `vite build --watch` on this folder. While the
  branch is checked out, 8100 serves the rebuilt (work-in-progress) web against the real data. The
  API is unaffected because no server file changes. Switching back to `v2.1` at the end restores
  the patch workflow and the UI Marcos uses. To see the rebuild later, run
  `git checkout ux/frontend-rebuild-2026-09-25` and 8100 rebuilds itself.
- *Uncommitted work found:* `packages/core/agents/{designer,explorer,onboarding}/AGENT.md` and
  `packages/core/src/providers/{claude,codex}.ts` hold uncommitted v2.1 patch work (agents allowed
  to research on the web). It is never staged or committed here (pathspec commits only) and it
  stays in the working tree across branch switches.
- *Alternatives:* a git worktree. It would isolate 8100, but Marcos's standing rule is "one
  project, one folder, switch branches in the same folder; no worktrees".
- *Why:* the brief says Marcos is away, the companion session is read-only (single writer), and the
  standing rule forbids worktrees.
- *Source:* memory `un-proyecto-una-carpeta`, `commits-directorio-compartido`; CLAUDE.md §Instancia 8100.

**D-004 · Languages**
- *Decision:* code, comments and `docs/ux-rebuild/*` in English (the brief is explicit). UI text in
  English (the brief, AGENTS.md and the v2 UI decision agree). Commit messages use conventional
  prefixes (`feat(web): …`) with the description in Spanish (repo rule; the brief only requires
  conventional format).
- *Alternatives:* Spanish docs (repo rule for `docs/`); English commits.
- *Why:* the brief overrides for its own deliverables and says nothing about commit language.
- *Source:* brief §Phase 3; AGENTS.md §Idioma.

**D-005 · Process on this branch**
- *Decision:* the CLAUDE.md "Modo V2.1" rules (no docs, `patch:` commits, push to `origin/v2.1`)
  govern branch `v2.1` only. On this branch the brief governs: research → inventory → design →
  implementation, conventional atomic commits, **never push**. Design skills (asterion, palantir,
  frontend-design) and process skills that require asking questions are not loaded.
- *Source:* brief §What to use; CLAUDE.md ("manda en la rama `v2.1`").

**D-006 · Verification baseline and the gates used after each commit**
- *Found at start (before any change):* `gate:types` passes and `vitest --project web` passes
  (31 files, 162 tests). `gate:lint` fails with 10 errors, 5 of them in `packages/core` and 5 in
  `packages/web/src/screens/thread/*`. `gate:format` fails on 26 files, 15 of them backend. These
  are pre-existing failures from the v2.1 patches, which only require `gate:types`.
- *Decision:* after each commit, these must pass:
  1. `pnpm gate:types`;
  2. `oxlint --type-aware --deny-warnings packages/web`;
  3. `biome format packages/web`;
  4. `vitest run --project web`;
  5. a production `vite build` into a scratch `--outDir`.

  The build must not go to `packages/web/dist`: 8100's watcher writes there, and two builds empty
  each other's output. Backend lint and format failures are out of scope and left as found.
- *Source:* baseline run logs; memory `qa-instancia-8101` (two watchers clobber `dist`).

**D-007 · E2E baseline before the rebuild**
- *Found:* `playwright test` on the untouched `v2.1` web: **70 passed, 21 failed** (7.1 min). The
  21 failures predate this work: the v2.1 patches changed behaviour without updating the tests
  (patch mode does not run e2e). The failing specs are:
  - `batch` AC-INT-001-12 and -13;
  - `blueprint` AC-INT-001-09 ×2, AC-WEB-001-03, screens;
  - `fidelity` AC-WEB-001-03;
  - `needs-you` AC-INT-001-11, -14 and -16;
  - `onboarding` AC-INT-001-01 ×2, -09, AC-WEB-001-03, screens;
  - `record` AC-INT-001-08 ×2;
  - `runs` AC-INT-001-10;
  - `threads` AC-INT-001-09 and -04;
  - `views` AC-INT-002-05/06/07.
- *Decision:* E2E is not a per-commit gate. It runs against the rebuilt screens at the end of each
  screen group. Each spec is rewritten for the new UI, keeping its AC code and intent. When a
  baseline failure is a stale expectation (the behaviour changed on purpose in v2.1), the rewritten
  spec asserts the current behaviour. A test that still fails for a reason outside the frontend is
  reported as such, not deleted.
- *Why:* the brief's per-commit gate covers "typecheck, lint, tests and production build". E2E
  takes about 7 minutes and needs the dev Postgres. Its value is as a parity oracle per screen.

**D-008 · Keep the data layer and the pure product logic; rebuild everything visual**
- *Decision:*
  - **Kept:** `api/*` (client, queries, commands, stream, tables, progress, views, models, dev),
    `words.ts` (the product dictionary agreed with Marcos), and the pure, unit-tested modules that
    encode product rules. Examples: `needs-you/order.ts`, `origins/tree.ts`,
    `overview/lens/lines.ts`, `onboarding/day.ts`, `batch/model.ts`, `knowledge/graph.ts`,
    `blueprint/search.ts`, `thread/timeline.ts`, `record/logic.ts`, `models/engines.ts`.
  - **Rebuilt:** every component, layout, style and screen.
  - **Changed** in the logic, where the inventory found product bugs: the search ref for every record
    prefix, and the live refresh of map, journeys, lens and projects. Every other change is
    presentation.
- *Alternatives:* rewrite the logic too. That risks behaviour drift and loses 160 unit tests of
  product rules.
- *Why:* the brief says to read the old frontend "only to extract routes, features, displayed data
  and API or event contracts". These modules *are* that contract, already encoded. None of them is a
  design pattern.
- *Source:* brief §What to use; INVENTORY Part A "Useful pure helpers already unit-tested".

**D-009 · No new dependencies: an own icon set and system fonts**
- *Decision:*
  - Icons are hand-drawn SVG components on one 24-unit grid (`components/icons.tsx`).
  - Type uses the system UI and mono stacks.
  - Nothing is added to `package.json`. The design-system package and its web fonts are no longer
    imported (at the end of the rebuild).
- *Alternatives:* `lucide-react`, or a web font such as Inter.
- *Why:*
  - The brief says to add a dependency only when it is clearly justified.
  - A `pnpm install` in the shared folder could restart the live API on 8100 in the middle of an
    agent run (CLAUDE.md, Cuota).
  - System fonts render natively and cost nothing; Primer follows the same practice (R35).
- *Source:* brief §Scope; CLAUDE.md.

**D-010 · Theme: light first, follow the OS, let the person pin one**
- *Decision:*
  - Every token has a light and a dark value (`light-dark()`).
  - The page follows `prefers-color-scheme`.
  - The person menu offers System / Light / Dark, stored in localStorage (a per-browser
    preference).
- *Alternatives:* light only; dark only.
- *Why:*
  - DEMIURGO is read more than it is monitored, and light polarity reads better for most people
    (R61).
  - Research C recommends following the OS with an override (Disagreement C4).
  - It is presentation, not a product feature.
- *Source:* R61, REFERENCES Disagreements C4.

**D-011 · Derived run states "Late" and "Stalled", and the sidebar failure count**
- *Decision:*
  - **Late:** a queued run older than 60 s.
  - **Stalled:** a running run for which this tab has seen no `run.progress` for 90 s, counting from
    when the page opened if it has seen none. Both states are shown as the UI's reading ("no sign of
    activity for 2 min").
  - **The sidebar "failed" count** includes only failed or interrupted runs finished in the last
    24 h that no retry points to.
- *Alternatives:* no stuck signal (the old UI); server-side stalled detection (B-01, out of scope).
- *Why:*
  - "Running vs stuck vs failed" is an explicit requirement of the brief.
  - Linear, Prefect and Temporal all surface stale or late states (R29, R09, R06).
  - The agents' time limits are 300–600 s, so 90 s without a single provider event is abnormal.
  - Counting every failure ever would nag forever.
- *Source:* brief §Phase 2; R29, R09, R06.

**D-012 · Park, Drop and Reopen come back to the thread, in each question's "More" menu**
- *Decision:* each question card in the thread gets a "More actions" menu with Park, Drop and
  Reopen, gated by the tables like every action.
- *Alternatives:* leave them only in Needs you and on the record's Questions tab, as v2.1 does.
- *Why:*
  - Patch `1ba0431` removed the questions column, and with it these three actions. The commands
    exist, the tables allow them, and the e2e AC-INT-001-09 still expects them in the thread.
  - A menu restores them without bringing the clutter back.
- *Source:* INV-THR-60; R23 (two ways into each task).

**D-013 · Composer keys and the "reply" trap**
- *Decision:* in every composer:
  - **Enter** runs the composer's main action: Send in the thread, Send in Go deeper, Ask in the
    "Ask DEMIURGO" boxes;
  - **Shift+Enter** inserts a new line;
  - in the thread, **Ctrl/⌘+Enter** is "Ask DEMIURGO";
  - hints are always visible.

  The thread composer always writes to the thread. It answers a question only after the person
  chooses "Answer in my own words", and then shows a visible "Answering: … ×" chip.
- *Alternatives:* keep Ctrl+Enter in the thread (the old behaviour, inconsistent with Go deeper and
  the Ask boxes).
- *Why:*
  - One convention everywhere (R93).
  - Plain Send in the thread spends no quota, and asking DEMIURGO stays an explicit act.
  - The old default reply mode silently turned messages into drafts (INVENTORY §2 #8).
- *Source:* INVENTORY §2 #8, #9; R23, R28.

**D-014 · The legend becomes Help, in one fixed place**
- *Decision:*
  - The self-opening legend is removed.
  - "?" and the Help button in the sidebar footer open a dialog. It explains every state symbol, the
    "who" marks and the readiness track, and lists the keyboard shortcuts.
  - Every badge on screen carries its word, so no symbol needs the legend to be understood.
- *Alternatives:* keep the legend overlay.
- *Why:* it covered actions and needed "Got it" before each test (INVENTORY §2 #1). Help belongs in
  a consistent place (R88).
- *Source:* R88, R91, R73.

**D-015 · "Point, peek, keep" becomes Open + Preview**
- *Decision:*
  - A card's title is a link, so one click opens it, everywhere.
  - A visible "Preview" button opens the same facts in a side panel. It works by keyboard, Esc
    closes it and focus returns to the button.
  - There is no hover-delay popover.
- *Alternatives:* keep the hover peek and add keyboard focus to it.
- *Why:* the peek mixed click semantics and hid actions from the keyboard (INVENTORY §2 #14).
  Supplementary information stays available without leaving the page (R51, R59).
- *Source:* R51, R59, R91, R93.

**D-016 · Implementation in parallel by screen group**
- *Decision:*
  - The shell and the component kit are built and committed first.
  - Then subagents rebuild the screens in six groups in parallel, each on a disjoint folder:
    1. Needs you and batches;
    2. threads;
    3. activity, runs and settings;
    4. overview and records;
    5. map, journeys, origins, knowledge and sources;
    6. Day 1 and the pages outside a project.
  - Subagents never commit. I run the gates and commit each group with pathspec once the wave's
    working tree passes them.
  - The old `ui/` and the design-system stylesheet stay until the last screen moves, then go in one
    final commit.
- *Consequence:* a per-commit gate runs on the working tree at the end of a wave, not on each
  commit's isolated snapshot. The groups are disjoint, and the old shared code stays until the end,
  so every intermediate commit also builds on its own.
- *Why:* 594 parity items over about 20,000 lines. Serial work would not fit the run.

**D-017 · Transition styling**
- *Decision:* until the final commit, `styles.css` loads both the old design-system stylesheet (for
  screens not yet rebuilt) and the new tokens, theme and base. The new token names never collide with
  the old ones.
  - `test/unit/design-system.test.ts` enforced "use every design-system component". It is replaced
    by `test/unit/tokens.test.ts`: contrast of every token pair, no raw colors, no unknown tokens,
    and only theme sizes, radii and shadows.
- *Why:* every intermediate commit keeps a working app; the replaced test gets a replacement in the
  same commit (brief §Verification).

**D-018 · Build order, and which pieces are shared**
- *Decision:* the commits follow this order:
  1. tokens;
  2. component kit;
  3. shell and navigation;
  4. the pieces several groups share: `QuestionActions`, `AskBox`, `PreviewSheet`;
  5. screens, in groups, in order of job priority (J1…J5).

  The brief puts the shell before the components. Here the kit's primitives come first because the
  shell is built from them. The screen-level components come after the shell, as the brief asks.
- *Also:* two e2e tests moved, unchanged, to the spec of the screen that owns them, so that each
  group owns its specs: "up to date" moved to `up-to-date.spec.ts`, and "what connects to a record"
  moved to `record-incoming.spec.ts`. The overview and record groups were merged into one agent (g4)
  because `fidelity.spec.ts` covers both.
- *Why:* the shell needs buttons, menus, dialogs and tooltips. Pieces used by several groups are
  built once, so there is one vocabulary: the question verbs, and one Ask box in one place (R88).

**D-019 · Security finding on uncommitted v2.1 work, outside this rebuild (not acted on)**
- *Found:* an automated security review flagged the uncommitted changes described in D-003:
  - `packages/core/src/providers/claude.ts` now runs `--tools WebSearch,WebFetch --allowedTools WebSearch,WebFetch`;
  - `packages/core/src/providers/codex.ts` now runs `web_search="live"`.

  Agents can therefore fetch arbitrary URLs from this machine, including loopback and private
  addresses: the API on 8100, Postgres on 55432/55433, and cloud metadata. Fetched pages can also
  carry prompt injection.
- *Decision:* not touched. It is someone else's work in progress, outside the frontend scope, and
  neither staged nor committed here.
- *Suggested:* keep only `WebSearch`, or restrict `WebFetch` with an allowlist or an egress proxy
  that denies loopback, RFC1918, link-local and metadata addresses. Enable it per invocation rather
  than as a global default.
- *Source:* the automated security review during this run.

**D-020 · Activity and the run page (group g3)**
- *Decision:*
  - Cancel on the run page asks first ("Cancel this run?"). It says the run stops now, nothing is
    applied, and what it wrote in the thread stays. The buttons are "Cancel the run" and "Keep it
    running".
  - The run's events move to their own tab; the side column keeps Details and Attempts.
  - Retry is the primary next step, except after `invalid_output`, where the page suggests Retry with….
  - The phase strip stops where the failure happened: `agent_error` and `timeout` at Model;
    `invalid_output` and `stale_knowledge` at Result; an interrupted or cancelled run at Result if an
    engine call answered, otherwise at Model.
  - Attempt numbers follow the retry chain.
- *Alternatives:* cancel with no confirmation (the old behaviour); events in the side column.
- *Why:* cancelling loses the running work, so it is a destructive step that says what is kept, in a
  modal dialog (R95); the person stays in control of what the agent does (R24). One primary action per
  view (DESIGN §6). A long event list in a narrow column pushed Details out of sight.
- *Source:* DESIGN §3.4, §4; report g3.

**D-021 · Map, Origins and Knowledge (group g5)**
- *Decision:*
  - On the map, pointing at or focusing a card lights its connections in the accent tint. Nothing is
    dimmed.
  - Each relation line has its own pattern and an arrowhead, so colour is never the only cue: needs
    solid, follows dotted, conflicts dash-dot in danger, affects dashed in info, and "under review" a
    wide amber band.
  - The keys + − 0 zoom; Fit can enlarge up to 130 %.
  - In Origins, tracing and opening are separate: a click or Enter pins the trace, and the Why panel
    opens the record or thread. The trace never follows the pointer.
  - Knowledge's tabs replace history instead of adding to it. The type filter is a radio group.
- *Alternatives:* dimming the rest of the map; opening on click in Origins (the old behaviour).
- *Why:* colour is never the only cue, and the lines keep their contrast (R90); everything works from
  the keyboard (R93), and what appears on hover or focus stays put (R91). A trace that follows the
  pointer cannot be used with a keyboard, and a click that both traces and navigates loses the trace.
- *Source:* DESIGN §3.6–3.8; report g5.

**D-022 · Sign in, Your projects and Day 1 (group g6)**
- *Decision:*
  - Sign in validates on submit and explains a missing field under it, instead of a silently disabled
    button.
  - With a session already open, `/sign-in` goes straight on to `safeNext(next)`.
  - Cancelling a Day 1 reading confirms first, like the run page (D-020).
  - The one-question walk uses Park from the shared vocabulary (§4.4).
  - Multi-select answers follow the thread's rule: the options joined with " · " in their order, and
    the person's own words last. An exclusive option stands alone.
  - New project keeps its draft, and the ids already created, per tab in sessionStorage. Once the
    project exists, the name is read-only with a hint.
  - "Review the decisions" opens Needs you when the waiting decisions span several batches.
  - Pages outside a project use a top bar that reflows on a phone: the links go to a second line and
    the person's menu shrinks to its avatar.
- *Alternatives:* keep the disabled button; a separate Day 1 cancel rule.
- *Why:* errors are identified and explained in text, and the page reflows at 320 CSS px (WCAG 2.2,
  R82). What the person already typed is never asked for again (R87), and a second project created by
  a retry is lost work (INVENTORY §2 #10).
- *Source:* DESIGN §3.9; report g6.

**D-023 · Needs you as a queue and a detail, and the batch pages (group g1)**
- *Decision:*
  - Needs you is a split view: the queue on the left is a single-select listbox, and the detail on
    the right holds the decision bar. Under 1280 px it is one column with "Back to Needs you".
  - The queue never reorders under the person: new items join the end of their group.
  - After a decision the item leaves, the result is announced ("… n left in Needs you"), and focus
    moves to the next item. Needs you follows successful commands in the mutation cache, because the
    component that ran the command has already unmounted.
  - Catch up keeps its walk in sessionStorage for 2 hours. The Catch up button, Leave and "Back to
    Needs you" reset it; any other entry resumes it, so a package opened from Catch up leads back.
  - A blocked Accept stays visible and inactive, with its reason. Only the link verdict "Out of date"
    asks first; Keep and Mark as changed run at once. "Accept my version" keeps a single confirmation
    that lists the changed fields.
  - After a decision on a batch page, the page moves to the next pending proposal. An unsaved Change
    is guarded, both in the page and on route change.
  - The 4-item "In this order" preview is dropped (INV-NEED-05, PARTIAL): Catch up's walk shows the
    order.
- *Alternatives:* keep the dense list with inline buttons; a separate triage screen.
- *Why:* the inbox and triage pattern from Linear, GitHub and the LangChain Agent Inbox (R19, R30,
  R33). Results are status messages (R80), and the listbox follows the keyboard interface (R93). A
  control that vanishes explains nothing; an inactive one with its reason does.
- *Source:* DESIGN §3.1, §3.2; report g1.

**D-024 · Threads and the thread (group g2)**
- *Decision:*
  - The Threads list is a treegrid with a state filter. The filter keeps the threads a match sits
    inside, so the nesting still reads. With no threads, "New thread" lives only in the empty state.
  - "Confirm and send" tries every item and reports each one; what fails stays as a draft
    (INV-THR-41 changed).
  - While the composer answers a question, Ask DEMIURGO is hidden and Ctrl+Enter keeps the answer. A
    picked radio option can't be clicked off, so a Clear button removes the draft.
  - A Go deeper run's observations stay in its side conversation. Go deeper stays open, with a notice,
    when its question is settled elsewhere.
  - The working card shows one clock, the run's. Cancel confirms as on the run page (D-020). The
    failed card puts the fitting retry first.
  - Under 1024 px, the side column and Go deeper open as sheets.
  - Drafts sync across tabs, and are dropped when their question or suggestion is settled elsewhere.
- *Alternatives:* a flat list with indentation only; stop "Confirm and send" at the first failure.
- *Why:* the tree follows the treegrid pattern (R98), and the conversation is a log whose additions
  are announced (R92). What the person wrote is never lost or asked for again (R87). Draft review
  before sending follows Gerrit's drafts (R68).
- *Source:* DESIGN §3.3; report g2.
