# Inventory: requirements and parity checklist

Phase 1 of the frontend rebuild (2026-09-25). This file lists every route, feature, displayed entity,
user action and API or event call in the frontend as it was on `v2.1` at `5a3243d`, before the
rebuild. It is the **parity checklist**: every `INV-…` item must exist in the rebuilt frontend, and
§4 records its final status.

Four read-only passes over `packages/web` produced it:
- Part A: shell, auth, projects, Day 1, settings and the live stream;
- Part B: product views and knowledge;
- Part C: threads, runs and activity;
- Part D: Needs you, batches and records.

They cite file:line evidence and the e2e and unit tests that cover each item. The current frontend
was read only as a source of requirements, never as a design reference.

**594 checklist items** in 29 areas:

| Areas | Items | Part |
| --- | --- | --- |
| SHELL 62 · AUTH 10 · PROJ 8 · ONB 53 · MODELS 21 · KEYS 11 · DEV 11 · LIVE 13 | 189 | A |
| OVW 30 · LENS 12 · BP 33 · MAP 13 · ORIG 12 · JRN 8 · KNOW 26 · SRC 4 | 138 | B |
| THRS 12 · THR 60 · FORK 8 · DEEP 14 · RUN 21 · ACT 11 | 126 | C |
| PROP 21 · NEED 25 · CATCH 14 · BATCH 22 · REC 31 · NEWREC 14 · NEWVER 14 | 141 | D |

## 1. Routes

| Route | Search params | Screen | Items |
| --- | --- | --- | --- |
| `/sign-in` | `next` | Sign in | INV-AUTH-05…10 |
| `/` | — | Landing: `/new`, `/p/:id` or `/projects` | INV-PROJ-01 |
| `/projects` | — | Your projects | INV-PROJ-02…07 |
| `/new` | — | New project ("What do you want to build?") | INV-ONB-01…12 |
| `/models` | — | Models & providers, workspace scope | INV-MODELS-* |
| `/p/:id` | — | Product overview (+ lens) | INV-OVW-*, INV-LENS-* |
| `/p/:id/map` | — | Map | INV-MAP-* |
| `/p/:id/origins` | — | Origins | INV-ORIG-* |
| `/p/:id/journeys` | `j` | Journeys | INV-JRN-* |
| `/p/:id/records/:code` | `v`, `tab` | Record (+ rail, questions, checks, history) | INV-REC-*, INV-BP-* |
| `/p/:id/records/new` | `type` | New record | INV-NEWREC-* |
| `/p/:id/records/:code/new-version` | — | New version | INV-NEWVER-* |
| `/p/:id/threads` | — | Threads | INV-THRS-* |
| `/p/:id/threads/:explorationId` | — | Thread (+ forks, Go deeper) | INV-THR-*, INV-FORK-*, INV-DEEP-* |
| `/p/:id/needs-you` | `catch-up=1` | Needs you, Catch up, You're up to date | INV-NEED-*, INV-CATCH-* |
| `/p/:id/batches/:batchId` | — | Batch: item, package or import | INV-BATCH-*, INV-PROP-* |
| `/p/:id/activity` | `state` | Activity | INV-ACT-* |
| `/p/:id/runs/:runId` | — | Run | INV-RUN-* |
| `/p/:id/knowledge` | `tab` | Knowledge | INV-KNOW-* |
| `/p/:id/sources` | — | Sources | INV-SRC-* |
| `/p/:id/models` | — | Models & providers, project scope | INV-MODELS-* |
| `/p/:id/agent-keys` | — | Agent keys | INV-KEYS-* |
| `/p/:id/start/:explorationId` | — | Day 1: reading, what I understood | INV-ONB-13…30 |
| `/p/:id/start/:explorationId/questions` | — | Day 1: one question at a time (unlinked since `4af77f1`) | INV-ONB-31…44 |
| `/p/:id/start/:explorationId/done` | — | Day 1: your starting point | INV-ONB-45…53 |
| any other | — | Not found | INV-SHELL-07, 08 |

**API surface used.** All of it is kept as it is:
- REST queries under `/api/…`: see Part A, "Shared data layer notes".
- One command route, `POST /api/projects/:id/commands/:command`.
- `POST /api/projects`.
- The session routes.
- The models routes (`/api/providers`, `/api/agents/:agent/assignment`).
- The dev routes.
- The SSE stream `/api/projects/:id/events/stream?from=latest`, with the `ready` event, one event
  name per command, and `run.progress`.

## 2. Main UX problems, judged against the research

These are the problems that shaped the design most. The evidence (file:line in the old frontend) is
in the parts below, and REFERENCES.md has the sources.

| # | Problem | Evidence | What the research says |
| --- | --- | --- | --- |
| 1 | The legend of marks opens by itself on every screen and covers the bottom-left actions; tests must fold it first | `ui/Legend.tsx:55`; `e2e/needs-you.spec.ts:38`; `e2e/batch.spec.ts:138` | Content on hover or focus must not obscure; focus not obscured [R83][R91]; help belongs in one consistent place [R88] |
| 2 | Mark tooltips (the meaning of every state) can't be reached by keyboard: marks are non-focusable `span role=img` | `ui/marks.tsx:57-61`; `ui/signals.tsx:31-35` | Hover content must also appear on focus, and essential information must not live only in a tooltip [R91]; status needs a text label [R73][R39] |
| 3 | Freshness, stage steps and several states are conveyed by dot color or borders only | `screens/shell/Header.tsx:109-114`; `needs-you/CatchUp.tsx:123-136` | At least 3 of symbol, shape, color and text [R73] |
| 4 | The page never goes below 1280 px (`min-width: 1280px`), so nothing reflows | `src/styles.css:95-99` | WCAG 1.4.10 Reflow [R82] |
| 5 | Fetch errors render as empty states ("No threads yet", "No runs yet", "There are no projects yet"); Map and Journeys show the error *and* the empty state | `threads/Threads.tsx:53-59`; `activity/Activity.tsx:60-100`; `projects/Projects.tsx:29-32`; `map/Map.tsx:69-73` | Distinguish loading, empty and error [R57][R44] |
| 6 | The Needs you count does not match its rows (a package counts each proposal) | `core/src/queries/read.ts:246` vs `needs-you/order.ts:120` | Consistent, honest status [R56]; the attention set explains itself [R69] |
| 7 | Two different orders for "what blocks more": Overview column vs Catch up | `overview/needs.ts:126-178` vs `needs-you/order.ts:141-157` | One mental model; consistency [R51] |
| 8 | The thread composer silently turns free text into a draft answer ("Send" becomes "Use as answer") | `thread/Thread.tsx:80-82`; `thread/Composer.tsx:64-69,166` | Clarify, don't assume [R23]; visible system status [R56] |
| 9 | Inconsistent send keys: Ctrl+Enter in the thread, Enter in Go deeper and in the Ask bar | `thread/Composer.tsx:95-100`; `thread/ThreadQuestions.tsx:467-472`; `ui/AskBar.tsx:124-129` | Consistent keyboard conventions [R93][R28] |
| 10 | Park, Drop and Reopen of a question are no longer reachable from the thread (removed with the questions column) | INV-THR-60; `threads.spec.ts` AC-INT-001-09 stale | Two ways into each task; don't strand the user [R23][R51] |
| 11 | The same question actions have different names on different screens (Park/Drop/Change vs Not now/Doesn't apply/Answer differently); "Not now" is also every dialog's cancel | `ui/QuestionItem.tsx:67-75`; `blueprint/QuestionsTab.tsx:146-150` | Don't invent terms; one vocabulary [R32] |
| 12 | A stuck run can't be told from a slow one; only a timer | `thread/RunCards.tsx:42-53`; `run/Run.tsx:211-220` | Surface stale or stalled states; progress evidence over 10 s [R29][R09][R54] |
| 13 | Output and context of a run are raw JSON dumps; the facts' provenance lives in hover-only `title`s | `run/Run.tsx:68-80,334-336`; `run/Engine.tsx:47-82` | Summary first, raw on demand [R28][R05]; no hover-only essentials [R91] |
| 14 | The "peek" on product cards: click keeps it (no navigation) on some cards and navigates on others; its Open and Cancel can't be reached by keyboard | `ui/Peek.tsx:86-114`; `overview/Overview.tsx:68-73` | Consistent interaction; keyboard parity [R93]; supplementary info without leaving the screen [R51] |
| 15 | The package's accept buttons sit far from the content they approve; unsaved Change edits are lost on Previous/Next | `batch/DemiurgoPackage.tsx:44`; `batch/ItemBatch.tsx:149` | Decision next to evidence; don't lose input [R13][R87] |
| 16 | The guided review dims the other parts to 35 % opacity, failing contrast (axe has to exclude them); its "Confirm" opens a dialog that says "Approve" | `record/Review.tsx:42,272-328`; `e2e/fidelity.spec.ts:13-19` | Contrast [R89]; consistent labels [R32] |
| 17 | The lens dims everything unchanged to 40 %, including what needs the person; its lines are not links | `overview/RecordCard.tsx:188`; `lens/WhileAway.tsx:27-50` | Change highlighting near focus without dimming the rest [R60]; Catch up links to what happened [R24][R81] |
| 18 | Map, Journeys, the lens and the project name never update live | `api/stream.ts:13-34` | Visibility of system status [R56] |
| 19 | The disconnected banner can say "Retrying…" forever after the stream is refused (401), and there is no manual retry | `api/stream.ts:104-107` | Degraded state, honest, with a way forward [R76][R77] |
| 20 | Search can't open requirement, quality, threat or production records (REQ, NFR, THR, PRR) and shows them with the wrong icon; a search error closes the dropdown that holds it | `blueprint/search.ts:12`; `ui/icons.tsx:111-114`; `ui/Reasons.tsx:63-65` + `shell/Search.tsx:147` | Findability; errors next to their cause [R44] |
| 21 | No per-route page title and no focus management on route change | `index.html:7`; `onboarding/Start.tsx:97-100` | Keyboard interface and landmarks [R93][R94]; status in the tab [R34] |
| 22 | The person menu mixes personal and project settings; Sign out is missing outside a project | `shell/Header.tsx:198-231`; `projects/Projects.tsx:15-27` | Scope-consistent navigation [R31][R34] |
| 23 | Day 1 shows rejected or out-of-date proposals as "Accepted" | `onboarding/Start.tsx:303-306`; `onboarding/Reading.tsx:245` | Never show success that isn't [R56][R78] |
| 24 | Destructive or decisive actions without confirmation (Cancel a run, Pass stage, Discard all drafts, link verdicts), while others double-confirm | `thread/RunCards.tsx:116-126`; `thread/ThreadQuestions.tsx:169-171`; `batch/ProposalActions.tsx:123,255` | Match friction to risk [R22]; convey consequences [R20]; Stop says what is kept [R27] |
| 25 | Resizable side panel: no `aria-valuemax`, no Home/End, invisible drag strip | `ui/layout.tsx:101-113` | Dragging alternatives [R85]; APG keyboard [R93] |

## 3. The inventory

Parts A–D follow as the four passes wrote them. Checklist IDs are stable. The final status of each
item is in §4.

## Part A · Shell, auth, projects, Day 1, settings, live stream


Parity checklist of `packages/web` (branch `ux/frontend-rebuild-2026-09-25`, HEAD `5a3243d`, which is the V2.1 patch line). Paths are relative to `packages/web/` unless stated. "Cmd" means `POST /api/projects/:projectId/commands/<name>` with body `{ entity_id?, data }` via `runCommand`/`useCommand` (`src/api/commands.ts`).

Areas: SHELL (root, header, search, shared overlays and UI primitives), AUTH, PROJ, ONB (New project and Day 1), MODELS, KEYS, DEV, LIVE.

---

### 0. App root and global overlays (every route)

#### App root: every route, including `/sign-in`
- Purpose: wraps every screen with tooltips, the legend of marks, the dev tools, the skip link and the global 401 handling (`src/screens/shell/AppRoot.tsx`).

- **INV-SHELL-01** "Skip to content" link. It is the first Tab stop, visible only on focus, and jumps to `#main`. Every screen's main region uses `id="main"` (`AppRoot.tsx:32-37`, `ui/layout.tsx:27`, `onboarding/parts.tsx:32`, `SignIn.tsx:58`).
- **INV-SHELL-02** Tooltip provider. Tooltips appear after 250 ms, and the next one within 150 ms appears without the delay (`ui/Tip.tsx:8-14`). `Tip` shows the design system's dark tooltip on hover or focus of its trigger (`Tip.tsx:16-35`).
- **INV-SHELL-03** The Legend of marks is mounted on every screen (see §9, INV-SHELL-40…47).
- **INV-SHELL-04** The Dev tools tab and panel are mounted on every screen when the session announces dev tools (see §15).
- **INV-SHELL-05** Router behaviour:
  - scroll restoration between routes;
  - routes are preloaded on hover or focus ("intent") with no preload cache (`router.tsx:209-217`);
  - one static document title, "DEMIURGO", for all routes (`index.html:7`).
- **INV-SHELL-06** Query defaults:
  - `staleTime` is 5 s;
  - there is no refetch on window focus;
  - 4xx answers are never retried, and other failures are retried twice (`main.tsx:9-18`).

- Real-time: none directly.
- States: n/a.
- Tests:
  - the skip link is used by `e2e/session.spec.ts:58` (AC-WEB-001-03, keyboard-only sign-in);
  - axe runs on every screen via `expectAccessible` (`e2e/support/fixtures.ts:129`).
- UX problems:
  - There is no per-route `document.title`, so every tab and history entry reads "DEMIURGO" (`index.html:7`; there is no `document.title` anywhere in `src/`).
  - There is no focus management or screen-reader announcement on route change. Focus stays on the clicked link, or is lost to `<body>` when the clicked element unmounts (for example `onboarding/Start.tsx:97-100`, where "See what I understood" unmounts itself).

---

### 1. Session guard, landing and sign-out (AUTH)

#### Session guard: every route except `/sign-in`
- Purpose: an internal route without a session goes to Sign in, keeping where the person was going.

- **INV-AUTH-01** Guard. The `authed` layout route runs `ensureQueryData(sessionQuery)`. If there is no session it redirects to `/sign-in?next=<location.href>` (`router.tsx:54-61`). `sessionQuery` is `GET /api/session`: a 401 maps to `null` and clears the CSRF token, and the result is cached for 60 s (`api/queries.ts:57-73`).
- **INV-AUTH-02** Session loss anywhere. Any `request()` other than `/api/session` that answers 401 fires `onUnauthorized` (`api/client.ts:62`). `AppRoot` then sets the session cache to `null` and navigates to `/sign-in?next=<current href>`, unless it is already on sign-in (`AppRoot.tsx:19-27`).
- **INV-AUTH-03** Session survives reload. The CSRF token lives in memory only (`client.ts:19-22`). After a reload it comes back from `GET /api/session` (`{ actor, type, csrf, dev_tools? }`).
- **INV-AUTH-04** Sign out, from the person menu (`Header.tsx:170-178, 226-231`):
  1. `DELETE /api/session` (the call is tolerant of failure);
  2. `setCsrf(null)`;
  3. `queryClient.clear()`;
  4. navigate to `/sign-in` (without `next`).

- Tests:
  - `e2e/session.spec.ts:13` (AC-INT-001-02: redirect, return after sign-in, a 401 after sign-out);
  - `e2e/session.spec.ts:45` (AC-INT-001-02: reload keeps the session and can still write with CSRF).
- UX problems:
  - Sign out exists only inside a project (the person menu). `/projects`, `/new` and `/models` have no person menu and no Sign out (`Projects.tsx:15-27`, `NewProject.tsx:101-113`, `ModelsAndProviders.tsx:46-56`).
  - `ensureQueryData` trusts a cached session for up to 60 s. An expired server session is only discovered on the next API call (`queries.ts:72`, `router.tsx:58`).

#### Landing: `/`
- Purpose: decides where DEMIURGO opens.
- **INV-PROJ-01** `GET /api/projects` (`projectsQuery`) decides the destination (`router.tsx:65-73`, `onboarding/landing.ts:6-10`):
  - no projects: go to `/new` ("What do you want to build?");
  - exactly one project: go to `/p/:id`;
  - more than one: go to `/projects`.
- Tests: `e2e/onboarding.spec.ts:346` (AC-INT-001-02: no projects opens on `/new`); `unit/onboarding-day.test.ts:315`.

---

### 2. Sign in: `/sign-in` (search `?next=<internal path>`)
- Purpose: a centred card with DEMIURGO's wordmark, the title "Sign in", and the User and Password fields (`screens/sign-in/SignIn.tsx`).

- **INV-AUTH-05** Form:
  - "User" (`autocomplete=username`, required);
  - "Password" (`type=password`, `autocomplete=current-password`, required) (`SignIn.tsx:70-98`).
- **INV-AUTH-06** The "Sign in" button is disabled until both fields have text, and reads "Signing in…" while pending. Enter in either field submits (`SignIn.tsx:99-101`).
- **INV-AUTH-07** Submit sends `POST /api/session { username, password }` and gets back `{ person, csrf, expires }`. It stores the CSRF token and seeds the session cache (`{actor:{type:'human',person}, type:'person', csrf}`). It then refetches the session in the background, which is how `dev_tools` arrives, awaits the projects invalidation, and pushes `safeNext(next)` (`SignIn.tsx:31-45`).
- **INV-AUTH-08** `safeNext` follows only in-app paths. It rejects empty values, values that do not start with `/`, `//…`, and `/sign-in…`, falling back to `/` (`SignIn.tsx:14-17`).
- **INV-AUTH-09** A 401 shows "Wrong user or password." (`role=alert`). The user is kept and the password is cleared (`SignIn.tsx:46-48, 102-106`).
- **INV-AUTH-10** Any other error shows `Reasons` in product words; for example, a network failure reads "Can't reach DEMIURGO. Check your connection and try again." (`SignIn.tsx:47, 107`; `ui/Reasons.tsx:23-24`).

- Real-time: none.
- States: pending, wrong credentials, and other errors. There is no loading state before the form.
- Tests:
  - `e2e/session.spec.ts:13` (AC-INT-001-02: wrong password keeps the user);
  - `e2e/session.spec.ts:58` (AC-WEB-001-03: keyboard only);
  - `e2e/session.spec.ts:86` (screenshot of cut 0 plus axe).
- UX problems:
  - Visiting `/sign-in` while signed in still shows the form, because the route is unguarded (`router.tsx:44-52`, and `SignIn.tsx` has no session check).
  - There is no autofocus on "User"; the test has to Tab past the skip link (`session.spec.ts:66-67`).
  - The submit button is silently disabled while a field is empty, with no hint (`SignIn.tsx:99`).
  - The "Dev" tab is hidden here even with dev tools on, because the session is null (`DevTools.tsx:45-48`).

---

### 3. Your projects: `/projects`
- Purpose: choose a project. It is reached when there are two or more projects, or through "Switch" (`screens/projects/Projects.tsx`).

- **INV-PROJ-02** The page header shows the DEMIURGO wordmark and the h1 "Your projects" (`Projects.tsx:15-19`).
- **INV-PROJ-03** Link "Models & providers" goes to `/models` (the workspace scope) (`Projects.tsx:21-23`).
- **INV-PROJ-04** Link "New project", styled as a secondary button, goes to `/new` (`Projects.tsx:24-26`).
- **INV-PROJ-05** Project list from `projectsQuery` (`GET /api/projects`, returning `Project{id,name,state,created_at}`). Each row is a card link to `/p/:id` showing the name, "Created <d Mon>", and a chevron (`Projects.tsx:34-49`).
- **INV-PROJ-06** Loading shows a skeleton with the label "Loading projects" (`Projects.tsx:29-30`).
- **INV-PROJ-07** Empty state: "There are no projects yet. Start one with New project." (`Projects.tsx:31-32`).

- Real-time: none. `['projects']` sits outside the `['p', id]` tree, and the stream is not open here.
- States: loading and empty. **Error is not handled.**
- Tests:
  - `e2e/models.spec.ts:40` (the link to Models & providers);
  - `e2e/onboarding.spec.ts:346` (New project from here);
  - `e2e/project.spec.ts:5` (the renamed name shows here after Switch).
- UX problems:
  - A failed `GET /api/projects` renders the empty state "There are no projects yet", because `isPending` is false and `data` is undefined (`Projects.tsx:29-32`). This is misleading.
  - There is no person menu or Sign out on this page (§1).
  - `Project.state` is never shown, so archived and active projects look identical.
  - There is no sort, search or last-activity column: the list shows only name and creation date.

---

### 4. Not found: any unknown route, an unknown project, or inline in screens
- Purpose: says what was not found and offers a way back (`screens/not-found/NotFound.tsx`).

- **INV-SHELL-07** Heading "We couldn't find {thing}." (default "this page"), an optional explanation, and a way back:
  - inside a project: "Back to the product", which goes to `/p/:projectId`;
  - otherwise: "Back to DEMIURGO", which goes to `/` (`NotFound.tsx:7-24`).
- **INV-SHELL-08** An unknown project id means the `/p/$projectId` loader cannot find it in `projectsQuery` and throws `notFound()` (`router.tsx:84-92`). Day 1 screens reuse the component inline:
  - "this idea" (the Start screen);
  - "these questions" (the Questions screen);
  - "this day" (the Done screen);

  in each case with "It may belong to another project."

- Tests: `e2e/session.spec.ts:86` (`/p/:id/does-not-exist` plus axe).
- UX problems:
  - For an unknown project id, `useParams` still carries `projectId`, so "Back to the product" probably links back to the same missing project and 404s again (`NotFound.tsx:8,13-16`).
  - The loader uses `ensureQueryData`, which returns cached projects. A project created in another tab or by the API may 404 until the list is refetched (`router.tsx:89`). `NewProject` works around this explicitly (`NewProject.tsx:88-89`).

---

### 5. Project shell: `/p/:projectId/*`
- Purpose: every project screen gets the sticky header, the connection banner and the event stream (`screens/shell/ProjectShell.tsx`, `Header.tsx`).

#### 5.1 Header (always visible, sticky at the top, z-30)
- **INV-SHELL-09** The DEMIURGO wordmark and the project name (`projectsQuery`). The name is truncated at 220 px (`Header.tsx:57-59`).
- **INV-SHELL-10** "Switch" is shown only when the person has more than one project, and goes to `/projects` (`Header.tsx:60-64`).
- **INV-SHELL-11** "New project" is always shown, and goes to `/new` (`Header.tsx:65-67`).
- **INV-SHELL-12** Section tabs, a nav with `aria-label="Sections"` (`Header.tsx:28-35, 70`). Each tab has `aria-current="page"` when current:

  | Tab | Destination | Also current on |
  |---|---|---|
  | Product | `/p/:id` | `/origins`, `/records/*`, `/map`, `/journeys` |
  | Threads | `/p/:id/threads` | |
  | Knowledge | `/p/:id/knowledge` | |
  | Sources | `/p/:id/sources` | |
  | Activity | `/p/:id/activity` | `/runs/*` |

- **INV-SHELL-13** "Needs you" link, to the right of the actions. It goes to `/p/:id/needs-you` and is current also on `/batches/*`. It shows the blue count bubble from `inboxQuery` (`GET /api/projects/:id/inbox` → `total`) and carries `data-needs=<n>` only when n > 0 (`Header.tsx:42, 47-52`). While n > 0 it registers the legend key `needs` (`Header.tsx:43`).
- **INV-SHELL-14** Knowledge freshness link, from `knowledgeQuery` (`GET …/knowledge`: `graph_version`, `up_to_date`, `updates_in_progress`, `updates[].state`) (`Header.tsx:87-118`). It shows "Knowledge vN" with a dot and goes to `/p/:id/knowledge`. It has three states:

  | State | Condition | Dot | Tooltip |
  |---|---|---|---|
  | current | none of the below | ink | "Knowledge is up to date (version N)." |
  | updating | any update in progress, or not up to date | amber working dot | "DEMIURGO is updating its knowledge: N change(s) to go." |
  | behind | any update with `state='rejected'` | rust | "Knowledge is behind: N update(s) failed. Open Knowledge to retry." |

  The link also carries `aria-label="Knowledge version N: up to date|updating|behind"` and `data-freshness`. It registers the legend keys `mark:working` and `mark:problem`.
- **INV-SHELL-15** Person menu trigger, labelled "Signed in as <person>" with the "you" glyph, the person's name and a chevron (`Header.tsx:183-190`). The menu opens with a label "Signed in as <person>" (Radix DropdownMenu, keyboard navigable) and contains:
  - **INV-SHELL-16** "Models & providers", which goes to `/p/:id/models` (`Header.tsx:198-203`);
  - **INV-SHELL-17** "Rename the project…", which opens the dialog in INV-PROJ-08 (`Header.tsx:204-210`);
  - **INV-SHELL-18** "Agent keys", which goes to `/p/:id/agent-keys` (`Header.tsx:211-216`);
  - **INV-SHELL-19** "Snapshots…", only with dev tools, which opens the dev panel (`Header.tsx:217-225`);
  - **INV-SHELL-20** "Sign out" (INV-AUTH-04).
- **INV-PROJ-08** Rename the project. A `TextDialog` titled "Rename the project" with:
  - field "Name": required, single line, max 120 characters, prefilled with the current name;
  - buttons "Rename" (reads "Working…" while pending) and "Not now";
  - server reasons shown inline.

  It runs Cmd `project.rename` with `entityId = projectId` and `{ name }`. On success it invalidates `['projects']` and closes (`Header.tsx:121-160`). The new name shows in the header and on the overview h1 without a reload.
- **INV-SHELL-21** Product sub-tabs, a nav with `aria-label="Product views"` containing Overview, Map, Origins and Journeys, each with `aria-current`. It is exported from `Header.tsx:242-269` and rendered by the product screens.

#### 5.2 Header search (combobox "Search decisions, features, ideas")
- **INV-SHELL-22** The input has `role=combobox`, `aria-autocomplete=list`, a placeholder and an aria-label (`Search.tsx:17, 128-150`). Search needs at least 2 characters and is debounced by 200 ms (`Search.tsx:18-19, 48-51, 66`).
- **INV-SHELL-23** Ctrl+K or ⌘K focuses and selects the field from anywhere in a project (`Search.tsx:54-64`).
- **INV-SHELL-24** Query `knowledgeSearchQuery` (`GET /api/projects/:id/knowledge/search?q=` → `{results:[{ref,type,title,excerpt,epistemic_status,rank}]}`). `stateQuery` (`GET …/state`) is also read, to find which record owns a check (`Search.tsx:67-70`).
- **INV-SHELL-25** Each result row shows:
  - the type icon, with the type word for screen readers;
  - the title with the matched words highlighted (`<mark>`);
  - an excerpt snippet of up to 160 characters around the first match, also highlighted;
  - the epistemic mark with its tooltip (`Search.tsx:169-209`; `blueprint/search.ts` `highlight`, `snippet`).
- **INV-SHELL-26** Navigation. ↑/↓ move the active option (`aria-activedescendant`), Enter opens the active option (or the first result with a target), and the mouse can hover or click (`Search.tsx:97-107, 180-181`). Targets (`blueprint/search.ts:16-29`):
  - `CODE@n` for a record opens `/p/:id/records/:code?v=n`;
  - `AC-…@n` for a check opens the owning record at `?v=n&tab=checks`;
  - `exploration:<uuid>` opens `/p/:id/threads/:uuid`.
- **INV-SHELL-27** A result with no page is marked `aria-disabled` and shows "It has no page of its own." (`Search.tsx:178, 201`).
- **INV-SHELL-28** States in the dropdown:
  - "Searching…" (debounce or pending);
  - "No matches";
  - the error, shown with `Reasons` (`Search.tsx:158-168`).
- **INV-SHELL-29** Esc closes and clears. Blur closes. Choosing a result clears the field (`Search.tsx:77-85, 108-113, 146-147`).
- **INV-SHELL-30** Below 1600 px the box collapses to a magnifier icon, 32 px wide with a transparent placeholder, and expands to 280 px on focus or while it holds text (`Search.tsx:117-150`).

#### 5.3 Shell states
- Real-time:
  - the Needs you count updates on `proposal`, `batch`, `record_version`, `link`, `question`, `knowledge_update`, `classification`, `taxonomy` and `idea_assessment` events (they invalidate `inbox`);
  - freshness updates on `knowledge_*`, `classification`, `taxonomy` and `idea_assessment` events;
  - search results under `knowledge` are refetched while open;
  - **the project name does not update from events.** The `project` entity is not in `INVALIDATES`, and `['projects']` is outside `['p', id]`.
- States:
  - the header renders an empty name while the projects load;
  - freshness renders nothing until `knowledgeQuery` resolves;
  - the connection banner is described in LIVE.
- Tests:
  - `e2e/session.spec.ts:13,58,86` (the Sections nav, tabs by keyboard, the Sign out menu);
  - `e2e/project.spec.ts:5` (Rename and Switch);
  - `e2e/realtime.spec.ts:3` (AC-INT-001-15: `data-needs` updates live);
  - `e2e/knowledge.spec.ts:7,190` (AC-INT-001-17: freshness current and behind; the aria-label);
  - `e2e/blueprint.spec.ts:371` (AC-INT-001-17: search, Enter, check → `tab=checks`, No matches, Esc);
  - `e2e/blueprint.spec.ts:411` (AC-WEB-001-03: Ctrl+K and arrows);
  - `e2e/blueprint.spec.ts:557` (search finds a parked idea and opens its thread);
  - `e2e/agent-keys.spec.ts:6` and `e2e/models.spec.ts:12` (menu items).
- UX problems:
  - **Search errors vanish.** `Reasons` focuses itself on mount (`ui/Reasons.tsx:63-65`), which blurs the combobox, and `onBlur → setOpen(false)` then closes the dropdown that holds the error (`Search.tsx:147, 158-159`).
  - Search cannot open requirement, quality requirement, threat model or production readiness records (codes `REQ`, `NFR`, `THR`, `PRR`, from `packages/domain/src/records.ts:21-24`). `RECORD_REF` only knows `DEC|FDR|ADR|BUG` (`blueprint/search.ts:12`), so those records show as "It has no page of its own."
  - Freshness state is conveyed visually by dot colour only. The visible text "Knowledge vN" is identical in all three states; the meaning is in the tooltip and aria-label (`Header.tsx:109-114`).
  - Below 1600 px search is an unlabeled magnifier icon with a transparent placeholder, and the Ctrl+K shortcut is never shown in the UI (`Search.tsx:117-150, 53`).
  - The DEMIURGO wordmark is not a link (design system `Header`, `packages/design-system/src/index.tsx:532`).
  - "Switch" and "New project" are caption-sized text links squeezed next to the project name (`Header.tsx:60-67`).
  - The truncated project name has no tooltip (`Header.tsx:59`).
  - The person menu mixes person-level items (Sign out) with project-level settings (Rename the project, Agent keys, Models & providers for this project) (`Header.tsx:198-231`). Rename is hard to discover.
  - No section tab is current on `/models`, `/agent-keys` or `/start/*` (`Header.tsx:28-35`).
  - The "Needs you" link sits outside the "Sections" nav, in the actions area (design system `index.tsx:554-558`).
  - The header fetches `stateQuery` (the whole product state) on every project page only to resolve the owners of checks for search (`Search.tsx:68-69`).

---

### 6. Page layout primitives (`ui/layout.tsx`)
- **INV-SHELL-31** `Page`. The main column (`<main id="main">`) plus an optional right column, "Side panel" (`aria-label`). The right column is sticky and can have `asideFooter`, which stays pinned at the bottom (used for "Ask DEMIURGO about this") (`layout.tsx:10-45`).
- **INV-SHELL-32** Resizable side panel (`asidePanel`, used by the Thread screen) (`layout.tsx:47-117`):
  - full height with its own scroll;
  - a vertical separator labelled "Resize the side panel": pointer drag, ←/→ for ±32 px, double-click resets to 480 px;
  - width clamped between 320 px and 60 % of the window;
  - width persisted in `localStorage['dm-aside-panel-width']`.
- **INV-SHELL-33** `PageTitle` (eyebrow, h1 display or page-title, subtitle, actions), `SectionTitle` (h2 with an aside note), `Panel`, and `Breadcrumbs` (a nav "Breadcrumb", with `aria-current` on the last item) (`layout.tsx:119-188`).
- **INV-SHELL-34** Loading: skeletons in the shape of the content, never a full-screen spinner. `Loading` has `role=status` and a label (default "Loading") and renders 3 card skeletons. `CardSkeleton` and `Skeleton` are also available (`layout.tsx:190-222`).
- **INV-SHELL-35** `EmptyState`: a dashed box with centred muted text (`layout.tsx:224-235`).
- UX problems:
  - The resize separator has no `aria-valuemax` and no Home/End keys (`layout.tsx:101-113`).
  - The generic `Loading` always draws 3 card skeletons whatever the page shape (`layout.tsx:209-222`).

### 7. Dialogs (`ui/dialogs.tsx`)
- **INV-SHELL-36** `ConfirmDialog` (Radix AlertDialog) for decisive commands (`dialogs.tsx:15-66`):
  - a title and a description of what the action does;
  - optional children and inline `Reasons` on error;
  - "Not now" (cancel) and a primary confirm button, which reads "Working…" while pending.
- **INV-SHELL-37** `TextDialog` (Radix Dialog), which asks for a text such as a reason, a conclusion or a name (`dialogs.tsx:69-158`):
  - the label, with " · optional" when not required;
  - a textarea (4 rows) or an input, with `maxLength`;
  - the text resets to `initial` each time it opens;
  - required plus empty shows "Write something to continue." and disables submit;
  - Enter submits in single-line mode;
  - `Reasons` inline on error, keeping what was written;
  - "Not now" and submit (reads "Working…" while pending).
- Tests: `e2e/needs-you.spec.ts:135` (AC-INT-001-14: 409, 422 and 403 in dialogs keep the text).
- UX problems:
  - `maxLength` truncates silently, with no character count (`dialogs.tsx:137, 141`).
  - The fixed 480 px panel (`dialogs.tsx:12`) is too narrow for long reasons.

### 8. Errors next to the action (`ui/Reasons.tsx`; shared convention)
- **INV-SHELL-38** `Reasons` shows a rust box with `role=alert`, focused when it appears, holding a title in product words and the server reasons as a list (`Reasons.tsx:61-102`). `explain()` maps the status to the title (`Reasons.tsx:17-47`):

  | Status | Title |
  |---|---|
  | 0 | "Can't reach DEMIURGO. Check your connection and try again." |
  | 401 | "Your session ended. Sign in again to continue." |
  | 403 | "Only a person can do this." or "This isn't allowed here.", plus the message |
  | 404 | "We couldn't find it. <msg>" |
  | 409 whose reason says knowledge is behind | "DEMIURGO is catching up with your latest changes. Try again in a moment." |
  | 409 with reasons | the message, with the reasons |
  | 409 without reasons | "It can't be done right now." |
  | 422 | "Some of what you wrote needs a change." |
  | anything else | "Something went wrong on our side. Nothing was changed." |

- **INV-SHELL-39** A reason matching `Choose (a|another) model for …` gets the link "Open Models & providers". It goes to `/p/:id/models` inside a project, or to `/models` outside one (`Reasons.tsx:50-59, 83-94`).
- Tests: `unit/reasons.test.tsx`: AC-AGE-002-03 (twice), AC-INT-001-14 (five cases).
- UX problem:
  - "Open Models & providers" is a plain `<a href>` (`Reasons.tsx:90`). It reloads the whole page, which loses in-memory state such as the New project form and its duplicate-project guard (see ONB).

### 9. Legend, marks, signals, icons, peek and Ask bar (shared UI)

#### Legend of marks (bottom-left, fixed; `ui/Legend.tsx`, `ui/legend-store.ts`)
- **INV-SHELL-40** It lists only the marks registered on the current screen. `useLegendMark` keys:
  - `mark:<kind>`;
  - `bars:<stage>`;
  - `who:<kind>`;
  - `needs`.

  Each entry is the glyph, the name and a phrase (`Legend.tsx:15-31`; `legend-store.ts:14-51`).
- **INV-SHELL-41** It opens by itself on any screen with marks until the person presses "Got it". It is split into "New on this screen" and "You know these" (`Legend.tsx:55, 61-62`). Seen and dismissed state is persisted in `localStorage['demiurgo:legend']` (`legend-store.ts:53-71`).
- **INV-SHELL-42** The ⓘ toggle button is labelled "What the marks mean", or "What the marks mean: N new" while folded and new marks exist (design system `index.tsx:850-854`).
- **INV-SHELL-43** "?" toggles the legend from anywhere except while typing in an input, textarea, select or contenteditable (`Legend.tsx:42-45, 97-105`). Esc closes it (only once it was dismissed at least once, `Legend.tsx:106`).
- **INV-SHELL-44** Pointing at an entry highlights the matching marks on screen with a focus ring (`[data-mark=…]`, `[data-stage=…]`, `[data-who=…]`, `[data-needs]`) (`Legend.tsx:33-40, 112, 118, 131`).
- **INV-SHELL-45** Footer: "No marks on this screen." (when opened with "?" on a screen without marks) or "Press ? to open it anywhere." (after dismissal) (`Legend.tsx:132`).
- **INV-SHELL-46** After the first "Got it", a notice reads "The legend stays here. Press ? to open it." for 4 s (`Legend.tsx:82-95, 134-138`).
- **INV-SHELL-47** Closing marks everything shown as seen. The legend is hidden when there are no marks and it was not asked for (`Legend.tsx:74-80, 114`).

#### Marks (`ui/marks.tsx`)
- **INV-SHELL-48** `Mark` is a glyph with a tooltip "<Name> · <phrase>", `role=img`, an aria-label, and `data-mark=<kind>`, and it registers itself in the legend (`marks.tsx:53-63`). The kinds are:
  - certainty dots: confirmed, assumed, proposed, open, unknown;
  - status marks: parked, dropped, replaced, stale→out-of-date, conflict, problem;
  - working;
  - inactive (a grey dot);
  - done (an ink tick) (`marks.tsx:12-50`).
- **INV-SHELL-49** Word and mark helpers:
  - `MarkWord` is the mark plus a word coloured by its mark: blue for proposed, grey for inactive states, rust for problem or conflict, amber for working (`marks.tsx:80-102`);
  - `StateMark` gives an entity-state's word and mark from `STATE_WORDS` (`marks.tsx:105-118`);
  - `EpistemicMark` maps the API's epistemic status (`marks.tsx:121-124`);
  - `ObservationChip` shows claim or hypothesis as Proposed and unknown as Unknown (`marks.tsx:127-135`);
  - `WorkingMark` is the amber Working signal with live text such as a timer (`marks.tsx:67-76`).

#### Signals (`ui/signals.tsx`)
- **INV-SHELL-50** `StageBars`, the feature's three-bar track (ready · built · verified). It has three stages, each carrying `data-stage` and a tooltip with a detail (`signals.tsx:10-37`):
  - Not ready;
  - Ready to build;
  - In doubt.
- **INV-SHELL-51** `NeedsBubble` is the blue count. It renders only when the count is above 0, with the tooltip "Needs you: N thing(s) wait(s) for you." (overridable) and `data-needs` (`signals.tsx:45-55`).
- **INV-SHELL-52** `WhoMark` shows who did something (You, DEMIURGO with its model, Agent with its name, or Automatic with its component) with a tooltip phrase, `data-who`, and an optional name. `whoLabel` formats the label (`signals.tsx:62-93`; `words.ts:229-251`).

#### Icons (`ui/icons.tsx`)
- **INV-SHELL-53** `TypeIcon` kinds (`icons.tsx:30-109`):
  - feature, decision, tech, question, check, idea, thread, bug (design-system item types);
  - taxonomy, package, source, run, knowledge (the default), link (depends-on);
  - the interface icons Chevron L/R/D, Close, ArrowRight, Warning (conflict), Info, Plus, Eye, Search, Lock, Dash and Tick.

  `RECORD_ICON` and `RECORD_TYPE` map record types to icons (`icons.tsx:111-114`).

#### Peek: "Point, peek, keep" (`ui/Peek.tsx`; used by overview record cards, the Blueprint and the Knowledge graph)
- **INV-SHELL-54** Pointing at a card for 0.4 s shows its detail popover to the right. Another card within 350 ms chains instantly. Leaving hides it after 120 ms unless the pointer is inside the popover (`Peek.tsx:10-12, 38-61, 116-123`).
- **INV-SHELL-55** Click keeps the peek open (`data-kept`, with the screen-reader text "Kept open. Press Escape to close."). Double-click opens the full page (`Peek.tsx:97-101, 127`).
- **INV-SHELL-56** Keyboard: the card is focusable (`role=link`). Focus shows the peek immediately, Enter opens the page and Esc closes it (`Peek.tsx:63-71, 85-96`).

#### Ask bar: "Ask DEMIURGO about this" (`ui/AskBar.tsx`, `ui/ask.ts`; on the Overview as `bar`, on a Record as `panel`)
- **INV-SHELL-57** The composer is tied to a subject:
  - the whole product: the form is labelled "Ask DEMIURGO about the whole product", with a static chip "About: whole product" and the placeholder "Ask or tell DEMIURGO anything about <name>";
  - a record: the form is labelled "Ask DEMIURGO about this <type>", with the DEMIURGO glyph and the placeholder "Ask about this <type>, or suggest a change…" (`AskBar.tsx:130, 144-152`; `ask.ts:33-41`).
- **INV-SHELL-58** Sending (`AskBar.tsx:88-111`; `ask.ts:18-31`):
  1. It refetches `explorationsQuery` fresh.
  2. It finds the subject's active thread. For a product, that is a thread whose purpose starts with "About the whole product" and has no origin. For a record, that is a thread whose origin is one of its versions. The most recent wins.
  3. If none exists, it runs Cmd `exploration.open` with `{purpose:'About the whole product'}` or `{purpose:'About <title>', origin:{type:'record_version', id}}`.
  4. It runs Cmd `message.post` with `{exploration_id, text, respond:true}`.
  5. It clears the field and invalidates the project.
- **INV-SHELL-59** Enter sends, Shift+Enter adds a new line, and IME composition is respected. The field auto-grows up to 132 px, with a max of 20 000 characters. The send button reads "Sending…" while pending (`AskBar.tsx:81-86, 124-129, 163, 170-172`).
- **INV-SHELL-60** The `prefill(text)` imperative handle writes a beginning such as "In What it's for: " and puts the caret at the end. The Record's guided review uses it for "Change something" (`AskBar.tsx:32-35, 67-79`).
- **INV-SHELL-61** A status line under the bar (`data-ask-status`, `role=status`) (`AskBar.tsx:180-236`; `ask.ts:52-72`):
  - answering: "Sent to <thread> · DEMIURGO is answering…" with an amber mark;
  - answered: "DEMIURGO answered in <thread> · Open the thread";
  - failed: "DEMIURGO couldn't answer: <failure words> · Open the thread", in rust.

  It reads from `explorationQuery` and `runsQuery({exploration})`.
- **INV-SHELL-62** Errors show `Reasons` above the form and keep the text. The whole bar renders nothing unless the tables let a person run both `exploration.open` and `message.post` (`AskBar.tsx:113, 134`).
- Tests:
  - `e2e/fidelity.spec.ts:40, 75` (AC-INT-001-09 Ask about a feature or product: the same thread reused, answering, a failed cancel);
  - `e2e/fidelity.spec.ts:222` (the review prefill);
  - `unit/fidelity-ask.test.ts` (AC-INT-001-09);
  - `e2e/product.spec.ts:107` (AC-WEB-001-03: peek on focus and hover, Enter opens);
  - `e2e/product.spec.ts:136` (click keeps the peek);
  - legend "Got it" in `e2e/h1-walk.spec.ts:129`, `e2e/batch.spec.ts:233`, `e2e/needs-you.spec.ts:316`;
  - `unit/words.test.ts` (AC-INT-001-04: every state has a word and mark, nothing proposed carries Confirmed).
- UX problems:
  - The legend auto-opens on every screen with marks until "Got it" and covers the bottom-left, where the batch pages keep their actions. The tests fold it for that reason (`Legend.tsx:55`; `e2e/onboarding.spec.ts:106-107`; `e2e/h1-walk.spec.ts:126-129`).
  - Esc cannot close the auto-opened legend before the first "Got it" (`Legend.tsx:106`).
  - The legend's "pointing highlights the marks" works on mouse hover only. Entries are not focusable (design system `index.tsx:771-772`).
  - Mark tooltips cannot be reached by keyboard. The marks are non-focusable `span role=img`, so the meaning phrase is hover-only (`marks.tsx:57-61`; `signals.tsx:31-35, 49-53, 79-84`).
  - "problem" and "conflict" render the same StatusMark glyph (`marks.tsx:25-26`), so one symbol carries two meanings.
  - `RECORD_ICON` and `RECORD_TYPE` omit requirement, quality_requirement, threat_model and production_readiness. Callers fall back to the feature or decision icon, so those records show a wrong type icon (`icons.tsx:111-114`; for example `overview/RecordCard.tsx:100`, `overview/Blueprint.tsx:386`).
  - Peek: a single click on a `role=link` card does not navigate, it only "keeps" the peek; opening needs a double-click or the "Open" link inside (`Peek.tsx:86-101`). The peek's own links cannot be reached by keyboard, because autofocus is prevented and the popover is portaled (`Peek.tsx:114`). Space is not handled (`Peek.tsx:63-71`).
  - The Ask bar is absent until `/api/tables` loads, which shifts the layout (`AskBar.tsx:113`). "Send" looks enabled with an empty field (`AskBar.tsx:170`). The "About: whole product" subject chip is not interactive (`AskBar.tsx:145-147`). The status line never dismisses (`AskBar.tsx:174`).

---

### 10. New project, "What do you want to build?": `/new` (Day 1, step 1)
- Purpose: the first thing a new person sees. An idea in their own words plus a name creates the project, its first thread and the first message, which DEMIURGO reads (`screens/onboarding/NewProject.tsx`).

- **INV-ONB-01** The workspace header shows the wordmark, "Models & providers" (→ `/models`), and "Your projects" (→ `/projects`, only if at least one project exists) (`NewProject.tsx:101-113`).
- **INV-ONB-02** Copy: eyebrow "New project", h1 "What do you want to build?", and the intro "Describe it in your own words, like you would to a friend. DEMIURGO turns it into a plan you can see, correct and build." (`NewProject.tsx:116-125`).
- **INV-ONB-03** Idea textarea:
  - the screen-reader label is "Describe your idea";
  - the placeholder is "An app where… It helps… People use it to…";
  - 5 rows, max 20 000 characters (`MESSAGE_MAX`) (`NewProject.tsx:129-145`).
- **INV-ONB-04** Name input:
  - label "Name", placeholder "A short name";
  - hint "You can rename it later.";
  - max 120 characters (`NewProject.tsx:148-168`).
- **INV-ONB-05** Example chips, introduced by "Or start from an example:" (`NewProject.tsx:185-193`; `day.ts:17-33`):
  - "Activities for my association" (name "Club Activities");
  - "Bookings for a small studio" (name "Studio Bookings");
  - "A simple game in Python" (name "Word Game").

  Each fills the idea and the name. The name is replaced only if it is empty or still an example name. The chip shows pressed while the idea equals it, and focus goes back to the idea (`NewProject.tsx:47-53`).
- **INV-ONB-06** The primary "Start →" button reads "Starting…" while pending (`NewProject.tsx:170-173`).
- **INV-ONB-07** Validation (`NewProject.tsx:58-67, 177-181`):
  - an empty idea shows "Describe your idea to start." and focuses the idea;
  - an empty name shows "Give the project a name to start." and focuses the name;
  - both use `role=alert` and `aria-invalid`.
- **INV-ONB-08** Start sequence (`NewProject.tsx:71-90`):
  1. `POST /api/projects {name}` → `{project_id}`.
  2. Cmd `exploration.open` with `{purpose: purposeOf(idea)}`. The purpose is the idea, trimmed to 1000 characters with "…" (`day.ts:36-39`).
  3. Cmd `message.post` with `{exploration_id, text: idea, respond: true, agent: 'onboarding'}`.
  4. `live.start(explorationId)`, so the reading shows live.
  5. Refetch `projectsQuery` fresh.
  6. Navigate to `/p/:id/start/:explorationId`.
- **INV-ONB-09** Idempotent retry. The ids already created are kept in a ref, so trying again after a partial failure does not create a second project or thread (`NewProject.tsx:36-37, 72-81`).
- **INV-ONB-10** An error shows `Reasons`, including the "Open Models & providers" link when no engine is chosen, and the projects list is invalidated (the project may exist already) (`NewProject.tsx:91-96, 182`).
- **INV-ONB-11** "Only a person can start a project." appears, and Start is disabled, when the tables do not let a person run `project.create`, `exploration.open` and `message.post` (`NewProject.tsx:43-45, 183`).
- **INV-ONB-12** Three reassurances (`NewProject.tsx:195-208`):
  - "Nothing is decided until you confirm it" (Proposed glyph);
  - "You can change anything later" (needs-review icon);
  - "Everything stays here, saved" (lock).

- Real-time: none. There is no stream outside a project.
- States: pending, validation, error, and not allowed.
- Tests:
  - `e2e/onboarding.spec.ts:62` (AC-INT-001-01: reassurances, example fill, Start creates the project and thread, axe);
  - `e2e/onboarding.spec.ts:267` (AC-INT-001-10: a failing reading from Start);
  - `e2e/onboarding.spec.ts:346` (AC-INT-001-02: entry points);
  - `e2e/onboarding.spec.ts:371` (AC-WEB-001-03: keyboard only);
  - `e2e/models.spec.ts:40` (the Models link);
  - `unit/onboarding-day.test.ts:122-152` (purpose trimming, the idea from the first person message, examples).
- UX problems:
  - After a partial failure, a changed name is silently ignored on retry, because the project already exists (`NewProject.tsx:63, 73-76`).
  - If the failure needs "Open Models & providers", that link is a full-page `<a>` (`Reasons.tsx:90`). It wipes the form and the `done` ref (`NewProject.tsx:37`), so starting again creates a second project, and the first one stays orphaned.
  - There is no Sign out on this page.
  - The examples are English-only, hard-coded (`day.ts:17-33`).

---

### 11. Day 1, DEMIURGO reads the idea: `/p/:projectId/start/:explorationId`
- Purpose: the idea written, DEMIURGO reading it live, and then "Here's what I understood", with its questions and proposals (`onboarding/Start.tsx`, `Reading.tsx`, `parts.tsx`, `hooks.ts`, `day.ts`, `live.ts`).

- Data (`useDay`, `hooks.ts:12-45`):
  - `explorationQuery` (`GET …/explorations/:id`: messages, questions, children);
  - `runsQuery({exploration})` (`GET …/runs?exploration=`);
  - `projectsQuery` (the name);
  - `stagesQuery` (`GET …/stages`), where the open stage's thread adds its mandatory questions;
  - `batchQuery` (`GET …/batches/:id`) for what was proposed.

  **Questions still in the reserve (`shown_at === null`) are filtered out** (`hooks.ts:27-28`). The reading phase comes from the person's last message (`response`: waiting, requested or abandoned, and `response_run`) and the runs, never from the clock (`day.ts:76-103`).

- **INV-ONB-13** States (`Start.tsx:49-60`):
  - 404 shows NotFound "this idea";
  - other errors show `Reasons` in main;
  - loading shows `DaySkeleton` "Loading your idea".
- **INV-ONB-14** No idea yet shows the thread purpose as h1, "Nothing was written in this thread yet, so DEMIURGO has nothing to read." and "Open the thread" (→ `/threads/:id`) (`Start.tsx:66-84`).
- **INV-ONB-15** Live reading, shown while "watching" or while no reading exists yet. The region is "DEMIURGO reads your idea", with "Your idea · <ago>" and the idea quoted (`Reading.tsx:69-102`). Watching is on when this tab started the day (`live.isLive`), or automatically whenever no reading has finished yet (`Start.tsx:41-47`).
- **INV-ONB-16** Reading-card headline by phase (`Reading.tsx:145-149`):
  - "Here's a first reading of your idea" (read);
  - "DEMIURGO is catching up on what you just decided…" (catching up);
  - "Reading your idea…" (working);
  - "Waiting for DEMIURGO…" (waiting).

  While waiting or catching up it adds "It starts as soon as its knowledge is up to date with your idea." (`Reading.tsx:176-178`).
- **INV-ONB-17** While working (`Reading.tsx:161-173, 255-273, 417-424`):
  - live progress, for example "Thinking… 1,240 tokens · 0:12", from `run.progress`;
  - the amber Working mark with a ticking timer (`runDuration`, `data-run-timer`);
  - "Cancel" (Cmd `run.cancel` on the run, shown only if the tables allow it from its state).

  When finished it shows "<duration> · <model>".
- **INV-ONB-18** Step "What I understood". It shows a tick, a working mark or an empty dot by phase. When read it shows DEMIURGO's reply text and observation chips, each with its mark (claim or hypothesis as Proposed, unknown as Unknown, `data-observation`) (`Reading.tsx:104-124, 179-200`).
- **INV-ONB-19** Step "What I still need to ask you" lists the open or assumed questions as chips with the Open mark (`data-reading-question`), or "Nothing for now." (`Reading.tsx:201-217`).
- **INV-ONB-20** Step "What I propose" lists the proposals of the run's batch as chips with the Proposed mark and the proposal title (`Reading.tsx:218, 237-253`).
- **INV-ONB-21** Footer text: "DEMIURGO is only reading. Nothing is decided without you." while reading, then "Everything above is only proposed. You will review it before anything is decided.". The footer has the primary "See what I understood →", which ends live mode (`Reading.tsx:219-231`; `Start.tsx:97-100`).
- **INV-ONB-22** Stopped card (`data-reading=failed|cancelled|unanswered`; rust when failed) (`Reading.tsx:276-370`). It shows:
  - the title: "I couldn't finish reading your idea", "You stopped the reading" or "DEMIURGO hasn't read your idea yet" (variants for a correction and for decisions: `Reading.tsx:34-56`);
  - the reason in product words (`failureWord`), or "Nothing was lost: what you wrote is in the thread.";
  - "Conversation · <day time> · <model>";
  - "Details ›", which goes to `/p/:id/runs/:runId`;
  - "Retry" (Cmd `run.retry {run_id}`, reads "Retrying…"), or, when there is no run, "Ask DEMIURGO" (Cmd `run.request {action:'exploration_chat', agent:'onboarding', scope:{type:'exploration', id}}`, reads "Asking…");
  - `Reasons` on error.
- **INV-ONB-23** "What I understood" view: a blue band under the header (`Start.tsx:159-177`) with:
  - a NeedsBubble, "Needs you: N question(s) wait(s) for you.";
  - bold "This is my first reading of your idea." or "This is my new reading, with your corrections.";
  - "Nothing is decided: correct anything that's wrong, then answer my questions." (or without the questions part);
  - the primary action **"Answer in the thread"** (→ `/threads/:explorationId`) when there are questions, otherwise "See your starting point" (→ `/start/:id/done`) (`Start.tsx:150-153`).
- **INV-ONB-24** "From your idea: “…”" with "Open the thread" (`parts.tsx:71-85`). Then "The product" and the product name as the display h1, or a skeleton while it loads (`parts.tsx:87-94`).
- **INV-ONB-25** The "What I understood" region (`Start.tsx:221-235`; `parts.tsx:145-174`) contains:
  - a compact `ReadingStatus`, which shows waiting or working with a timer, progress and Cancel, or a stopped card with Retry or Ask;
  - DEMIURGO's reply, with its WhoMark and model;
  - observation rows, each with a MarkWord (Claim, Hypothesis or Unknown).

  The region is `aria-busy` while reading.
- **INV-ONB-26** "Correct something" (aside button) opens the inline form "What's wrong?" (`Start.tsx:212-214, 243-286`):
  - the textarea is autofocused and scrolled into view;
  - the placeholder is "Say it in your own words: DEMIURGO reads your idea again with it.";
  - buttons "Cancel" and "Send and read again" (reads "Sending…"), which runs Cmd `message.post {…, respond:true, agent:'onboarding'}`;
  - `Reasons` on error.

  The status then says "Reading your correction…".
- **INV-ONB-27** "What I propose" list: each proposal shows a mark, its type word, its title, and "Review ›" (→ `/batches/:batchId`) (`Start.tsx:289-324`).
- **INV-ONB-28** "Later" placeholders (a dashed box with a "Later" tag; `data-later`) (`parts.tsx:106-142`):
  - "Who uses it": "DEMIURGO will read the people in your idea (S6).";
  - "Rules for the whole product": "DEMIURGO will gather the rules your answers set (S6).";
  - "What it must do": "DEMIURGO will split your idea into features (S6). For now, a feature is drafted from a decision you approve, in the thread."
- **INV-ONB-29** Aside "What happens now" (`Start.tsx:179-216`):
  - "Nothing is decided yet": "Everything on the left is only proposed. You decide on each thing." and "Nothing is built. Each feature will get its own details and checks.";
  - "Then I'll ask you N question(s), one at a time", or "No questions for now", with each question as an Open node;
  - "Smaller things I'll decide on my own and mark as assumed, so you can check them later.";
  - the primary next action (duplicated from the band) and the secondary "Correct something".
- **INV-ONB-30** Polling fallback: while the answer is waiting or catching up, the thread and runs are refetched every 2.5 s (`hooks.ts:13-18, 34`). The clock ticks every second while something is active (`useNow`).

- Real-time:
  - `message` and `question` events refresh the thread;
  - `ai_run` events refresh runs and the thread;
  - `batch` and `proposal` events refresh `batch`;
  - `stage` and `question` events refresh `stages`;
  - `run.progress` drives the progress line.
- States: loading, 404, error, no idea, waiting, catching up, working, read, failed, cancelled, unanswered, and a new reading after a correction.
- Tests:
  - `e2e/onboarding.spec.ts:62` (AC-INT-001-01: live reading, all marks Proposed or Unknown, "Correct something" re-read);
  - `e2e/onboarding.spec.ts:267` (AC-INT-001-10: the rust card and Retry);
  - `e2e/onboarding.spec.ts:295` (catching up, answered once, no "Ask DEMIURGO");
  - `e2e/onboarding.spec.ts:420` (screens: working and Cancel, cancelled, failed);
  - `unit/onboarding-day.test.ts:154-231` (reading phase and understanding).
  - **Broken on this branch:** `e2e/onboarding.spec.ts:150, 387, 467` click "Answer the questions", but the label is now "Answer in the thread" and it leads to the thread (patch `4af77f1`, `Start.tsx:152`).
- UX problems:
  - **Wrong state shown.** Non-pending proposals render the Confirmed mark and "Accepted" even when they were rejected or went out of date (`Start.tsx:303-306`).
  - `ProposedStep` always shows "Proposed" whatever the proposal state (`Reading.tsx:245`).
  - The Start screen is only reached by `NewProject`'s navigate. Nothing in the app links back to Day 1 or to the starting point once the person leaves (only `NewProject.tsx:90` and the Day 1 screens reference `/start/…`).
  - The question count ("Then I'll ask you N…", the band bubble) includes mandatory stage questions taken from the stage's own thread (`hooks.ts:22-26`). "Answer in the thread" opens the Day 1 thread instead (`Start.tsx:152`). The counts can disagree.
  - Two identical primary buttons are on screen (band and aside) (`Start.tsx:161, 209`), against the one-primary-per-view rule (`ui/Button.tsx:1-3`).
  - The band message is single-line truncated with no way to read the rest (`Start.tsx:169`). The idea line (`parts.tsx:75`) and proposal titles (`Start.tsx:310`) are truncated too.
  - Focus is lost when "See what I understood" unmounts itself (`Start.tsx:97-100`).
  - Hard-coded widths and sticky offsets assume a 58 px band (`parts.tsx:37, 43`). The connection banner and the Day 1 band are both `sticky top-14 z-20` and overlap when disconnected (`parts.tsx:58`; `api/stream.ts:153`).
  - Polling duplicates the stream (`hooks.ts:15-18`).

### 12. Day 1, one question at a time: `/p/:projectId/start/:explorationId/questions`
- Purpose: walk the open questions in the aside, answer, skip or park each, then ask DEMIURGO to propose decisions (`onboarding/Questions.tsx`).
- **Status on this branch: orphaned.** No link leads here since patch `4af77f1` ("answering outside the exploration chat makes no sense"). It is reachable only by URL.

- **INV-ONB-31** States: 404 shows NotFound "these questions"; error shows `Reasons`; loading shows `DaySkeleton` "Loading the questions" (`Questions.tsx:61-72`).
- **INV-ONB-32** Walk composition (`Questions.tsx:48-59`; `day.ts:152-154`):
  - the questions open when the screen opens, in the order they were asked;
  - any that DEMIURGO raises while the person walks are appended;
  - once the walk ends it no longer grows;
  - if the last message was already the decision request, the walk is empty.
- **INV-ONB-33** The aside is labelled "Question i of N" (`Questions.tsx:85, 121-132, 190-201`). Its header shows:
  - the question icon with "Question", or "<Stage title> · mandatory";
  - the state mark and word (Open or Assumed);
  - "i of N" with a track of up to 10 bars (ink for walked).
- **INV-ONB-34** The question is an h2, focused on each question (`Questions.tsx:163-165, 203-205`).
- **INV-ONB-35** "Why it matters" (the reason) and "What it affects", which shows "High/Medium/Low impact." plus a phrase from `IMPACT_WORDS` (`Questions.tsx:206-224, 334`).
- **INV-ONB-36** Answer choices, shown only if the tables allow `question.confirm` from its state (`Questions.tsx:225-275, 337-369`). With options or an inferred answer:
  - "Pick an answer" is a radiogroup with DEMIURGO's inferred answer ("DEMIURGO inferred it: <reasoning>"), the predefined options with "implies", and "Something else" ("Write it in your own words."), which opens a textarea.

  Otherwise it is "Your answer", a textarea (max 3000, placeholder "Answer in your own words").
- **INV-ONB-37** "Answer" (primary, full width, reads "Answering…") runs Cmd `question.confirm {conclusion}` on the question and advances. It is disabled while the conclusion is empty (`Questions.tsx:173-174, 278-288`).
- **INV-ONB-38** "Skip" (pending) or "Next" (assumed) advances locally without changing anything (`Questions.tsx:290-292`).
- **INV-ONB-39** "Not now", shown if `question.postpone` is allowed, opens a TextDialog (`Questions.tsx:175-184, 293-304, 317-329`):
  - title "Not now", with "The question stays for later, parked. Say why.";
  - "Reason": required, max 1000;
  - "Park it" runs Cmd `question.postpone {reason}` and advances.
- **INV-ONB-40** "Talk it through with DEMIURGO instead: Open the thread" (`Questions.tsx:306-315`).
- **INV-ONB-41** End, with the aside labelled "Questions done" (`Questions.tsx:372-483`; `day.ts:157-198`):
  - the h2 "That's all my questions for now", focused;
  - the summary "You answered X, skipped Y, parked Z and dropped W.";
  - "DEMIURGO can turn your answers into decisions. It only proposes them: you accept, change or reject each one.";
  - "Answer at least one question to ask for decisions." when there are none;
  - the primary "Ask DEMIURGO to propose decisions" (reads "Asking…"), which runs Cmd `message.post` with the text "I decide: <conclusions>\n\nMy answers to your questions:\n- Q → A…\n\nPropose each one as a decision for me to review." (max 20 000).
- **INV-ONB-42** After asking (`Questions.tsx:428-460`):
  - a compact `ReadingStatus` ("Proposing decisions…", Cancel, Retry);
  - then "DEMIURGO proposed N decision(s)." with each decision's state mark and title, and "They wait for you: accept, change or reject each one. Nothing is decided yet.";
  - or "DEMIURGO didn't propose a decision this time. You can ask again in the thread."
- **INV-ONB-43** "See your starting point" (secondary, → `/start/:id/done`) is always shown at the end (`Questions.tsx:473-479`).
- **INV-ONB-44** The main column shows From your idea, the product title (muted), "Your answers" (confirmed questions with their conclusion, or "Your answers appear here as you give them.") and "What I understood" (the reply, muted, and compact observations) (`Questions.tsx:111-114, 486-529`).

- Real-time: the same as §11.
- Tests:
  - `e2e/onboarding.spec.ts:134` (AC-INT-001-09: answer, skip, park, summary);
  - `e2e/onboarding.spec.ts:200` (AC-INT-001-01: the decision request and 1 decision proposed);
  - `e2e/onboarding.spec.ts:371, 420`;
  - `unit/onboarding-day.test.ts:232-278`.
  - **Broken:** `onboarding.spec.ts:156,167` expect "Why I ask: …", but the label is now "Why it matters" (`Questions.tsx:210`, patch `a24239f`). Line 150 navigates through the removed link.
- UX problems:
  - The screen is unreachable from the UI (see Status).
  - Multi-select (`Question.multiple`) and exclusive options are ignored: the screen is single choice only (`Questions.tsx:135, 236-261`; `api/types.ts:324-328`).
  - The radio options are separate Tab stops, with no arrow-key roving (`Questions.tsx:349-357`).
  - Skip is not persisted: a reload restarts the walk and skipped questions come back (`Questions.tsx:45, 290`).

### 13. Day 1, your starting point: `/p/:projectId/start/:explorationId/done`
- Purpose: the day in numbers, what DEMIURGO understood, the person's answers, what needs them, what comes next, and "You can close DEMIURGO" (`onboarding/DayDone.tsx`).

- Data: `useDay`, plus `stateQuery` (the approved decisions born from this thread), plus a `batchQuery` for every batch produced by the thread's runs (`DayDone.tsx:27-30`). The summary comes from `daySummary` (`day.ts:234-259`).
- **INV-ONB-45** States: 404 shows NotFound "this day"; error shows `Reasons`; loading shows `DaySkeleton` "Loading your starting point" until every batch has loaded (`DayDone.tsx:32-44`).
- **INV-ONB-46** Summary panel (`DayDone.tsx:136-151`; `day.ts:212-217, 242-250`):
  - "<Today|d Mon> · N minute(s)", measured from the thread opening to its last activity, at least 1;
  - the h1 "Your starting point is ready";
  - the figures `data-day-numbers`: "1 idea → N question(s) answered → N decision(s) proposed".
- **INV-ONB-47** "Review the decisions" (primary, → the first waiting decision's batch) and "Go to the product" (→ `/p/:id`) (`DayDone.tsx:152-165`).
- **INV-ONB-48** Two columns, plus the "What it must do" Later placeholder (`DayDone.tsx:168-190, 218-228`):
  - "What I understood": observation rows, or "Nothing noted.";
  - "Your answers": answer rows, or "No answers yet. The questions wait in the thread."
- **INV-ONB-49** Aside "Needs you" with a bubble counting the waiting decisions plus the open questions (`DayDone.tsx:67-92, 230-260`):
  - each waiting decision is a card (`data-waiting-decision`: "Proposed · Decision", the title, "DEMIURGO proposes it. Accept, change or reject it.") that goes to its batch;
  - each open or assumed question is a link with its mark, and "Assumed: <conclusion>" when assumed, that goes to the thread;
  - "Nothing from today waits for you." when there is nothing.
- **INV-ONB-50** "What's next" (`data-whats-next`) (`DayDone.tsx:94-114`):
  - for each approved decision from this thread: "Draft it: DEMIURGO drafts a feature with its checks from “<title>”.";
  - otherwise: "Accept and approve a decision, then Draft it: DEMIURGO drafts a feature with its checks from it.";
  - then "Draft it lives in the thread. Open the thread".
- **INV-ONB-51** "Parked for later" lists the parked questions, each linking to the thread (`DayDone.tsx:116-123`).
- **INV-ONB-52** Taxonomy hint, from `taxonomiesQuery` (`GET …/taxonomies`), shown while no taxonomy is approved (`knowledge/TaxonomyHint.tsx:9-28`):
  - "A taxonomy is waiting for your approval: until then, what DEMIURGO knows is not grouped." with "Review the taxonomy ›";
  - or "DEMIURGO doesn't group what it knows yet." with "Set up how it groups knowledge ›".

  Both go to `/knowledge?tab=taxonomy`.
- **INV-ONB-53** The "You can close DEMIURGO" box: "Everything is saved. When you come back, I'll show you what changed while you were away." (`DayDone.tsx:127-132`).

- Real-time: as in §11, plus `state` (approved decisions) and `knowledge` (the taxonomy hint).
- Tests:
  - `e2e/onboarding.spec.ts:200` (numbers, Needs you = 1, close box, "Go to the product" href, "Review the decisions" → batch, then what's next → Draft it in the thread);
  - `e2e/onboarding.spec.ts:371` (keyboard);
  - `e2e/knowledge.spec.ts:302` (the taxonomy hint on a new project);
  - `unit/onboarding-day.test.ts:279-313`.
- UX problems:
  - "Review the decisions" opens only the first waiting batch. Decisions in later batches are reachable only from the aside (`DayDone.tsx:58, 153-161`).
  - "N minutes" measures the span of thread activity, not the time spent, and can read as hours or days later (`day.ts:242-250`).
  - A batch query that fails silently drops its decisions from the counts (`DayDone.tsx:46`).

---

### 14. Models & providers: `/p/:projectId/models` (project) and `/models` (workspace)
- Purpose: which engine (provider, model, effort) runs each agent, globally and per project; what each provider offers; spend and stats (`screens/models/*`, `api/models.ts`).

- **INV-MODELS-01** Entry points:
  - the person menu → `/p/:id/models`;
  - `/projects` → "Models & providers" (`/models`);
  - `/new` → "Models & providers" (`/models`);
  - any `Reasons` "Choose a model for …" → "Open Models & providers".
- **INV-MODELS-02** The workspace variant (`/models`) has its own header (wordmark, "Your projects", "New project") and only the "Everywhere" column (`ModelsAndProviders.tsx:43-62`).
- **INV-MODELS-03** Title: eyebrow "Settings", h1 "Models & providers", and the subtitle "Which engine runs each part of DEMIURGO. You choose from what each provider offers right now; DEMIURGO never switches on its own." (`ModelsAndProviders.tsx:76-86`).
- **INV-MODELS-04** "Refresh" (reads "Looking…") calls `refreshProviders()` (`POST /api/providers/refresh`), which re-discovers the catalogs, then invalidates `['models']`. Errors show `Reasons` (`ModelsAndProviders.tsx:68-71, 80-87`).
- **INV-MODELS-05** Section "Providers", with the aside "Discovered without spending quota", from `providersQuery` (`GET /api/providers` → `{providers, catalogs, stats, consumption}`). One card per catalog (`ModelsAndProviders.tsx:90-107`).
- **INV-MODELS-06** Provider card (`data-provider`) (`ModelsAndProviders.tsx:145-158`):
  - the label;
  - the state word with a dot: Ready (ink), Not ready (rust) or Not installed (grey);
  - `v<version>`;
  - the discovery message, in rust when not ready.
- **INV-MODELS-07** The card's model list: each model label with its effort chips; the default effort has a stronger border and the title "Default effort". With no models: "No models to offer." (`ModelsAndProviders.tsx:159-185`).
- **INV-MODELS-08** Card footer: "Keeps a conversation per thread" or "Sends the whole context every time", then "· Checked <ago>" (`ModelsAndProviders.tsx:186-192`).
- **INV-MODELS-09** Section "Who does what", with the aside "A change applies to the next run, never to one already asked for", from `agentsQuery(projectId?)` (`GET /api/agents[?project=]` → `{agents:[AgentInfo], skills}`) (`ModelsAndProviders.tsx:109-119`). Table columns: "Part of DEMIURGO" | "Everywhere" | "This project" (the last only inside a project). Agents are ordered onboarding, explorer, designer, knowledge_classifier, knowledge_reviewer, echo (`engines.ts:7`).
- **INV-MODELS-10** Agent row identity (`data-agent`): the section name, the description, and the code `<id>@<version> · N skill(s)` (`ModelsAndProviders.tsx:250-255`).
- **INV-MODELS-11** Effective line (`data-effective`), with a tone dot (`engines.ts:63-67`; `ModelsAndProviders.tsx:256-265`):
  - "<Provider · Model · effort> (everywhere|this project|this time)";
  - or "No model: DEMIURGO cannot run it." (rust);
  - or the reason it is unavailable (rust).
- **INV-MODELS-12** The "Everywhere" cell holds the provider, model and effort selects. Any change immediately calls `assignEngine(agent,'global',engine)`, which is `PUT /api/agents/:agent/assignment {scope:'global', provider, model, effort}`. It then invalidates `['models']` (`ModelsAndProviders.tsx:230-236, 267-274`).
- **INV-MODELS-13** "Remove" calls `unassignEngine(agent,'global')` (`DELETE /api/agents/:agent/assignment?scope=global`). Without a global engine the cell shows "No model yet" in rust (`ModelsAndProviders.tsx:275-281`).
- **INV-MODELS-14** "This project" without an override shows "Same as everywhere" and "Use another here". That button immediately creates a project override (`PUT … {scope:'project', project_id}`) copying the global engine, or the first model of the first choosable provider. It is disabled when there is none (`ModelsAndProviders.tsx:243, 303-315`).
- **INV-MODELS-15** "This project" with an override shows the project engine selects, which apply immediately, and "Use everywhere’s", which calls `DELETE …?scope=project&project=<id>` (`ModelsAndProviders.tsx:285-301`).
- **INV-MODELS-16** Assign and unassign errors show per-row `Reasons`, for example a 403 for a non-person or a 422 for an engine outside the catalog. All controls in a row are disabled while busy (`ModelsAndProviders.tsx:241, 319-323`).
- **INV-MODELS-17** EngineSelect: a fieldset labelled "<Section>, everywhere|this project", with the selects "…: provider", "…: model" and "…: effort" (`EngineSelect.tsx:10-77`; `engines.ts:15-51`). Only discovered providers with models are offered, in the order claude, codex, opencode, simulated.
  - Suffixes: "(not ready)" on a provider that is not ready; "(gone)" on a provider or model that is no longer offered; "Choose…" when nothing is assigned; "—" when no efforts.
  - Changing the provider takes its first model with that model's default effort, or "medium", or the first effort.
  - Changing the model keeps the effort if the new model offers it.
- **INV-MODELS-18** "What it has spent" section (`ModelsAndProviders.tsx:332-396`):
  - a period chip group (`aria-label="Period"`): "Today" or "Last 7 days";
  - the note "Only shown: there are no limits. Cost appears only when the provider reports it.";
  - two tables, "By provider" and "By part of DEMIURGO", with columns Name, Calls, Tokens in, Tokens out, Cost ("$x.xx" or "—");
  - an empty table reads "Nothing yet.";
  - tokens are formatted with `en-GB` grouping, or as "1.25M" (`engines.ts:73-76`).
- **INV-MODELS-19** "How each engine does" (shown only when there are stats) (`ModelsAndProviders.tsx:401-447`). Columns:
  - Part;
  - Engine (label);
  - Calls;
  - Failed (the failure kinds with counts, in rust, or "—");
  - Avg time (s);
  - Avg tokens;
  - Questions/run;
  - Proposals/run.
- **INV-MODELS-20** Loading shows skeletons (3 provider cards, the agent table). Provider and agent errors show `Reasons` (`ModelsAndProviders.tsx:88, 94-100, 113-116`).
- **INV-MODELS-21** "Retry with…", used on failed run cards in a thread (`thread/RunCards.tsx:162`) and on the Run page (`run/Run.tsx:144`) (`models/RetryWith.tsx`):
  - it is a popover with the title "Retry with another engine" and "Same context, just this once. What runs this agent next time doesn’t change.";
  - the EngineSelect labelled "Retry with" is prefilled with the run's engine, or the first available;
  - "Not now" closes, and "Retry" (primary, reads "Retrying…") runs Cmd `run.retry {run_id, override:{provider,model,effort}}`, then closes and calls `onRetried(newRunId)`;
  - `Reasons` shows on error, and the error resets when it reopens.

- Real-time: **none.** The `['models', …]` keys are not under `['p', id]`, so the stream never refreshes spend, stats or assignments (`api/models.ts:110-114`). Only mount, Refresh and the mutations refetch.
- States: loading, error, empty usage ("Nothing yet."), no stats (the section is hidden), and not ready, not installed or gone.
- Tests:
  - `e2e/models.spec.ts:12` (AC-AGE-002-02: from the menu, the provider card, "Use another here" and "Use everywhere’s", axe);
  - `e2e/models.spec.ts:40` (AC-AGE-002-02: the workspace variant, reachable from `/new` and `/projects`, no project column);
  - `e2e/models.spec.ts:64` (AC-AGE-002-11: Retry with…);
  - `unit/models-engines.test.ts` (AC-AGE-002-02, -03, -08, -10);
  - `unit/reasons.test.tsx:7,19` (AC-AGE-002-03: the engine link).
- UX problems:
  - Engine selects apply on change with no confirmation, save step or undo; a mis-selected provider immediately reassigns the agent (`ModelsAndProviders.tsx:273, 292`).
  - "Use another here" creates an override identical to the global engine, so visually only "(everywhere)" → "(this project)" changes. The `setOverriding`/"Cancel" path is dead code, because the button is disabled exactly when it would run (`ModelsAndProviders.tsx:297-311`).
  - Inconsistent names: the agent table uses section names, while the spend table "By part of DEMIURGO" and the stats column "Part" show raw agent ids such as `knowledge_classifier` (`ModelsAndProviders.tsx:356, 428`).
  - The failure-kind label replaces only the first "_" (`ModelsAndProviders.tsx:433`).
  - The default effort is indicated only by border contrast and a hover `title` (`ModelsAndProviders.tsx:167-176`).
  - The fixed grid minimum of 220 + 480 + 480 px sits inside an `overflow-hidden` container, so on narrower windows the "This project" column is clipped with no scroll (`ModelsAndProviders.tsx:198-201, 206`).
  - There is no empty state for zero providers or zero agents.
  - Data the API sends is never shown: each agent's skills list (id and description), `action`, `session` and `time_limit`, and `AgentsResponse.skills` (`api/models.ts:37-49, 78`).
  - Eyebrow "Settings" here versus "The product" on Agent keys (`ModelsAndProviders.tsx:77`, `AgentKeys.tsx:40`).
  - The workspace variant has no Sign out.

---

### 15. Agent keys: `/p/:projectId/agent-keys`
- Purpose: issue and revoke keys for external agents (Claude Code, Codex…) that read the project and propose through MCP (`screens/agent-keys/AgentKeys.tsx`).

- **INV-KEYS-01** Entry: person menu → "Agent keys".
- **INV-KEYS-02** Title: eyebrow "The product", h1 "Agent keys", and the subtitle "An agent with a key reads this project and proposes through MCP, with its own name. It never accepts or approves anything: that stays with you." (`AgentKeys.tsx:39-43`).
- **INV-KEYS-03** "+ New key" opens a TextDialog (`AgentKeys.tsx:44-54, 108-131`):
  - title "New agent key", with "The agent proposes with this name. Lowercase letters, numbers and hyphens.";
  - "Name of the agent": required, single line, max 40;
  - "Create the key" runs Cmd `agent_token.issue {name}` → `result.token`;
  - `Reasons` on error (for example the 422 from the `valid_agent_name` guard).
- **INV-KEYS-04** Issued-key panel (`role=status`, labelled "The key of <name>", `data-issued-key`): "The key of <name>. It is shown only this once: copy it now." (`AgentKeys.tsx:57-64`).
- **INV-KEYS-05** The secret appears in a code span (`data-secret`) with a "Copy" button that uses `navigator.clipboard.writeText` (`AgentKeys.tsx:65-72`).
- **INV-KEYS-06** MCP setup line: "To use it from Claude Code, run this in the DEMIURGO folder:" followed by `claude mcp add demiurgo -e DEMIURGO_API_URL=<origin> -e DEMIURGO_AGENT_TOKEN=<token> -e DEMIURGO_PROJECT=<projectId> -- node packages/mcp/src/main.ts` (`AgentKeys.tsx:23-25, 73-74`).
- **INV-KEYS-07** "I have saved it" dismisses the panel. The secret is then gone from the page, including after a reload (`AgentKeys.tsx:75-77`).
- **INV-KEYS-08** Key list (`aria-label="Keys"`), from `tokensQuery` (`GET /api/projects/:id/tokens` → `AgentToken{id,name,state,issued_by,created_at,revoked_at}`) (`AgentKeys.tsx:87-106`). Each row (`data-agent-key`, `data-key-state`) shows:
  - the mark: done "Active" or dropped "Revoked";
  - the name;
  - "Active" or "Revoked <ago>", then "· issued by <person> <ago>".
- **INV-KEYS-09** "Revoke", shown on active keys, opens a ConfirmDialog (`AgentKeys.tsx:98-102, 132-149`):
  - "Revoke the key of <name>?";
  - "The agent can no longer read or propose with it. What it already proposed stays as it is.";
  - "Revoke" runs Cmd `agent_token.revoke` on the key.
- **INV-KEYS-10** States: loading shows a skeleton; the error shows `Reasons`; the empty state reads "No agent has a key yet. Give one to Claude Code to let it propose through MCP." (`AgentKeys.tsx:81-86`).
- **INV-KEYS-11** Real-time: `agent_token` events invalidate `tokens`, so a key issued or revoked in another tab appears live.

- Tests: `e2e/agent-keys.spec.ts:6` (issue from the menu, shown once, the MCP line, the agent can read, "I have saved it" plus reload hides the secret, revoke → 401 for the agent, axe).
- UX problems:
  - "Copy" gives no feedback such as "Copied", and fails silently when the clipboard API is unavailable (`AgentKeys.tsx:69`).
  - A failed revoke leaves its error in the ConfirmDialog for the next key revoked, because `revoke.reset()` is never called (`AgentKeys.tsx:141`).
  - Focus is lost to `<body>` after revoking (the "Revoke" trigger disappears) and after "I have saved it" (the panel unmounts) (`AgentKeys.tsx:75-77, 98-102`).
  - On a load error, the empty state "No agent has a key yet" renders under the error (`AgentKeys.tsx:81-85`).
  - The eyebrow "The product" mislabels a settings page (`AgentKeys.tsx:40`).
  - Name rules are only prose, with no client-side validation (`AgentKeys.tsx:112`).
  - The setup line covers Claude Code only.
  - Navigating away before copying loses the secret with no warning.

---

### 16. Dev tools panel (every screen, when `GET /api/session` has `dev_tools: true`)
- Purpose: development-only snapshots of the whole database, restore, delete and reset (`screens/dev/DevTools.tsx`, `snapshots.ts`, `api/dev.ts`).

- **INV-DEV-01** Gate: rendered only if the session announces `dev_tools === true`, which the API sends with `DEMIURGO_DEV_TOOLS=1` (`snapshots.ts:6-8`; `DevTools.tsx:45-48`).
- **INV-DEV-02** A "Dev" tab fixed at the bottom centre of every signed-in screen opens the dialog (`DevTools.tsx:97-104`).
- **INV-DEV-03** The person menu's "Snapshots…" opens the same dialog, through a module-level opener registry (`snapshots.ts:21-34`; `DevTools.tsx:53`).
- **INV-DEV-04** Dialog "Snapshots": "Copies of the whole database (<database>): projects, conversations, runs and knowledge. Development only." (`DevTools.tsx:108-111`).
- **INV-DEV-05** Save (`DevTools.tsx:59-67, 77-80, 113-131`):
  - "Label" (optional, max 60, placeholder "after day 1") and "Save snapshot";
  - it calls `saveSnapshot(label)` (`POST /api/dev/snapshots {label}`);
  - on success the page reloads (`location.reload()`), because the API restarted.
- **INV-DEV-06** List, from `devSnapshotsQuery` (`GET /api/dev/snapshots` → `{database, snapshots[]}`), fetched only while open (`DevTools.tsx:56, 133-152`; `snapshots.ts:12-19`). Each row shows:
  - the label;
  - "<day time> · <summary> · <x.x MB>", where the summary is "No projects", "<name> · N event(s)" or "N projects · N events".

  It shows "Loading…" and "No snapshots yet." when applicable.
- **INV-DEV-07** "Restore" (`DevTools.tsx:69-71, 81-85`):
  - native `confirm("Restore «label»? Everything done after it is lost. You stay signed in.")`;
  - `POST /api/dev/snapshots/:name/restore`;
  - `visits.forget()` (clears `localStorage['demiurgo:visits']` and stops remembering);
  - `location.assign('/')`.
- **INV-DEV-08** "Delete": native `confirm("Delete the snapshot «label»?")`, then `DELETE /api/dev/snapshots/:name`, then the list is invalidated (`DevTools.tsx:60-63, 86-88`).
- **INV-DEV-09** "Reset", with the note "Reset: an empty database with the same people, ready for a new Day 1.":
  - `confirm("Reset <db>? Every project is deleted. You stay signed in. Save a snapshot first if in doubt.")`;
  - `POST /api/dev/reset`;
  - forget the visits;
  - `location.assign('/')` (`DevTools.tsx:89-93, 155-162`).
- **INV-DEV-10** Busy state: Working "Restarting the API…" or "Deleting…". Every button and the label field are disabled, and the dialog cannot be closed while busy (`DevTools.tsx:96, 164-168`).
- **INV-DEV-11** Errors: `Reasons` for the list and for the action (`DevTools.tsx:153, 169`).

- Real-time: none. The API holds requests while its core restarts (`packages/api/src/server.ts:96-97`).
- Tests: `unit/dev-snapshots.test.ts` (the gate, the summary, the opener). **No e2e**, because the e2e server runs without dev tools.
- UX problems:
  - It uses native `window.confirm`, unlike the app's ConfirmDialog (`DevTools.tsx:82, 87, 90`).
  - The fixed "Dev" tab overlaps the bottom centre of every page (`DevTools.tsx:98-103`).
  - Saving reloads the page and loses unsaved UI state (`DevTools.tsx:66`).
  - Snapshot `source` and `migration` are never shown (`api/dev.ts:7-15`).

---

### 17. Live event stream (app-wide; `api/stream.ts`, `api/progress.ts`)
- Purpose: one Server-Sent Events stream per open project keeps every screen current without reloading.

- **INV-LIVE-01** `ProjectShell` calls `useProjectStream(projectId)`, which opens `new EventSource('/api/projects/:id/events/stream?from=latest')` once `/api/tables` has loaded (`ProjectShell.tsx:10`; `stream.ts:80-96`). There is no stream outside `/p/:id/*`.
- **INV-LIVE-02** Server contract (`packages/api/src/server.ts:210-280`):
  - `from=latest` first sends `event: ready` with `id: <latest>` and `data {latest}`;
  - each log row arrives as `id: <event id>`, `event: <command name>`, `data: EventRow`;
  - `event: run.progress` (no id) carries `RunProgress`;
  - a `: heartbeat` comment is sent every 15 s.

  The browser resends `Last-Event-ID` on reconnect, and the server replays everything after it.
- **INV-LIVE-03** The client listens to every command name in `tables.capabilities.commands`, plus `ready` and `run.progress` (`stream.ts:108-124`).
- **INV-LIVE-04** Invalidation. Each event adds the query names for its `entity_type` (the third key segment under `['p', projectId, …]`). They are flushed together after 60 ms (`stream.ts:13-34, 86-95, 112-118`):

  | entity_type | invalidates |
  |---|---|
  | proposal | inbox, batch, state, record, readiness |
  | batch | inbox, batch, state, runs |
  | record | record, state |
  | record_version | record, readiness, state, inbox |
  | criterion | record |
  | link | record, readiness, inbox, state |
  | question | exploration, inbox, state, readiness, explorations, stages |
  | stage | stages, explorations, state |
  | message | exploration, explorations |
  | exploration | exploration, explorations, state, events |
  | ai_run | run, runs, exploration, events |
  | context_pack | run |
  | knowledge_update | knowledge, inbox |
  | knowledge_node / knowledge_edge | knowledge |
  | classification / taxonomy | knowledge, inbox |
  | idea_assessment | knowledge, inbox, batch |
  | source | sources |
  | agent_token | tokens |

  Sub-keys follow their prefix. For example, `knowledge` also refreshes search, graph, idea-assessments, rebuild and taxonomies. `runs` refreshes usage. `run` refreshes a run's calls and events. `events` refreshes the entity events.
- **INV-LIVE-05** Event listeners. `onProjectEvent(listener)` lets other modules react to each row: the record History tab refetches the events of its own versions (`blueprint/HistoryTab.tsx:31-38`).
- **INV-LIVE-06** Latest event id (`latestEventId`, `onLatestEvent`), set from `ready` and from each event and only ever moving forward (`stream.ts:46-60`). `overview/lens/visit.ts` stores the last event seen per project in `localStorage['demiurgo:visits']` on each event and on `pagehide` (`visit.ts:77-87`). This is the baseline for "While you were away" (AC-INT-001-16).
- **INV-LIVE-07** Run progress. `run.progress` messages go to an in-memory map per run that never goes back within one call: tokens only grow, and late messages are dropped (`progress.ts:25-35`). `progressText` renders "<Starting|Thinking|Writing|Finishing|Something went wrong>… N tokens · m:ss" (`progress.ts:51-70`). `useRunProgress` feeds Day 1 (`Reading.tsx:417-424`), thread run cards (`thread/RunCards.tsx:98`) and the Run page (`run/Run.tsx:210`).
- **INV-LIVE-08** Connection state is connecting, open or down (a module-global store, `useConnection`) (`stream.ts:62-78, 98-107`).
- **INV-LIVE-09** Disconnected banner. After 1.5 s in "down", a sticky amber band under the header (`role=status`) reads "Can't reach DEMIURGO. Retrying…". It hides when the connection reopens (`stream.ts:136-157`; `ProjectShell.tsx:14`).
- **INV-LIVE-10** Reconnect. On `open` after a cut, every `['p', projectId]` query is invalidated, in addition to the `Last-Event-ID` replay (`stream.ts:98-103`).
- **INV-LIVE-11** Commands. After any 2xx from `useCommand`, every `['p', projectId]` query is invalidated; the stream confirms afterwards (`commands.ts:19-25`).
- **INV-LIVE-12** Polling fallbacks exist where the stream may miss or not cover something:
  - Day 1 thread and runs every 2.5 s while the answer waits (`onboarding/hooks.ts:15-18`);
  - a run's provider calls every 2 s while the run is active (`run/Engine.tsx:108`).
- **INV-LIVE-13** Leaving the project closes the source and resets the connection to "connecting" (`stream.ts:125-131`).

- Tests:
  - `e2e/realtime.spec.ts:3` (AC-INT-001-15: another actor's batch updates `data-needs` with no reload);
  - `packages/api/test/web.test.ts:98` (AC-INT-001-15: `from=latest` and `ready`);
  - `unit/run-progress.test.ts`;
  - `unit/models-engines.test.ts:120` (AC-AGE-002-10, `progressText`);
  - `unit/lens-visit.test.ts` (AC-INT-001-16).
  - **No test covers the disconnected banner or reconnection.**
- UX problems and gaps:
  - **The banner can lie forever.** When the stream fails with a non-200 status (for example a 401 after the session expired, or a 403), `EventSource` closes for good and does not retry. The client still shows "Retrying…" (`stream.ts:104-107`; `server.ts:215` `requireQuery` rejects before the stream starts). No redirect to sign-in happens, because `onUnauthorized` is fetch-only (`client.ts:62`).
  - No manual "Retry now", no "Reconnected" confirmation, and no connectivity indicator outside the project shell.
  - Not refreshed by events:
    - `project` events (`project.rename`, `project.archive`): the header name and the projects list go stale in other tabs, because `project` is not in `INVALIDATES` and `['projects']` is outside `['p']`;
    - `['p', id, 'map']` and `['p', id, 'journeys']` (`api/views.ts:58-65`): the Map and Journeys screens do not update from other actors' changes; they refresh only after the person's own command, or after a reconnect, which invalidates the whole project;
    - `['models', …]` and `['dev', 'snapshots']`;
    - `['p', id, 'changes', since]`, which has `staleTime: Infinity` by design.
  - Commands that return 2xx invalidate the entire project cache, which is a broad refetch of every mounted project query (`commands.ts:23`).
  - An event whose command is missing from `/api/tables` is silently ignored, because listeners are registered per command name (`stream.ts:123-124`).
  - The banner and the Day 1 band share `sticky top-14 z-20` and overlap (`stream.ts:153`; `onboarding/parts.tsx:58`).

---

### Shared data layer notes

**HTTP client (`api/client.ts`)**
- `request<T>(method: 'GET'|'POST'|'PUT'|'DELETE', path, body?)` and `get<T>(path)`.
- Same origin with `credentials: 'same-origin'` and `accept: application/json`, plus `content-type` when there is a body.
- `x-demiurgo-csrf: <token>` is sent on every non-GET when a token is held (`CSRF_HEADER`).
- The CSRF token is held in memory only, through `setCsrf()`. It is set by `sessionQuery` and by the sign-in response, and cleared on sign-out or 401.
- The server rejects a person's mutation without a valid CSRF header with 403, and checks Origin (`packages/api/src/server.ts:110-117`).
- Errors throw `ApiError(status, type, message, reasons[])`. The body shape is `{error, message, reasons}`. A network failure becomes `status 0`, `type 'network'`, "Can't reach DEMIURGO.".
- A 401 on any path except `/api/session` fires the `onUnauthorized` listeners.

**Session endpoints**
- `POST /api/session {username, password}` → `{person, csrf, expires}`.
- `GET /api/session` → `{actor, type:'person'|'agent', csrf, dev_tools?}`.
- `DELETE /api/session`.
- `POST /api/projects {name}` → `{project_id, state, seq}`, which is `project.create` and does not go through the generic command route.

**Commands (`api/commands.ts`)**
- `runCommand<R>(projectId, {command, entityId?, data?})` sends `POST /api/projects/:projectId/commands/:command` with `{entity_id?, data: data ?? {}}`.
- The response is `CommandResponse<R> = {entity, entity_id, state, seq, result: R|null}`.
- `useCommand<R>(projectId)` is a TanStack mutation whose `onSuccess` invalidates `['p', projectId]`. Its `.error` is an `ApiError` to show with `<Reasons error=…/>`.

**Allowed actions (`api/tables.ts`, `ui/ActionBar.tsx`)**
- Buttons come from `GET /api/tables` (capabilities plus transitions) and `GET /api/commands` (the contract, with `implemented` and a JSON Schema); both have `staleTime` Infinity.
- `actionsFor(tables, catalog, entity, state, actor='human')` gives the commands whose transition leaves `state` and whose actor is allowed, excluding unimplemented ones.
- Other helpers:
  - `canCreate(tables, command)`: a transition from `new`;
  - `isDecisive`;
  - `stateLabel`;
  - `useActions`, `useAllows`, `ActionBar` and `ActionButtons` (the primary variant when decisive; words from `COMMAND_WORDS`; `data-command`).
- The rebuild must keep "no button unless the tables allow it" (AC-WEB-001-02, `unit/tables.test.tsx`).

**Query keys (`api/queries.ts`, `views.ts`, `models.ts`, `dev.ts`)**

Global keys:

| Key | Endpoint | Notes |
|---|---|---|
| `['session']` | `GET /api/session` | staleTime 60 s |
| `['projects']` | `GET /api/projects` | |
| `['tables']` | `GET /api/tables` | staleTime Infinity |
| `['commands']` | `GET /api/commands` | staleTime Infinity |
| `['models','providers']` | `GET /api/providers` | |
| `['models','agents', projectId or 'everywhere']` | `GET /api/agents[?project=]` | |
| `['dev','snapshots']` | `GET /api/dev/snapshots` | |

Per project, every key starts with `['p', projectId, …]`:

| Key after `['p', id]` | Endpoint |
|---|---|
| `'state'` | `GET …/state` |
| `'inbox'` | `GET …/inbox` |
| `'explorations'` | `GET …/explorations` |
| `'exploration', id` | `GET …/explorations/:id` |
| `'record', code` | `GET …/records/:code` |
| `'readiness', versionId` | `GET …/versions/:id/readiness` |
| `'batch', id` | `GET …/batches/:id` |
| `'run', id` | `GET …/runs/:id` |
| `'run', id, 'calls'` | `GET …/runs/:id/calls` |
| `'run', id, 'events', packId` | run events |
| `'runs', filter` | `GET …/runs?exploration=&state=` |
| `'runs', 'usage'` | `GET …/usage` |
| `'events', from` | `GET …/events?from=` |
| `'events', 'entity', id` | `GET …/events?entity=` |
| `'knowledge'` | `GET …/knowledge` |
| `'knowledge', 'search', q` | `GET …/knowledge/search?q=` |
| `'knowledge', 'graph'` | `GET …/knowledge/graph` |
| `'knowledge', 'idea-assessments'` | `GET …/knowledge/idea-assessments` |
| `'knowledge', 'rebuild'` | `GET …/knowledge/rebuild` (staleTime 60 s) |
| `'knowledge', 'taxonomies'` | `GET …/taxonomies` |
| `'sources'` | `GET …/sources` |
| `'tokens'` | `GET …/tokens` |
| `'stages'` | `GET …/stages` |
| `'changes', since` | `GET …/changes?since=` (staleTime Infinity) |
| `'map'` | `GET …/map` |
| `'journeys'` | `GET …/journeys` |

The invalidation contract is: third key segment equals the name in `INVALIDATES`.

**Non-query endpoints**
- Models:
  - `refreshProviders()` → `POST /api/providers/refresh`;
  - `assignEngine(agent, scope, engine, projectId?)` → `PUT /api/agents/:agent/assignment {scope, project_id?, provider, model, effort}`;
  - `unassignEngine(agent, scope, projectId?)` → `DELETE /api/agents/:agent/assignment?scope=&project=`.
- Dev:
  - `saveSnapshot(label)` → `POST /api/dev/snapshots`;
  - `restoreSnapshot(name)` → `POST …/:name/restore`;
  - `dropSnapshot(name)` → `DELETE …/:name`;
  - `resetEnvironment()` → `POST /api/dev/reset`.
- Stream: `GET /api/projects/:id/events/stream?from=latest` (SSE).

**Query client defaults**: `staleTime` 5 s, `refetchOnWindowFocus` false, no retry on 4xx and at most 2 retries otherwise (`main.tsx`).

**Router guard**: an `authed` layout route (`ensureQueryData(sessionQuery)`), a project loader that validates the id against `projectsQuery`, `defaultPreload: 'intent'` and `scrollRestoration`.

**Error convention**:
- Every action shows `<Reasons error>` next to itself and keeps what was written.
- A 409 whose reasons say knowledge is behind becomes "catching up".
- "Choose a model for …" links to Models & providers.
- `Reasons` takes focus on appear, which a rebuild must reconcile with comboboxes and popovers (see the SHELL problems).
- Readiness uses `ReadinessBox` (`data-kind="reason"` or `"warning"`).

**Client-side stores to keep or port**:
- the legend store (a context, with `localStorage['demiurgo:legend'] = {dismissed, seen[]}`);
- the run-progress map (module level);
- the latest event id and the visits (`localStorage['demiurgo:visits'] = {projectId: {event, at}}`);
- the `live` Day 1 set (tab memory);
- the side-panel width (`localStorage['dm-aside-panel-width']`);
- the dev-panel opener registry;
- the connection store.

**Useful pure helpers already unit-tested** (reuse rather than rewrite):
- `onboarding/day.ts` (`readingOf`, `readingsOf`, `answerOf`, `writtenBy`, `promptOf`, `pendingInOrder`, `walkSummary`, `answersOf`, `decisionRequest`, `isDecisionRequest`, `daySummary`, `dayLabel`, `purposeOf`, `IDEA_EXAMPLES`);
- `onboarding/landing.ts`;
- `models/engines.ts`;
- `ui/ask.ts`;
- `blueprint/search.ts`;
- `dev/snapshots.ts`;
- `api/progress.ts`;
- `lib/time.ts` (`ago`, `shortDate`, `dayTime`, `duration`, `between`);
- `words.ts` (`whoOf`, `stateWord`, `failureWord`).

---

### Product vocabulary (verbatim from `src/words.ts`, plus the in-file words of this area)

**Marks (`MARKS`: name, then phrase; the tooltip and the legend say the same)**

| Mark | Phrase |
|---|---|
| Confirmed | "A person said yes." |
| Assumed | "DEMIURGO concluded it. Not confirmed yet." |
| Proposed | "Suggested, waiting for you." |
| Open | "Asked, no answer yet." |
| Unknown | "Not known yet." |
| Parked | "Kept for later." |
| Dropped | "Doesn't apply." |
| Replaced | "A newer version exists." |
| Out of date | "What it was based on changed: it can no longer be accepted." |
| Conflict | "Contradicts something confirmed." |
| Problem | "Something went wrong or needs a review." |
| Working | "DEMIURGO or an agent is on it." |
| Not active | "Finished or stopped: nothing to do." |
| Done | "Finished without problems." |

**Stage bars (`ui/signals.tsx` `STAGE_WORDS`)**
- Not ready: "Something still blocks it. Not built."
- Ready to build: "Confirmed, nothing blocks it. Not built yet."
- In doubt: "It was ready to build, and now something blocks it."

**Needs you** (legend entry): "Things waiting for you." The bubble tooltip is "Needs you: N thing(s) wait(s) for you."

**Who (`WHO_PHRASES`; names You / DEMIURGO / Agent / Automatic)**
- You: "Only people confirm."
- DEMIURGO (with its model): "Drafts, asks and proposes."
- Agent (with its name): "From outside. Only proposes."
- Automatic (with its component): "A rule or test that ran alone."
- `whoOf` maps actor prefixes: `human:` gives You, `agent:run:` gives DEMIURGO, `agent:<name>:` gives Agent, `system:` gives Automatic.

**Epistemic status to mark (`EPISTEMIC_MARK`)**: confirmed→Confirmed, proposed→Proposed, pending→Open, unknown→Unknown.

**Observations (`OBSERVATION_WORDS`)**: claim → "Claim" (Proposed), hypothesis → "Hypothesis" (Proposed), unknown → "Unknown" (Unknown).

**State words used in this area (`STATE_WORDS`)**
- question: pending "Open", inferred "Assumed", confirmed "Confirmed", postponed "Parked", discarded "Dropped".
- proposal: pending "Proposed", accepted "Accepted", accepted_edited "Accepted with edits", rejected "Rejected", superseded "Out of date".
- batch: pending "Pending", accepted "Accepted", rejected "Rejected", resolved "Resolved", superseded "Out of date".
- ai_run: queued "Queued", running "Working", completed "Completed", failed "Failed", cancelled "Cancelled", interrupted "Interrupted".
- knowledge_update: queued, classifying and verifying are all "Updating"; applied "Applied"; rejected "Failed". The freshness states in the header are current, updating and behind.
- exploration: active "Active", concluded "Concluded", set_aside "Set aside".
- Agent keys use their own words: active "Active" (Done mark) and revoked "Revoked" (Dropped mark).

**Commands in this area (`COMMAND_WORDS`)**
- message.post "Send"
- exploration.open "New thread"
- question.confirm "Confirm" (Day 1 uses "Answer")
- question.postpone "Park" (Day 1 uses "Not now" / "Park it")
- run.request "Ask DEMIURGO"
- run.retry "Retry"
- run.cancel "Cancel"
- These have no dictionary entry and use screen labels: project.rename ("Rename"), agent_token.issue ("Create the key"), agent_token.revoke ("Revoke").

**Record types (`TYPE_WORDS`)**: fdr "Feature", adr "Tech decision", decision "Decision", bug "Bug", requirement "Requirement", quality_requirement "Quality requirement", threat_model "Threat model", production_readiness "Production readiness".

**Run actions (`ACTION_WORDS`)**: exploration_chat "Conversation", design_proposal "Draft", echo "Echo".

**Run failures (`FAILURE_WORDS` and `failureWord`)**

| Failure kind | Words |
|---|---|
| invalid_output | "It couldn't finish: the output didn't match the format. Nothing was changed." |
| agent_error | "The agent answered with an error. Nothing was changed." |
| timeout | "It took too long and was stopped. Nothing was changed." |
| infra (and the interrupted state) | "DEMIURGO restarted while it was running. Nothing was changed." |
| cancelled | "You cancelled it. Nothing was changed." |
| stale_knowledge | "The knowledge changed while it was running. Nothing was changed." |
| no kind | "It stopped without saying why. Nothing was changed." |
| unknown kind | "It stopped with an error. Nothing was changed." |

**Product words (`PRODUCT_WORDS`)**
- needsYou: "Needs you"
- nothingNeedsYou: "Nothing needs you. You can close DEMIURGO."
- readyToBuild: "Ready to build"
- notReady: "Not ready"
- notBuilt: "not built"
- catchingUp: "DEMIURGO is catching up with your latest changes. Try again in a moment."
- cantReach: "Can't reach DEMIURGO. Retrying…" (the disconnected banner)
- onlyAPerson: "Only a person can do this."
- notAllowed: "This isn't allowed here."

**Shell and section names**:
- the sections: "Product", "Threads", "Knowledge", "Sources", "Activity", "Needs you";
- the Product views: "Overview", "Map", "Origins", "Journeys";
- the search label: "Search decisions, features, ideas";
- the person menu: "Signed in as <person>", "Models & providers", "Rename the project…", "Agent keys", "Snapshots…", "Sign out";
- the legend: "What the marks mean", "New on this screen", "You know these", "Got it", "Press ? to open it anywhere.", "The legend stays here. Press ? to open it.".

**Live progress (`api/progress.ts` `KIND_WORDS`)**: started "Starting", thinking "Thinking", message "Writing", usage and result "Finishing", error "Something went wrong", anything else "Working". The format is "<doing>… N tokens · m:ss".

**Day 1 words**
- The reading verbs, per subject (`Reading.tsx:34-56`):
  - idea: "Reading your idea…";
  - correction: "Reading your correction…";
  - decisions: "Proposing decisions…".
- Waiting: "Waiting for DEMIURGO…"; catching up: "DEMIURGO is catching up on what you just decided…".
- Impact (`day.ts` `IMPACT_WORDS`):
  - high "It shapes a lot of the design.";
  - medium "It shapes part of the design.";
  - low "It settles a detail.".
- Impact levels: "High impact", "Medium impact", "Low impact".
- The decision-request prefix `DECIDE_PREFIX`: "I decide:".
- The Ask-bar thread purpose `PRODUCT_PURPOSE`: "About the whole product"; a record thread is "About <title>".
- "Later" is the tag for what H1 cannot give yet (S6).

## Part B · Product overview, blueprint, map, origins, journeys, knowledge, sources


Feature-parity checklist of `packages/web` (branch `ux/frontend-rebuild-2026-09-25`), read-only survey.
All paths are relative to `packages/web/` unless stated. "`P`" = `/api/projects/:projectId`.

Conventions used in every item:

- **Reads**: `fnName` (file) → `GET path`. All project reads are TanStack queries keyed `['p', projectId, <name>, …]`.
- **Writes**: always `POST P/commands/<command>` with body `{ entity_id?, data }` (`useCommand`/`runCommand`, `api/commands.ts`). On 2xx every `['p', projectId, …]` query is invalidated (`commands.ts:23`), then the SSE stream confirms it.
- **Buttons from the tables**: every action button marked "(tables)" exists only if `GET /api/tables` allows a `human` that command from the entity's current state and `GET /api/commands` says it is implemented (`api/tables.ts:15-41`, `ui/ActionBar.tsx`). "Create" affordances use `canCreate` (`tables.ts:44-48`).
- **Errors**: every failing command or query shows `Reasons` (see Shared UI S5): a rust `role="alert"` box, focus moved to it, with the product title per status and the server's reasons verbatim.
- Query defaults (`main.tsx:9-17`): `staleTime` 5 s, no refetch on window focus, 4xx never retried, other errors retried twice.

---

### Real time (applies to every screen below)

- One `EventSource` per open project: `GET P/events/stream?from=latest` (`api/stream.ts:96`), opened by `ProjectShell` (`screens/shell/ProjectShell.tsx:10`).
- It listens to one SSE event type per command name in `tables.capabilities.commands` (`stream.ts:123-124`), plus `ready` (sets the latest event id, `stream.ts:108-111`) and `run.progress` (live run progress, `stream.ts:119-122`).
- Each event invalidates, after a 60 ms batch, the queries whose third key part is listed for its `entity_type` (`stream.ts:13-34`):

| entity_type | invalidates query names |
|---|---|
| proposal | inbox, batch, state, record, readiness |
| batch | inbox, batch, state, runs |
| record | record, state |
| record_version | record, readiness, state, inbox |
| criterion | record |
| link | record, readiness, inbox, state |
| question | exploration, inbox, state, readiness, explorations, stages |
| stage | stages, explorations, state |
| message | exploration, explorations |
| exploration | exploration, explorations, state, events |
| ai_run | run, runs, exploration, events |
| context_pack | run |
| knowledge_update | knowledge, inbox |
| knowledge_node / knowledge_edge | knowledge |
| classification / taxonomy | knowledge, inbox |
| idea_assessment | knowledge, inbox, batch |
| source | sources |
| agent_token | tokens |

- `map`, `journeys` and `changes` are in **no** list: those screens do not update live from other actors (see UX notes).
- After a disconnection every project query is refetched (`stream.ts:98-103`). An amber `role="status"` band "Can't reach DEMIURGO. Retrying…" appears after 1.5 s down (`stream.ts:136-157`).
- Every event id seen (and `ready`) is written to the last-visit memory used by the "What changed" lens (`screens/overview/lens/visit.ts:84-87`).

---

### Product views tabs (shared by Overview, Map, Origins, Journeys)

- **INV-OVW-01**: The "Product views" sub-navigation (`screens/shell/Header.tsx:242-268`) offers Overview (`/p/$projectId`), Map, Origins and Journeys. The active one has `aria-current="page"`. In the global header the "Product" section is active on all four and on `/records/*` (`Header.tsx:29`).

---

### Overview (product blueprint): `/p/$projectId` (no search params)

- **Purpose:** The product at a glance: design stages, features as cards, decisions, requirements and bugs as nodes, threads with open questions, what needs the person, what is running and what was decided. Plus "Ask DEMIURGO" about the whole product and the "What changed" lens.
- **Route guard:** Needs a session (redirects to `/sign-in?next=`). The project must be in `GET /api/projects`, else Not Found (`router.tsx:84-92`). The screen remounts per project (`Overview.tsx:119-122`).
- **Reads:** `stateQuery` → `GET P/state`, `inboxQuery` → `GET P/inbox`, `runsQuery` → `GET P/runs`, `explorationsQuery` → `GET P/explorations`, `stagesQuery` → `GET P/stages`, `taxonomiesQuery` → `GET P/taxonomies`, and the lens reads (see LENS).

#### Main column

- **INV-OVW-02**: **Title block.** Eyebrow "The product", H1 = `state.project.name` (`Overview.tsx:163-167`).
- **INV-OVW-03**: **Progress line** under the title (`Blueprint.tsx:37-67`, `progress.ts:40-55`). Text: "Ready to build: R of N features · X need(s) you · Y in progress". Beside it, a segmented bar (ink = ready, blue = needs you, amber = in progress, empty = rest) with tooltip and `role="img"` + `aria-label`.
  - Ready = `readiness.ready`.
  - Needs you = features with anything waiting (see OVW-11).
  - In progress = features whose origin thread has a queued/running run other than `design_proposal`, plus every run drafting a new feature.
  - Shows "No features yet." when there are no features and nothing is drafting. Hidden when the product is empty.
- **INV-OVW-04**: **"+ New record"** link to `/p/$projectId/records/new`, only if `canCreate(record.create)` (`Blueprint.tsx:241-250`).
- **INV-OVW-05**: **"Show what changed · N"** pill button (eye icon): see LENS-03 (`Overview.tsx:170-175`).
- **INV-OVW-06**: **Product design stages** section (`Stages.tsx`), `stagesQuery` → `GET P/stages` (StageRow[]).
  - Heading "Product design" plus " · now: <open stage title>". Explanation: "What holds for the whole product. Each feature then has its own requirements, checks and Ready to build."
  - One card per fixed stage, in order: "<position+1> · Passed / Open / Not started", title, `produces`, "<covered>/<total> questions answered". Not-started cards are faded; the open one is emphasised.
- **INV-OVW-07**: **Start design stages** button, shown when no stage has started. Runs `stage.open` with `{ stage: <first stage key> }` (`Stages.tsx:35-43`). No confirmation.
- **INV-OVW-08**: On an open or passed stage card:
  - "Open thread" link → `/threads/<stage.exploration_id>`.
  - On the open stage, a **"Pass stage"** button runs `stage.pass` (entity = stage id). It is primary when covered = total, a text button otherwise, and always enabled: the server refuses with reasons (`Stages.tsx:91-107`, `56`).
- **INV-OVW-09**: **"Later" rows**: "Who uses it" and "Rules for the whole product", each with a dashed "Later" pill and "In a later increment, DEMIURGO will read them from your idea." (`Blueprint.tsx:69-93`). These are informational placeholders.
- **INV-OVW-10**: **Empty product** (no features, decisions, bugs or stage records): "Nothing here yet. Write a record yourself or open a thread to design it with DEMIURGO." plus a "Go to Threads" link (`Overview.tsx:185-192`).
- **INV-OVW-11**: **Features section** "Features · N". Grid of 4 columns (3 under 1440 px). Each `fdr` is a FeatureCard (`RecordCard.tsx:195-225`) with 6 zones:
  - Type: feature icon.
  - Certainty: mark and word from `epistemic_status` (confirmed → Confirmed, proposed → Proposed, pending → Open, unknown → Unknown), with tooltip.
  - Stage bars: `rowStage`. Ready (ink), In doubt (rust: was approved and now blocked), Not ready. Tooltip "N thing(s) block(s) it…".
  - **Needs-you blue count** = versions to approve of this code + proposals whose batch or dependencies cite the code + links under review from it + open/to-confirm questions of its origin thread (`record/logic.ts:69-88`).
  - Title and line (`summary`, the first paragraph of the latest version).
  - Who mark (`updated_by` → You/DEMIURGO/Agent/Automatic) and when ("approved/drafted <ago>").
  - Signals (only non-zero): "vN" changed signal when a draft is newer than current (tooltip "Version N is a draft; version M is the current one."); checks count (tooltip "N checks. None has run: nothing is built yet."); Working signal with live duration m:ss when a run works in its origin thread (`data-feature-working`).
- **INV-OVW-12**: **Record peek** on every feature card and node ("point, peek, keep", see S1). Content (`RecordCard.tsx:93-166`):
  - TYPE · status word, stage bars (features only), "CODE · vN" (current, else latest).
  - Title and summary.
  - Blue box with the waiting phrase ("3 versions to approve, 1 question in its thread").
  - For features: readiness box with the server's reasons verbatim, or "Nothing blocks it. Nothing is built yet.", plus "N warning(s) on how its checks can be verified".
  - Facts: Versions ("vN current" / "None approved yet", "· vM draft"), Checks ("None yet"/N, not for decisions), "Comes from" (thread purpose).
  - Footer: "Approved/Drafted by you|<who> · <day time>" and an **Open** link → `/records/<code>`.
  - Click keeps the peek (card drawn selected). Esc closes it. Enter or double-click opens the record.
- **INV-OVW-13**: **Drafting cards**: one per queued/running `design_proposal` run (`Blueprint.tsx:174-202`).
  - Card: Proposed mark, "A new feature", "From <decision title>" (the run's `scope.id` resolved to a record version through `versionIndex`) or "From an approved decision", DEMIURGO who mark with model, "started <ago>", Working "Drafting · m:ss".
  - Peek (`Blueprint.tsx:111-169`): link to the source decision, "Writing a first draft", "It becomes a feature when you accept its package.", **Cancel** (`run.cancel`, tables for `ai_run` state) and **Open** → `/runs/<id>`.
  - Enter opens the run.
- **INV-OVW-14**: **Parked idea cards**: every exploration with `state = set_aside` (`explorationsQuery`) (`Blueprint.tsx:206-238`). Shows "IDEA · Parked" mark, the purpose, the `state_reason`, and "Set aside <ago>" (`last_activity`). The whole card links to the thread.
- **INV-OVW-15**: **Capture an idea** (dashed card, only if `canCreate(exploration.open)`) (`Blueprint.tsx:253-314`).
  - Dialog "Capture an idea": "It is saved as a thread, to think it through later. DEMIURGO is not asked anything." Field "Your idea" (required, max 1000). Submit "Save as a thread" runs `exploration.open { purpose }`.
  - On success the dialog closes and an inline status shows "✓ Saved as a thread · Open ›" (link to the new thread). The person stays on the overview. Errors show inside the dialog.
- **INV-OVW-16**: **"Decisions and tech decisions · N"**: `state.decisions` plus `adr` designs as Nodes in 2 columns (`RecordNode`, `RecordCard.tsx:227-247`). Each shows a type icon, compact certainty mark, title, and blue count with the waiting phrase as tooltip. Same peek as OVW-12.
- **INV-OVW-17**: **"Requirements, quality, security and production · N"**: records of type requirement, quality_requirement, threat_model and production_readiness as Nodes (same peek) (`Overview.tsx:233-241`).
- **INV-OVW-18**: **"Bugs · N"**: bug records as Nodes (same peek).
- **INV-OVW-19**: **"Threads with open questions · N"**: `state.explorations` with `open_questions > 0` (`Overview.tsx:55-93, 253-273`). Each is a thread Node with an Open mark labelled "N open question(s)", the purpose, "N question(s)", and a blue count (inbox open + to-confirm questions of that thread). It links to the thread.
- **INV-OVW-20**: **"Ask DEMIURGO about the whole product"**: sticky bottom composer (`ui/AskBar.tsx`, `ui/ask.ts`).
  - Chip "About: whole product". Placeholder "Ask or tell DEMIURGO anything about <project>". Field max 20 000 chars, grows up to about 5 lines.
  - Enter sends, Shift+Enter adds a new line. Button "Send" shows "Sending…" while pending.
  - Sending re-reads `GET P/explorations`. It reuses the most recent **active** thread with `origin_type = null` whose purpose starts with "About the whole product", or opens one (`exploration.open { purpose: "About the whole product" }`). Then it runs `message.post { exploration_id, text, respond: true }`.
  - Status line under the bar (`role="status"`, reads `explorationQuery` and `runsQuery{exploration}`):
    - answering: "Sent to <thread> · DEMIURGO is answering…" with the Working mark;
    - answered: "DEMIURGO answered in <thread> · Open the thread ›";
    - failed: "DEMIURGO couldn't answer: <failure words> · Open the thread".
  - On error, Reasons shows above the bar and the text is kept. The bar is hidden if a human cannot create both `message.post` and `exploration.open`.
- **INV-OVW-21**: **Loading and error**: a skeleton labelled "Loading the product" (title, 4 cards, 4 rows) while the state loads. If the state fails, `Reasons` shows instead. The right column renders independently of the main column (`Overview.tsx:134-136`).

#### Right column ("Side panel")

- **INV-OVW-22**: **Needs you panel** (`NeedsColumn.tsx:75-154`).
  - Heading "Needs you" with the blue count `inbox.total`.
  - When total > 0: summary "N item(s) · about M minute(s)". M uses the per-kind estimates in `needs-you/order.ts:39-48`: conflict 2, question 1, package 3, proposal 1, version 2, link 1, classification 1, update 1. The panel sits on a blue band.
  - Two skeleton rows while the inbox loads. When empty: "Nothing needs you. You can close DEMIURGO."
- **INV-OVW-23**: **Ordered list of what waits** (`needs.ts:66-179`, `NeedsColumn.tsx:22-45, 106-110`). The first 4 items are shown, each a link card: number, mark, kind label, title (2 lines), and where it comes from.

  | kind | label | title | "from" line | target |
  |---|---|---|---|---|
  | conflict (knowledge batch proposal) | Conflict | cited record title or code | `payload.reason` or "Knowledge found it." | batch |
  | question | Question | the question | thread purpose | thread |
  | postponed question | Parked question | the question | thread purpose | thread |
  | inferred question | Assumed answer | the question | thread purpose | thread |
  | package batch | Package | "Imported from design/", or the first proposal's title/purpose/document title, or the summary | "From an agent · <name>" / "From DEMIURGO" / "Automatic" / "From you" + " · N proposals" | batch |
  | item batch proposal | Proposal | proposal title | producer words | batch |
  | version | Version to approve, or "Old draft to discard" when not approvable | version title | "<Type> · CODE vN" | record `?v=N` |
  | link under review | Link to review | "from title → to title" | "CODE vN → CODE vM" | from record |
  | classification | Classification | "category · axis" | `node_ref` | `/needs-you` |
  | failed knowledge update | Knowledge update | "A knowledge update failed" | failure, or "It can be retried." | `/knowledge` |

  - A proposal's mark is Out of date when it has `obsolescence`, else its epistemic mark.
  - Order: conflicts; questions that block a not-ready feature's thread first, then the other questions; proposals and packages; versions; links; classifications; updates. Right after ratifying, versions go first.
  - Caption "In this order: what blocks more goes first."
- **INV-OVW-24**: "And N more in Needs you" link → `/needs-you`, shown when there are more than 4 items.
- **INV-OVW-25**: **Just-ratified mode**: records exist, none has a current version, and versions wait for approval (`needs.ts:182-185`).
  - Text "Everything is proposed: nothing is approved yet. Start with what you agree with."
  - Primary link "Start with the versions to approve" → first approvable version (`/records/<code>?v=<n>`). Secondary link "Or catch up with everything, one at a time" → `/needs-you?catch-up=1`.
- **INV-OVW-26**: **Normal mode**: primary link "Catch up" → `/needs-you?catch-up=1` with caption "One at a time. What you skip stays here."
- **INV-OVW-27**: **Taxonomy hint** (`knowledge/TaxonomyHint.tsx`, also shown at the end of Day 1), from `taxonomiesQuery`. When no taxonomy is approved:
  - with a draft: "A taxonomy is waiting for your approval: until then, what DEMIURGO knows is not grouped." plus "Review the taxonomy ›";
  - with none: "DEMIURGO doesn't group what it knows yet." plus "Set up how it groups knowledge ›".
  - Both links go to `/knowledge?tab=taxonomy`. The hint is hidden while loading or when an approved taxonomy exists.
- **INV-OVW-28**: **Running now** (`Blueprint.tsx:317-362`): every queued or running run (`runsQuery`).
  - Row: "Drafting a feature" (design_proposal) or "Answering", then " · <thread purpose>", then the Working mark with a live m:ss duration (ticks every second while something works). Each row links to `/runs/<id>`.
  - Empty: "Nothing. I'm waiting for you."
- **INV-OVW-29**: **Ready to build**: features in `state.ready_to_build`. Row: confirmed mark, title, stage bars (ready), link to the record. Empty: "Nothing is ready to build yet." (`NeedsColumn.tsx:160-183`).
- **INV-OVW-30**: **Recently decided**: up to 4 records whose latest version is approved, newest `updated_at` first (`progress.ts:58-63`). Row: confirmed mark, type icon, title, "<ago>" plus ", by you" when a human did it. Links to the record. Hidden when empty (`Blueprint.tsx:365-400`).

- **Real-time:** `state` (record, record_version, link, question, stage, exploration, proposal, batch events), `inbox` (proposal, batch, record_version, link, question, knowledge_update, classification, taxonomy, idea_assessment), `runs` (batch, ai_run), `explorations` (question, stage, message, exploration), `stages` (question, stage), `taxonomies` (knowledge_*, classification, taxonomy, idea_assessment). The lens `changes` query is refreshed only by the person's own commands or a reconnection. Durations tick locally (`run/hooks.ts:12-21`).
- **States handled:**
  - Main column: skeleton; Reasons on a state error; empty product.
  - Needs column: skeleton; "Nothing needs you".
  - Running now and Ready to build: empty lines.
  - Stages: nothing rendered while loading or on error.
  - Ask bar: answering, answered, failed.
  - inbox, runs and explorations errors are **not** shown.
- **Tests:**
  - `e2e/product.spec.ts`: AC-INT-001-04 (just ratified: all Proposed, "Start with the versions to approve"; marks by epistemic state, Ready to build list, thread node mark, agent proposal is Proposed, Catch up link). AC-WEB-001-03 (peek on hover and focus, Enter opens). Screens of cut 2.
  - `e2e/fidelity.spec.ts`: AC-INT-001-09 (Ask about the whole product: thread reuse, answering, failed with product words; capture an idea: parked card, Later rows, dialog, "Saved as a thread"). Fidelity screens (`data-stage="ready"`, `data-feature-working`, `data-drafting`).
  - `e2e/lens.spec.ts`: AC-INT-001-16.
  - `e2e/knowledge.spec.ts`: untitled test "a new project says its knowledge is not grouped yet…" (taxonomy hint).
  - `e2e/h1-walk.spec.ts`: AC-INT-001-01 (Ready to build bar at the end).
  - `unit/fidelity-overview.test.ts`: featureStatus, productProgress, recentlyDecided, working and drafting runs (no AC).
  - `unit/needs-you-order.test.ts` covers the minutes estimate.
  - **Untested:** design stages (`stage.open`, `stage.pass`), the overview's own Needs order (`needs.ts`), Running now and Recently decided (e2e).
- **UX problems:**
  - **Mixed click semantics in one grid.** Feature and decision cards keep the peek on click and open only on Enter or double-click (`ui/Peek.tsx:97-101`). Thread nodes and parked cards navigate on a single click (`Overview.tsx:68-73`, `Blueprint.tsx:208-216`). The peek anchor is a `div role="link"` that does not navigate on click (`Peek.tsx:86`).
  - **Peek actions can't be reached with the keyboard.** The popover is portaled, its autofocus is prevented (`Peek.tsx:114`) and blur hides it (`Peek.tsx:94-96`). So the drafting run's **Cancel** and every peek's **Open** are mouse-only (`Blueprint.tsx:143-160`). Enter still opens the page.
  - **Key facts hidden behind hover:** readiness reasons, versions, "Comes from" and what exactly waits live only in the peek (`RecordCard.tsx:122-163`), after a 400 ms delay (`Peek.tsx:11`).
  - **Two different orders for the same thing.** The column says "In this order: what blocks more goes first" (`NeedsColumn.tsx:104`), but its order (`needs.ts:126-130, 175-178`) differs from Catch up's rank (`needs-you/order.ts:141-157`). Examples: non-blocking questions come before proposals here but last in Catch up; "blocking" is defined differently (the thread of a not-ready feature vs. readiness reasons that cite the question).
  - **Two sources for one count:** "N items" is `inbox.total` (`NeedsColumn.tsx:66, 86`), but "And N more" counts the derived list (`NeedsColumn.tsx:111-117`), where a package is one item.
  - **Vague destinations:** classification items go to the whole `/needs-you` (`needs.ts:161`), failed updates to the Graph tab of `/knowledge` (`needs.ts:172`), and links under review to the record without the version or the link (`needs.ts:150`).
  - **Stages:** nothing shows while loading or on error (`Stages.tsx:19`). "Pass stage" is always enabled on the open stage: readiness is conveyed only by button style (`Stages.tsx:103`). "Start design stages" runs without confirmation (`Stages.tsx:39`).
  - **Silent failures:** inbox, runs and explorations query errors are ignored (`Overview.tsx:126-128`). The Needs panel then shows a skeleton forever (`NeedsColumn.tsx:90-94`).
  - **Progress line mixes populations.** Drafting runs count as "in progress" but aren't in the feature total (`progress.ts:47`, `Blueprint.tsx:40-44`). The meaning of each bar segment is carried by colour; the text beside it helps.
  - **Type fallbacks:** stage-record types (requirement, quality, threat, production) have no icon or DS type (`ui/icons.tsx:111-114`). Nodes fall back to "decision" (`RecordCard.tsx:235`) while their peek icon falls back to "feature" (`RecordCard.tsx:100`).
  - **Thread nodes are always drawn with state "open"** (`Overview.tsx:78`).
  - **Density and layout:** 6 zones plus signals per card, 5 record sections, stages, "Later" placeholders and a sticky ask bar on one page. Fixed 4/3-column grids with no narrow layout (`Overview.tsx:195, 225`). The "Later" rows take prime space with no action (`Blueprint.tsx:86-92`).
  - **Terminology overlaps:** "Parked idea" = a set-aside thread (`Blueprint.tsx:225`, `Rail.tsx:172`), "Parked" = a postponed question (`words.ts:56`), "Set aside" = the thread state (`words.ts:103`).

---

### "What changed" lens on the Overview (LENS)

- **Purpose:** Coming back, tell what changed since the last visit in this browser, highlight the cards that changed and dim the rest.
- **Reads:** `changesQuery(since)` → `GET P/changes?since=<event id>` (`staleTime` Infinity), `batchQuery` → `GET P/batches/:id` for up to 12 changed batches, `tablesQuery` (authority states), and `stateQuery` (titles and check counts).

- **INV-LENS-01**: **Last-visit memory** (`lens/visit.ts`):
  - localStorage key `demiurgo:visits` holds `{ [projectId]: { event, at } }`. The baseline is read once when the app starts (`visit.ts:26-33`).
  - It is updated with the newest event id on every SSE event or `ready`, and on `pagehide`, while the address is a project page. It never goes backwards (`visit.ts:35-46`).
  - `forget()` clears it and stops remembering until reload (used after a dev snapshot restore, `visit.ts:51-59`). Storage failures are tolerated.
- **INV-LENS-02**: **Availability:** the lens needs a baseline (never on the first visit) and at least one line. It is **on by default** when available (`useLens.ts:31-67`).
- **INV-LENS-03**: **"Show what changed · N"** (N = number of lines) appears in the title actions when the lens is available but off. It turns the lens on (`Overview.tsx:170-175`).
- **INV-LENS-04**: **"While you were away"** panel (region; design-system `WhileAway`) (`lens/WhileAway.tsx`).
  - Title "While you were away" plus " · since <day time of the baseline>".
  - One row per changed thing, in API order (`data-id="<kind>:<key>"`): time (e.g. "Thu 18:52"), who mark of the telling event, sentence with bold names, and a trailing rust "A problem" mark and/or record code chips.
- **INV-LENS-05**: **Line templates for records** (`lines.ts:60-131`). Subject is You / DEMIURGO / An agent:
  - "<S> added and approved **T**."
  - "<S> approved version N of **T**."
  - "<S> added **T** as a draft (N checks)."
  - "<S> drafted version N of **T** (N checks)."
  - "<S> discarded version N of **T**."
  - "<S> reviewed a link of **T**."
  - "A link of **T** needs a review." (problem)
  - "Version N of **T** was replaced."
  - "<S> changed **T**."
- **INV-LENS-06**: **Line templates for batches** (`lines.ts:158-251`):
  - "<S> ratified the import of design/ (N proposals)."
  - "<S> accepted **T**." / "<S> rejected **T**."
  - "<S> resolved N proposals from <producer>."
  - "**T** is out of date."
  - "design/ was imported as a package of N proposals."
  - "Knowledge found a conflict in **R**." / "Knowledge found conflicts in N records." (problem)
  - "<S> drafted **T** (N checks)." (system package with an fdr)
  - "<S> proposed N changes to **records**."
  - "<S> proposed N decisions/features/threads/reviews/proposals[: **title**]."
  - The record codes a batch is about are shown as chips (`batchTargets`).
- **INV-LENS-07**: **Line templates for threads** (`lines.ts:253-315`):
  - "DEMIURGO couldn't finish in **T**." (problem)
  - "DEMIURGO answered in **T**[ and asked N questions, assumed N answers]."
  - "DEMIURGO asked N questions and assumed N answers in **T**."
  - "An agent wrote in **T**."
  - "<S> concluded **T**." / "<S> set **T** aside."
  - "<S> answered N questions in **T**."
  - "<S> opened **T**[ with N questions]."
  - "<S> wrote in **T**."
  - "<S> made N changes in **T**."
- **INV-LENS-08**: **Line templates for knowledge and project** (`lines.ts:317-360`):
  - "A knowledge update failed. Nothing was changed by it." (problem)
  - "Knowledge has N classifications for you to review."
  - "Knowledge checked N ideas against what it knows."
  - "Knowledge was brought up to date (N updates)."
  - "Knowledge changed."
  - "<S> registered N sources."
  - "<S> gave an agent a key." / "<S> revoked an agent's key."
  - "<S> created the project."
  - "<S> made N changes to the project."
- **INV-LENS-09**: **Highlighting on the overview** (`changedOf`, `RecordCard.tsx:183-193`, `Overview.tsx:49-53`).
  - Changed: records with a line or cited by a batch line, and threads with a line. They get a stronger border (`data-changed`). A feature card's line becomes bold "Since <since>: <note>".
  - Everything else (cards, nodes, thread nodes, parked cards) is dimmed to 40 % and regains full contrast on hover or focus.
  - Notes: Approved vN, New, as a draft, New draft vN, vN discarded, A link to review, vN replaced, Changed, A proposal is out of date, A conflict found, N changes proposed, A run failed, DEMIURGO answered, New questions, An agent wrote, Concluded, Set aside, Questions answered, New thread, You wrote.
- **INV-LENS-10**: **"Nothing you confirmed was changed."** closes the panel when no event left an authority state of its entity (`tables.transitions.entities[e].authority`, `lines.ts:408-416`).
- **INV-LENS-11**: **"Show everything"** (panel button) turns the lens off for this project for the rest of the browser session (in-memory; reset on reload) (`useLens.ts:14, 58-63`).
- **INV-LENS-12**: **No baseline or nothing changed:** no panel, no button, nothing dimmed.

- **Real-time:** the visit memory follows every SSE event. The `changes` query is **not** refreshed by SSE (not in `INVALIDATES`, `staleTime: Infinity`, `queries.ts:169-174`). It refreshes only after the person's own command or a reconnection. Batch details refresh on proposal, batch and idea_assessment events.
- **States handled:** no baseline; nothing changed; batch details loading (lines degrade to generic words until then).
- **Tests:**
  - `e2e/lens.spec.ts`: AC-INT-001-16 ×3 (one line per thing, only the changed highlighted, "Nothing you confirmed…", Show everything / Show what changed; no summary without changes; coming back then Catch up). Screens of cut 6.
  - `unit/lens-lines.test.ts`: AC-INT-001-16 (templates, highlighting, authority note).
  - `unit/lens-visit.test.ts`: AC-INT-001-16 (baseline, never goes back, forget).
  - `unit/fidelity-today.test.ts` reuses the templates for "Today" in Needs you.
- **UX problems:**
  - **Lines are not links:** there's no way to go from a line to the thing that changed. Codes are plain chips (`WhileAway.tsx:27-50`).
  - "Show everything" is remembered only in memory (`useLens.ts:14`). It resets on reload and never expires per visit.
  - The baseline is read once per app load (`visit.ts:31-33`). In a long session it keeps comparing with the visit before the app started, and the person's own actions appear as changes ("You approved…"), un-dimming things.
  - Only 12 batches are detailed (`useLens.ts:29`). Later batch lines lose codes and producer.
  - Dimming everything unchanged to 40 % also dims items that need the person (`RecordCard.tsx:188`, `Blueprint.tsx:215`). The e2e axe run must exclude dimmed nodes (`lens.spec.ts:15`).
  - Not live while on the page (see Real-time).
  - Times under 6 days show only the weekday and time (`lib/time.ts:23-29`).

---

### Blueprint rail and record sections: `/p/$projectId/records/$code` (`?v=<n>`, `?tab=overview|questions|checks|history`)

- **Purpose:** The left rail of every record page (the product blueprint) and the record's sections: Overview, Questions (answered in place), Checks, History. The record page itself (header, review, aside, Ask) belongs to the record inventory. Here: `BlueprintFrame`, `Sections`, `QuestionsTab`, `HistoryTab`, plus `Checks` as reached through the tab.
- **Reads:** `stateQuery`, `inboxQuery` (rail), `explorationQuery` → `GET P/explorations/:originThread` (tab count and Questions), `recordQuery` → `GET P/records/:code`, `readinessQuery` → `GET P/versions/:versionId/readiness`, `entityEventsQuery` → `GET P/events?entity=<versionId>` (one per version).

#### Blueprint rail (`screens/blueprint/Rail.tsx`, `rail.ts`)

- **INV-BP-01**: The rail (`nav` "Blueprint") shows on every record page, including while the record loads or fails. It is sticky, scrolls on its own, and is 212 px wide (272 px from 1400 px) (`Rail.tsx:18-25, 100-104`).
- **INV-BP-02**: Back link "‹ <project name>" (or "The product") → overview (`Rail.tsx:105-113`).
- **INV-BP-03**: "+ New record" link (only with `record.create`) (`Rail.tsx:114-117`).
- **INV-BP-04**: **Features** group: each `fdr` with its title and one status word (`rail.ts:20-28`):
  - "Needs you" + blue count (tooltip = waiting phrase);
  - else "Ready to build";
  - else "In doubt" (rust; approved, then blocked);
  - else "Draft" (latest version is a draft);
  - else "Not ready".
  - Empty: "No features yet."
- **INV-BP-05**: **Decisions** group (`state.decisions`) and **Tech decisions** group (`adr` designs). Each row: certainty mark and title. Each group is hidden when empty (`Rail.tsx:147-160`).
- **INV-BP-06**: The record on screen is highlighted: `aria-current="page"`, bold, blue border. Rail links open the **current** version (no `?v`) (`Rail.tsx:130-137`).
- **INV-BP-07**: **"Rules for the whole product"** placeholder: "Later · Rules that every feature follows come in a later increment." (`Rail.tsx:161-170`).
- **INV-BP-08**: **Parked ideas** group: set-aside threads with the Parked mark → thread (`Rail.tsx:171-188`).
- **INV-BP-09**: **Keyboard:** Tab reaches every link. ↑/↓ move focus between the rail's links (`Rail.tsx:85-93`).
- **INV-BP-10**: Skeleton "Loading the product" while the state loads (`Rail.tsx:118-124`).

#### Record sections (`screens/blueprint/Sections.tsx`, `tabs.ts`)

- **INV-BP-11**: Section tabs (`nav` "Record sections"), all links to the same route with `?tab`:
  - "Overview" (no param);
  - "Questions" or "Questions · <open count>" (pending + inferred questions of the version's origin thread);
  - "Checks · N" (hidden for a decision without criteria);
  - "History".
  - `?v` is kept when switching, scroll is not reset, and the active tab has `aria-current="page"` (`Sections.tsx:25-71`, `tabs.ts`).
- **INV-BP-12**: **Section layout** (`record/Record.tsx:353-365`). On Questions the record's right column (readiness, context, versions, Ask) is replaced by "If you confirm". On Checks and History it stays. Breadcrumb and header, with the record actions (e.g. Approve), stay on every section.

#### Questions tab (`QuestionsTab.tsx`, `questions.ts`)

- **INV-BP-13**: States:
  - version without an origin thread: "This version doesn't come from a thread, so it has no questions.";
  - skeleton "Loading the questions";
  - Reasons on error (`QuestionsTab.tsx:330-339`).
- **INV-BP-14**: **Open questions** (pending, then inferred; each by `created_at`). Each is a card (`QuestionsTab.tsx:129-204`) with:
  - state mark (Open / Assumed) and the question as a heading;
  - "Why it matters: <reason>" and "Impact: High|Medium|Low";
  - for an inferred question with a conclusion, a blue **Recommended** box: the conclusion, a "Recommended" tag, "Why: <reasoning>", and "DEMIURGO assumed it. Nothing is confirmed until you say so."
- **INV-BP-15**: **Confirm the assumed answer** (tables): button "Confirm: <short answer, cut at a word, 44 chars>…" (`questions.ts:30-36`). It opens a confirmation "Confirm this answer?" showing the question, the conclusion, and "DEMIURGO assumed it. Confirming makes it your answer in the thread." Buttons: "Not now" and "Confirm". Runs `question.confirm {}`.
- **INV-BP-16**: **"Answer differently"** (inferred): dialog "Answer differently", field "Conclusion" prefilled with the assumed answer (required, max 3000), submit "Confirm my answer". Runs `question.confirm { conclusion }`.
- **INV-BP-17**: **"Answer"** (pending): dialog "Answer the question" (description = the question), field "Conclusion" (required, max 3000), submit "Answer". Runs `question.confirm { conclusion }`.
- **INV-BP-18**: **"Not now"**: dialog "Leave it for later" ("It stays in the thread for later, and it still keeps the feature from being ready. Say why."), field "Reason" (required, max 1000). Runs `question.postpone { reason }`.
- **INV-BP-19**: **"Doesn't apply"**: dialog "Doesn't apply" ("It stays in the thread, marked as not applying. Say why."), field "Reason" (required, max 1000). Runs `question.discard { reason }`.
- **INV-BP-20**: "Talk about it in the thread ›" under each open question → thread (`QuestionsTab.tsx:116-127`).
- **INV-BP-21**: **Choosing the question in hand:** a click or focus anywhere on a card selects it (`data-selected`). By default the first open question is selected (`QuestionsTab.tsx:155-158, 341`).
- **INV-BP-22**: **"If you confirm"** sticky aside for the selected question (`QuestionsTab.tsx:255-316`):
  - the question;
  - "It becomes the confirmed answer in its thread": the assumed conclusion with a confirmed dot, or "The answer you write.";
  - "It affects: <High|Medium|Low> impact";
  - "Before it can be built": "Yes. It waits until you confirm the answer DEMIURGO assumed." / "Yes. It waits on this question of its thread." / "Its readiness doesn't cite it.", plus the server's reason verbatim (e.g. `A question of its thread is open: “…”`). Nothing is shown for decisions, which have no readiness (`questions.ts:47-60`).
  - "How we'll know it works": the titles of the version's criteria with the version-state mark, or "This version has no checks yet.";
  - "Later · Becomes a decision and adds checks on its own (later increment). Today confirming only answers the question."
- **INV-BP-23**: **Settled groups**, collapsible, closed by default: "Answered · N" (confirmed), "Not now · N" (postponed), "Doesn't apply · N" (discarded) (`QuestionsTab.tsx:239-243, 360-379`). Row: mark, question, "Answer: <conclusion>" (confirmed) or "Reason: <state_reason>".
  - Row actions (tables): "Doesn't apply" (`question.discard`), and "Reopen" → dialog "Reopen this question" ("Its history is kept. The answer has to be given again."), optional "Reason", runs `question.reopen { reason? }`.
- **INV-BP-24**: No open question: "Nothing to answer here: no question of its thread is open."
- **INV-BP-25**: Footer link "Open the thread: <purpose> ›".

#### History tab (`HistoryTab.tsx`, `history.ts`)

- **INV-BP-26**: **"What happened"**: the diary events of every version merged, newest first by event id. Line: who mark with name, words, and day time.
  - Words: "Created vN", "Approved vN", "vN was replaced", "Discarded vN", else "<command word> · vN".
  - Skeleton "Loading the history"; Reasons on error.
- **INV-BP-27**: **"Every version"**: newest first. Each row shows:
  - state mark + "vN" + state word (Draft/Approved/Replaced/Discarded) + " · current";
  - "Open vN ›" → `?v=N`;
  - the change note, or "The first version." / "No change note.";
  - "Written by you|<who> · <day time>" and "Approved by … · …".

#### Checks tab (`record/Checks.tsx`, reached through `?tab=checks`)

- **INV-BP-28**: "Checks · N", then one card per criterion: title, statement, "How: <check>", code, and "Checked by: You/Automatic" with tooltip ("You check it by hand once it is built." / "A test checks it on its own.").
  - Verifiability warnings from the readiness (warnings prefixed by the criterion code) show under the statement.
  - Empty: "This version has no checks yet."

#### Header search (global header on every project page; logic in `screens/blueprint/search.ts`, UI in `screens/shell/Search.tsx`)

- **INV-BP-29**: **Search field** "Search decisions, features, ideas" (combobox). Under 1600 px it is collapsed to a magnifier and expands on focus or when it has text. **Ctrl/⌘+K** focuses and selects it from anywhere (`Search.tsx:54-64, 117-150`).
- **INV-BP-30**: **Live results.** Debounced 200 ms, from 2 characters: `knowledgeSearchQuery` → `GET P/knowledge/search?q=`. Dropdown states: "Searching…", "No matches", Reasons on error, listbox "Results" (scrolls from 420 px) (`Search.tsx:152-212`).
- **INV-BP-31**: **Result row:**
  - type icon (the type word for screen readers), title with matched words highlighted, excerpt window around the first match (2 lines), and the certainty mark;
  - "It has no page of its own." and `aria-disabled` when it has no destination;
  - matching ignores case and accents, works at word start and roughly stems ("activity" also matches "activities") (`search.ts:31-122`).
- **INV-BP-32**: **Destinations** (`search.ts:16-29`):
  - `CODE@n` (DEC/FDR/ADR/BUG) → `/records/CODE?v=n`;
  - a check `AC-XXX-NNN-M@n` → the record sharing `XXX-NNN`, at `?v=n&tab=checks`;
  - `exploration:<uuid>` → `/threads/<uuid>` (threads and parked ideas).
- **INV-BP-33**: **Keyboard and mouse:**
  - ↑/↓ choose (`aria-activedescendant`), Enter opens the chosen result (or the first with a destination), Esc clears and closes;
  - click opens (focus stays in the field while clicking);
  - the field clears after navigating and the dropdown closes on blur.

- **Real-time:** rail (`state`, `inbox`); Questions tab and tab count (`exploration`: question, message, exploration, ai_run; `readiness`: proposal, record_version, link, question); record (record, record_version, criterion, link, proposal). History has its own listener: any event whose `entity_id` is one of the versions refetches that version's events (`HistoryTab.tsx:32-38`). Header search results sit under `knowledge` (knowledge_*, classification, taxonomy, idea_assessment).
- **States handled:**
  - Rail: skeleton; no error state.
  - Questions: no thread, loading, error, nothing open, groups empty.
  - History: loading, error.
  - Checks: empty.
  - Search: searching, no matches, error, results without a page.
- **Tests:**
  - `e2e/blueprint.spec.ts`:
    - AC-INT-001-09 ×2: confirm the recommended answer, Not now, Doesn't apply, "If you confirm"; answer in own words; version without a thread.
    - AC-INT-001-04: rail statuses, marks and highlight, Later, parked idea, no horizontal scroll at 1280 px, Ctrl+K.
    - AC-INT-001-08: history lines and versions; checks with who and verifiability; `?v` kept.
    - AC-INT-001-17: search, highlight, Enter, check → Checks tab, No matches, Esc.
    - AC-WEB-001-03: keyboard-only rail, tabs, search, Not now.
    - Screens of the blueprint; parked idea found by search.
  - `unit/blueprint-rail.test.ts` (AC-INT-001-04), `unit/blueprint-questions.test.ts` (AC-INT-001-09, AC-INT-001-08, AC-INT-001-04), `unit/blueprint-history.test.ts` (AC-INT-001-08), `unit/blueprint-search.test.ts` (AC-INT-001-17).
- **UX problems:**
  - **Inconsistent terminology for the same question actions.**
    - Here: "Not now" / "Doesn't apply" / "Answer differently" (`QuestionsTab.tsx:146-150, 194-196, 241-242`).
    - Needs you (`ui/QuestionItem.tsx:67-75, 100-104`): "Park" / "Drop" / "Change".
    - State words: "Parked" / "Dropped" (`words.ts:56-57`).
  - **"Not now" means two things.** It is the postpone action and also the cancel button of every dialog (`ui/dialogs.tsx:49, 147`). The "Leave it for later" dialog opened by "Not now" has a "Not now" button that cancels.
  - **The question in hand is chosen by clicking or focusing a non-interactive `<article>`** (`QuestionsTab.tsx:155-158`). The change of the aside isn't announced.
  - Settled questions are hidden in collapsed `<details>` (`QuestionsTab.tsx:364-377`).
  - **The UI re-derives server readiness text by importing domain code** (`questions.ts:5, 52-53`). If server wording changes, "Its readiness doesn't cite it." shows wrongly.
  - The Questions tab drops the record's side panel and Ask bar (`Record.tsx:356-357`): context changes between tabs.
  - History makes one request per version plus its own event listener (`HistoryTab.tsx:28-38`). Fallback lines expose raw command words, e.g. "Mark as changed · v2" (`history.ts:28`).
  - **The rail omits bugs and stage records** (requirement, quality, threat, production) (`rail.ts:51-61`). On their pages nothing is highlighted. The rail has no error state: its skeleton stays forever on a state error (`Rail.tsx:118`).
  - **The header search can't open REQ/NFR/THR/PRR records:** the ref regex allows only DEC|FDR|ADR|BUG (`search.ts:12-13`), so they say "It has no page of its own." Under 1600 px the field is icon-sized with a transparent placeholder (`Search.tsx:149`), which hurts discoverability.
  - A search error renders `Reasons`, which grabs focus (`ui/Reasons.tsx:63-65`), taking it away from the field being typed in (`Search.tsx:158-159`).

---

### Map: `/p/$projectId/map` (no search params)

- **Purpose:** A canvas with one lane per area: features as cards, the decisions they follow as nodes, the relations their links declare drawn between them, the questions that wait on the person, and parked ideas.
- **Reads:** `mapQuery` (`api/views.ts`) → `GET P/map` → `ProductMap { project, areas[], records: ProductRow[], relations: MapRelation[], questions: MapQuestion[], ideas: {id, purpose}[] }`.

- **INV-MAP-01**: Product views tabs (Map active).
- **INV-MAP-02**: **Summary line:** "N records in M area(s) · K relation(s)" plus, bold blue, " · Q question(s) wait(s) on you" (`Map.tsx:77-86`).
- **INV-MAP-03**: **Canvas** (`data-map`): dotted background, scrollable viewport (height `100vh-230px`, minimum 420 px). One 300 px lane per `areas[]` entry, in API order, headed with the area name (region "Area: <area>").
  - In each lane: features (`fdr`) sorted by code first, then "Rules it follows" (or "Rules" when the lane has no features) with every other record type sorted by code (`layout.ts:14-19`, `Map.tsx:114-150`).
- **INV-MAP-04**: **Feature element:** a FeatureCard with type, certainty mark and word, stage bars, a **needs count = open questions affecting it** (`MapQuestion.affects`), title, summary, who mark, "<ago>", and a checks signal (`Map.tsx:219-234`).
- **INV-MAP-05**: **Rule element:** a Node with type icon, compact mark, title, and blue count with tooltip "N question(s) wait(s) on you" (`Map.tsx:235-244`).
- **INV-MAP-06**: **Relation lines** (SVG, measured over the elements, redrawn on resize and zoom) from `relations[] { from, to, kind: needs|follows|conflicts|affects, link, under_review }` (`Map.tsx:252-345`, `layout.ts:48-51`).
  - needs: ink-3, 1.75 px;
  - follows: grey;
  - conflicts: rust;
  - affects: dashed;
  - any link under review: dashed.
  - Lines curve between lanes; within one lane they loop along the right side.
- **INV-MAP-07**: **Pointing or focusing** an element lights it and everything connected to it (both directions) and thickens their lines. Everything else dims to 40 % and other lines to 15 % (`layout.ts:22-29`, `Map.tsx:39-40, 128, 329-339`).
- **INV-MAP-08**: **Selecting:** each element is a toggle `<button aria-pressed>`. Click, Enter or Space selects it or clears the selection. The selection survives zoom (`Map.tsx:203-218`).
- **INV-MAP-09**: **Selection panel** in the right column (`data-map-panel`, "Selected: <title>") (`Map.tsx:380-474`):
  - Detail: type, status word, bars (features), "CODE · vN", title, summary.
  - Actions: "Close" (deselect) and "Open" → record.
  - "Comes from: Its thread" → origin thread.
  - Relation groups by word: Needs / Needed by, Rules it follows / Followed by, Conflicts with, Affects / Affected by. Each lists record titles with a code chip, linking to the record.
  - "Waiting on you": each question with an "Answer" link → its thread.
  - Features: "How we'll know it works: N checks · none has run: nothing is built yet."
- **INV-MAP-10**: **Map legend** in the right column when nothing is selected: "How to read the map", "One column per area. Features are cards; the decisions they follow are below them. Point at something to light up what it is connected to; click it to see it here." Line samples: Needs another feature, Follows a rule, Conflicts, Affects (derived from). "Only the links the records declare are drawn: nothing is guessed." (`Map.tsx:359-378`).
- **INV-MAP-11**: **Zoom group:** "−" (Zoom out), "<N>%" (Actual size → 100 %), "+" (Zoom in), and "Fit" (fits the content width, never above 100 %, minimum 50 %). Steps: 50/60/75/90/100/115/130 % (`Map.tsx:28, 43-56, 87-100`).
- **INV-MAP-12**: **Parked ideas column** (when there are ideas): dashed header "Parked ideas", one faded idea Node per set-aside thread, each linking to the thread. No lines, not selectable (`Map.tsx:151-165`).
- **INV-MAP-13**: **States:** skeleton (520 px) while pending; Reasons on error; empty "Nothing on the map yet: records appear here as soon as the product has them." (`Map.tsx:69-73`).

- **Real-time:** **none from SSE.** `map` is not in `INVALIDATES` (`stream.ts:13-34`). It refreshes after the person's own commands, a reconnection, or a remount older than 5 s.
- **States handled:** pending, error, empty, nothing selected (legend), selected (panel).
- **Tests:** `e2e/views.spec.ts` AC-INT-002-01…04 (lanes, follows lines, select → panel with "Rules it follows", zoom keeps selection, keyboard Enter selects), plus an axe run with the selection. `unit/map-layout.test.ts` AC-INT-002-01, 02, 03. `e2e/views.spec.ts` AC-INT-002-08 covers the record's incoming links (record screen).
- **UX problems:**
  - **Lines carry no direction and are invisible to assistive technology.** No arrowheads; the SVG is `aria-hidden` (`Map.tsx:320-343`). Relations are available to screen readers only through the selection panel.
  - **Ambiguous line styles.** Dashed means both "affects" and "under review" (`layout.ts:50`), and the legend never mentions "under review" (`Map.tsx:370-375`). Conflicts differ from others by colour.
  - **Zoom and pan are button-only:** no keyboard shortcuts, no wheel or pinch zoom, and panning is by scrollbars only. "Fit" never enlarges (`Map.tsx:48`).
  - Pointer movement over the canvas constantly re-dims everything (`Map.tsx:128, 216`).
  - No Esc to deselect. The legend disappears while something is selected (`Map.tsx:60-66`).
  - **The same feature shows different blue counts** on the Map (open questions only, `Map.tsx:200`) and on the Overview (versions + proposals + links + questions, `RecordCard.tsx:197`).
  - **On error both the error and the "Nothing on the map yet" empty state render** (`Map.tsx:69-73`). A project with only parked ideas also shows the empty state (`Map.tsx:72`).
  - **Not live** (see Real-time).
  - Mixed element semantics: toggle buttons for records, links for ideas. Fixed lane width and viewport height: desktop only (`Map.tsx:105, 119`).

---

### Origins: `/p/$projectId/origins` (no search params)

- **Purpose:** A left-to-right provenance tree (thread → decision → feature or tech decision, through `based_on` and `origin` links) that traces and explains why each element exists.
- **Reads:** `stateQuery`, `explorationsQuery`, and **one `recordQuery` per record** (`GET P/records/:code`) to read the shown version's links and change note (`Origins.tsx:41-47`). The tree is drawn only once all of them have arrived.

- **INV-ORIG-01**: Product views tabs (Origins active). Header "Origins" with "Where each decision, feature and tech decision comes from." (`Origins.tsx:77-82`).
- **INV-ORIG-02**: **Three columns** with headers "Where it started" (threads and the "Not from a thread" start), "Decisions", and "Features and tech decisions" (every non-decision record) (`Origins.tsx:37`, `tree.ts:87`). The width follows the container, minimum 960 px (`tree.ts:57-73`).
- **INV-ORIG-03**: **Edges** (`tree.ts:123-172`):
  - record → record from the shown version's links: `based_on` (solid) and `origin` to a record version (dashed);
  - thread → record (`origin_exploration`, when the record has no record parent);
  - thread → inner thread (`parent_id`, a vertical line);
  - "start" → top records without a parent (dashed).
- **INV-ORIG-04**: **Reading order and layout:** each top-level thread by creation date with what came from it, then its inner threads below, then the "Not from a thread" lane. A parent sits level with its first child, and nothing overlaps (`tree.ts:186-225`).
- **INV-ORIG-05**: **Thread node** (link → thread; screen readers hear "Thread"). A Node with the exploration state mark (Active → Open, Concluded → Confirmed, Set aside → Parked) and the purpose.
  - Note: "you|<name>, <date>" plus " · inside a thread".
  - Phrase: the concluded `state_reason` in quotes (`Origins.tsx:248-277`).
- **INV-ORIG-06**: **Record node** (link → record; screen readers hear the type). A Node with type icon, certainty mark, title, and stage bars for features (ready / not-ready).
  - Note: "<who>, <date>" plus a code chip "CODE vN".
  - Phrase: the change note of the shown version, or the conclusion inherited from its thread (`Origins.tsx:279-311`, `tree.ts:175-184`).
- **INV-ORIG-07**: **Start node** "Not from a thread" (faded): "What follows doesn't come from a conversation." It is not interactive (`Origins.tsx:235-246`).
- **INV-ORIG-08**: **Trace:** pointing at or focusing a node lights its whole trace (all ancestors and descendants). Traced nodes get a 2 px blue border (`data-traced`) and traced edges are blue 2.5 px. The node in hand is drawn selected. The trace **stays** after the pointer leaves (`tree.ts:249-272`, `Origins.tsx:163-181, 233`).
- **INV-ORIG-09**: **"Why does this exist?"** sticky panel, 120 px high (`Origins.tsx:323-392`, `tree.ts:308-356`).
  - Idle: "Point at a thread, a decision or a feature to trace where it comes from and why it exists."
  - Traced: one sentence with quoted, **linked** names. For example:
    - "“X” is a feature that follows the decision “Y”, which came from the thread “Z”[, branched from “W”]."
    - "… It doesn't come from a thread."
    - "“T” is a thread[, branched from “P”][, opened from CODE vN]. It led to N decisions and M features." / "Nothing has come from it yet."
  - Up to 2 phrases: "Change note of CODE vN: “…”", "The thread concluded: “…”". Otherwise "No thread conclusion or change note says why yet." The sentence is `aria-live="polite"`.
- **INV-ORIG-10**: **"Clear trace"** button: clears the trace and moves focus to the panel (`Origins.tsx:377-389`).
- **INV-ORIG-11**: **Keyboard:** Tab walks the nodes (focus traces) and Enter opens the node's page.
- **INV-ORIG-12**: **States:** skeleton "Loading the origins" (tree shape); Reasons if any of the queries fails; empty "Nothing here yet. Threads, decisions and designs appear here as they are created." (`Origins.tsx:87-97`).

- **Real-time:** `state` and `explorations` (exploration, question, message, stage, record, record_version, link…) and every `record` query (record, record_version, criterion, link, proposal). The tree is rebuilt when they change.
- **States handled:** loading (until every record arrives), error, empty, idle and traced Why panel.
- **Tests:** `e2e/origins.spec.ts` AC-INT-001-04 (thread → decision → feature with marks, conclusion as phrase, hover traces and says why, link in the sentence opens the record) and AC-WEB-001-03 (Tab traces, Clear trace, Enter opens). Screens of cut 7. `unit/origins-tree.test.ts` AC-INT-001-04 ×8.
- **UX problems:**
  - **N+1 requests:** one GET per record. Nothing is drawn until every record has arrived, and a single failure blanks the whole tree (`Origins.tsx:47, 104-115, 87-88`).
  - **The trace follows the pointer** (`onPointerEnter`, `Origins.tsx:233`). Crossing other nodes on the way to the Why panel's links re-traces. There is no click-to-pin and no Esc to clear.
  - **The Why panel is a fixed 120 px:** the sentence is clamped to 2 lines and phrases to 2 items. Full text is only in `title` tooltips, which are mouse-only (`Origins.tsx:344, 354, 361-363, 316`). The `aria-live` sentence is re-announced on every hover (`Origins.tsx:354`).
  - **Stage bars are never "In doubt" here** (`Origins.tsx:296`), unlike everywhere else (`record/logic.ts:8-11`).
  - **Wrong column label:** "Features and tech decisions" also holds bugs and stage records (`tree.ts:87`). "It led to …" counts only decision, fdr, adr and bug (`tree.ts:323`).
  - The trace is shown by a blue border only; the minimum width of 960 px forces horizontal scrolling on narrow windows (`tree.ts:58`).

---

### Journeys: `/p/$projectId/journeys` (`?j=<feature code>`)

- **Purpose:** How people will use what is designed. There is one journey per feature with a written Behavior: its numbered points are the steps, its criteria are the paths ("If … → then …"), and the open questions of its thread are gaps.
- **Reads:** `journeysQuery` (`api/views.ts`) → `GET P/journeys` → `{ project, journeys: Journey[] }`.

- **INV-JRN-01**: Product views tabs (Journeys active). `?j` selects the journey (history replaced); without it, the first one is shown (`Journeys.tsx:30-35`).
- **INV-JRN-02**: **Journey list** (`nav` "Journeys"): heading "Journeys" and "How people will use <project>". Each journey is a button with its title and summary: "N path(s) wait(s) on you" (bold blue), "All paths defined", or "No paths written yet". The active one is highlighted (`Journeys.tsx:50-75`).
- **INV-JRN-03**: **Journey header:** H1 title, certainty MarkWord, and "From the behavior and the checks of CODE vN" (link → `/records/CODE?v=N`) (`Journeys.tsx:88-107`).
- **INV-JRN-04**: **Steps:** a horizontally scrolling row of cards: "STEP n", bold title, up to 4 detail lines (2-line clamp) plus "+N more", with arrows between steps (`Journeys.tsx:109-138`).
- **INV-JRN-05**: **Paths** (one per criterion): kicker "If <given>" (or the criterion title), "When <when>", "→ <outcome>". Foot: check icon, "<title> · You check it|Checked automatically", and the code (`Journeys.tsx:144-164`).
- **INV-JRN-06**: **Gaps** (open questions of the thread): dashed blue card "Not defined yet", the question, "Waiting on your answer in its thread.", and an "Answer" link → thread (`Journeys.tsx:165-180`).
- **INV-JRN-07**: **Summary footer:** figures for paths in this journey (defined + gaps), defined, waiting on you (blue when > 0), and steps. A primary "Answer N question(s)" → origin thread shows when there are gaps and an origin thread (`Journeys.tsx:184-200`).
- **INV-JRN-08**: **States:** skeleton (480 px); Reasons on error; empty "No journeys yet. A journey appears when a feature has its behavior written: its steps come from it, and its paths from its checks."

- **Real-time:** **none from SSE** (`journeys` is not in `INVALIDATES`). It refreshes on the person's own commands, a reconnection, or a remount.
- **States handled:** pending, error, empty, selected journey (with or without gaps and paths).
- **Tests:** `e2e/views.spec.ts` AC-INT-002-05, 06, 07 (list summary "1 path waits on you", 3 steps, 2 paths "If someone who is not a member…", gap with Answer link, summary, axe). No unit test.
- **UX problems:**
  - **Wrong semantics:** the list uses `aria-current="page"` on buttons (`Journeys.tsx:61`); a selection should use pressed or selected state.
  - **Truncated content with no way to expand:** step details stop at 4 with a non-interactive "+N more" (`Journeys.tsx:121-126`), and outcomes are clamped to 3 lines (`Journeys.tsx:210`).
  - **On error both the error and the "No journeys yet" empty state render** (`Journeys.tsx:40-47`).
  - "Answer" goes to the thread, not to the question (`Journeys.tsx:171-177`).
  - Features without a Behavior don't appear at all, with no hint of which ones are missing.
  - Not live (see Real-time).

---

### Knowledge: `/p/$projectId/knowledge` (`?tab=graph|search|ideas|taxonomy|rebuild`, graph when omitted)

- **Purpose:** The derived knowledge: graph version and freshness, latest updates (retry the failed ones), and five tabs: graph by taxonomy area, search, idea checks, taxonomy (approve or propose) and rebuild fingerprint.
- **Reads:** `knowledgeQuery` → `GET P/knowledge`, `stateQuery` (to name triggers), `graphQuery` → `GET P/knowledge/graph`, `taxonomiesQuery` → `GET P/taxonomies`, `knowledgeSearchQuery` → `GET P/knowledge/search?q=`, `ideaAssessmentsQuery` → `GET P/knowledge/idea-assessments`, `rebuildQuery` → `GET P/knowledge/rebuild` (`staleTime` 60 s), `commandsQuery` (taxonomy form).

- **INV-KNOW-01**: **Tabs** (Radix, "Knowledge views"): Graph, Search, Idea checks, Taxonomy, Rebuild. Arrow keys move between tabs. The tab lives in `?tab=` (Graph = no param), and switching pushes a history entry (`Knowledge.tsx:28-81`).
- **INV-KNOW-02**: **Title "Knowledge" with the freshness line** (`Knowledge.tsx:86-129`, `graph.ts:128-131`):
  - Up to date: ink dot;
  - Updating: Working mark, "N change(s) to go";
  - Behind: rust dot and rust word, "N update(s) failed";
  - then "Graph version N · N nodes · N relations".
  - Skeleton while loading.
- **INV-KNOW-03**: **Header freshness indicator** (global header, `shell/Header.tsx:87-118`): link "Knowledge v<N>" with the same dot states. Tooltips: "Knowledge is up to date (version N)." / "DEMIURGO is updating its knowledge: N change(s) to go." / "Knowledge is behind: N update(s) failed. Open Knowledge to retry." Its aria-label is "Knowledge version N: up to date|updating|behind". It opens `/knowledge`.
- **INV-KNOW-04**: **Latest updates** (right column) (`Knowledge.tsx:133-174`):
  - Heading and "What you approve, accept or discard updates what DEMIURGO knows."
  - Rows: state mark and word (Updating/Applied/Failed), "<ago>", what triggered it, and "vA → vB" when the graph version changed.
  - Trigger phrases: "Approval of CODE vN" / "Approval of a version", "Discard of CODE vN" / "Discard of a draft", "An accepted proposal", "A change" (`graph.ts:136-155`).
  - Shows the first 8 plus every failed one. "Show all N" / "Show fewer" toggles the rest.
  - Empty: "Nothing has changed the knowledge yet." Skeleton while loading.
- **INV-KNOW-05**: **Failed update:** rust failure text and a **"Retry"** button (tables → `knowledge_update.retry`, entity = update id), with Reasons on error (`Knowledge.tsx:192-214`).

#### Graph tab (`GraphTab.tsx`, `graph.ts`)

- **INV-KNOW-06**: **Grouping line:** "Grouped by <axis name> (<TAX code> v<N>)", using the first axis of the latest approved taxonomy. Otherwise: "No taxonomy is approved yet, so nothing is classified." with an **"Open the taxonomy"** button that switches tab (`GraphTab.tsx:48-61`).
- **INV-KNOW-07**: **Type filter chips:** "All N" plus one chip per present type (Decisions, Tech decisions, Features, Bugs, Checks) with counts. Single-select, `aria-pressed` (`GraphTab.tsx:62-73, 98-104`).
- **INV-KNOW-08**: **Area sections** (regions): category name, count, and description. Ordered by the taxonomy's category order, then unknown categories by code, then "Not classified yet". Nodes are sorted by type order (decision, adr, fdr, bug, criterion), then ref, in a 3-column grid (`graph.ts:78-99`).
- **INV-KNOW-09**: **Node:** a Node with type icon, mark (certainty, or "Invalidated" with the replaced mark; invalidated nodes are faded), and label. It uses the Peek behaviour (S1): focus or pointing shows the peek, click keeps it, Enter or double-click opens `/records/<code>?v=<n>` when the node has a record (`GraphTab.tsx:109-158`).
- **INV-KNOW-10**: **Node peek** (`GraphTab.tsx:163-240`, `graph.ts:25-58`):
  - Type, status word, ref code, label, and a 3-line excerpt.
  - Relations grouped by word, containment last: Based on / Basis of, Related to, Design of / Designed in, Covers / Covered by, Comes from / Origin of, Conflicts with, Derived from / Source of, Contains / Part of. Each group shows its count and up to 4 rows (icon, label, ref) plus "and N more". None: "No relations yet."
  - Footer: the node's area names across every axis, or "Not classified yet" / "No approved taxonomy". An "Open CODE" link.
- **INV-KNOW-11**: **States:** skeleton "Loading the graph"; Reasons; empty "The graph is empty. It grows as you approve decisions and designs, or accept what DEMIURGO proposes."

#### Search tab (`SearchTab.tsx`)

- **INV-KNOW-12**: **Search form** (`role="search"`): label "Search the knowledge", placeholder "A word or a phrase, as it was written". The "Search" button is disabled when empty. Runs on submit only (Enter or button).
- **INV-KNOW-13**: **States:**
  - idle: "Search what DEMIURGO knows: decisions, features, tech decisions and their checks, as they were written.";
  - skeleton "Searching";
  - Reasons on error;
  - empty "Nothing matches “q”.";
  - results count "N result(s) for “q”" (`aria-live`).
- **INV-KNOW-14**: **Result card:** type icon and word, certainty mark and word, ref code (not for threads), title, 2-line excerpt.
  - A thread (`exploration:`) links to the thread.
  - A record (the graph node's record, or the ref pattern) links to `/records/CODE?v=N`.
  - Anything else is not a link (`SearchTab.tsx:73-116`).

#### Idea checks tab (`IdeaChecksTab.tsx`)

- **INV-KNOW-15**: Intro "Each idea an agent proposes is compared with what DEMIURGO knows. It recommends; you decide in the batch." One article per assessment ("Idea check: <title>").
- **INV-KNOW-16**: **Left side of a check:**
  - "Conflict" MarkWord when any finding contradicts or is inconsistent;
  - "Idea · Decision|Feature|Thread" plus the proposal's state mark and word (Proposed/Accepted/Accepted with edits/Rejected/Out of date);
  - the title;
  - Automatic who mark (`system:<classifier>`) with "Checked against graph vN · <ago>";
  - **"Open its batch →"** → `/batches/<batch_id>`.
- **INV-KNOW-17**: **Findings:** a symbol (= duplicates, ≠ contradicts or inconsistent, ~ relates), the verdict word (Duplicates / Contradicts / Inconsistent with / Relates to; rust for conflicts), the certainty mark of the cited node, and the cited label with its citation code, linking to `/records/CODE?v=N` when it has a record. Then "N% sure" and the justification.
  - Error: "It couldn't be checked: <error>". No findings: "Nothing DEMIURGO knows duplicates, contradicts or relates to this idea."
- **INV-KNOW-18**: **States:** skeleton "Loading the idea checks"; Reasons; empty "No idea has been checked yet. When an agent proposes a decision, a feature or a thread, DEMIURGO compares it with what it knows and shows here what it duplicates, contradicts or relates to."

#### Taxonomy tab (`TaxonomyTab.tsx`, `TaxonomyEditor.tsx`, `taxonomy.ts`)

- **INV-KNOW-19**: Intro: "The taxonomy organizes what DEMIURGO knows. Only the approved version is used to classify, and only what changes after approving it is classified with it." A **"Propose a new version"** button ("Propose a taxonomy" without a base) shows when `canCreate(taxonomy.propose)`, taxonomies exist and the editor is closed. It opens the editor prefilled from the current version (else the newest draft).
- **INV-KNOW-20**: **Setup card when there is no taxonomy** (`data-taxonomy-setup`): "Set up how DEMIURGO groups knowledge" and "Without a taxonomy nothing is classified. Start from a template by area and by quality and change any word, or start blank. Nothing is used until you approve it."
  - **"Start from a template"**: title "How DEMIURGO groups knowledge"; axis Area (Product, Interface, Data, Platform, Other) and axis Quality (Security, Performance, Usability, Reliability, Other), each with a description.
  - **"Start blank"**: axis Area with "Other" only.
  - Without the right to propose: "There is no taxonomy yet. Without one, nothing in the knowledge is classified."
- **INV-KNOW-21**: **Groups:** "Current" (latest approved), "Proposed" (drafts, newest first), and "Replaced · N" (collapsed `<details>`).
- **INV-KNOW-22**: **Taxonomy card** (article "<CODE> vN · <title>"):
  - "Taxonomy · <state mark and word: Proposed/Approved/Replaced> · CODE vN", then the title;
  - "Proposed by <who> · <date>" and "Approved by <who> · <date>";
  - axes in up to 3 columns: axis name and code, then each category's name, code and description;
  - "Its text · <section titles>": a collapsible block with markdown sections.
- **INV-KNOW-23**: **Approve** (tables, only on a draft): confirmation "Approve CODE vN?". With a current version: "It replaces vX. From now on, what changes is classified with this version." Otherwise: "From now on, what changes is classified with it." Runs `taxonomy.approve` (`TaxonomyTab.tsx:207-220`).
- **INV-KNOW-24**: **Editor** (form "New version of <CODE>") (`TaxonomyEditor.tsx`):
  - Header: "New version of CODE · from vN" or "New taxonomy · CODE". Rules hint: every axis keeps an "other" category, and no code repeats.
  - "Title" (max 200).
  - Per axis (fieldset): "Axis name", "Axis code" (derived from the name until edited, format `[a-z][a-z0-9_]*`), "Remove axis".
  - Category rows: Name / Code (auto-derived) / Description / remove (×, labelled "Remove <name>"). "Add a category" per axis. "Add an axis" (a new axis starts with "Other").
  - Existing text sections are kept, with a note.
  - Client-side check (`missing`: empty title, no axis, unnamed or uncoded axis, category without name, code or description) shows the first gap and "And N more", and disables Propose.
  - Server refusals show Reasons (e.g. `Axis area has no "other" category.`) and keep the edits.
  - "Not now" closes. "Propose" / "Proposing…" runs `taxonomy.propose { code, title, axes[{code,name,categories[{code,name,description}]}], sections }`.
- **INV-KNOW-25**: **States:** skeleton "Loading the taxonomy"; Reasons.

#### Rebuild tab (`RebuildTab.tsx`)

- **INV-KNOW-26**: Panel "Rebuild from what you approved": "DEMIURGO can rebuild its knowledge from the records and the saved classifications, without asking the classifier again. If both fingerprints are the same, the graph has not drifted."
  - **"Rebuild again"** refetches (shows "Rebuilding…").
  - Rows: "Live graph · version N" with its fingerprint (mono, `data-fingerprint="live"`); "Rebuilt from what you approved" with its fingerprint or "It could not be rebuilt."
  - Result: "They match" (confirmed) with "The graph is exactly what your records and its saved classifications give.", or rust "They don't match" with the drift text.
  - Skeleton "Rebuilding"; Reasons.

- **Real-time:** every query here is keyed under `knowledge`, so knowledge_update, knowledge_node, knowledge_edge, classification, taxonomy and idea_assessment events refresh them all, **including the rebuild**. `state` refreshes the trigger names.
- **States handled:** loading, error and empty per tab; freshness current, updating or behind; failed update with retry; no approved taxonomy; no taxonomy at all (setup) with or without the right to propose; editor with client gaps and server reasons.
- **Tests:**
  - `e2e/knowledge.spec.ts` AC-INT-001-17 ×7:
    - header and page freshness plus an idea check citation;
    - approve the taxonomy;
    - propose a new version with a rule broken and the edit kept;
    - graph groups and the peek with relations, Enter opens, type filter;
    - search and links;
    - rebuild match;
    - failed update: Behind, retry until Applied.
  - Also screens of cut 7 and the untitled "new project … template proposed and approved" (taxonomy hint → setup → template → approve).
  - `unit/knowledge-graph.test.ts` AC-INT-001-17 ×8 (grouping, relations, verdicts, refs, freshness, trigger).
  - `unit/knowledge-taxonomy.test.ts` AC-INT-001-17 ×6 plus the starter taxonomy.
- **UX problems:**
  - **The "Graph" tab is not a graph:** it is a list grouped by area. Relations appear only in the hover or focus peek (`GraphTab.tsx:75-92, 213-236`). Relation rows are **not links** (`GraphTab.tsx:221-227`) and "and N more" can't be expanded (`GraphTab.tsx:229-231`).
  - Nodes are `role="link"`, but Enter does nothing on a node without a record (`GraphTab.tsx:126-133`).
  - **Two searches over the same endpoint behave differently:** the Search tab needs a submit (`SearchTab.tsx:26-29`) while the header searches live (`Search.tsx:48-51`). Results without a record are inert cards with no explanation (`SearchTab.tsx:111-112`).
  - **Types beyond decision, adr, fdr, bug and criterion fall back to the raw type string and a generic icon** (`graph.ts:9-22`). The ref regex excludes REQ, NFR, THR and PRR and digits in the domain part (`graph.ts:105`), unlike `search.ts:12`.
  - **The rebuild fingerprint is recomputed on every knowledge event** because it is keyed under `knowledge` (`queries.ts:158-164`, `stream.ts:26-31`).
  - **Taxonomy editor:** "Remove axis" has no confirmation (`TaxonomyEditor.tsx:92-94`). Only the first missing item is shown and nothing is marked at field level (`TaxonomyEditor.tsx:160-165`). Category column headers are `aria-hidden` (`TaxonomyEditor.tsx:96`); the inputs carry their own labels.
  - Latest updates caps at 8 (`Knowledge.tsx:131, 139`). Tab switches push history entries (`Knowledge.tsx:44-45`), so Back walks through tabs.

---

### Sources: `/p/$projectId/sources` (no search params)

- **Purpose:** What the person and agents give DEMIURGO to read: name, content hash, who registered it and when. An agent's source is marked as untrusted input. Registering a source is the only action.
- **Reads:** `sourcesQuery` → `GET P/sources` (Source[]), `commandsQuery` → `GET /api/commands` (form schema), `tablesQuery`.

- **INV-SRC-01**: Title "Sources" and "What you and your agents give DEMIURGO to read. A source is input for its work, never a decision."
- **INV-SRC-02**: **Table** (caption "Sources"), newest first (the API order reversed) (`Sources.tsx:27, 45-70`):
  - **Name**: source icon and name, plus an **"Untrusted input"** pill when an agent registered it, with tooltip "An agent registered it. DEMIURGO reads it as input to check, never as something you decided.";
  - **Registered by**: who mark with name, plus "· agent";
  - **When**: "<ago>" (`<time datetime>`, absolute day time in `title`);
  - **Content hash**: first 12 characters and "…" (full hash in `title`).
- **INV-SRC-03**: **States:** skeleton "Loading the sources"; Reasons; empty "No sources yet. Add notes, rules or anything else DEMIURGO should read."
- **INV-SRC-04**: **"Add a source"** form in the right column, only if `canCreate(source.register)` (`Sources.tsx:130-206`):
  - Heading and "Paste what DEMIURGO should read: notes, rules, a survey."
  - Fields are built from the command's JSON Schema: every string property. A property with `maxLength > 1000` becomes a 10-row textarea. Labels come from the key (today "Name" and "Content"); "· optional" marks non-required fields.
  - Skeleton while the catalog loads.
  - Submit "Add a source" is disabled until the required fields are filled, and shows "Adding…" while pending. Runs `source.register { name, content }`.
  - On success the fields clear and a `role="status"` shows "Added “<name>”." for 5 s. Reasons on error.

- **Real-time:** `sources` refreshes on `source` events (e.g. an agent registering one).
- **States handled:** loading, error, empty, catalog loading, submit pending, success status, error.
- **Tests:** `e2e/sources.spec.ts` AC-INT-001-17 (agent source with "Agent · claude-code" and Untrusted input; the form from the schema, disabled until filled, adds a row with "You", clears, shows the hash prefix; axe). Screens of cut 7.
- **UX problems:**
  - **No way to read a source's content** or open it; the list type has no content (`Sources.tsx:76-111`, `api/types.ts:456`).
  - No search, sort, filter or pagination. The order depends on the API's order, reversed (`Sources.tsx:27`). A source can't be removed or renamed.
  - **Mouse-only details:** the absolute date and the full hash are only in `title` tooltips (`Sources.tsx:101, 106`). The "Untrusted input" explanation is a Tip on a non-focusable span (`Sources.tsx:86-90`).
  - The success message disappears after 5 s (`Sources.tsx:137-141`). Field labels are derived from schema keys, not written copy (`Sources.tsx:123`).

---

### Shared UI used by these screens (referenced above; describe what they carry, not their look)

- **S1 Peek** (`ui/Peek.tsx`): "point, peek, keep".
  - Pointing at a card for about 400 ms shows its detail beside it. A peek opened within 350 ms of another opens instantly.
  - Focus shows the peek immediately. Click keeps it open (the card is drawn selected). Esc closes it. Enter or double-click runs `onOpen` (navigate).
  - The popover (`role="dialog"`, labelled) closes 120 ms after the pointer leaves, unless the pointer is inside it. A kept peek announces "Kept open. Press Escape to close." to screen readers.
  - Used by the Overview's feature cards, record nodes and drafting cards, and by the Knowledge graph's nodes.
- **S2 Detail** (`ui/Card.tsx`): detail-size panel, with zones in card order: TYPE · status, bars and code, title and line, children, footer with who and actions. `Code` = small mono code chip (codes are shown only in detail views).
- **S3 Marks** (`ui/marks.tsx`, `ui/signals.tsx`, `ui/Tip.tsx`, `ui/legend-store.ts`):
  - `Mark` (certainty dot or status mark with `role="img"`, `aria-label` = name, tooltip "<Name> · <phrase>"); `MarkWord` (mark and word; word colour follows the mark); `StateMark` (entity + state → word); `EpistemicMark` (confirmed/proposed/pending/unknown); `WorkingMark` (amber, with children such as a duration).
  - `StageBars` (not-ready / ready / doubt, with tooltip), `NeedsBubble` (blue count, tooltip "Needs you: N things wait for you." or a given detail), `WhoMark` (You / DEMIURGO · model / Agent · name / Automatic · component, with its phrase).
  - Every mark registers itself with the legend, which shows only the marks on screen ("?" toggles it; "Got it" folds it).
- **S4 ActionBar / ActionButtons / useActions / useAllows** (`ui/ActionBar.tsx`): one button per allowed command (tables and catalog) that the screen has a handler for, in the handler order. Label = handler label or the command word; decisive commands are primary by default; `data-command` is set.
- **S5 Reasons** (`ui/Reasons.tsx`):

  | status | title | reasons shown |
  |---|---|---|
  | 0 | "Can't reach DEMIURGO. Check your connection and try again." | none |
  | 401 | "Your session ended. Sign in again to continue." | none |
  | 403 | "Only a person can do this." / "This isn't allowed here." | the message |
  | 404 | "We couldn't find it. …" | none |
  | 409, knowledge behind | "DEMIURGO is catching up with your latest changes. Try again in a moment." | the reasons |
  | 409, other | the message, or "It can't be done right now." | the reasons |
  | 422 | "Some of what you wrote needs a change." | the reasons |
  | else | "Something went wrong on our side. Nothing was changed." | the message |

  A reason matching "Choose a/another model for …" gets an "Open Models & providers" link. Focus moves to the box.
  - `ReadinessBox`: the server's reasons one per line (`data-kind="reason"`), warnings apart (`data-kind="warning"`), and an optional "next" line.
- **S6 Dialogs** (`ui/dialogs.tsx`):
  - `ConfirmDialog` (alertdialog: title, description, Reasons, "Not now" and confirm, which shows "Working…" while pending).
  - `TextDialog` (dialog: title, description, labelled field with "· optional" when not required, max length, "Write something to continue." when a required field is empty, Reasons, "Not now" and submit). It keeps the text on error and resets it on open.
- **S7 Markdown** (`ui/Markdown.tsx`): record and taxonomy sections rendered as GitHub-flavoured Markdown, never raw HTML.
- **S8 QuestionItem** (`ui/QuestionItem.tsx`; used in Needs you, not on these screens). A question with its mark, "Answer:" or "Assumed:" conclusion, "Why:" reasoning (non-compact), and "Reason:" for parked or dropped questions.
  - Actions (tables): pending → Answer / Park / Drop / Reopen; inferred → Confirm (confirmation "…Confirming makes it your answer.") / Change / Park / Drop.
  - Dialogs "Answer the question", "Change the assumed answer", "Park this question" ("It stays open for later. Say why."), "Drop this question" ("It doesn't apply. Say why."), "Reopen this question".
  - Inline errors.
- **S9 Layout** (`ui/layout.tsx`): `Page` (main plus a sticky right "Side panel", optional sticky aside footer, optional resizable panel with keyboard ←/→ and double-click reset, width kept in localStorage `dm-aside-panel-width`), `PageTitle` (eyebrow, h1, subtitle, actions), `EmptyState`, `Skeleton` and `CardSkeleton` (never a full-screen spinner), `Breadcrumbs`. A "Skip to content" link targets `#main` (`AppRoot.tsx:31-36`).
- **Shared UX problem:** **tooltips can't be reached from the keyboard.** Every `Tip` trigger for marks, stage bars, who marks, the Needs bubble and the Untrusted pill is a non-focusable `span role="img"` (`Tip.tsx:26-27`, `marks.tsx:57-61`, `signals.tsx:31-35, 49-53, 79-84`). Keyboard and screen-reader users get the name (`aria-label`) but never the explanatory phrase.

---

### Domain model notes

Entities and fields these screens display, with the allowed values found in `api/types.ts`, `api/views.ts`, `words.ts`, `api/tables.ts` and the helpers.

- **Actor** (strings in `updated_by`, `author`, `approved_by`, `registered_by`, `opened_by`, `producer`, event `actor`):
  - `human:<person>` → You;
  - `agent:run:<runId>` → DEMIURGO (+ model);
  - `agent:<name>:<session>` → Agent · name;
  - `system:<component>@<version>` → Automatic.
  - Object form `{type: human|agent_external|agent_run|system}` (`types.ts:8-12`, `words.ts:229-251`).
- **Epistemic status** (certainty): `confirmed | proposed | pending | unknown` → marks Confirmed / Proposed / **Open** / Unknown (`words.ts:131-136`). There is also a separate `assumed` mark for inferred questions.
- **ProductRow** (a record in `/state` and `/map`): `code`, `type`, `domain` (map lane = area), `title`, `current` (approved version number or null), `latest {n, state}`, `epistemic_status`, `readiness {ready, reasons[], warnings[]} | null`, `implementation`, `summary` (first paragraph), `checks` (criteria of the latest version), `latest_id`, `current_id`, `updated_at`, `updated_by`, `origin_exploration` (thread id or null).
- **RecordType**:

  | code | word | plural | prefix |
  |---|---|---|---|
  | decision | Decision | Decisions | DEC |
  | fdr | Feature | Features | FDR |
  | adr | Tech decision | Tech decisions | ADR |
  | bug | Bug | Bugs | BUG |
  | requirement | Requirement | Requirements | REQ |
  | quality_requirement | Quality requirement | Quality requirements | NFR |
  | threat_model | Threat model | Threat models | THR |
  | production_readiness | Production readiness | Production readiness | PRR |

  Templates (section names):
  - decision: Context, Decision, Consequences;
  - fdr: Goal, Scope, Out of scope, Behavior;
  - adr: Context, Options, Decision, Consequences;
  - bug: Reproduction, Expected, Observed;
  - requirement: Statement, Rationale, Fit criterion;
  - quality: Quality attribute, Scenario, Measure;
  - threat: Assets, Actors and trust boundaries, Threats, Mitigations;
  - PRR: Rollout and rollback, Monitoring, Failure modes, Scalability, Support.

  All except decision require criteria (`domain/src/records.ts:4-41`).
- **Record version state**: draft → Draft (proposed mark), approved → Approved (confirmed), superseded → Replaced, discarded → Discarded (dropped). An earlier draft (draft older than current) can only be discarded.
- **Feature stage (first bar)**: `not-ready` (Not ready: "Something still blocks it. Not built."), `ready` (Ready to build: "Confirmed, nothing blocks it. Not built yet."), `doubt` (In doubt: "It was ready to build, and now something blocks it."). Only the first of three bars (ready · built · verified) is live in H1 (`ui/signals.tsx:11-24`).
- **Rail feature status**: Needs you (count + detail) > Ready to build > In doubt > Draft > Not ready. **Overview featureStatus**: working (a run in its thread) > ready > needs (`progress.ts:24-32`).
- **Waiting** (per record): `{versions, proposals, links, questions}` with the phrase "Needs you: N version(s) to approve, N proposal(s), N link(s) to review, N question(s) in its thread." (`record/logic.ts:66-101`).
- **Readiness reasons**: server strings shown verbatim. Question-based ones: "A question of its thread is open: “…”", "A question of its thread was left for later: “…”", "DEMIURGO assumed an answer you have not confirmed: “…”". Version-based ones: "Version N is not approved.", "Version N is superseded: …", "Version N is a draft earlier than the current one (vM): it can only be discarded." Warnings are prefixed by the criterion code (verifiability).
- **Criterion** (check): `code` (AC-XXX-NNN-M), `title`, `statement`, `verification: automatic | manual` (Automatic / You), `check` ("How:"), `carry: new | kept | modified`.
- **Link** types: `based_on` (Based on), `design_of` (Design of), `covers` (Covers), `origin` (Comes from), `conflicts_with` (Conflicts with), `derived_from` (Derived from) (`record/logic.ts:108-115`). The graph adds `contains` and `related`.
  - Link state: current (Current), needs_review (Needs review, problem), kept (Kept), changed (Changed), obsolete (Out of date).
  - IncomingLink `relation: needs | follows | conflicts | affects | null`.
- **MapRelation**: `{from, to, kind: needs|follows|conflicts|affects, link, under_review: boolean}`. Words from/to: Needs/Needed by, Rules it follows/Followed by, Conflicts with/Conflicts with, Affects/Affected by. **MapQuestion**: `{id, exploration_id, question, state, impact, conclusion, affects: record codes}`. **ProductMap.areas**: string[]. **ideas**: `{id, purpose}`.
- **Journey**: `{code, title, version, epistemic_status, readiness, origin_exploration, steps: {n, title, detail[]}[], paths: {code, title, verification, given, when, outcome}[], gaps: {id, question, state, impact, exploration_id}[]}`.
- **Exploration (thread)**:
  - Summary: `{id, purpose, state, parent_id, origin_type, origin_id, open_questions}`.
  - List item: + `state_reason`, `opened_by`, `created_at`, `origin_version`, `last_activity`.
  - `state`: active (Active, open mark), concluded (Concluded, confirmed), set_aside (Set aside, parked; shown as a "Parked idea"). `origin_type`: `record_version` or null.
  - "About the whole product" is the reserved purpose of the product-level ask thread.
- **Question**: `{id, exploration_id, question, reason, impact: high|medium|low (High/Medium/Low), conclusion, reasoning, state, state_reason, raised_by, created_at, epistemic_status, options?, stage_id?, stage_key?, multiple?, shown_at?}`.
  - state: pending (Open), inferred (Assumed), confirmed (Confirmed), postponed (Parked; "Not now" group in the Questions tab), discarded (Dropped; "Doesn't apply" group).
  - Commands: question.confirm {conclusion?}, question.postpone {reason}, question.discard {reason}, question.reopen {reason?}.
- **StageRow** (design stages): `{key, title, produces, position, id, state: not_started|open|passed (Not started/Open/Passed), exploration_id, passed_by, passed_at, total, covered, questions[{id,key,question,state}]}`. Commands: `stage.open {stage}`, `stage.pass` (entity = stage id).
- **Inbox**: `total`, `batches[{id, type: agent|system_package|knowledge|import, producer, resolution: item|package, summary, run_id, created, dependencies[{type,id,code?,version}], proposals[{id,type,payload,state,epistemic_status,obsolescence[],assessment,dependencies}]}]`, `questions_to_confirm[]`, `open_questions[]`, `versions_to_approve[{id,code,type,n,title,approvable,epistemic_status}]`, `links_under_review[]` (with from/to code, n, title), `classifications_to_review[{id,node_ref,axis,category,confidence,justification,classifier}]`, `rejected_updates[{id,trigger,failure,created_at}]`.
  - Needs kinds: conflict, question, assumed, proposal, package, version, link, classification, update.
- **Proposal state**: pending (Proposed), accepted (Accepted), accepted_edited (Accepted with edits), rejected (Rejected), superseded (Out of date). **Batch state**: pending (Pending), accepted (Accepted), rejected (Rejected), resolved (Resolved), superseded (Out of date).
- **Run** (RunListItem):
  - `state`: queued (Queued), running (Working) = "working" states; completed (Completed), failed (Failed), cancelled (Cancelled), interrupted (Interrupted).
  - `action`: exploration_chat (Conversation; "Answering"), design_proposal (Draft; "Drafting a feature"), echo.
  - Fields used: `scope {type, id, version}`, `model`, `exploration_id`, `created_at`, `started_at`, `finished_at`, `failure_kind` (invalid_output, agent_error, timeout, infra, cancelled, stale_knowledge, with product sentences in `words.ts:205-218`).
- **Changes** (lens): `{latest, things: ChangedThing[]}`. `ChangedThing {kind: record|exploration|batch|knowledge|project, key (record code / exploration id / batch id / "knowledge" / project id), title, record_type? (record type or batch kind), events[{id, at, actor, command, entity_type, entity_id, entity_version, state_before, state_after}]}`. A LensLine is `{id "kind:key", kind, key, at, actor, segments (string | {strong}), codes[], problem, note}`. Authority states per entity come from the tables (`transitions.entities[e].authority`).
- **EventRow** (history): `{id (bigint string, ordering), seq, at, actor, command, entity_type, entity_id, entity_version, state_before, state_after, before, after, cause}`.
- **Knowledge**: `{graph_version, up_to_date, updates_in_progress, fingerprint, current_nodes, current_edges, updates: KnowledgeUpdate[]}`.
  - KnowledgeUpdate `{id, state: queued|classifying|verifying (all "Updating") | applied (Applied) | rejected (Failed), trigger {type: record_version|record_version_discard|proposal, id, version}, failure, graph_version_before, graph_version_after, created_at}`.
  - Freshness: current / updating / behind (any rejected update → behind).
- **GraphNode**: `{ref (CODE@n for records, AC-…@n for checks), type: decision|adr|fdr|bug|criterion (+thread|idea in search), label, excerpt, epistemic_status, areas: {axisCode: categoryCode}, state: current (Current)|invalidated (Invalidated), record: {code, version}|null}`. **GraphEdge**: `{type: contains|based_on|related|design_of|covers|origin|conflicts_with|derived_from, from, to, state}`.
- **SearchResult**: `{ref, type, title, excerpt, epistemic_status, rank}`. Ref forms: `CODE@n`, `AC-XXX-NNN-M@n`, `exploration:<uuid>`.
- **IdeaAssessment**: `{id, graph_version, classifier, created_at, error, proposal {id, type: decision|fdr|exploration, title, batch_id, state}, findings[{verdict: duplicates|conflicts|inconsistent|relates, citation, label, record, epistemic_status, confidence 0..1, justification}]}`.
- **Taxonomy**: `{id, code (TAX-001), version, title, axes: [{code, name, categories: [{code, name, description}]}], sections[{title, content}], state: draft (Proposed)|approved (Approved)|superseded (Replaced), author, created_at, approved_at, approved_by}`. Rules enforced by the server: every axis has an `other` category; codes are unique; code format `[a-z][a-z0-9_]*`. Only the first axis of the latest approved version groups the graph.
- **Classification state**: applied (Applied), pending_review (Needs review), resolved (Resolved).
- **Source**: `{id, name, content_hash, registered_by, created_at}`. State: registered (Registered). The command is `source.register {name, content}`; the API list carries no content.

---

### Product vocabulary

Verbatim from `words.ts`, plus local dictionaries of this area (file noted).

**Marks (`MARKS`, tooltip and legend = "<Name> · <phrase>")**

| name | phrase |
|---|---|
| Confirmed | A person said yes. |
| Assumed | DEMIURGO concluded it. Not confirmed yet. |
| Proposed | Suggested, waiting for you. |
| Open | Asked, no answer yet. |
| Unknown | Not known yet. |
| Parked | Kept for later. |
| Dropped | Doesn't apply. |
| Replaced | A newer version exists. |
| Out of date | What it was based on changed: it can no longer be accepted. |
| Conflict | Contradicts something confirmed. |
| Problem | Something went wrong or needs a review. |
| Working | DEMIURGO or an agent is on it. |
| Not active | Finished or stopped: nothing to do. |
| Done | Finished without problems. |

**State words (`STATE_WORDS`) relevant here** (entity: state → Word [mark])

- record_version: draft → Draft [proposed]; approved → Approved [confirmed]; superseded → Replaced [replaced]; discarded → Discarded [dropped].
- question: pending → Open; inferred → Assumed; confirmed → Confirmed; postponed → Parked; discarded → Dropped.
- proposal: pending → Proposed; accepted → Accepted; accepted_edited → Accepted with edits; rejected → Rejected [dropped]; superseded → Out of date [stale].
- batch: pending → Pending; accepted → Accepted; rejected → Rejected; resolved → Resolved [done]; superseded → Out of date.
- link: current → Current; needs_review → Needs review [problem]; kept → Kept; changed → Changed; obsolete → Out of date.
- ai_run: queued → Queued [working]; running → Working; completed → Completed [done]; failed → Failed [problem]; cancelled → Cancelled [inactive]; interrupted → Interrupted [problem].
- knowledge_update: queued, classifying, verifying → Updating [working]; applied → Applied [done]; rejected → Failed [problem].
- classification: applied → Applied; pending_review → Needs review [proposed]; resolved → Resolved.
- exploration: active → Active [open]; concluded → Concluded [confirmed]; set_aside → Set aside [parked].
- taxonomy: draft → Proposed; approved → Approved; superseded → Replaced.
- knowledge_node, knowledge_edge: current → Current [done]; invalidated → Invalidated [inactive].
- source: registered → Registered [unknown].

**Commands (`COMMAND_WORDS`) used or shown here**

`question.confirm` Confirm · `question.postpone` Park · `question.discard` Drop · `question.reopen` Reopen · `question.raise` Ask a question · `exploration.open` New thread · `exploration.set_aside` Set aside · `run.cancel` Cancel · `run.request` Ask DEMIURGO · `knowledge_update.retry` Retry · `taxonomy.propose` Propose · `taxonomy.approve` Approve · `source.register` Add a source · `record_version.approve` Approve · `record_version.discard` Discard · `record_version.create` New version · `link.keep` Keep · `link.change` Mark as changed · `link.obsolete` Out of date · `design.import` Import design/.

Screen-level overrides in the Questions tab: "Confirm: <answer>", "Answer", "Answer differently", "Not now", "Doesn't apply", "Reopen".

**Who (`WHO_PHRASES`)**

| who | phrase |
|---|---|
| You | Only people confirm. |
| DEMIURGO | Drafts, asks and proposes. |
| Agent | From outside. Only proposes. |
| Automatic | A rule or test that ran alone. |

**Product words (`PRODUCT_WORDS`)**

| key | text |
|---|---|
| needsYou | Needs you |
| nothingNeedsYou | Nothing needs you. You can close DEMIURGO. |
| readyToBuild | Ready to build |
| notReady | Not ready |
| notBuilt | not built |
| catchingUp | DEMIURGO is catching up with your latest changes. Try again in a moment. |
| cantReach | Can't reach DEMIURGO. Retrying… |
| onlyAPerson | Only a person can do this. |
| notAllowed | This isn't allowed here. |

**Types**: see the RecordType table in the Domain model notes.

**Local dictionaries of this area**

- **Stage words** (`ui/signals.tsx`): Not ready / Ready to build / In doubt, with the phrases listed in the Domain model notes. "the track … ready · built · verified".
- **Needs labels** (`overview/needs.ts`): Conflict, Question, Assumed answer, Proposal, Package, Version to approve, Link to review, Classification, Knowledge update, plus "Parked question" and "Old draft to discard".
- **Impact** (`blueprint/questions.ts`): High, Medium, Low.
- **Map relation words** (`map/layout.ts`): Needs / Needed by; Rules it follows / Followed by; Conflicts with; Affects / Affected by. Legend: "Needs another feature", "Follows a rule", "Conflicts", "Affects (derived from)".
- **Graph edge words** (`knowledge/graph.ts`): Contains/Part of, Based on/Basis of, Related to, Design of/Designed in, Covers/Covered by, Comes from/Origin of, Conflicts with, Derived from/Source of.
- **Graph node types**: Decision(s), Tech decision(s), Feature(s), Bug(s), Check(s), Thread(s), Idea(s).
- **Verdicts**: Duplicates (=), Contradicts (≠), Inconsistent with (≠), Relates to (~).
- **Freshness**: Up to date, Updating, Behind.
- **Update triggers**: Approval of CODE vN / a version, Discard of CODE vN / a draft, An accepted proposal, A change.
- **History words** (`blueprint/history.ts`): Created vN, Approved vN, vN was replaced, Discarded vN.
- **Section tabs**: Overview, Questions, Checks, History. **Product views**: Overview, Map, Origins, Journeys. **Knowledge views**: Graph, Search, Idea checks, Taxonomy, Rebuild.
- **Recurring phrases**:
  - "Later" (not in this increment);
  - "Parked ideas" (set-aside threads);
  - "Catch up" (walk Needs you one at a time);
  - "While you were away" / "Show what changed" / "Show everything" (lens);
  - "Why does this exist?" / "Clear trace" (Origins);
  - "If you confirm" (Questions aside);
  - "Not defined yet" (journey gap);
  - "Untrusted input" (agent source);
  - "Rebuild from what you approved" / "They match" / "They don't match";
  - "Point at …" (peek and trace hints);
  - "Ask DEMIURGO about <subject>" / "About: whole product".

## Part C · Threads, thread, forks, Go deeper, runs, activity


Source: `packages/web` on branch `ux/frontend-rebuild-2026-09-25` at `5a3243d` (identical to `v2.1`). Latest patches in this
area (newest first): `5a3243d` (DEMIURGO replies as markdown; settled questions layout), `2cd79c9` (answers and fork
choices are drafts confirmed together; Go deeper "Use this reply as the answer"), `7d13a99` (resizable side panel with its
own scroll; Go deeper stops getting stuck in "writing"), `1ba0431` (guided thread: questions in the conversation with
options, Go deeper, forks, stage progress), `fffa049` (server: reserve of questions, 2 open at a time, multiple choice,
stages in the main thread, forks hang from their thread), `94a9619` (thread purpose summarised by the agent, with history),
`fa5bd65` (Activity: usage per agent).

### Conventions of the data layer used below

- **Commands**: every write is `POST /api/projects/:projectId/commands/:command` with body `{ entity_id?, data }`
  (`runCommand` / `useCommand` in `api/commands.ts`). On 2xx every query under `['p', projectId]` is invalidated. Errors
  are `ApiError {status, type, message, reasons}` shown by `ui/Reasons.tsx` (role=alert, takes focus, product words per
  status; a reason matching `Choose (a|another) model for` gets a link "Open Models & providers").
- **Buttons from the tables**: `ActionBar`/`useAllows` (ui/ActionBar.tsx) show a command only if `GET /api/tables`
  allows a `human` that transition from the entity's current state (and `GET /api/commands` says it is implemented).
  `canCreate(tables, command)` gates creation buttons (transition from `new`).
- **Queries** (api/queries.ts, api/models.ts): `explorationsQuery` → `GET /api/projects/:p/explorations`;
  `explorationQuery` → `GET /api/projects/:p/explorations/:id`; `runsQuery(p, {exploration?, state?})` →
  `GET /api/projects/:p/runs?exploration=&state=` (server: newest first, **limit 500**); `runQuery` →
  `GET /api/projects/:p/runs/:id`; `runCallsQuery` → `GET /api/projects/:p/runs/:id/calls`; `stagesQuery` →
  `GET /api/projects/:p/stages`; `stateQuery` → `GET /api/projects/:p/state`; `batchQuery` →
  `GET /api/projects/:p/batches/:id`; `entityEventsQuery` / `runEventsQuery` → `GET /api/projects/:p/events?entity=:id`;
  `usageQuery` → `GET /api/projects/:p/usage`; `providersQuery` → `GET /api/providers`; `tablesQuery` → `GET /api/tables`;
  `commandsQuery` → `GET /api/commands`.
- **Real time** (api/stream.ts): one `EventSource` per open project on `GET /api/projects/:p/events/stream?from=latest`;
  each log event (SSE event name = command) invalidates the query groups of its `entity_type` (`INVALIDATES` map),
  batched every 60 ms; `run.progress` SSE messages (not log events) feed `api/progress.ts`; after a reconnect all
  project queries are refetched; `ConnectionBanner` shows "Can't reach DEMIURGO. Retrying…" (role=status) after 1.5 s down.
  Relevant map: `question → exploration, inbox, state, readiness, explorations, stages`; `stage → stages, explorations,
  state`; `message → exploration, explorations`; `exploration → exploration, explorations, state, events`; `ai_run → run,
  runs, exploration, events`; `context_pack → run`; `batch → inbox, batch, state, runs`; `proposal → inbox, batch, state,
  record, readiness`.

---

#### Threads list — `/p/$projectId/threads` (no search params)

- Purpose: every thread of the project as a nested tree, with what waits for the person and its last activity; open a new thread.

Checklist:

- **INV-THRS-01** Page title "Threads" with subtitle "`N` thread(s) · `K` active" (counts from the list), or, with no
  threads, "Explore something with DEMIURGO: a question, an idea, a change." — `explorationsQuery`
  (`GET /api/projects/:p/explorations`), fields `state`.
- **INV-THRS-02** "New thread" button (secondary, plus icon) in the title bar, only when the tables allow a person
  `exploration.open` (`canCreate`).
- **INV-THRS-03** "Open a thread" dialog (`OpenThreadDialog`, `ui/dialogs.tsx TextDialog`): description "Say what this
  thread explores. DEMIURGO reads it as its purpose."; field "Purpose" (textarea, required, max 1000); hint "Write
  something to continue." while empty; buttons "Not now" / "Open thread" ("Working…" while pending); server reasons
  inside the dialog; the command is reset every time the dialog opens. Submits `exploration.open` `{purpose}` and
  navigates to `/p/$projectId/threads/<entity_id>`.
- **INV-THRS-04** Each thread is one row rendered as the design system's `Node` (type thread) and the **whole row is a
  link** to the thread; title = `purpose`.
- **INV-THRS-05** State mark on each row (`Mark` with tooltip "<word> · <phrase>" and `aria-label`): Active → Open mark,
  Concluded → Confirmed mark, Set aside → Parked mark; the Node's own state follows (open / confirmed / parked).
- **INV-THRS-06** For non-active threads the trailing text starts with the state word ("Set aside · ", "Concluded · ").
- **INV-THRS-07** Needs-you bubble per row with `open_questions` (blue count, `aria-label "Needs you: N"`, tooltip
  "`N` open question waits / questions wait for you."); hidden when 0. Server counts shown questions in `pending`,
  `inferred` **and `postponed`**.
- **INV-THRS-08** Last activity per row: relative time (`ago`: "just now", "`N` min ago", "`N` h ago", "24 Sep") in a
  `<time datetime>` with tooltip `dayTime` ("Thu 18:52" / "24 Sep 18:52"). `last_activity` = last message time, else
  creation time.
- **INV-THRS-09** Nesting (`screens/threads/tree.ts threadTree`): each thread under its parent (`parent_id`), indented 26 px
  per level with an elbow connector; roots ordered Active → Set aside → Concluded, then most recent activity first, then
  id; children in creation order; a thread whose parent is missing (or a cycle) still shows at the top level.
  `data-thread-row=<id>`, `data-depth=<n>`.
- **INV-THRS-10** Loading: 4 skeleton rows, `role=status` "Loading the threads".
- **INV-THRS-11** Empty state: "No threads yet." + " Open one to explore something with DEMIURGO." when allowed.
- **INV-THRS-12** Entry points: header section nav "Threads" (active for `/threads*`, screens/shell/Header.tsx:30); global
  search results can open a thread (screens/shell/Search.tsx:87); many other screens link to threads (Overview, Needs you,
  Map, Journeys, Record aside, Day 1, Origins).

Real-time: `explorationsQuery` is invalidated by events on `question`, `stage`, `message`, `exploration` → new threads,
state changes, open-question counts and last activity refresh in place (realtime.spec shows the header Needs you count
updating on this page without reload).

States handled: loading (skeleton) · empty · populated · per-row thread states active / concluded / set_aside (+ unknown
state → "unknown" mark fallback). **Not handled: error** (see UX).

Tests: e2e `threads.spec.ts` "AC-INT-001-09 a new thread opens from the list, Send writes in it, and a thread inside nests
under its parent" (empty state, New thread dialog, nesting depth 0/1, a11y scan); "screens of cut 3" (4 rows screenshot);
`h1-walk.spec.ts` AC-INT-001-01 (New thread from list); `realtime.spec.ts` AC-INT-001-15 (page stays mounted while Needs you
updates). Unit `thread-tree.test.ts` AC-INT-001-09 ×2 (nesting/order; orphans and cycles).

UX problems:

- A failed fetch is shown as the empty state "No threads yet." — the branch only checks `isPending` then `rows.length`
  (`screens/threads/Threads.tsx:53-59`); no retry, no error message.
- The tooltip says "open questions wait for you" but the server count includes **parked** (`postponed`) questions
  (`Threads.tsx:122-125` vs `packages/core/src/queries/web.ts:21`).
- Hierarchy is only visual: a flat `<ul>` with `paddingLeft` and an `aria-hidden` elbow (`Threads.tsx:104-116`); no
  `aria-level`/tree semantics, so screen-reader users cannot tell a child from a root; unbounded indentation at deep levels.
- Active threads show no state word, only the mark (`Threads.tsx:127`); state is conveyed by a glyph (with tooltip/aria-label).
- No search, filter (by state), sort or collapse of subtrees (`Threads.tsx:102-139`); with many threads the list only grows.
- Relative times never refresh while the page stays open (computed at render, `Threads.tsx:128-130`).
- `last_activity` ignores runs, answers and question changes (only messages, `core/src/queries/web.ts:25-36`), so a thread
  where the person only answered questions looks idle.

---

#### Thread — `/p/$projectId/threads/$explorationId` (no search params)

- Purpose: one thread (exploration): its purpose and provenance, the guided conversation with DEMIURGO (messages, questions
  answered in place as drafts, runs), the composer, and a right column with the threads inside it or a "Go deeper" side
  conversation.

Data used: `explorationQuery` (`ExplorationDetail`: purpose, state, state_reason, parent_id, origin_type/id,
opened_by, created_at, messages[], questions[], children[]), `runsQuery(p, {exploration})`, `stateQuery` (decisions for
Draft it, records for provenance), `stagesQuery`, `explorationsQuery` (parent/origin names), `entityEventsQuery` (purpose
history), `batchQuery` (proposals of a run), `tablesQuery`/`commandsQuery` (allowed actions), `useRunProgress`.

##### Header

- **INV-THR-01** Load: 404 → NotFound "this thread" with "It may belong to another project."; other error with no data →
  `Reasons` box; loading → skeleton (`role=status` "Loading the thread", aside `role=status` "Loading the questions").
- **INV-THR-02** Breadcrumbs: "Threads" (link to list) › parent purpose truncated to 40 chars with "…" (link, only if the
  thread has a parent) › own purpose truncated to 48 chars (`aria-current=page`).
- **INV-THR-03** Eyebrow: thread icon, "Thread", "·", state mark + word (Active / Concluded / Set aside).
- **INV-THR-04** `h1` = full purpose (the agent may rewrite it; see INV-THR-11).
- **INV-THR-05** Stage chip under the title when an **open** stage belongs to this thread (`stages[].exploration_id`):
  "`<Stage title>` · `X` of `Y` answered" (`covered`/`total`), `data-thread-stage=<key>`.
- **INV-THR-06** "Conclude" (secondary; tables: from `active`) → dialog "Conclude this thread", "Say what the thread
  settled. It stays with the thread, and you can resume it later.", field "Conclusion" (required, max 1000), "Conclude" →
  `exploration.conclude` `{reason}`.
- **INV-THR-07** "Set aside" (text button; from `active`) → dialog "Set this thread aside", "It stops for now, with
  everything it has. Say why.", field "Reason" (required, max 1000), "Set aside" → `exploration.set_aside` `{reason}`.
- **INV-THR-08** "Resume" (secondary; from `concluded`/`set_aside`) → `exploration.resume` `{}` immediately (no dialog),
  disabled while pending.
- **INV-THR-09** Header command errors appear under the header when no dialog is open; dialog errors inside the dialog
  (text kept).
- **INV-THR-10** Provenance line (`data-thread-provenance`), parts separated by "·": "Inside `<parent purpose link>`";
  origin: "From the thread `<link>`" / "From another thread" (origin exploration ≠ parent), "From the question
  “`<question, 80 chars>`”" / "From a question" (reads the parent's questions), "From `<record title link>` `<CODE vN>`"
  (link to `/records/$code?v=N`, found in state decisions/designs by latest or current version) / "From a record",
  "From a proposal" (accepted DEMIURGO fork); "`<WhoMark>` Opened by you|`<name>` · `<24 Sep>`".
- **INV-THR-11** Purpose history: `<details data-purpose-history>` "Earlier summaries (`N`)" listing previous purposes
  (newest first, date + text) built from the thread's `exploration.open` and `exploration.revise_purpose` events; hidden
  with fewer than 2 versions. `exploration.revise_purpose` is a system command applied from the agent's output.
- **INV-THR-12** Concluded box (`data-thread-conclusion`): "Conclusion" + `state_reason` (only when concluded with a reason).
- **INV-THR-13** Set-aside box (dashed): "Why it was set aside" + `state_reason` or "No reason given."

##### Conversation (main column)

- **INV-THR-14** Timeline (`screens/thread/timeline.ts buildTimeline`): messages, **shown** questions (at `shown_at`) and
  runs (a working run at `created_at`, others at `finished_at`) merged by time, stable for ties (messages first).
  Messages with a `question_id` (Go deeper side conversation) are excluded from the main timeline.
- **INV-THR-15** DEMIURGO's messages of the same run are grouped into one card: the first message without `kind` is the
  reply, messages with `kind` are observations, other non-kind messages of the run are shown as extra paragraphs.
- **INV-THR-16** Empty conversation: "Nothing written yet. Write below, then Send it or ask DEMIURGO." (active) / "Nothing
  was written in this thread." (not active).
- **INV-THR-17** While runs load: two skeleton bubbles (aria-hidden).
- **INV-THR-18** Person's message (`data-message-by="you"`): right-aligned bubble, header "You · `<relative time>`" (tooltip
  day+time) + WhoMark; body as plain text with line breaks preserved (not markdown). (Code also supports "On the question
  “…”" for messages about a question, unreachable in the main timeline.)
- **INV-THR-19** External agent / automatic message (`data-message-by="agent"|"automatic"`): left bubble with WhoMark, name
  (agent name or "Automatic"), detail ("Agent" or `component@version`), time; plain text.
- **INV-THR-20** DEMIURGO message card (`data-message-by="demiurgo"`): WhoMark (tooltip "DEMIURGO · `<model>`"),
  "DEMIURGO", model name of the run, "·", relative time; reply and extra paragraphs rendered as **Markdown**
  (`ui/Markdown.tsx`: react-markdown + remark-gfm, never raw HTML, class `prose-record`).
- **INV-THR-21** "What it observed" block (`data-observation=<kind>`): each observation with its chip — `claim` and
  `hypothesis` → Proposed mark, `unknown` → Unknown mark, never Confirmed — and its text (plain).
- **INV-THR-22** "Proposed" box under a DEMIURGO card when its `exploration_chat` run produced a batch (`batchQuery`):
  non-thread proposals summarised "Proposed `<1 decision | 2 features and 1 thread | …>` for you to review." with
  "Review →" (needs colour) while the batch is pending with pending proposals, otherwise "Proposed … ." + batch state mark
  + "Open →"; link to `/p/$projectId/batches/$batchId` (`data-proposed`). Skeleton line while the batch loads.
  Thread-type proposals render as fork suggestions (INV-FORK-03).
- **INV-THR-23** Follow the end: when the window is within 160 px of the bottom, new timeline items scroll the page to the
  end; otherwise the position is kept.
- **INV-THR-24** Relative times re-render every second only while a run of the thread is active (`useNow`).

##### Questions answered in the conversation (guided thread)

- **INV-THR-25** Only questions with `shown_at` appear; the server keeps at most **2 open (pending/inferred) shown
  questions** per thread and reveals the next from the reserve after DEMIURGO's reply or when one is settled. A question a
  person raises is shown at once.
- **INV-THR-26** Reserve notice (active thread): "DEMIURGO keeps `N` question(s) for later. They come up as you answer."
- **INV-THR-27** Open question card (`data-question=<id>`, pending or inferred): header "Question" (+ " · `<stage title>`"
  when `stage_id`), `h3` question text, "Why it matters: `<reason>`".
- **INV-THR-28** Predefined options as buttons (grid of 2 or 3 columns): bold `answer` + caption `implies`; `aria-pressed`;
  single choice: a click drafts that option's text as the answer, clicking it again removes the draft.
- **INV-THR-29** Multiple choice (`multiple`): checkbox glyph on each option; clicking toggles; an `exclusive` option clears
  the others and any other clears the exclusive ones; the draft stores the picked answers joined with " · " in option
  order; caption "Pick all that apply" while nothing is picked.
- **INV-THR-30** Inferred (assumed) answer: when `state = inferred` with a conclusion, the first option is DEMIURGO's
  conclusion with caption "DEMIURGO inferred it: `<reasoning>`" or "DEMIURGO inferred it from the conversation."; picking it
  drafts it.
- **INV-THR-31** "Answer in my own words": points the composer at this question ("Replying to") and focuses the composer.
- **INV-THR-32** Own-words draft preview: "Your answer: `<text>`" (clamped to 4 lines, full text in tooltip) + "Clear".
- **INV-THR-33** "Not sent yet" caption on a card with a draft (`data-draft="true"`).
- **INV-THR-34** Answer controls (options, Go deeper, own words) appear only when the tables allow `question.confirm` from
  the question's state **and** the thread is active; otherwise the card shows only question + reason.
- **INV-THR-35** Settled question (`confirmed`/`postponed`/`discarded`, `data-state`): compact grey row with a dot (ink when
  confirmed, grey otherwise), the question, and the conclusion (clamped 3 lines, tooltip) or "Parked"/"Dropped".
- **INV-THR-36** Stage complete card (`data-stage-complete`; open stage of this thread with `total > 0` and
  `covered = total`, thread active): "`<title>` is complete: `X` of `Y` answered. You can pass the stage; next comes
  `<next title>`." + "Pass stage" (primary; "Passing…") → `stage.pass` (entity = stage id; decisive); errors below.

##### Drafts confirmed together

- **INV-THR-37** Drafts per thread: `answers {questionId: text}` (trimmed, max 3000) and `forks {proposalId:
  'explore'|'keep'}`, kept in this browser's `localStorage` under `dm-thread-drafts:<threadId>` (survive reloads; removed
  when empty; storage failures ignored); state switches when the thread id changes.
- **INV-THR-38** Drafts bar above the composer (active thread, when there are drafts or a send error): "`a` of `n`
  answer(s) and `f` thread choice(s) ready. Nothing is sent until you confirm; you can still change them." + "Discard"
  (clears all drafts of the thread) + "Confirm and send" (primary, "Sending…").
- **INV-THR-39** Confirm and send, in order: for each drafted **open shown** question `question.confirm` `{conclusion}`
  (entity question), removing each draft as it succeeds; then each fork choice → `proposal.accept` `{}` (explore) or
  `proposal.reject` `{reason: 'Kept in this thread.'}` (keep); a 409 on a fork (already resolved elsewhere) is ignored and
  its draft dropped.
- **INV-THR-40** After sending at least one answer, if no open question is left in the thread (reserve included), it asks
  DEMIURGO to go on: `run.request` `{action: 'exploration_chat', scope: {type: 'exploration', id}}`.
- **INV-THR-41** A failure stops the sequence and shows the reasons in the bar; what was already sent stays sent, the
  rest stays as drafts.

##### Composer

- **INV-THR-42** Sticky composer at the bottom of the main column (form `aria-label "Write in the thread"`, textarea
  labelled "Message", id `thread-composer`, max 20,000 chars, 3 rows, vertically resizable, placeholder "Write to the
  thread…"); disabled when the thread is not active or `message.post` is not allowed.
- **INV-THR-43** "Send" (text button, submit) → `message.post` `{exploration_id, text, respond: false}`; clears the field on
  success; label "Sending…" while pending; disabled when empty or busy.
- **INV-THR-44** "Ask DEMIURGO" (secondary, when `run.request` allowed) with text → `message.post` `{…, respond: true}`
  (durable answer requested by the server); clears on success; "Asking…".
- **INV-THR-45** "Ask DEMIURGO" with an empty field → `run.request` `{action: 'exploration_chat', scope: {type:
  'exploration', id}}` (DEMIURGO continues the conversation).
- **INV-THR-46** Replying mode: when a shown open question is chosen (INV-THR-31) or, by default, the first shown open
  question without a draft, the composer shows "Replying to: `<question>`" + "Write something else" (aria-label "Write to
  the thread instead of answering"); placeholder "Your answer, or pick an option above"; the submit button reads "Use as
  answer" and stores the text as that question's **draft** (nothing is sent), then moves on to the next question without a
  draft. "Write something else" turns replying off for the rest of the visit.
- **INV-THR-47** Keyboard: Ctrl+Enter / Cmd+Enter submits (Send, or Use as answer while replying); plain Enter inserts a
  new line; hint "Ctrl+Enter sends" shown only on wide (xl) screens.
- **INV-THR-48** "Draft it ▾" dropdown (secondary, when `run.request` allowed): menu label "DEMIURGO drafts a feature with
  its checks from an approved decision. You review it before anything changes."; one item per **approved** decision
  (`state.decisions` with a current version): title (2 lines), "`CODE` v`N`", badge "From this thread" when
  `origin_exploration` is this thread; born-here first, then by code. Picking → `run.request` `{action:
  'design_proposal', scope: {type: 'record_version', id: <current version id>}}`; label "Asking…" while pending.
- **INV-THR-49** No approved decision: "Draft it" disabled and the footer says "Draft it needs an approved decision first."
- **INV-THR-50** Not active: footer note "This thread is concluded. Resume it to continue." / "This thread is set aside.
  Resume it to continue." + "Resume" (when allowed) → `exploration.resume`; textarea collapses to one line; resume errors
  shown above the composer.
- **INV-THR-51** Any composer command error appears above the composer (Reasons, focus moves to it) and the written text
  is kept; a "Choose a model for …" reason links to Models & providers.

##### Runs inside the thread (run cards)

- **INV-THR-52** Which runs show (`runDisplay`): queued/running → working card; failed/interrupted without a retry →
  failed card; failed/interrupted with a retry → "retried" line; cancelled → cancelled line; completed `design_proposal`
  with a batch → draft card; any other completed run → nothing (its messages speak). Includes runs started from Go deeper.
- **INV-THR-53** Working card (`data-run-card="working"`): WhoMark (DEMIURGO + model), "DEMIURGO is working…", action word
  ("Conversation"/"Draft") + " · `<model>`", live progress text (INV-RUN-19), Working mark with "Queued" or
  "Answering…"/"Drafting…"/"Working…" + " · `m:ss`" (`data-run-timer`), and "Cancel" (tables: `run.cancel` from
  queued/running) → `run.cancel` (entity run id), disabled while pending; errors under the card.
- **INV-THR-54** Failed card (`data-run-card="failed"`, rust box): problem mark ("Failed"/"Interrupted"), failure in product
  words (`failureWord`), "`<action>` · `<day time>` · `<model>`", "Details →" (aria-label "Details of the `<action>` run",
  to the run page), "Retry with…" (INV-RUN-08) and "Retry" (secondary, "Retrying…") → `run.retry` `{run_id}` (same context
  pack) — both only when `run.retry` is allowed and state ∈ failed/interrupted/cancelled; errors under the card.
- **INV-THR-55** Retried line (`data-run-card="retried"`): grey mark "Retried", "Failed, then retried: `<failure words>`"
  (or "Interrupted, then retried: …"), "·", "Details →". No Retry.
- **INV-THR-56** Cancelled line (`data-run-card="cancelled"`): grey mark "Cancelled", "Cancelled · `<action>` after `m:ss`",
  "Details →". No Retry in the thread (only on the run page).
- **INV-THR-57** Draft card (`data-run-card="draft"`, `batchQuery`): pending batch → needs-coloured box "A draft is ready:
  `<title>` with `N` check(s)" + "Review →"; resolved → "The draft `<title>` with `N` checks" + batch state mark + "Open →";
  link to the batch page. Skeleton (`data-run-card="draft-loading"`) while the batch loads.

##### Shared UI as used around threads

- **INV-THR-58** `Markdown` (ui/Markdown.tsx) renders DEMIURGO's replies in the main thread and in Go deeper (GFM tables,
  lists, code; no raw HTML). Person messages, agent messages and observations stay plain text.
- **INV-THR-59** "Ask DEMIURGO about this" bar (`ui/AskBar.tsx`, on Overview "About: whole product" and on a record's
  aside; entry point into threads): finds the subject's most recent **active** thread (`ui/ask.ts threadFor`: product →
  origin null and purpose starting "About the whole product"; record → origin `record_version` among its versions) or opens
  one (`exploration.open` `{purpose: 'About the whole product'}` or `{purpose: 'About <title>', origin: {type:
  'record_version', id}}`), then `message.post` `{respond: true}`; Enter sends, Shift+Enter new line (IME-safe); the field
  grows to ~5 lines; placeholder "Ask or tell DEMIURGO anything about `<product>`" / "Ask about this `<type>`, or suggest a
  change…"; status line (`role=status`, `data-ask-status`): "Sent to `<thread>` · DEMIURGO is answering…" (working mark) /
  "DEMIURGO answered in `<thread>` · Open the thread →" / "DEMIURGO couldn't answer: `<failure words>` · Open the thread →";
  imperative `prefill(text)` ("In Checks: "). Hidden when `message.post` or `exploration.open` is not allowed.
- **INV-THR-60** `QuestionItem` (ui/QuestionItem.tsx) — **no longer used in the thread** (removed from the thread's right
  column by `1ba0431`; now only in Needs you). The capabilities it gave the thread and that the guided thread lacks:
  "Answer" (dialog "Answer the question", field "Conclusion", max 3000) → `question.confirm`; for an assumed question
  "Confirm" with confirmation dialog "Confirm this answer?" ("DEMIURGO assumed it. Confirming makes it your answer.") and
  "Change" (dialog "Change the assumed answer", "Confirm my answer"); "Park" (dialog "Park this question", "It stays open
  for later. Say why.", reason required) → `question.postpone`; "Drop" (dialog "Drop this question", "It doesn't apply. Say
  why.") → `question.discard`; "Reopen" (dialog "Reopen this question", "Its history is kept. The answer has to be given
  again.", reason optional) → `question.reopen`; "Answer:/Assumed:" line, "Why:" reasoning, "Reason:" for parked/dropped.
  **Parity decision needed**: Park, Drop and Reopen of a question cannot be done from the thread today.

##### Right column (default: Threads inside) — see INV-FORK-06/07; replaced by Go deeper — see INV-DEEP-*

Real-time:
- New messages/replies, question changes (confirm, reveal from reserve via `shown_at`), thread state and purpose rewrites
  (`exploration.revise_purpose` changes the `h1` and the history in place) arrive through `exploration`/`message`/
  `question`/`ai_run` events invalidating `explorationQuery` and `entityEventsQuery`.
- Run cards change on `ai_run` events (`run.request/begin/complete/fail/cancel/interrupt/retry` → `runsQuery`): working →
  failed / cancelled / disappears (completed conversation) / draft ready; "Draft it" menu fills when a decision is approved
  (`stateQuery`).
- Stage chip and Stage complete card update on `question`/`stage` events (`stagesQuery`).
- Proposed box and fork suggestions update on `proposal`/`batch` events (`batchQuery`) — e.g. "Review" becomes "Open" when
  accepted from Needs you.
- Live progress text of working cards from SSE `run.progress`; timers tick locally each second.
- Drafts are **not** real-time: localStorage is read on mount/thread change only; two tabs diverge.

States handled: loading (thread skeleton; runs skeleton) · 404 · error · empty conversation (active/inactive wording) ·
thread active / concluded (with/without conclusion) / set_aside · question pending / inferred / confirmed / postponed /
discarded / reserve (hidden) · draft present / absent · sending drafts / send error (partial) · stage open, complete,
none · run queued / running (+ progress or not) / failed / interrupted / cancelled / retried / completed with or without
batch / draft batch pending or resolved / batch loading · no approved decision · command pending / error (409, 422, 403,
network, engine not chosen).

Tests:
- e2e `threads.spec.ts`: "AC-INT-001-09 a thread with questions: answer, park, drop and reopen …; concluding … Resume" —
  **likely broken since `1ba0431`**: it clicks "Answer"/"Park"/"Drop"/"Reopen" inside `[data-question]`, which the thread
  no longer renders (the conclude/resume part matches current behaviour); "AC-INT-001-09 a new thread opens from the list,
  Send writes in it, and a thread inside nests under its parent" (Send, message bubble, New thread inside, provenance
  "Inside"); "AC-INT-001-04 DEMIURGO's observations … Proposed or Unknown chips, never Confirmed" (Ask DEMIURGO with text
  and with empty field, `data-observation`, WhoMark "DEMIURGO · simulated"); "screens of cut 3" (working, cancelled,
  failed, draft ready, concluded).
- e2e `runs.spec.ts`: AC-INT-001-10 "a run in progress shows amber with its time and can be cancelled from the thread";
  "a failed run shows its reason in product words and Retry runs again on the same context pack" (retried line, Details
  link); "Draft it asks DEMIURGO for a design from the decision born in the thread…" (disabled Draft it + hint, Proposed
  box, menu item "From this thread", draft card "with 2 checks", Review link).
- e2e `models.spec.ts` AC-AGE-002-11 "a failed run offers Retry with… and runs again on the chosen engine" (from the thread).
- e2e `h1-walk.spec.ts` AC-INT-001-01 (thread → Ask DEMIURGO → Proposed box Review → Draft it → draft card Review);
  `onboarding.spec.ts` AC-INT-001-01 (Day 1 "Open the thread" → Draft it "From this thread"); `fidelity.spec.ts`
  AC-INT-001-09 ×2 (AskBar opens/reuses the thread; messages visible there).
- Unit `thread-timeline.test.ts`: AC-INT-001-04 (grouping reply + observations), AC-INT-001-10 ×3 (run display rules,
  retried, ordering), AC-INT-001-10 Draft it (`draftableDecisions`); `fidelity-ask.test.ts` (AskBar subject/thread/progress).
- **Not covered by any test**: options, multiple choice/exclusive, inferred option, own-words drafts, drafts bar / Confirm
  and send / Discard, reserve notice, stage chip, Pass stage, purpose history, fork suggestions, Fork dialog, Go deeper,
  resizable panel, markdown replies, Ctrl+Enter.

UX problems:
- **The composer silently turns free text into an answer**: by default it replies to the first open question without a
  draft (`screens/thread/Thread.tsx:80-82`), so "Send" becomes "Use as answer" and stores the text as a draft instead of
  posting it (`Composer.tsx:64-69,166`); a person who wants to write to the thread must notice "Write something else".
- Same text, two meanings: while "Replying to" a question, "Ask DEMIURGO" ignores the reply context and posts a general
  message (`Composer.tsx:72-83`), whereas Send/Ctrl+Enter drafts an answer.
- "Write something else" sets `replyOff` for the rest of the visit (`Thread.tsx:53,164`); it only resets via "Answer in my
  own words" (`Thread.tsx:126-129`), so new questions later never get the reply affordance.
- Screen state survives navigation between threads: the composer is not keyed by thread (`Thread.tsx:146-173`,
  `Composer.tsx:47`) and `deeper`/`replyTo`/`replyOff` are plain `useState` (`Thread.tsx:51-53`), so (with the router
  reusing the component on param change) text typed in one thread likely appears in the next.
- Inconsistent send shortcuts: Ctrl/Cmd+Enter in the composer (`Composer.tsx:95-100`), Enter in Go deeper
  (`ThreadQuestions.tsx:467-472`) and in AskBar (`ui/AskBar.tsx:124-129`); the composer hint is hidden below xl and replaced
  by the Draft-it hint when there is no decision (`Composer.tsx:158-162`).
- Focus lost after send: the focused Send button becomes disabled when the field empties (`Composer.tsx:165`); nothing
  refocuses the textarea. Same after "Confirm and send" (bar unmounts, `ThreadQuestions.tsx:157`) and after Go deeper "Use as
  answer" (panel unmounts, `ThreadQuestions.tsx:526-533`).
- No live region: new DEMIURGO replies, revealed questions and run state changes are not announced (`Conversation.tsx:67`
  plain `section`; working card not `role=status`, `RunCards.tsx:100-104`); only errors (role=alert) are.
- No "new messages below" cue when the person scrolled up (`Conversation.tsx:104-120` only follows when already at the end).
- "Ask DEMIURGO" can look like it did nothing: the main thread never reads `message.response` (`waiting` while knowledge
  catches up, `abandoned`), and shows only runs (`timeline.ts:60-65`); `PRODUCT_WORDS.catchingUp` is unused here. Go deeper
  does handle it (`ThreadQuestions.tsx:391-394`).
- No way to tell a stuck run from a slow one: the working card only counts time (`RunCards.tsx:42-53`); no threshold, no
  "last activity" of the provider unless SSE progress arrives; the only action is Cancel.
- Two clocks side by side on the working card: progress clock from the provider call's start (`RunCards.tsx:113`,
  `api/progress.ts:66-69`) and the run timer from the run's start (`RunCards.tsx:115`) can disagree.
- Cancel (and Pass stage, a decisive command) run without confirmation (`RunCards.tsx:116-126`,
  `ThreadQuestions.tsx:559-566`); "Discard" drops every draft of the thread with no confirmation or undo
  (`ThreadQuestions.tsx:169-171`).
- Confirm and send is sequential and can leave a **partial** send with one generic error in the bar and no per-item status
  (`ThreadQuestions.tsx:118-150,176`).
- Fork drafts are not validated against current proposals (answers are, forks are not: `ThreadQuestions.tsx:114-115`);
  stale choices only disappear by swallowing a 409.
- Drafts live only in this browser (`ThreadQuestions.tsx:44-68`): another device or a cleared storage loses them silently;
  no `storage` event, so two tabs disagree.
- Settled questions convey confirmed vs parked/dropped by dot colour (`aria-hidden`) and show no reason nor Reopen
  (`ThreadQuestions.tsx:346-362`); Park / Drop / Reopen are gone from the thread (see INV-THR-60).
- Terminology: the mark word is "Assumed" (words.ts:55) but the option says "DEMIURGO inferred it" (`ThreadQuestions.tsx:258`);
  "draft" means both an unsent answer ("Not sent yet", drafts bar) and a DEMIURGO feature draft ("Draft it", "A draft is
  ready"); "Send" posts without an answer here but with an answer in AskBar (`ui/AskBar.tsx:170`).
- Question card header uses the thread's **currently open** stage title for any question with a `stage_id`
  (`Conversation.tsx:75`), mislabelling questions of another stage.
- An open question on a non-active thread keeps the strong blue "needs you" border but offers no action and no explanation
  (`ThreadQuestions.tsx:235,245,253`).
- Option grid columns are fixed (2 or 3, `ThreadQuestions.tsx:254`); options have no group semantics (no fieldset/legend or
  radiogroup), and single vs multiple is only said by "Pick all that apply" before a first pick (`:278-280`).
- The question's `impact` is not shown in the thread (Day 1 shows it with `IMPACT_WORDS`).
- Failed run in the thread shows the failure kind but not the provider's `error` text (`RunCards.tsx:150-154`); two retry
  buttons side by side ("Retry with…" and "Retry", `:162-172`); a cancelled run can only be retried from the run page.
- Batch-dependent boxes show a skeleton forever when the batch query fails (`Conversation.tsx:326`, `RunCards.tsx:209-215`).
- Relative times only refresh while a run is active (`Conversation.tsx:55,122-130`).
- Heading levels skip from `h1` to `h3` in the conversation (`Conversation.tsx:216`, `ThreadQuestions.tsx:251`); messages
  are unnamed `article`s.
- No deep link to a question, a message or an open Go deeper panel (the route has no search params), although Needs you,
  Map, Journeys, etc. link to the thread.

---

#### Forks and threads inside — part of `/p/$projectId/threads/$explorationId`

- Purpose: explore an idea apart in a child thread: fork a DEMIURGO message, accept or decline a thread DEMIURGO suggests,
  open a thread inside, and see the children.

Checklist:

- **INV-FORK-01** "Fork into a new thread" (text button with fork icon, bottom-right of every DEMIURGO message card,
  `data-command="exploration.open"`), only while the thread is active.
- **INV-FORK-02** Fork dialog: title "Fork into a new thread", description "Inside `<parent purpose>`. Say what this thread
  explores.", "Purpose" pre-filled with DEMIURGO's reply body (first 1000 chars), required, max 1000, "Open thread" →
  `exploration.open` `{purpose, parent_id: <thread>, origin: {type: 'exploration', id: <thread>}}` → navigates to the new
  thread.
- **INV-FORK-03** Suggested thread (`data-fork-suggestion=<proposalId>`; a pending proposal of type `exploration` in the
  batch of an `exploration_chat` run): dashed box "Could deserve its own thread: «`<purpose>`»" with two toggle buttons
  "Explore separately" / "Keep it here" (`aria-pressed`; chosen = primary; clicking the chosen one clears it) and "Not sent
  yet" while chosen. Disabled without the drafts context.
- **INV-FORK-04** The choice is a draft sent with "Confirm and send" (INV-THR-39): explore → `proposal.accept` (server opens
  a child thread under the run's thread, origin `proposal`); keep → `proposal.reject` `{reason: 'Kept in this thread.'}`.
  The drafts bar counts "`N` thread choice(s)".
- **INV-FORK-05** Resolved suggestion: "Opened as its own thread: «`<purpose>`»" (accepted) or "Kept in this thread:
  «`<purpose>`»" (any other state).
- **INV-FORK-06** Right column "Threads inside" (default aside, `aria-labelledby="thread-children"`): each child
  (`children[] {id, purpose, state}`) as a Node link with state mark; empty text "None yet. Fork a message of DEMIURGO to
  explore an idea apart."
- **INV-FORK-07** "New thread inside" (secondary, plus icon; when `exploration.open` allowed) → dialog "Open a thread
  inside", "Inside `<purpose>`. Say what this thread explores.", "Purpose" required max 1000 → `exploration.open`
  `{purpose, parent_id, origin: {type: 'exploration', id}}` → navigates to it.
- **INV-FORK-08** A child shows "Inside `<parent>`" in its provenance and the parent in its breadcrumbs; an accepted
  suggestion shows "From a proposal"; the list nests it under its parent (INV-THRS-09).

Real-time: suggestion state follows `proposal`/`batch` events; the children list follows `exploration` events
(`explorationQuery` of the parent).

States handled: suggestion pending (no choice / explore / keep) · accepted · rejected/superseded/accepted_edited (all
worded "Kept in this thread") · batch loading · no children.

Tests: `threads.spec.ts` AC-INT-001-09 (New thread inside, provenance "Inside", nesting). **No test** for Fork dialog or
fork suggestions.

UX problems:
- A resolved suggestion does not link to the thread it opened (`Conversation.tsx:280-285`), and every non-accepted state
  (including `accepted_edited` and `superseded`) reads "Kept in this thread" (`:283`).
- The fork purpose is pre-filled with the raw markdown of the whole reply (`Conversation.tsx:243`), not a summary; the
  child's origin is the parent thread, not the forked message, so the message is not traceable from the child.
- A Fork button on every DEMIURGO card (`Conversation.tsx:230-237`) competes with the suggestion's "Explore separately" —
  two different flows (immediate vs draft) for the same outcome.
- Children in the aside show no open-question count or activity (`Thread.tsx:456-459`), unlike the list; the aside is
  hidden entirely while Go deeper is open (`Thread.tsx:91-104`).

---

#### Go deeper (side conversation about one question) — right column of `/p/$projectId/threads/$explorationId`

- Purpose: talk one open question through with DEMIURGO without cluttering the main thread, then settle it as a draft answer.

Checklist:

- **INV-DEEP-01** "Go deeper →" text button on each answerable open question card, with " · `N`" = number of side messages
  about it; toggles the panel for that question; while open the button reads "Going deeper" with a tinted background, and
  clicking it again closes the panel.
- **INV-DEEP-02** The panel replaces the right column (section `aria-label "Going deeper"`); the column is a full-height
  sticky panel with its own scroll, **resizable** from its left edge: `role=separator` "Resize the side panel"
  (`aria-valuenow`, min 320 px, max 60 % of the window, default 480), drag with the pointer, ←/→ keys ±32 px, double-click
  resets to 480; width remembered in `localStorage` `dm-aside-panel-width` (applies to the thread's aside in both modes).
- **INV-DEEP-03** Panel header: label "Going deeper", "Close" (aria-label "Close and go back to the thread"), `h2` the
  question, caption "The main thread waits here. Nothing is lost."
- **INV-DEEP-04** Side conversation: the thread's messages with `question_id = question`; the person's as right bubbles
  (plain text), DEMIURGO's/others' on the left with WhoMark and **Markdown**; auto-scrolls to the bottom when messages
  arrive or writing starts.
- **INV-DEEP-05** Empty hint: "Ask anything about this question: what each option means, examples, what others do."
- **INV-DEEP-06** "Talk it through" textarea (sr-only label "Talk it through", placeholder "Talk it through…"): **Enter
  sends, Shift+Enter new line**; "Send" (secondary; "Sending…"; disabled when empty) → `message.post` `{exploration_id,
  question_id, text, respond: true}`; clears on success; errors below. (Server: with `question_in_progress` the agent talks
  only about that question and raises no new questions or proposals.)
- **INV-DEEP-07** "DEMIURGO is writing…" while the answer to the person's last side message is catching up (knowledge),
  waiting for its run, or queued/running (`readingOf`: `message.response`, `response_run`, runs and their retries).
- **INV-DEEP-08** "DEMIURGO couldn't answer this time. Send it again." when that run failed, was interrupted or cancelled.
- **INV-DEEP-09** "Use this reply as the answer" under each DEMIURGO reply (not observations): copies the reply as plain
  text (bold/`__`, `#` headings and backticks stripped; max 3000) into "My own words" and focuses it.
- **INV-DEEP-10** "Settle the question with" box: one pill per option (`aria-pressed`; single choice selects one; multiple
  toggles with the exclusive rules of INV-THR-29) and "My own words" pill → textarea (aria-label "Your answer", max 3000,
  2 rows or 6 when > 200 chars).
- **INV-DEEP-11** "Use as answer" (primary; disabled until an option or text is chosen) writes the draft answer in the
  main thread and closes the panel; caption "You confirm it with the others in the thread." or "Pick an option, or use a
  reply or your own words."
- **INV-DEEP-12** The panel opens pre-filled with the question's current draft (picked options, or own words).
- **INV-DEEP-13** The panel closes by itself when the question stops being open; opening another question resets it.
- **INV-DEEP-14** Runs requested from the side conversation appear as run cards in the **main** conversation (working,
  failed with Retry, cancelled) although their messages do not.

Real-time: side messages arrive via `message`/`ai_run` events (`explorationQuery`, `runsQuery`); writing/failed state
recomputed from runs.

States handled: no messages · writing (catching_up / waiting / working) · failed / cancelled · replies present · draft
present (options / own words) · nothing chosen · send pending / error.

Tests: **none** (no e2e or unit test mentions Go deeper, the panel or `readingOf` in this context; `onboarding` unit tests
cover `readingOf` for Day 1).

UX problems:
- Failure note offers no Retry, no reason and no link to the run (`ThreadQuestions.tsx:457`); the retry lives on a rust
  card in the main conversation (INV-DEEP-14), far from the panel.
- "DEMIURGO is writing…" and new replies are not announced (no `role=status`/`aria-live`, `ThreadQuestions.tsx:456`).
- Observations in the side conversation are shown without their Proposed/Unknown chips (`ThreadQuestions.tsx:432-454`),
  unlike the main thread.
- "Use this reply" strips only some markdown (`ThreadQuestions.tsx:182-187`): list markers, links, italics and tables stay.
- No Escape to close, focus does not move into the panel on open nor back to the card on close (`ThreadQuestions.tsx:419-421`,
  `Thread.tsx:125`); the Go deeper toggle has no `aria-expanded`/`aria-pressed`, its open state is a background tint
  (`ThreadQuestions.tsx:294-297`).
- Unsent text in "Talk it through" is lost on close or when switching question (`Thread.tsx:94` key reset); the textarea
  has no `maxLength` (`ThreadQuestions.tsx:463-476`) while the server caps messages at 20,000.
- The panel vanishes abruptly if the question is settled elsewhere (`Thread.tsx:83`).
- The splitter exposes `aria-valuenow`/`aria-valuemin` but no `aria-valuemax` (`ui/layout.tsx:102-113`), and its value is
  in pixels with no text alternative; the drag handle is an invisible 8 px strip until hovered or focused (`:112`).
- The side count " · N" includes DEMIURGO's own messages, not only the person's (`Conversation.tsx:77`).

---

#### Run detail — `/p/$projectId/runs/$runId` (no search params)

- Purpose: everything about one agent run: state and why it failed, Cancel/Retry/Retry with…, the engine and its calls,
  the context it was given, its output, retries and events.

Checklist:

- **INV-RUN-01** Load `runQuery` (`GET /api/projects/:p/runs/:id` → `RunDetail` with `context_pack`); 404 → NotFound "this
  run" "It may belong to another project."; other error → Reasons; skeletons `role=status` "Loading the run" / "Loading
  the details". Also loads **all** project runs (`runsQuery(p)`) to find its list item, original and retries.
- **INV-RUN-02** Breadcrumbs: "Activity" (link) › "`<Action>` · `<day time>`".
- **INV-RUN-03** Eyebrow: run icon, "Run", "·", state mark + word (Queued, Working, Completed, Failed, Cancelled, Interrupted).
- **INV-RUN-04** `h1`: "Draft a feature" for `design_proposal`, else the action word ("Conversation", "Echo").
- **INV-RUN-05** "Cancel" (tables: `run.cancel` from queued/running) → `run.cancel` (entity run id); errors under the header.
- **INV-RUN-06** "Retry" (secondary, "Retrying…"; when `run.retry` allowed and state ∈ failed/interrupted/cancelled) →
  `run.retry` `{run_id}` → navigates to the new run (`result.runId` or `entity_id`).
- **INV-RUN-07** "Retry with…" (same condition) → popover (INV-RUN-08) and, on success, navigates to the new run.
- **INV-RUN-08** Retry with… popover (`screens/models/RetryWith.tsx`, `data-retry-with`): title "Retry with another engine",
  text "Same context, just this once. What runs this agent next time doesn't change.", engine picker (`fieldset` "Retry
  with": provider / model / effort selects, "(gone)" for vanished entries, "Choose…"), initial value = the run's requested
  engine or the first choosable one (`GET /api/providers`), "Not now" / "Retry" ("Retrying…") → `run.retry` `{run_id,
  override: {provider, model, effort}}`; errors inside. Also on the thread's failed card.
- **INV-RUN-09** Provenance line: "From `<decision title>` `<CODE>`" (record_version scope, link to the record), "In the
  thread `<purpose>`" (link; `exploration_id` of the list item), "`<WhoMark>` Requested by you | Requested by Agent ·
  `<name>` | Requested automatically · `<day time>`".
- **INV-RUN-10** Status box (`data-run-status`), active: "Waiting to start…" (queued) or "DEMIURGO is working…" + live
  progress (INV-RUN-19) + Working mark with timer.
- **INV-RUN-11** Status completed: done mark, "Finished in `m:ss`." and "It proposed what it found: it waits for you before
  anything changes." + "Review →" to the batch, or "What it wrote is in its thread."
- **INV-RUN-12** Status failed/interrupted (rust box, problem mark "Failed"/"Interrupted") or cancelled (dashed grey box,
  inactive mark "Cancelled"): failure in product words (`failureWord`, cancelled → "You cancelled it. Nothing was
  changed."); "What it said: `<error>`" when the run has an error text.
- **INV-RUN-13** "What the engine did" (`data-run-calls`, `GET /api/projects/:p/runs/:id/calls`, polled every 2 s while
  active, hidden when there are no calls; caption "Every event as it arrived"): per call "Call" / "Call `N`", engine label,
  session words, state "working" / "answered" / failure kind; error text; events with offset "+`x.x` s", kind word
  (Started, Thinking, Wrote, Counted usage, Answered, Error) and "`N` tokens"; "Raw events" folded `<pre>`.
- **INV-RUN-14** Context section (`data-context`): "Context" + "What DEMIURGO was given. A retry reuses it as it is.";
  Role; Builder (code); Budget chips (key + number) or "None"; Graph version "v`N`"; Dependencies (type + link: thread
  purpose, record `CODE vN`, or raw id) or "None"; Hash (`data-context-hash`); "What it read" folded JSON
  (`data-context-content`). Without a pack: "This run has no context pack."
- **INV-RUN-15** "What it answered": folded JSON of `output` (when not null).
- **INV-RUN-16** Aside "Details": Agent (`agent@version` from `method`), Engine (label from provider catalogs, else
  provider), Answered by (observed model or "Not known yet"), Conversation ("None: the whole context" / "New conversation,
  whole context" / "Continued: only what was added"), Prompt (hash; tooltip "Fingerprint of the agent's system prompt"),
  Requested, Started, Finished, Duration (ticking while active, "—"), Tokens in (+ "· `N` cached"), Tokens out (+ "· `N`
  thinking"), Turns, Cost ("$0.0123"), each token/cost figure with its provenance in a tooltip ("From …" / "not reported").
- **INV-RUN-17** Aside "Retries" (when the run is a retry or has retries): "Retry of" link (state mark + action + time) and
  "Retried as" / "Retried as, in order" links, oldest first (`data-run-retry-of`, `data-run-retries`).
- **INV-RUN-18** Aside "Events" (`data-run-events`): the run's own events, the events it caused (`cause.run`) and its
  context pack's events, oldest first; each with product words (Requested, Requested again (retry), Started, Finished,
  Failed, Cancelled, Interrupted, Context gathered, Wrote in the thread, Asked a question, Assumed an answer, Proposed;
  unknown → command code), WhoMark of the actor, time `HH:MM:SS` and the command code. `GET /events?entity=<run>` and
  `?entity=<context_pack>`.
- **INV-RUN-19** Live progress (shared with the thread and Day 1): SSE `run.progress` `{run_id, call_id, provider, model,
  started_at, events, tokens, last_kind}` kept in memory per run (never goes back within a call: fewer events dropped,
  tokens only grow; a new call restarts) and shown as "`<Starting|Thinking|Writing|Finishing|Something went wrong>`…
  `N` tokens · `m:ss`" (`data-run-progress`).
- **INV-RUN-20** Run timer (shared `RunWorking`): `runDuration` — queued counts from the request, otherwise from the start
  to the end/now, `m:ss` or `h:mm:ss`, ticking every second while active.
- **INV-RUN-21** Entry points: thread run cards "Details", Activity rows, Retries links, batch package, Overview/Blueprint,
  Day 1 reading (outside this area).

Real-time: `runQuery`, `runEventsQuery` and `runCallsQuery` (all under `['p', p, 'run', id]`) refresh on `ai_run` and
`context_pack` events; `runsQuery` on `ai_run`/`batch`; calls also polled every 2 s while active; progress via
`run.progress`; clocks tick locally.

States handled: loading · 404 · error · queued · running (with/without progress) · completed with/without batch · failed
(each `failure_kind`: invalid_output, agent_error, timeout, infra, cancelled, stale_knowledge, unknown/null) ·
interrupted · cancelled · retry of / retried · no context pack · no calls · no output · events loading.

Tests: `runs.spec.ts` AC-INT-001-10 (failed run → Details → context hash, Retries links both ways; Activity → run page with
invalid output words, context content fold, events contain "Requested", Retry visible; cancel from the run page →
Cancelled + Retry); "screens of cut 7"; `models.spec.ts` AC-AGE-002-11 (Retry with…). Unit `runs-logic.test.ts`
AC-INT-001-10 ×7 (events gathering, retries order, duration, failure words, asked-by, proposals in words, run states);
`run-progress.test.ts` (monotonic progress, new call). Not covered: "What the engine did", engine/usage facts.

UX problems:
- Output and context are raw JSON dumps (`screens/run/Run.tsx:68-80,334-336`) — nothing human-readable about what DEMIURGO
  read or answered.
- Terminology drifts for the same thing: `h1` "Draft a feature" vs breadcrumb/Activity "Draft" (`Run.tsx:113,128`);
  "Waiting to start…" (`Run.tsx:215`) vs mark "Queued"; "Working" (state word) vs `running`; calls show raw failure codes
  with `_`→space (`screens/run/Engine.tsx:136-137`) instead of `FAILURE_WORDS`.
- Provenance of tokens/cost and the prompt fingerprint are hover-only `title` tooltips (`Engine.tsx:47,68,74,82`), not
  reachable by keyboard or touch.
- "What it wrote is in its thread." has no link in the status box (`Run.tsx:231-233`); the thread link is only in the
  header line.
- Cancel without confirmation (`Run.tsx:130-141`); two retry buttons (`:142-153`).
- No stuck-run signal beyond the timer (`Run.tsx:211-220`); progress is in memory only (`api/progress.ts:18`), so after a
  reload the progress text is missing until the next provider event.
- Event times show `HH:MM:SS` without the date (`Run.tsx:457`); events fetched with a limit of 1000 per entity server-side.
- Fetches every run of the project to derive one item and its retries (`Run.tsx:40`).

---

#### Activity — `/p/$projectId/activity` (search: `?state=queued|running|completed|failed|cancelled|interrupted`)

- Purpose: every run of DEMIURGO in the project, newest first, filterable by state, plus the project's consumption per agent.

Checklist:

- **INV-ACT-01** Title "Activity"; subtitle "`N` run(s) of DEMIURGO" + " · `K` working now" when some are queued/running, or
  "What DEMIURGO did and is doing, run by run." with none.
- **INV-ACT-02** Usage section (`data-project-usage`, `usageQuery` `GET /api/projects/:p/usage`, all-time over provider
  calls; hidden when empty): heading "Usage · `N` calls · `N` failed · `N` tokens · `$x.xx`"; table per agent: Agent,
  Calls, Failed (rust when > 0), Tokens in / out, Cost (`$x.xx` or "—"), Avg time ("`N` s" or "—").
- **INV-ACT-03** Filter nav (`aria-label "Filter by state"`): chips (links) "All", "Queued", "Working", "Completed",
  "Failed", "Cancelled", "Interrupted", each with its count from the unfiltered list (hidden when 0); the current chip is
  inked and `aria-current="page"`; clicking sets `?state=` (All clears it); an unknown `state` value is ignored (All).
- **INV-ACT-04** Runs table (`runsQuery(p, {state})` → `GET /runs?state=`): columns State (mark + word), Run, Thread, Asked by,
  When, Duration; rows `data-run-row=<id>`, hover highlight.
- **INV-ACT-05** Run cell: action word as link to the run page ("Conversation", "Draft", "Echo"), model name, "Retry" pill
  when the run is a retry, and for failed/interrupted the failure in product words (rust).
- **INV-ACT-06** Thread cell: the thread's purpose as a link (2 lines max) — a conversation's own thread, or for a draft
  the thread where its decision was born — or "—".
- **INV-ACT-07** Asked by: WhoMark + "You" / "Agent · `<name>`" / "Automatic".
- **INV-ACT-08** When: `dayTime` of the request in `<time>`; Duration `m:ss` (ticking for active runs) or "—".
- **INV-ACT-09** Empty: "No `<state word, lower case>` runs." with a filter, else "No runs yet. They appear when you ask
  DEMIURGO in a thread."
- **INV-ACT-10** Loading: table skeleton `role=status` "Loading the runs".
- **INV-ACT-11** Entry: header nav "Activity" (active on `/activity` and `/runs/*`); Needs you "up to date" → show all
  activity (outside); run page breadcrumb.

Real-time: both run lists and usage (key `['p', p, 'runs', 'usage']`) refresh on `ai_run` and `batch` events; thread
purposes on exploration events; durations tick while something works.

States handled: loading · empty (with/without filter) · populated · every run state · retries · failed with each failure
kind · no thread · usage empty (hidden).

Tests: `runs.spec.ts` AC-INT-001-10 "Activity lists the runs with their state and filters them; a run page …" (rows,
Failed/Conversation, thread link, filter to `?state=failed`, "No cancelled runs.", All, link to run page, a11y); "screens
of cut 7" (4 rows). Unit `runs-logic.test.ts` AC-INT-001-10 (filter offers every run state with word and mark). Usage:
**no test**.

UX problems:
- A failed fetch shows the empty state "No runs yet…" (`screens/activity/Activity.tsx:60-100`); Usage silently disappears
  on error and has no loading state (`screens/activity/Usage.tsx:14-15`).
- Filter counts are `aria-hidden` (`Activity.tsx:131-135`): screen-reader users get the chips without their counts.
- Silent truncation: the server returns at most 500 runs (`core/src/queries/web.ts:71`) with no paging or notice.
- Only a state filter: no filter by thread, agent, action or date, no search (`Activity.tsx:46-58`).
- Only the action word links to the run; the row is not clickable (`Activity.tsx:150-156`); the "Retry" pill does not
  link to the original (`:158-160`).
- Usage has no stated period (it is all-time) and counts provider **calls**, not runs, without saying so; its title is a
  caption-sized `h2` (`Usage.tsx:27-29`).
- State relies on mark + word (fine), but failed rows' reason is colour + text only under the link (`Activity.tsx:162`),
  and cancelled rows give no reason.

---

### Domain model notes

**Exploration = thread** (`ExplorationDetail`, `Exploration`):
- `id`, `project_id`, `parent_id` (child thread), `purpose` (≤ 1000 chars; may be rewritten by the system from the agent's
  output via `exploration.revise_purpose`), `origin_type` ∈ `exploration | question | record_version | proposal | null`,
  `origin_id`, `origin_version`, `state` ∈ `active | concluded | set_aside`, `state_reason` (conclusion or reason),
  `opened_by` (actor string), `created_at`, `messages[]`, `questions[]`, `children[] {id, purpose, state}`.
- List item adds `open_questions` (shown questions in pending/inferred/postponed) and `last_activity` (last message or
  creation). Transitions: `exploration.open` (new → active; human, system), `conclude` (active → concluded), `set_aside`
  (active → set_aside, reason required), `resume` (concluded/set_aside → active), `revise_purpose` (system only).

**Message**: `id`, `exploration_id`, `question_id` (set = Go deeper side conversation), `author`, `run_id`, `kind` ∈
`null` (reply) `| claim | hypothesis | unknown` (observation), `body` (≤ 20,000), `state` = `recorded`, `created_at`,
`epistemic_status`, `response` ∈ `waiting` (knowledge catching up) `| requested | abandoned | null`, `response_run`.
Commands: `message.post {exploration_id, question_id?, text, respond}` (human, agent_external, agent_run; guard thread
active), `message.abandon_response` (system).

**Actor strings** (`whoOf`): `human:<person>` → You; `agent:run:<runId>` → DEMIURGO (+ model); `agent:<name>:<session>` →
external Agent `<name>`; `system:<component>@<version>` → Automatic.

**Question**: `id`, `exploration_id`, `question`, `reason` ("Why it matters"), `impact` ∈ `high | medium | low`,
`conclusion` (≤ 3000), `reasoning` (why DEMIURGO assumed it), `state` ∈ `pending | inferred | confirmed | postponed |
discarded`, `state_reason`, `raised_by`, `created_at`, `epistemic_status`, `options[] {answer, implies, exclusive?}`,
`multiple`, `stage_id`, `stage_key`, `shown_at` (null = waiting in the reserve). Server pacing: `MAX_OPEN_QUESTIONS = 2`.
Transitions: `raise` (human, system), `infer` / `suggest_options` (system), `confirm` (pending/inferred → confirmed,
human, **decisive**, conclusion required), `postpone` (→ postponed, reason), `discard` (pending/inferred/postponed →
discarded, reason), `reopen` (confirmed/postponed/discarded → pending).

**Drafts (client only)**: `{answers: {questionId: string}, forks: {proposalId: 'explore' | 'keep'}}` in localStorage
`dm-thread-drafts:<threadId>`; multiple-choice answers are the picked options joined by " · ".

**Fork suggestion** = `Proposal` of type `exploration` (payload `{purpose}`) in the batch of an `exploration_chat` run;
proposal `state` ∈ `pending | accepted | accepted_edited | rejected | superseded`; accept opens a child thread (parent =
the run's thread, origin `proposal`). **Batch** `state` ∈ `pending | accepted | rejected | resolved | superseded`;
proposal types seen here: `decision`, `fdr` (feature), `adr` (tech decision), `exploration` (thread), `review`.

**Stage** (`StageRow`): `key`, `title`, `produces`, `position`, `id`, `state` ∈ `not_started | open | passed`,
`exploration_id`, `passed_by`, `passed_at`, `total`, `covered`, `questions[] {id, key, question, state}`; `stage.pass`
(human, decisive, guard all covered) opens the next.

**Run** (`ai_run`: `Run`, `RunDetail`, `RunListItem`): `id`, `action` ∈ `exploration_chat | design_proposal | echo`,
`scope {type: exploration | record_version, id, version?}`, `method` (`agent@version`), `schema_version`, `provider`,
`model` (observed), `requested_model`, `effort`, `agent`, `prompt_hash`, `session_mode` ∈ `none | fresh | resumed`,
`provider_session_id`, `delta_hash`, `context_pack_id`, `retry_of`, `state` ∈ `queued | running | completed | failed |
cancelled | interrupted`, `failure_kind` ∈ `invalid_output | agent_error | timeout | infra | cancelled | stale_knowledge`
(or null), `error`, `output`, `usage`, `requested_by`, `created_at`, `started_at`, `finished_at`. List item adds
`context_pack_hash`, `exploration_id` (derived), `batch_id`. Transitions: `run.request` (human, system; guard graph up to
date), `run.retry` (human; guard original finished; optional `override` engine), `run.begin/complete/fail/interrupt`
(system), `run.cancel` (human, from queued/running).
- In-thread display (`RunDisplay`): `working | failed | retried | cancelled | draft | null`.
- Reading of a message (`ReadingPhase`): `catching_up | waiting | working | failed | cancelled | read | unanswered`.
- AskBar progress: `answering | answered | failed`.

**ContextPack**: `id`, `role`, `builder`, `budget {k: v}`, `graph_version`, `dependencies[] {type, id, code?, version}`,
`content`, `hash`.

**Run progress** (SSE `run.progress`, not logged): `run_id`, `call_id`, `provider`, `model`, `started_at`, `events`,
`tokens`, `last_kind` ∈ `started | thinking | message | usage | result | error`.

**Run call** (`RunCall`): `id`, `state` ∈ `running | ok | error`, `provider`, `requested_model`, `observed_model`,
`effort`, `session_mode`, `provider_session_id`, `usage`, `failure_kind`, `error`, `started_at`, `finished_at`,
`events[] {seq, received_at, kind, tokens, raw}`.

**Usage** (`RunUsage`): `inputTokens`, `outputTokens`, `durationMs`, `declaredCostUsd?`, `cachedInputTokens?`,
`reasoningTokens?`, `turns?`, `provenance? {field: source}`. **Project usage row**: `agent`, `calls`, `failures` (calls in
state error), `inputTokens`, `outputTokens`, `declaredCostUsd`, `avgDurationMs` (all-time, from `agent_calls`).

**Event row**: `id`, `seq`, `at`, `actor`, `command`, `entity_type`, `entity_id`, `entity_version`, `state_before`,
`state_after`, `before`, `after`, `cause` (`{run?, correlation?}`).

### Product vocabulary

- **Thread** — an exploration; states **Active** (Open mark), **Concluded** (Confirmed mark), **Set aside** (Parked mark).
  "New thread", "Open a thread", "Open a thread inside", "New thread inside", "Threads inside", "Inside `<parent>`",
  "Opened by", "Earlier summaries", "Conclusion", "Why it was set aside".
- **Conclude / Set aside / Resume** — close with what it settled / stop for now with a reason / reopen.
- **Send** — post a message without asking for an answer. **Ask DEMIURGO** — post and ask for an answer, or with nothing
  written ask the conversation to go on. **Asking… / Sending…** — pending labels.
- **DEMIURGO** — the product's agent ("Drafts, asks and proposes."); **You** ("Only people confirm."); **Agent** ("From
  outside. Only proposes."); **Automatic** ("A rule or test that ran alone.").
- **What it observed** — DEMIURGO's observations: **claim**, **hypothesis** (Proposed: "Suggested, waiting for you."),
  **unknown** (Unknown: "Not known yet."). Never Confirmed.
- **Proposed … for you to review** / **Review** / **Open** — what a run proposed and the way to its batch.
- **Question** — "Why it matters", options with what each **implies**, "Pick all that apply", "DEMIURGO inferred it",
  "Answer in my own words", "Your answer", "Clear", **Not sent yet**, "Replying to", "Write something else", **Use as
  answer**, "Your answer, or pick an option above". States: **Open** (pending), **Assumed** (inferred: "DEMIURGO concluded
  it. Not confirmed yet."), **Confirmed**, **Parked** (postponed: "Kept for later."), **Dropped** (discarded: "Doesn't
  apply.").
- **Reserve** — "DEMIURGO keeps N questions for later. They come up as you answer."
- **Drafts bar** — "`a` of `n` answers and `f` thread choices ready. Nothing is sent until you confirm; you can still change
  them.", **Discard**, **Confirm and send**.
- **Stage** — "`<Stage>` · X of Y answered", "`<Stage>` is complete", **Pass stage** / "Passing…", "next comes `<stage>`".
- **Fork into a new thread** — make a child thread from a DEMIURGO message. **Could deserve its own thread** — DEMIURGO's
  suggestion: **Explore separately** / **Keep it here**; "Opened as its own thread", "Kept in this thread".
- **Go deeper → / Going deeper** — side conversation about one question: "The main thread waits here. Nothing is lost.",
  "Talk it through…", "DEMIURGO is writing…", "DEMIURGO couldn't answer this time. Send it again.", "Use this reply as the
  answer", "Settle the question with", "My own words", "You confirm it with the others in the thread."
- **Draft it** — ask DEMIURGO to draft a feature (with its checks) from an approved decision; "From this thread";
  "Draft it needs an approved decision first."; **A draft is ready: `<title>` with N checks** / "The draft …".
- **Run** — an agent run; action words **Conversation** (exploration_chat), **Draft** (design_proposal; page title "Draft a
  feature"), **Echo**. States: **Queued**, **Working** (running; "DEMIURGO or an agent is on it."), **Completed** (Done:
  "Finished without problems."), **Failed** / **Interrupted** (Problem: "Something went wrong or needs a review."),
  **Cancelled** (Not active: "Finished or stopped: nothing to do."). "DEMIURGO is working…", "Answering…", "Drafting…",
  "Waiting to start…", "Finished in m:ss.", "Retried", "Failed, then retried: …", "Cancelled · … after m:ss".
- **Failure words** — invalid_output: "It couldn't finish: the output didn't match the format. Nothing was changed.";
  agent_error: "The agent answered with an error. Nothing was changed."; timeout: "It took too long and was stopped.
  Nothing was changed."; infra / interrupted: "DEMIURGO restarted while it was running. Nothing was changed."; cancelled:
  "You cancelled it. Nothing was changed."; stale_knowledge: "The knowledge changed while it was running. Nothing was
  changed."; none: "It stopped without saying why. Nothing was changed."; other: "It stopped with an error. Nothing was
  changed."
- **Cancel / Retry / Retry with…** — stop a run; run it again on the same context pack; once on another engine ("Retry with
  another engine", "Same context, just this once. What runs this agent next time doesn't change.", "Not now").
- **Details** — link to the run page; also the run aside's facts: Agent, Engine, Answered by ("Not known yet"),
  Conversation ("None: the whole context", "New conversation, whole context", "Continued: only what was added"), Prompt,
  Requested, Started, Finished, Duration, Tokens in (cached), Tokens out (thinking), Turns, Cost.
- **What the engine did** — provider calls: Call N, working/answered, Started, Thinking, Wrote, Counted usage, Answered,
  Error, "Raw events". Live progress: Starting…, Thinking…, Writing…, Finishing…, Something went wrong….
- **Context** — "What DEMIURGO was given. A retry reuses it as it is.": Role, Builder, Budget, Graph version, Dependencies,
  Hash, "What it read"; **What it answered**.
- **Retries** — "Retry of", "Retried as (, in order)". **Events** — Requested, Requested again (retry), Started, Finished,
  Failed, Cancelled, Interrupted, Context gathered, Wrote in the thread, Asked a question, Assumed an answer, Proposed.
- **Activity** — "N runs of DEMIURGO · K working now", "Filter by state", "All", columns State / Run / Thread / Asked by /
  When / Duration, "Retry" pill, "Requested by you / Agent · name / Requested automatically".
- **Usage** — "Usage · N calls · N failed · N tokens · $x", columns Agent / Calls / Failed / Tokens in / out / Cost / Avg time.
- **Needs you** — the blue count ("open questions wait for you"). **Can't reach DEMIURGO. Retrying…** — stream down.
  **DEMIURGO is catching up with your latest changes. Try again in a moment.** — 409 when knowledge is behind.
- **Ask DEMIURGO about this** (AskBar) — "About: whole product", "About the whole product", "About `<title>`", "Sent to …
  · DEMIURGO is answering…", "DEMIURGO answered in …", "DEMIURGO couldn't answer: …", "Open the thread".

## Part D · Needs you, Catch up, batches, records, new record, new version


Source: `packages/web` on branch `ux/frontend-rebuild-2026-09-25` (read only). Paths are relative to
`packages/web/src/` unless they start with `packages/` or `test/`.

### How to read this

- **cmd `x.y`** means `POST /api/projects/:projectId/commands/x.y` with body `{ entity_id?, data }`. It goes
  through `useCommand` or `runCommand` (`api/commands.ts`). After any 2xx, every query under
  `['p', projectId]` is invalidated, and the SSE stream confirms afterwards.
- **gated** means the button exists only when `actionsFor(tables, catalog, entity, state, 'human')`
  (`api/tables.ts`) lists the command, using the data below. The UI never decides this on its own.
  - `GET /api/tables`: the command's transition leaves the entity's current state, and its capability
    allows `human`.
  - `GET /api/commands`: the command is not `implemented:false`.
- **Decisive commands** (`decisive: true` in `design/data/capabilities.yaml`) always ask first with
  `ConfirmDialog`: `proposal.accept`, `proposal.accept_edited`, `batch.accept_package`,
  `record_version.approve` and `question.confirm`.
- Queries (`api/queries.ts`). Every one is a `GET`:

  | Query | Path |
  | --- | --- |
  | `inboxQuery` | `/api/projects/:p/inbox` |
  | `stateQuery` | `/state` |
  | `explorationsQuery` | `/explorations` |
  | `explorationQuery` | `/explorations/:id` |
  | `taxonomiesQuery` | `/taxonomies` |
  | `batchQuery` | `/batches/:id` |
  | `runQuery` | `/runs/:id` |
  | `runsQuery` | `/runs?exploration=&state=` |
  | `recordQuery` | `/records/:code` |
  | `readinessQuery` | `/versions/:versionId/readiness` |
  | `changesQuery` | `/changes?since=` |
  | `entityEventsQuery` | `/events?entity=:id` |
  | `tablesQuery` | `/api/tables` (not under the project) |
  | `commandsQuery` | `/api/commands` (not under the project) |

- **SSE.** One `EventSource` is open per project on `/api/projects/:p/events/stream?from=latest`
  (`api/stream.ts`). Each event invalidates query keys by entity type:

  | Entity type | Query keys it invalidates |
  | --- | --- |
  | `proposal` | inbox, batch, state, record, readiness |
  | `batch` | inbox, batch, state, runs |
  | `record` | record, state |
  | `record_version` | record, readiness, state, inbox |
  | `criterion` | record |
  | `link` | record, readiness, inbox, state |
  | `question` | exploration, inbox, state, readiness, explorations, stages |
  | `exploration` | exploration, explorations, state, events |
  | `ai_run` | run, runs, exploration, events |
  | `knowledge_update` | knowledge, inbox |
  | `classification` | knowledge, inbox |
  | `taxonomy` | knowledge, inbox |
  | `idea_assessment` | knowledge, inbox, batch |

  - Invalidations are batched within 60 ms.
  - After a disconnect, everything under the project is refetched.
  - An amber band says "Can't reach DEMIURGO. Retrying…" after 1.5 s down.

---

### 0. Shared conventions and single-proposal actions (PROP)

These live in `ui/ActionBar.tsx`, `ui/dialogs.tsx`, `ui/Reasons.tsx`, `ui/marks.tsx`, `ui/signals.tsx`,
`ui/Card.tsx`, `screens/batch/ProposalCard.tsx`, `ProposalActions.tsx` and `parts.tsx`. They are used by
Needs you, Catch up, the item batch page and the record page.

#### Conventions

- **INV-PROP-01 Buttons come from the tables.**
  - `ActionBar` and `ActionButtons` draw one button per allowed command that the screen has a handler for,
    in the handlers' order.
  - Default variant: primary if decisive, otherwise secondary. A handler may set the label, variant,
    `disabled` and `hint` (the `title` tooltip).
  - Every button carries `data-command`.
  - While the tables are loading, no buttons show.
  - Queries: `tablesQuery`, `commandsQuery`.
- **INV-PROP-02 Decisive confirmation (`ConfirmDialog`, Radix AlertDialog).**
  - It shows a title (usually quoting the item's title), a description of the effects, and the server
    `Reasons` inside the dialog on error.
  - Buttons: "Not now" (cancel) and a primary confirm button that reads "Working…" and is disabled while
    pending.
- **INV-PROP-03 Text prompt (`TextDialog`, Radix Dialog).**
  - Title, optional description, and a labelled textarea (or input) with an optional "· optional" marker
    and a `maxLength`.
  - It can be prefilled (`initial`) and is reset each time it opens. The text is trimmed on submit.
  - Required fields show "Write something to continue." and disable submit.
  - The text is kept when the command fails (409, 422 or 403), with `Reasons` under the field.
  - Buttons: "Not now" and submit ("Working…" while pending). Focus lands in the field
    (AC-WEB-001-03).
- **INV-PROP-04 Error explanation (`Reasons`).**
  - It is `role=alert`, gets focus when it appears, and is shown in rust next to the failed action. It is
    never a bare "Error".
  - Title by status:

    | Status | Title |
    | --- | --- |
    | 0 | "Can't reach DEMIURGO. Check your connection and try again." |
    | 401 | "Your session ended. Sign in again to continue." |
    | 403 | "Only a person can do this." (message mentions person/human), otherwise "This isn't allowed here." |
    | 404 | "We couldn't find it. …" |
    | 409, knowledge behind | "DEMIURGO is catching up with your latest changes. Try again in a moment." |
    | 409, with reasons | the server message |
    | 409, without reasons | "It can't be done right now." |
    | 422 | "Some of what you wrote needs a change." |
    | anything else | "Something went wrong on our side. Nothing was changed." |

  - It is followed by a bulleted list of the server's `reasons` exactly as sent.
  - A reason matching "Choose (a|another) model for …" gets an "Open Models & providers" link, to
    `/p/:id/models` or to `/models` outside a project.
- **INV-PROP-05 Refresh after a 409.** When a dialog of a proposal (`ProposalActions`) or of a version
  (`VersionNeed`) is closed after a 409, every project query is refetched so the page stops showing
  stale data.
- **INV-PROP-06 Marks.**
  - Every mark (certainty dot, status mark, working, done) has a tooltip "Name · phrase" (`MARKS` in
    `words.ts`) and an `aria-label`, and registers itself in the Legend.
  - The Legend sits bottom left and lists only the marks on screen. "Got it" folds it, `?` opens it
    anywhere, and Esc closes it.
  - `MarkWord` pairs a mark with its word, colour-toned: blue for Proposed, grey for inactive, rust for a
    problem, amber for working.
- **INV-PROP-07 Who marks.**
  - `WhoMark` distinguishes You, DEMIURGO (with its model), Agent · name, and Automatic · component.
  - Tooltip phrases: "Only people confirm." / "Drafts, asks and proposes." / "From outside. Only
    proposes." / "A rule or test that ran alone."
  - It is derived from actor strings `human:`, `agent:run:`, `agent:<name>:<session>` and
    `system:<component>@<version>`.
- **INV-PROP-08 Record chip (`RecordChip`).** It shows the record's title first, then its code (and `vN`)
  small in mono, and links to `/p/:id/records/:code?v=N`.

#### Proposal card (`ProposalCard`, the design system's `Proposal`)

- **INV-PROP-09 Card header.**
  - Author line: WhoMark, "<Agent name | DEMIURGO | DEMIURGO's knowledge> proposes · i of n · <day
    time>".
  - Kind label: New decision / New feature / New thread / Review / Imported document / Imported
    taxonomy.
  - State mark and word: Proposed / Accepted / Accepted with edits / Rejected / Out of date.
  - Title, then "why" in quotes: the context of a decision, the goal of a feature, the reason of a
    review.
- **INV-PROP-10 Card body by proposal type.**
  - decision: "What it changes" with Decision and Consequences.
  - fdr: Scope, Out of scope, Behavior, and "Based on" with a RecordChip of `payload.based_on`, plus its
    checks as `CheckCards` (title, statement, "Check: …", who verifies, code).
  - design_record: its sections (title and content) and its checks.
  - exploration: "New thread: <purpose>".
  - review: "What it asks". It shows "Review <chip> · NN% sure" and "Because of <chip of the change>",
    with the note "Accepting opens a thread to review it; the record itself doesn't change."
- **INV-PROP-11 Dependencies.** A "Starts from" line holds RecordChips of `proposal.dependencies`.
- **INV-PROP-12 Idea check** (`IdeaCheck`, not shown for reviews). Under the heading "Checked against
  what DEMIURGO knows":
  - pending: "Checking it…" (working mark);
  - error: "The check couldn't run: <error>";
  - no findings: "It doesn't repeat or contradict anything DEMIURGO knows.";
  - findings: a list of Duplicates / Contradicts / Doesn't fit with / Relates to, each with a chip of the
    cited record (when `CODE@n` can be derived) or the raw citation, and the justification.
    Duplicates, contradicts and inconsistent get a warning icon and rust colour.
  - Data: `assessment` from the inbox.
- **INV-PROP-13 May be out of date.** A pending proposal with server `obsolescence` reasons shows "It
  can't be accepted as it is" with the reasons. Accept, Accept and approve and Change are hidden
  (`blocked`), and only Reject stays.
- **INV-PROP-14 Out of date (superseded).**
  - It shows a grey "Out of date" clock mark and "<server reason (`resolution.obsolete`), or 'What it was
    based on changed.'> It can't be accepted any more. Nothing is lost: it stays here as it came."
  - The body and "Starts from" stay visible. There are no actions (only the footer, e.g. Next).
  - AC-INT-001-13 checks the code and version appear, updated live.
- **INV-PROP-15 Accept.**
  - Gated on `proposal.accept` from `pending`, and not blocked.
  - Label: "Accept", or "Accept as draft" when the type can be approved (decision, fdr, design_record),
    or a custom label ("Open a review" for reviews).
  - Its `ConfirmDialog` says the effects in words:
    - review: "DEMIURGO opens a thread to review CODE vN. The record itself doesn't change.";
    - exploration: "DEMIURGO opens the thread “…”.";
    - others: "DEMIURGO records the decision/the feature “title”, with its N checks as a draft. You
      approve it later, on its page."
  - cmd `proposal.accept` `{}`.
- **INV-PROP-16 Accept and approve** (secondary, types that can be approved). Its `ConfirmDialog` says
  "Two things happen: 1. DEMIURGO records …. 2. You approve it: it becomes the current version." cmd
  `proposal.accept` `{approve: true}`.
- **INV-PROP-17 Draft versus approve caption**, shown when both are offered: "As draft: it is recorded
  but doesn't count yet; you can discard it or make a new version. Approve: it becomes settled: agents
  take it as decided, features can build on it, and changing it takes a new version."
- **INV-PROP-18 Change (accept with edits).**
  - Gated on `proposal.accept_edited` and not blocked. Only for types with editable fields:
    - decision: Title, Context, Decision, Consequences;
    - fdr: Title, Goal, Scope, Out of scope, Behavior;
    - exploration: Purpose.
  - It opens an inline "Your version" form prefilled from the payload.
  - Validation: "<fields> can't be empty." / "Change something to accept your version."
  - "Accept my version" opens a `ConfirmDialog` "Accept your version of “title”?" listing the changed
    field labels ("The proposal is kept as it came.").
  - cmd `proposal.accept_edited` `{edit: <whole payload with trimmed changes>}`. Cancel leaves the form.
- **INV-PROP-19 Reject.**
  - Gated on `proposal.reject`. The label can be customised ("Keep it as it is" for reviews).
  - `TextDialog` "<Reject>: “title”", "Say why, if you want. The reason is kept with the proposal."
    with an optional Reason.
  - cmd `proposal.reject` `{reason?}`.
- **INV-PROP-20 Resolved view.** Once resolved, the actions are replaced by:
  - one of "You accepted it." / "You accepted your version." / "You rejected it.";
  - "<CODE> is approved and current." or "<CODE> is a draft." (from `resolution.effect`);
  - "Reason: …";
  - an "Open CODE →" link to `/records/:code?v=N`;
  - an optional footer (e.g. Next).
- **INV-PROP-21 No accept-all.** No accept-all exists anywhere (AC-INT-001-12).

---

### 1. Needs you: `/p/$projectId/needs-you`

Search params: none. `?catch-up=1` switches to Catch up (section 2). The empty state switches to "You're up
to date" (section 1b).

- **Purpose.** Everything that waits for the person, grouped and resolved in place (FDR-INT-001).

#### Capabilities

- **INV-NEED-01 Page title.**
  - "Needs you" with a blue count bubble (`inbox.total`), `data-needs`, tooltip "Needs you: N things
    wait for you."
  - Subtitle "Everything that waits for you. Each thing is resolved here, in place."
  - Data: `inboxQuery`, `stateQuery` (record rows = decisions + designs), `explorationsQuery` (thread
    names) and `taxonomiesQuery` (categories).
- **INV-NEED-02 Groups.** Fixed order; empty groups hidden; each group shows "(n)" and a hint:

  | Group | Hint |
  | --- | --- |
  | Conflicts (rust warning icon) | "Knowledge found them. DEMIURGO recommends; you decide." |
  | Questions | "The ones that block something come first." |
  | Proposals (includes packages) | "A package is decided whole; a batch, one proposal at a time." |
  | Versions to approve | "Approving doesn't create a new version." |
  | Links to review | "What they point to has a newer version." |
  | Classifications to review | "DEMIURGO wasn't sure where they go." |
  | Knowledge updates that failed | "Until they are taken in, the knowledge is behind." |

  Each group is a `region` named by its title and sits on the blue ground (`needs-soft`).
- **INV-NEED-03 Row frame.** Every row (`Frame`, `mode="row"`) shows, in order:
  - the kind eyebrow: icon and kind word (Conflict / Question / Package / Proposal / Version to approve /
    Link to review / Classification / Knowledge update), then a state mark and word;
  - the title (h3) and an optional code chip;
  - one line (2 lines max);
  - a "from" line;
  - "Unblocks" chips;
  - the actions in place.

  It carries `data-need=<kind:id>` and `data-kind`.
- **INV-NEED-04 "Unblocks" chips.**
  - Chips of the records (type icon, title, code) whose readiness reasons cite this item. Each links to
    `/records/:code`.
  - Derived only from server reason strings:
    - question: `questionReason(state, question)` in a record whose `origin_exploration` is its thread;
    - version: "Version N is not approved." on its own record, or "The decision it is based on, CODE, is
      not approved.";
    - link: "The link with CODE[ vN] is pending review." on the source record;
    - proposal, package or conflict: the dependency codes whose record has "There are N pending
      proposal(s) affecting it."
- **INV-NEED-05 Right column "In this order".**
  - The first 4 items in Catch up order, each with "n · <kind>", "<m> min", the title and "Unblocks:
    <record titles>". Conflicts are in rust.
  - Also shown: "about N min in all" (sum of the estimates), "What unblocks the most comes first." and
    "and N more".
  - A primary **"Catch up"** link goes to `?catch-up=1`, with the caption "One at a time, in this order.
    What you skip stays here."
- **INV-NEED-06 Open question** (`pending`).
  - Eyebrow "Open". Title: the question. From: "Asked by you | Asked by DEMIURGO in <thread link>" with a
    WhoMark.
  - Actions (`QuestionItem`, compact, gated on the question state):
    - **Answer** opens a `TextDialog` "Answer the question" (Conclusion, required, max 3000). cmd
      `question.confirm` `{conclusion}`.
    - **Park** opens a `TextDialog` "Park this question", "It stays open for later. Say why." (Reason,
      required, max 1000). cmd `question.postpone` `{reason}`.
    - **Drop** opens a `TextDialog` "Drop this question", "It doesn't apply. Say why." (required). cmd
      `question.discard` `{reason}`.
  - Errors from inline actions show below.
- **INV-NEED-07 Assumed question** (`inferred`).
  - Eyebrow "Assumed". Shows "Assumed: <conclusion>".
  - **Confirm** opens a `ConfirmDialog` "Confirm this answer?" showing the question, the conclusion and
    "DEMIURGO assumed it. Confirming makes it your answer." cmd `question.confirm` `{}`.
  - **Change** opens a `TextDialog` "Change the assumed answer" prefilled with the conclusion; submit
    "Confirm my answer". cmd `question.confirm` `{conclusion}`.
  - Park and Drop work as in INV-NEED-06.
- **INV-NEED-08 Parked question** (`postponed`).
  - Eyebrow "Parked". Shows "Reason: <state_reason>".
  - Allowed actions: **Drop**, and **Reopen**, which opens a `TextDialog` "Reopen this question", "Its
    history is kept. The answer has to be given again." (Reason, optional, max 1000). cmd
    `question.reopen` `{reason?}`.
- **INV-NEED-09 Question order.** Questions that unblock a record (blocking) come first within the
  Questions group. `questions_to_confirm` (inferred) and `open_questions` (pending, postponed) are merged.
  Questions still in the reserve (`shown_at` null) are not in the inbox.
- **INV-NEED-10 Package row** (a batch with `resolution=package`: an import, or DEMIURGO's package).
  - Eyebrow "Proposed · N proposals, accepted or rejected whole".
  - Title "Imported from design/", or the first proposal's title, or "A package". The line is the batch
    summary (not for imports).
  - From: producer WhoMark with name · creation day and time.
  - Only action: an **"Open the package →"** link to `/batches/:batchId`. There is no in-place accept.
- **INV-NEED-11 Proposal row** (each pending proposal of a batch resolved item by item; `exploration`
  proposals are excluded by the server).
  - Eyebrow: type icon, type word (Decision / Feature / Design record / Thread / Review / Document /
    Taxonomy), "Proposed".
  - Title: `proposalTitle`. Line: `proposalLine` (decision text, feature goal, review reason, or the
    first section).
  - From: producer WhoMark with name · "i of n in its batch" · an **"Open the batch"** link.
  - Idea check findings (INV-PROP-12), obsolescence warnings in rust, and `ProposalActions` (INV-PROP-13
    to 19).
- **INV-NEED-12 Conflict row** (every proposal of a `knowledge` batch; type `review`).
  - Eyebrow "Conflict · with something you approved" or "· with an earlier version".
  - Title "<record title> may need an update | may no longer hold | may need something added | may be
    affected" (from the verdict). Code "CODE vN".
  - Line "Because of “<change title>” <CODE vN>. <reason>".
  - Recommendation "DEMIURGO recommends reviewing “<record>”: with “<change>” approved, it <verdict
    words>. It won't choose for you: nothing changes until you do."
  - Actions:
    - **Open a review** (`proposal.accept`, confirmation "DEMIURGO opens a thread to review CODE vN. The
      record itself doesn't change.");
    - **Keep it as it is** (`proposal.reject`, `TextDialog` with an optional reason).
- **INV-NEED-13 Version to approve** (every draft version of the project).
  - Eyebrow: type icon, type word (Feature, Tech decision, …), "vN Draft". Title and code.
  - From: a **"Read it on its page →"** link to `/records/:code?v=N`.
  - **Approve** (primary; gated on `record_version.approve` and shown only if `approvable`) opens a
    `ConfirmDialog` "Approve “title” vN?", "It becomes the current version of CODE. Approving doesn't
    create a new version." cmd `record_version.approve` `{}`.
  - **Discard** (text variant, or secondary when it cannot be approved) opens a `TextDialog` "Discard
    “title” vN?", "The draft stays in the history as discarded. Say why, if you want." (Reason,
    optional). cmd `record_version.discard` `{reason?}`.
  - A draft that cannot be approved shows "A later version is already approved: this draft can only be
    discarded."
- **INV-NEED-14 Link to review** (links in `needs_review`).
  - Eyebrow "Needs review" (problem mark). Title "<from title> is based on <to title>".
  - Line: code chips "FROM vN → TO vN" and "· TO now has vM: does the link still hold?" (or "The version
    it points to changed: does the link still hold?").
  - Actions, gated, with no confirmation:
    - **Keep**: primary, tooltip "It still holds." cmd `link.keep`.
    - **Mark as changed**: tooltip "It holds, with changes." cmd `link.change`.
    - **Out of date**: tooltip "It no longer holds." cmd `link.obsolete`.
  - Errors show as `Reasons` below.
- **INV-NEED-15 Classification to review** (`pending_review`).
  - Eyebrow "<axis name> · Needs review". Title: the node's record title (from `node_ref` `CODE@n`).
    Code "CODE vN".
  - Line "DEMIURGO put it in “<category>”, NN% sure: <justification>".
  - A single-choice row of category chips from the approved taxonomy's axis (DEMIURGO's is preselected,
    the description is the tooltip). Without an approved taxonomy, only DEMIURGO's category is offered.
  - **Resolve** runs cmd `classification.resolve` `{category}`. Errors appear under it.
- **INV-NEED-16 Failed knowledge update** (`rejected`).
  - Eyebrow "Failed".
  - Title "Knowledge couldn't take in <record title>", or "… an accepted proposal", or "… a change".
    Code "CODE vN". Line: the failure text, or "It stopped without saying why."
  - From: day and time · "Until it is taken in, the knowledge is behind."
  - **Retry**, gated, with no confirmation, runs cmd `knowledge_update.retry`.
- **INV-NEED-17 Count goes down.** Every resolution makes the item disappear and the header count go
  down (via invalidation and SSE) without a reload (AC-INT-001-11, AC-INT-001-15).
- **INV-NEED-18 Loading skeleton.** Two groups of row skeletons, `role=status` "Loading what needs you".
  The list waits for both the inbox and the state.
- **INV-NEED-19 Error.** An error on the inbox or the state replaces the page with the title "Needs you"
  and `Reasons`.
- **INV-NEED-20 Entry points.**
  - The header "Needs you" nav link with its count (`screens/shell/Header.tsx:34`; active on
    `/needs-you` and `/batches/*`).
  - The overview's needs column.
  - Breadcrumbs of the batch pages.
  - The "What needs you" link after ratifying.
  - The "Back to Needs you" link at the end of Catch up.

#### Real-time

- Inbox: `proposal`, `batch`, `record_version`, `link`, `question`, `knowledge_update`,
  `classification`, `taxonomy`, `idea_assessment`.
- State: `proposal`, `batch`, `record`, `record_version`, `link`, `question`, `stage`, `exploration`.
- Explorations: `question`, `stage`, `message`, `exploration`.
- Taxonomies (key under `knowledge`): `knowledge_*`, `classification`, `taxonomy`, `idea_assessment`.

#### States handled

Loading (skeleton), empty (goes to Up to date), error (`Reasons`), partial (a missing thread name falls
back to "its thread"; without a taxonomy only DEMIURGO's category shows), 409/422/403 inside dialogs
(INV-PROP-04 and 05), obsolete or blocked proposals.

#### Tests

- `test/e2e/needs-you.spec.ts`:
  - AC-INT-001-11 (every kind resolved in place, the count goes down);
  - AC-INT-001-14 (409, 422 and 403 reasons next to the action, the text is kept);
  - AC-WEB-001-03 (keyboard only);
  - AC-INT-001-16 (Catch up order);
  - screens of cut 5.
- `test/e2e/fidelity.spec.ts`: AC-INT-001-11 (up to date).
- `test/e2e/h1-walk.spec.ts`: AC-INT-001-01 (`settleNeedsYou`).
- `test/e2e/realtime.spec.ts`: AC-INT-001-15 (header count live).
- `test/e2e/lens.spec.ts`: AC-INT-001-16.
- `test/unit/needs-you-order.test.ts`: AC-INT-001-16 and AC-INT-001-11.
- `test/unit/reasons.test.tsx`: AC-INT-001-14.
- Helpers in `test/e2e/needs-data.ts`.
- **Probably stale.** `needs-you.spec.ts:153` clicks a button named exactly "Accept" on a decision
  proposal row. That label is now "Accept as draft" for decision, fdr and design_record
  (`screens/batch/ProposalActions.tsx:135`, patch f5db840). Not run; flagged by reading.

#### UX problems

- **The count does not match the rows.** The page and header count proposals one by one, including every
  proposal of a package (`packages/core/src/queries/read.ts:246`). The list shows a package as a single
  row (`screens/needs-you/order.ts:120`), so the blue "12" can sit over 3 rows.
- **An assumed answer is confirmed from the list without its reasoning.**
  - In row mode the "Why: <reasoning>" is hidden (`ui/QuestionItem.tsx:94`, `!compact`) and the frame's
    explanatory line is focus-only (`screens/needs-you/NeedView.tsx:133-141`).
  - A decisive "Confirm" is offered without the reason DEMIURGO assumed it.
- **A fragile CSS hack hides duplicated text.** The question text and mark from `QuestionItem` are
  hidden with structural selectors (`NeedView.tsx:156` `[&>div>div>p:first-child]:hidden …`); any markup
  change breaks it.
- **Button order.** On an assumed question, "Change" comes after the Park and Drop text buttons
  (`ui/QuestionItem.tsx:98-105`, rendered as a child after the table-driven buttons).
- **No confirmation and no undo for link verdicts.**
  - Keep, Mark as changed and Out of date run at once (`NeedView.tsx:386-388`).
  - "Out of date" makes a link obsolete, and obsolete links are not carried into new versions
    (`screens/new-version/form.ts` `carriedLinks`).
- **Terminology clash.** The link command button "Out of date" (`words.ts:168`) reuses the name of the
  stale mark "Out of date" (`words.ts:34`), which means "can no longer be accepted".
- **"Conflict" overstates.** Every knowledge review is called a Conflict, rust with a warning icon
  (`screens/needs-you/frame.tsx:25` `KIND_WORDS.conflict`; `NeedsYou.tsx:89`), even when the verdict is
  only "may need something added" or "may be affected" (`screens/needs-you/Conflict.tsx:21-26`).
- **Classification choice is fake without a taxonomy.** Without an approved taxonomy, the chip row has
  one option (`NeedView.tsx:417`), so "Resolve" can only confirm DEMIURGO's guess.
- **Time estimates are hard-coded constants** (`order.ts:39-48`) presented as "about N min in all".
- **The error state has no retry**, and any error on the state query hides the whole inbox
  (`NeedsYou.tsx:42-50`).
- **Dense rows.** A proposal row can hold at once: eyebrow, title, 2-line text, from line, Unblocks,
  idea-check findings, obsolescence warnings, 4 buttons, and the 2-sentence draft-versus-approve caption
  (`ProposalActions.tsx:163-168`).
- **The Legend covers row actions.** It overlays the bottom-left row actions; the tests must fold it
  first (`test/e2e/needs-you.spec.ts:38`).

---

### 1b. You're up to date: `/p/$projectId/needs-you` (and Catch up) when nothing is left

`screens/needs-you/UpToDate.tsx` and `today.ts`.

- **Purpose.** It closes the loop: what you did today, where the product is, what DEMIURGO is still doing,
  and that you can leave.

#### Capabilities

- **INV-NEED-21 Header.**
  - Eyebrow "<WEEKDAY> · HH:MM".
  - Title "You're up to date".
  - Subtitle "N things done today. Nothing waits for you." (or "Nothing done yet today. …").
- **INV-NEED-22 "Today" list** (the design system's `WhileAway`).
  - The person's own (`human:`) events of the local day. Source: `changesQuery(p,'0')` →
    `GET /changes?since=0` with `staleTime 0`, told with the lens lines (`overview/lens/lines.ts`).
  - Each line: time, WhoMark, text with bold segments, and trailing problem mark and record codes.
  - Header "Today · since HH:MM".
  - Empty note: "Nothing yet today. What you do here is kept and shown next time."
  - "Show everything" goes to `/activity`.
- **INV-NEED-23 "The product · <name>"** with a "See the product" link to `/p/:id` and the progress line
  "Ready to build: x of N features · k in progress" (bars).
- **INV-NEED-24 Aside "In progress".** The running runs (`runsQuery`): "Drafting a feature" or
  "Answering" · thread name, a live duration with the working mark, and a link to `/runs/:runId`. Empty:
  "Nothing. I'm waiting for you."
- **INV-NEED-25 Aside footer.** "Nothing needs you. You can close DEMIURGO." and "Everything is saved.
  When you come back, I'll show you what changed while you were away."

#### Real-time

The state and runs refresh through SSE. **The "Today" list does not.** Its key `['p',p,'changes','0']`
is not in `INVALIDATES` (`api/stream.ts:13-34`); it refreshes only after the person's own command (the
project-wide invalidation) or a reconnect.

#### States handled

Loading (skeleton "Today"), empty today, no runs.

#### Tests

- `fidelity.spec.ts`: AC-INT-001-11 (up to date, the end of Catch up).
- `needs-you.spec.ts`: screens of cut 5 ("Needs you empty").

#### UX problems

- **The voice switches.** It changes to the first person ("I'll show you…", `UpToDate.tsx:49`; "I'm
  waiting for you", `screens/overview/Blueprint.tsx:337`) while every other screen says "DEMIURGO" in
  the third person.
- **The "Today" list is not live** (see Real-time).

---

### 2. Catch up: `/p/$projectId/needs-you?catch-up=1`

`screens/needs-you/CatchUp.tsx`, `NeedView.tsx` and `Conflict.tsx`.

- **Purpose.** Walk Needs you one thing at a time, in the order that unblocks the most, with Skip and
  Leave.

#### Capabilities

- **INV-CATCH-01 Entry.**
  - The "Catch up" link in the Needs you aside.
  - The overview (the needs column and the lens "catch up" link).
  - A direct URL with `catch-up=1` (or `'1'`).
- **INV-CATCH-02 Order** (`catchUpOrder`; within a rank, the list's order):
  1. conflicts with something approved;
  2. questions that unblock a readiness;
  3. proposals and packages, and conflicts with an earlier version;
  4. versions to approve;
  5. links and classifications;
  6. the rest (non-blocking questions, failed updates).
- **INV-CATCH-03 Breadcrumb** "Needs you / Catching up".
- **INV-CATCH-04 The "Catching up" band** (a region).
  - Step circles for the walk: the first 12, then "+N". The current one has a blue outline; done ones a
    tick; skipped ones a dashed grey outline; the next ones a plain outline.
  - Tooltip and screen-reader text "i: <title>, Now|Done|Skipped|Next"; `aria-current=step`.
  - Progress "i of N · about M min" (`aria-live=polite`, `data-progress`) and the current title.
  - Buttons **Leave** (back to the list) and **Skip** (moves on; the item stays in Needs you).
- **INV-CATCH-05 Focus view of the current item** (`NeedView mode="focus"`, h1 title). It has the same
  actions as the row, with these differences:
  - Question line:
    - "DEMIURGO assumed an answer from what you said. Confirm it, change it, or park it." when assumed;
    - "Something waits for your answer before it can be built." when blocking;
    - otherwise "It waits for your answer."
  - An assumed question also shows "Why: <reasoning>".
  - Proposal: the full `ProposalCard` (INV-PROP-09 to 21) instead of the row frame.
  - Version: its line is the record summary, plus a Readiness box of the record's reasons.
  - Conflict: two side cards ("To review" and "The change"), each loaded with `recordQuery`. Each card
    shows:
    - the type, epistemic mark, title and code;
    - its Decision section, or the first non-empty one, as 4 clamped lines of markdown;
    - "Approved <when>" or "Drafted <when>".
  - Between the two cards a rust "may contradict" mark. When the change is no longer in the current view,
    a dashed note replaces its card.
  - A box "What DEMIURGO recommends" with the recommendation and "Why: <reason> (NN% sure)".
  - Actions: Open a review / Keep it as it is.
- **INV-CATCH-06 Resolving moves on.** Resolving the current item advances by itself: the item leaves the
  inbox, the next one takes focus (`key=current.key`), and the progress counts it as done.
- **INV-CATCH-07 Aside "In order".** The whole walk, each with a number circle, kind word (conflict in
  rust), title (struck through when done) and state word. Header "N left · about M min" or "Nothing
  left". The current row is highlighted.
- **INV-CATCH-08 Aside "What it unblocks".**
  - Design-system `Node`s for the records the current item unblocks: type, epistemic mark, title, and
    stage bars for features. Each links to `/records/:code`.
  - Under each: "Ready to build" or "N things before it can be built".
  - Empty: "Nothing waits for it directly."
- **INV-CATCH-09 Aside footer.** "Stop whenever you like — What you skip stays in Needs you, in the same
  order."
- **INV-CATCH-10 Finished with skips.** "You went through everything", "N things you skipped stay in
  Needs you, in the same order.", "Back to Needs you" and "See the product".
- **INV-CATCH-11 Everything resolved** (or nothing to start with) shows "You're up to date" (section 1b).
- **INV-CATCH-12 Items arriving mid-walk** (SSE) are appended to the walk. The total is the larger of
  what was seen and what is present.
- **INV-CATCH-13 Loading.** The band says "Getting ready…" over a skeleton.
- **INV-CATCH-14 Keyboard.** Everything works by Tab and Enter (AC-WEB-001-03). There are no dedicated
  shortcuts.

#### Real-time

Same as Needs you. The conflict side cards also follow `record` events.

#### States handled

Loading, empty, finished-with-skips, a changed item missing from view, 409 in dialogs.

#### Tests

- `needs-you.spec.ts`: AC-INT-001-16, AC-WEB-001-03, screens of cut 5.
- `lens.spec.ts`: AC-INT-001-16.
- `fidelity.spec.ts`: AC-INT-001-11 (Catch up ends in up to date).
- `test/unit/needs-you-order.test.ts`.

#### UX problems

- **The walk lives in React state.** Walk and skipped are `useState` (`CatchUp.tsx:28-29`): a reload or
  opening a package forgets the position and the skips.
- **A package takes you out of Catch up.** Its only action is a link away (`NeedView.tsx:187-189`), with
  no way back into the walk.
- **No focus management after resolving.** The next item is re-mounted by key (`CatchUp.tsx:104`) and
  focus falls to the body; the keyboard test has to re-Tab from the top (`needs-you.spec.ts:204-216`).
- **Step state is drawn as borders.** Solid, dashed, or tick (`CatchUp.tsx:123-136`), with the words
  only in the tooltip and screen-reader text; they are readable only in the aside list.
- **Skip and Leave sit far from the item.** They are in the top band, while the item's own actions are
  in the body.

---

### 3. Proposal batch page: `/p/$projectId/batches/$batchId`

`screens/batch/Batch.tsx` dispatches on `batchView`:

- `kind==='import'` → the import view (3c);
- `resolution_mode==='package'` → DEMIURGO's package (3b);
- anything else → the item batch (3a).

#### Dispatcher

- **INV-BATCH-01 Load.**
  - `batchQuery` (`GET /batches/:id`).
  - 404: the NotFound page "We couldn't find this package." with "Back to the product".
  - Another error: `Reasons`.
  - Loading: a skeleton with the breadcrumb "Needs you / Package" (`role=status` "Loading the
    package").

#### 3a. Item batch

`ItemBatch.tsx`: an agent's batch, DEMIURGO's from a conversation, or knowledge reviews.

- **Purpose.** Decide each proposal of a batch one at a time, with its author visible.

- **INV-BATCH-02 Breadcrumb** "Needs you / <title>".
- **INV-BATCH-03 Header.** WhoMark (40 px), then by producer:

  | Producer | Eyebrow | Title |
  | --- | --- | --- |
  | agent | "N proposals from an agent" | "<agent> proposes N changes" |
  | DEMIURGO | "N proposals from DEMIURGO" | "DEMIURGO proposes N changes" |
  | anything else | "N reviews from knowledge" | "DEMIURGO's knowledge asks you to review N records" |

  The line under it: "<day time> · <summary> Nothing changes until you accept. Decide each one: accept
  it, change it or reject it."
- **INV-BATCH-04 One card at a time.**
  - One `ProposalCard` (INV-PROP-09 to 21), opened on the first pending proposal.
  - The page stays on the proposal shown while others resolve.
  - `article` "Proposal i of n: <title>".
- **INV-BATCH-05 Aside "In this batch".**
  - Every proposal (all states) as a button: number circle (blue outline on the current one), type word,
    title, state mark and word. A click jumps to it (`aria-current=step`).
  - Header "N to decide" or "All decided".
- **INV-BATCH-06 Aside "Who proposes".** WhoMark (28 px), name ("DEMIURGO's knowledge" for automatic),
  and an explanation: "An agent from outside. It only proposes: nothing changes until you accept." /
  "It found these while taking in a change. …" / "It only proposes: …".
- **INV-BATCH-07 Navigation.**
  - Previous / "i of n" / Next (disabled at the ends; aria-labels "Previous proposal" and "Next
    proposal").
  - After a proposal is resolved, the card footer shows **Next**, which goes to the next pending one, or
    the next one.
- **INV-BATCH-08 Merged data.** The batch proposals are merged with the inbox's `obsolescence` and
  `assessment` for pending ones (`withInbox`). Record titles come from `stateQuery`.
- **INV-BATCH-09 Reviews.** Knowledge review proposals use "Open a review" and "Keep it as it is", have
  no Change and no idea check.

#### 3b. DEMIURGO's package

`DemiurgoPackage.tsx`: a design proposal, resolved whole.

- **Purpose.** Accept or reject a coherent system package in one step, reading it the way its record
  will look.

- **INV-BATCH-10 Breadcrumb and header.**
  - Breadcrumb "Needs you / Package from DEMIURGO".
  - Header: WhoMark; eyebrow "Package from DEMIURGO · N proposals · <batch state mark>"; h1 the single
    proposal's title, or "A package from DEMIURGO".
  - "<summary> It is accepted or rejected whole."
- **INV-BATCH-11 Run line.** `runQuery` (`GET /runs/:run_id`): run WhoMark with its model, "Drafted by
  DEMIURGO" (or "<Conversation|Draft|Echo> with DEMIURGO"), the model, the run state mark, day and time,
  "took m:ss", and an **"Open the run →"** link to `/runs/:runId`. A placeholder shows while loading.
- **INV-BATCH-12 Each proposed record shows:**
  - the type label and state mark, and "Based on <chip>";
  - an Out of date box with the server reason ("It can't be accepted any more.");
  - fdr: the Goal, Scope, Out of scope and Behavior sections (markdown). Otherwise the decision text or
    the purpose;
  - "Checks (N)" as `CheckCards` with "Codes are given when it is accepted";
  - the idea check.
- **INV-BATCH-13 Aside "Decide the package" while pending.**
  - Heading "Accept it whole".
  - Text: "Accepting records <each item with its checks count> as a draft. Accept and approve also
    approves it: it becomes the current version. Nothing changes until you decide."
  - The union of obsolescence warnings in rust.
  - Buttons:
    - **Accept package** (primary): `ConfirmDialog` "Accept this package?", "DEMIURGO records … as a
      draft. You approve it later, on its page." cmd `batch.accept_package` `{}`.
    - **Accept and approve** (secondary): "Accept and approve this package?", "Two things happen: 1 …
      2 You approve it: it becomes the current version." cmd `batch.accept_package` `{approve:true}`.
    - **Reject package** (text): `TextDialog` "Reject this package?", "Nothing is recorded. Say why, if
      you want: the reason is kept with the package." (optional). cmd `batch.reject_package`
      `{reason?}`.
  - Both accept buttons are gated, and hidden while there are warnings.
- **INV-BATCH-14 Aside once resolved.**
  - Heading: the state mark and word.
  - Superseded: "What it was based on changed. It can't be accepted any more."
  - Accepted: per created record, a chip with "is approved and current." or "is a draft: approve it on
    its page."
  - Rejected: "Nothing was recorded."
- **INV-BATCH-15 Aside "Starts from".** Chips of the batch dependencies and "If it gets a newer version
  before you decide, the package goes out of date."

#### 3c. Import of design/

`ImportPackage.tsx`, spec §4.2 stop 1.

- **Purpose.** Ratify the import of `design/` (DEMIURGO becomes the home of the design) or reject it.

- **INV-BATCH-16 Breadcrumb and header.**
  - Breadcrumb "Needs you / Imported from design/".
  - Header: package icon; eyebrow "Package · N proposals"; h1 "Imported from design/".
  - Producer WhoMark with name, the producer code (`system:` stripped), the batch state mark, "imported
    <day time>".
- **INV-BATCH-17 "What's inside" table** (from `import_counts`; caption via `aria-labelledby`).
  - Columns: Kind / In design/ / In this package.
  - Rows: Records (decision+adr+fdr+bug), Versions, Checks, Links, Taxonomies, Annexes.
  - Each row has an icon "Same as design/" (tick) or "Differs from design/" (problem mark, rust row).
  - Summary: "Everything in design/ is here" / "Some counts differ from design/" / "design/ gave no
    counts". The table is hidden without counts.
- **INV-BATCH-18 Ratification panel while pending.**
  - "What ratifying does": "Everything becomes DEMIURGO's, as it is in design/. What is proposed stays
    proposed: ratifying approves nothing." (or "only the N documents design/ marks as approved stay
    approved."), then "From then on, design/ is an export."
  - **Ratify** (primary, gated `batch.accept_package`): `ConfirmDialog` "Ratify N proposals?", "This
    makes DEMIURGO the home of your design. Every document keeps the state it has in design/. You approve
    versions afterwards." cmd `batch.accept_package` `{}`.
  - **Reject package** (text): `TextDialog` "Reject this package?", "Nothing is imported and design/
    stays as it is. Say why, if you want." cmd `batch.reject_package` `{reason?}`.
- **INV-BATCH-19 Ratification panel once resolved.**
  - Superseded: Out of date box "Out of date: a newer import replaced it", "Only the latest import of
    design/ can be ratified. Open it from Needs you." Ratify is gone.
  - Accepted: "Ratified" (confirmed mark), "DEMIURGO is now the home of your design (<time ago>). From
    now on, design/ is an export. Each record keeps the state it had in design/: approve the versions you
    agree with." Links: **"Open the product"** and **"What needs you"**.
  - Rejected: "Rejected", "Nothing was imported. design/ stays as it is.", "Reason: …".
- **INV-BATCH-20 Documents section.**
  - Caption "Names first; open one to read it here."
  - Grouped as Decisions / Tech decisions / Features / Bugs / Taxonomy, each "(n)".
  - Each row: the proposal state mark (the word only in the tooltip and aria-label), title, code, vN, a
    checks-count signal with tooltip, "approved in design/", and, once accepted, "Open the record" or
    "Open the draft" to `/records/:code?v=N`.
  - An **Open / Close** toggle (`aria-expanded`, label "Open <title>").
- **INV-BATCH-21 Document opened in place.**
  - A record shows its sections (markdown), "Checks (n)" as a dense `ChecksList`, links ("Based on
    CODE vN", or the type words) and annexes (paths).
  - A taxonomy shows each axis (name and code) with its categories (name · description), then its
    sections.
- **INV-BATCH-22 Security.** Ratify goes to the same origin with the session cookie and the
  `x-demiurgo-csrf` header; without the header it gets 403 (AC-WEB-001-01).

#### Real-time (all batch views)

- The batch key follows `proposal`, `batch` and `idea_assessment` (an out-of-date proposal turns stale
  live, AC-INT-001-13).
- The inbox (obsolescence and assessment) and the state (titles) follow their events.
- The run follows `ai_run` and `context_pack`.

#### States handled

Loading, 404, error, each of the batch states (pending, accepted, rejected, resolved, superseded), each of
the proposal states, blocked by obsolescence, idea check pending or error, counts missing or different,
409/422 in dialogs.

#### Tests

- `test/e2e/batch.spec.ts`:
  - AC-INT-001-03 (counts, ratify, every event is the person's);
  - AC-WEB-001-01 (same origin and CSRF);
  - AC-WEB-001-03 (keyboard ratify);
  - AC-INT-001-12 (one at a time, author, no accept-all, Change, package whole with Accept and
    approve);
  - AC-INT-001-13 (out of date, live);
  - screens of cut 1.
- `h1-walk.spec.ts`: AC-INT-001-01 (ratify; accept and approve a decision; accept the package).
- `test/unit/batch-model.test.ts`: AC-INT-001-03, -12 and -13.
- **Probably stale.** `batch.spec.ts:150-152` clicks a button named exactly "Accept" on a decision
  proposal and expects an "Accept" dialog button; the label is "Accept as draft"
  (`ProposalActions.tsx:135`).

#### UX problems

- **The package's accept buttons are far from what they approve.** They sit in the right column
  (`DemiurgoPackage.tsx:44`); the content fills a long main column.
- **Unsaved Change edits are lost silently.** They live in `ProposalActions` state, and the card is keyed
  by proposal (`ItemBatch.tsx:149`); Previous, Next or an aside click drops the edits without asking.
- **Double confirmation of your version.** "Accept my version" in the form (`ProposalActions.tsx:255`)
  opens a second "Accept my version" dialog (`ProposalActions.tsx:123`).
- **Field limits are not enforced in the form.** They are declared (`model.ts:115-133`, `max`) but the
  Change form's inputs have no `maxLength` (`ProposalActions.tsx:236-250`); an over-long field fails
  only after confirming, with a 422.
- **Proposal type `design_record` is half-supported.**
  - No kind label: the raw "design_record" is shown uppercase (`ProposalCard.tsx:43-50, 253`).
  - No icon.
  - No Change (no `EDITABLE_FIELDS`, `model.ts:118`).
  - Inside a DEMIURGO package its sections are not rendered: only `decision || purpose`
    (`DemiurgoPackage.tsx:145`).
- **Citations and types ignore four record prefixes.** Citations resolve only for DEC, FDR, ADR and BUG
  codes (`model.ts:167`), and `CODE_TYPE` has only those 4 (`ProposalCard.tsx:53`); REQ, NFR, THR and
  PRR show as raw codes or wrong types.
- **The import document state is conveyed by the mark only** ("its word is the mark's label",
  `ImportPackage.tsx:341-349`).
- **Breadcrumbs always say "Needs you"** (`Batch.tsx:42`, `DemiurgoPackage.tsx:46`,
  `ImportPackage.tsx:39`, `ItemBatch.tsx:133`), even when the person came from a thread's "Review"
  link (the h1 walk).
- **Inconsistent terms.**
  - A 404 says "this package" even for an item batch (`Batch.tsx:20`).
  - "Ratify N proposals?" (`ImportPackage.tsx:225`) while the page calls them "Documents".
  - The item-batch heading treats any non-agent, non-DEMIURGO producer as "reviews from knowledge"
    (`ItemBatch.tsx:21-32`).
- **The package accept buttons vanish when warnings exist** (`DemiurgoPackage.tsx:218`), with no
  disabled state or explanation next to where they were.
- **A rejected import's reason comes from its first proposal** that has one
  (`ImportPackage.tsx:189`), not from the batch.
- **The Legend covers the batch actions** bottom left; tests fold it first (`batch.spec.ts:138`).

---

### 4. Record page: `/p/$projectId/records/$code`

Search params: `v` (a positive integer; otherwise the default version) and `tab`
(`overview` | `questions` | `checks` | `history`; default `overview`, which is not written).

Files: `screens/record/*` plus `screens/blueprint/{Rail,Sections,QuestionsTab,HistoryTab}.tsx`.

- **Purpose.** Read one version of a record: what it needs before it can be built, where it comes from,
  its versions, and the actions on it (Approve, New version, Discard, guided review, Ask DEMIURGO).

#### Loading and frame

- **INV-REC-01 Load.**
  - `recordQuery` (`GET /records/:code`), `stateQuery`, `inboxQuery`, and `readinessQuery`
    (`GET /versions/:id/readiness`, not for decisions).
  - The version shown is `?v`, otherwise the current one, otherwise the latest.
  - 404: NotFound "the record CODE". Error: `Reasons`. Loading: a skeleton (`role=status` "Loading the
    record").
- **INV-REC-02 Left blueprint rail** (`BlueprintRail`, `nav` "Blueprint").
  - A back link to the product (the project name), and "New record" (gated `record.create`).
  - Features, each with a status: "Needs you" with a count bubble and a detail such as "Needs you: 1
    version to approve, 2 proposals…", or Ready to build / In doubt / Draft / Not ready.
  - Decisions and Tech decisions with epistemic marks.
  - "Rules for the whole product" as a Later placeholder, and Parked ideas (set-aside threads) linking to
    the thread.
  - The record on screen is highlighted (`aria-current=page`). ↑ and ↓ move the focus.
- **INV-REC-03 Breadcrumb** "Product / <version title>".

#### Header (every tab)

- **INV-REC-04 Header.**
  - Type icon and word · state mark and word (Draft / Approved / Replaced / Discarded) · "current" ·
    stage bars for features (`data-stage` not-ready / ready / doubt).
  - h1 title; code "CODE · vN".
  - "Written by <you|DEMIURGO · model|Agent · x|Automatic> · <day time>" and "Approved by … · <day
    time>", each with a WhoMark.
- **INV-REC-05 Version picker.** A dropdown "vN <state> ▾" (aria "Version N of M · choose another").
  Each version shows its mark, vN, state word, "· current", date, "by <who>" and "approved by <who>".
  Choosing one sets `?v=N`.
- **INV-REC-06 "New version" link** to `/records/:code/new-version`. Shown when `canCreate
  record_version.create` and the version shown is not an earlier draft.
- **INV-REC-07 Approve** (gated `record_version.approve` from `draft`; hidden for a draft older than the
  current version).
  - `ConfirmDialog` "Approve vN of <title>?", "It becomes the current version[, and vM is replaced].
    Approving does not create a new version."
  - cmd `record_version.approve` `{}` (AC-INT-001-05).
- **INV-REC-08 Discard** (gated `record_version.discard` from `draft`, text variant).
  - `TextDialog` "Discard vN?", "The draft stays in the history, marked as discarded. Nothing else
    changes." (Reason, optional, max 1000).
  - cmd `record_version.discard` `{reason?}`.
- **INV-REC-09 Section tabs** (`nav` "Record sections"), which keep `?v`:
  - "Overview";
  - "Questions" or "Questions · N" (open questions of the origin thread, from `explorationQuery`);
  - "Checks · N" (hidden for a decision without checks);
  - "History".

  The current tab has `aria-current=page`. The scroll is kept.

#### Overview tab

- **INV-REC-10 Guided review banner** (a draft feature or tech decision that the person may approve and
  that is not an earlier draft).
  - A blue count "1" ("Needs you: this version waits for your review.").
  - "Review it: context, details and N checks" (or "context and details").
  - "5 short parts · about M minutes. Nothing is final until you confirm." (M = words / 200 + 1).
  - A **Start review** button.
- **INV-REC-11 Guided review bar** (sticky region "Review").
  - Part buttons 1-5 (jump to any; `aria-label` "Part n: <name>").
  - Label "Part i of 5 · <name>", the question and the hint.
  - Parts for a feature:
    1. Context: "Is this the right context?"
    2. What it's for: goal, scope, out of scope.
    3. How it works: behaviour.
    4. Checks: "Would these N checks prove it works?", counting automatic ones and ones that are "yours
       to try".
    5. What DEMIURGO assumed: "DEMIURGO assumed N answers. Are they right?", or quiet with "Nothing
       assumed".
  - For a tech decision, parts 2 and 3 are "Why it's needed" (Context, Options) and "What it decides"
    (Decision, Consequences). Unknown sections go with the part before them.
  - The part under review is outlined in blue and scrolled into view; the rest is dimmed.
  - Buttons: **Leave review** (focus returns to Start review), **Back**, **Change something**, **Looks
    right**.
  - **Change something** prefills the Ask bar with "In <part>: " and focuses it, and shows "Tell DEMIURGO
    what to change in <part>: it is written on the right. Or change it yourself: [New version]".
  - At the end: "All 5 parts reviewed / Confirm <title>? / It becomes the current version. It is Ready to
    build if nothing else blocks it.", with **Review again** and **Confirm**.
  - **Confirm** opens a `ConfirmDialog` "Confirm <title>?" (button "Approve"). cmd
    `record_version.approve`. The review then ends and the page scrolls to the top.
  - Keyboard: the focus stays on Looks right, then on Confirm (AC-WEB-001-03).
- **INV-REC-12 Ready banner** (ready and current). "<title> is ready to build", "Nothing is built yet.
  When it is, the next bar fills and each check shows when it passes." Links: **Back to the product**
  and **Next: <first Needs you item not on this record>** (from `overview/needs.ts`).
- **INV-REC-13 Next strip** (current, something waits elsewhere, no newer draft). "Approved. What needs
  you next: <link>".
- **INV-REC-14 Version notices.**
  - An earlier draft: the server reason, or "This draft is older than the current version (vN): it can
    only be discarded."
  - A superseded version: "This version was replaced. The current one is vN. See vN".
  - A discarded version: "This draft was discarded. It stays in the history."
  - A newer draft exists: "Version N is a draft waiting for you. See vN".
- **INV-REC-15 Feature design journey** (fdr only). Three steps (Done / To do):
  - Requirements: "N requirements, each with its check (below)." or "No requirements yet…";
  - Changes to the product baseline: which of the Quality, Security and Rollout sections exist;
  - Ready to build: "Every check is verifiable…" or "N things left: see the panel on the right."
- **INV-REC-16 Body.** The sections in order, each with its title and markdown content, grouped into the
  review's what and how areas.
- **INV-REC-17 Checks.**
  - "Checks · N". Each `CheckRow` shows: title, statement, "How: <check>", "Automatic" or "You" (with
    the tooltips "A test checks it on its own." / "You check it by hand once it is built."), the code,
    and the readiness verifiability warnings of that check (without the code prefix).
  - Empty: "This version has no checks yet." Hidden for a decision without checks.
- **INV-REC-18 Annexes.** "Annexes · N": a collapsible `<details>` per path, with the raw content in a
  scrollable `pre`.

#### Right column (Overview, Checks and History tabs; the Questions tab has its own)

- **INV-REC-19 Readiness** (not for decisions).
  - A stage track with its word and tooltip (Not ready / Ready to build / In doubt, the "ready · built ·
    verified" bars) and "N things left".
  - "Nothing blocks it. Nothing is built yet." when ready, or in rust "It was ready to build, and now
    something blocks it." when in doubt.
  - The design system's Readiness list: server reasons exactly as given (`data-kind=reason`) and warnings
    apart (`data-kind=warning`). The region is named "Before it can be built" or "Ready to build"
    (AC-INT-001-08).
- **INV-REC-20 "Assumed in its thread".** Each inferred question of the origin thread with its assumed
  mark, question text, "Assumed: …", and a **"Confirm it in the thread"** link to `/threads/:id`.
- **INV-REC-21 Context panel.**
  - An "Open in Origins" link.
  - "Where it comes from": a thread link (its purpose), "A proposal, accepted by <who>", "This version ·
    written by <who>, <when>", "Approved by <who> · <when>".
  - "What it changes": the change note, "It's the first version: …" or "This version has no change
    note."
  - "What it touches": outgoing links, each with:
    - a link-state mark (Current / Needs review / Kept / Changed / Out of date);
    - the type words (Based on, Design of, Covers, Comes from, Conflicts with, Derived from);
    - the target title as a link to `/records/:code?v=N`;
    - "CODE vN", plus "· replaced by a newer version" when so;
    - or "a version that is no longer shown".
    Empty: "It has no links to other records."
  - Incoming links (`data-incoming`): Needed by / Followed by / Conflicts with / Affected by, with the
    link state mark, the source title linking to it with `?v`, and "CODE vN · to vM" (AC-INT-002-08).
- **INV-REC-22 Versions panel.** Newest first; each with mark, vN, state word, "· current", WhoMark and
  date. Each links to `?v=N`; the one shown has `aria-current`.
- **INV-REC-23 "Ask DEMIURGO about this <type>"** (aside footer; shown only if the tables allow
  `message.post` and `exploration.open`).
  - A growing textarea (max 20,000), placeholder "Ask about this <type>, or suggest a change…". **Enter
    sends, Shift+Enter adds a new line.** A Send button ("Sending…" while pending).
  - On send:
    1. Fetch fresh explorations.
    2. Reuse the active thread with `origin_type=record_version` and an origin among this record's
       versions, otherwise run cmd `exploration.open` `{purpose:"About <title>", origin:{type:
       'record_version', id}}`.
    3. Run cmd `message.post` `{exploration_id, text, respond:true}`, which starts a DEMIURGO run.
  - Status line: "Sent to <thread> · DEMIURGO is answering…" (working), "DEMIURGO answered in <thread> ·
    Open the thread", or "DEMIURGO couldn't answer: <failure> · Open the thread". It is derived from
    `explorationQuery` and `runsQuery?exploration=`.
  - The text is kept on error, shown with `Reasons` (AC-INT-001-09).

#### Questions tab

`?tab=questions` (`blueprint/QuestionsTab.tsx`).

- **INV-REC-24 Content.**
  - The questions of the origin thread (`explorationQuery`).
  - Without a thread: "This version doesn't come from a thread, so it has no questions."
  - Loading skeleton; errors as `Reasons`.
- **INV-REC-25 Open questions** (pending first, then inferred, each by creation), as cards.
  - Mark, h2 question, "Why it matters: …", "Impact: High | Medium | Low".
  - An assumed question shows a "Recommended" box with the conclusion, "Why: …" and "DEMIURGO assumed
    it. Nothing is confirmed until you say so."
  - Actions (gated):
    - **"Confirm: <short answer…>"**: `ConfirmDialog` "Confirm this answer?". cmd `question.confirm`
      `{}`.
    - **Answer**: `TextDialog`, Conclusion required.
    - **Answer differently**: prefilled; submit "Confirm my answer".
    - **Not now**: `TextDialog` "Leave it for later", "It stays in the thread for later, and it still
      keeps the feature from being ready. Say why." (required). cmd `question.postpone`.
    - **Doesn't apply**: required reason. cmd `question.discard`.
  - A "Talk about it in the thread" link.
- **INV-REC-26 "If you confirm" aside.** It follows the selected card (click or focus). It shows:
  - "It becomes the confirmed answer in its thread": the conclusion, or "The answer you write";
  - "It affects: <impact> impact";
  - "Before it can be built": whether the readiness cites the question ("Yes. It waits…" or "Its
    readiness doesn't cite it.") with the reason;
  - "How we'll know it works": the check titles;
  - a Later note: "Becomes a decision and adds checks on its own (later increment). Today confirming
    only answers the question."
- **INV-REC-27 Settled groups** as `<details>`: "Answered · n", "Not now · n", "Doesn't apply · n".
  - Rows show the mark, the question, and "Answer: …" or "Reason: …".
  - Actions: **Doesn't apply** and **Reopen** (`TextDialog`, optional reason; cmd `question.reopen`).
- **INV-REC-28 Links and empty state.** An "Open the thread: <purpose>" link. Empty: "Nothing to answer
  here: no question of its thread is open."

#### Checks tab and History tab

- **INV-REC-29 Checks tab.** The same `Checks` list as INV-REC-17, for the version in `?v`.
- **INV-REC-30 History tab, "What happened".**
  - One `GET /events?entity=<versionId>` per version, merged newest first.
  - Each line: WhoMark with name, "Created vN" / "Approved vN" / "vN was replaced" / "Discarded vN" /
    "<command word> · vN", and the day and time.
  - Live through `onProjectEvent` for these version ids. Loading skeleton and error `Reasons`.
- **INV-REC-31 History tab, "Every version".** Mark, vN, state, "· current", an "Open vN" link, the
  change note or "The first version." or "No change note.", "Written by … · <when>" and "Approved by …
  · <when>".

#### Real-time

- The record key follows `record`, `record_version`, `criterion`, `link` and `proposal`.
- Readiness follows `record_version`, `link`, `question` and `proposal`.
- The state and inbox (the rail and next item) follow their events, and the origin thread follows
  `question`, `message`, `exploration` and `ai_run`.
- A readiness that changes live flips the stage bars and the reasons (AC-INT-001-08, rust).

#### States handled

Loading, 404, error, any version state, an earlier draft, discarded, superseded, a newer draft, ready, in
doubt, a decision (no readiness), no checks, no thread, no links, unresolved link targets, review
in progress, 409/422 in dialogs, an Ask failure.

#### Tests

- `test/e2e/record.spec.ts`:
  - AC-INT-001-05 (approve without a new version; an earlier draft offers only Discard);
  - AC-INT-001-08 twice (reasons exactly as given; Ready to build and the rust doubt);
  - AC-INT-001-04 (proposed until approved).
- `fidelity.spec.ts`:
  - AC-INT-001-09 (Ask about a feature);
  - AC-INT-001-05 (guided review);
  - AC-INT-001-09 (Change something);
  - AC-WEB-001-03 (review by keyboard).
- `test/e2e/blueprint.spec.ts`:
  - AC-INT-001-09 twice (Questions tab);
  - AC-INT-001-04 (rail);
  - AC-INT-001-08 (History and Checks tabs);
  - AC-WEB-001-03.
- `test/e2e/views.spec.ts`: AC-INT-002-08 (incoming).
- `test/e2e/product.spec.ts`: a record page screenshot.
- `new-record.spec.ts`: links shown in "What it touches" and incoming "Followed by".
- `test/unit/record-logic.test.ts`: AC-INT-001-08, -05, -06 and -04.
- `test/unit/fidelity-review.test.ts`: AC-INT-001-05.
- `test/unit/reasons.test.tsx`.
- Helpers in `test/e2e/record-setup.ts`.

#### UX problems

- **Button order.** Discard comes before Approve in the header (handlers order discard, approve,
  `record/Record.tsx:113-117`); the secondary action precedes the primary one.
- **Label mismatch in the review.** The bar button says "Confirm" (`Review.tsx:272-281`) but the dialog
  button says "Approve" (`Review.tsx:328`).
- **Dimmed parts fail contrast.** The review dims the other parts to 35% opacity (`Review.tsx:42`); the
  accessibility test has to exclude them (`test/e2e/fidelity.spec.ts:13-19`,
  `.exclude('[data-dimmed="true"]')`). The dimmed content stays interactive.
- **The "Approved." strip misleads.** It shows whenever a current version is viewed and anything else
  waits (`Record.tsx:200, 384`), even if the approval was long ago.
- **One banner at a time.** Review band, ready banner, next strip or version notice are exclusive
  (`Record.tsx:373-388`); a replaced version that also has a newer draft shows only one message.
- **A step that is always "Done".** "Changes to the product baseline" is hard-coded as Done
  (`FeatureJourney.tsx:31`).
- **Readiness reasons are verbatim server strings and cannot be acted on.**
  - The grammar comes through as is ("There are 1 pending proposal(s) affecting it.",
    `packages/domain/src/records.ts:169`).
  - The reasons are plain text with no link to the thing that resolves them (`RecordAside.tsx` via
    `ReadinessBox`).
- **Only features and tech decisions get the guided review** (`review.ts:23`). Decisions, bugs,
  requirements and the other types go straight to a bare "Approve".
- **Two lists of versions.** The header dropdown (`VersionPicker.tsx`) and the aside panel
  (`RecordAside.tsx:280-316`) show the same list.
- **"Open in Origins" is not scoped to this record** (`RecordAside.tsx:159-161`).
- **Question vocabulary differs between screens.** Needs you says Park, Drop and Change
  (`ui/QuestionItem.tsx:68-69, 101`). The Questions tab says "Not now", "Doesn't apply", "Answer
  differently" and "Leave it for later" (`blueprint/QuestionsTab.tsx:149-150, 61, 76`) for the same
  commands.
- **Possible mismatch with Needs you.** The Questions tab counts and shows every thread question,
  including those still in the reserve (`blueprint/questions.ts:18-26`, no `shown_at` filter), while the
  inbox hides them (`packages/core/src/queries/read.ts:196, 205`).
- **Dense checks.** Two-column check grids (`Checks.tsx:43`, `parts.tsx:144`) squeeze long Given/When/
  Then statements.
- **Ask sends on Enter.** It starts a paid agent run with no confirmation or preview (`ui/AskBar.tsx:124-
  129`).

---

### 5. New record: `/p/$projectId/records/new`

Search param: `type` (any of the 8 writable types; default `decision`). Files: `screens/new-record/*`,
reusing `new-version/CheckEditor.tsx`, `LinksEditor.tsx` and `Section`.

- **Purpose.** Write a record by hand (no DEMIURGO). It is saved as version 1, a draft.

#### Capabilities

- **INV-NEWREC-01 Entry.** "New record" links on the overview and the blueprint rail, gated
  `record.create` (`overview/Blueprint.tsx` `NewRecordLink`). A direct URL may set `?type=`.
- **INV-NEWREC-02 Header.** Breadcrumb "Product / New record"; h1 "New record"; "Write it yourself.
  DEMIURGO is not asked anything."
- **INV-NEWREC-03 Type choice.** "What it is" chips (`aria-pressed`) with icon and word: Decision,
  Feature, Tech decision, Bug, Requirement, Quality requirement, Threat model, Production readiness. Each
  has a one-line hint, e.g. the EARS form for a requirement or STRIDE for a threat model.
- **INV-NEWREC-04 Switching type.** The template sections are replaced
  (`packages/domain/src/records.ts` `RECORD_TEMPLATES`). Content is kept for sections with the same title
  in both templates.
- **INV-NEWREC-05 Title.** Max 200.
- **INV-NEWREC-06 Area (domain).**
  - Free text, max 40, with a datalist of the areas already used.
  - Hint "Lowercase letters and underscores. It names the code: «club» gives DEC-CLU-001."
  - Invalid input gets a suggestion ("like platform_core").
- **INV-NEWREC-07 Template sections.** Labelled markdown textareas (3 to 18 rows, growing), with a
  "Markdown" hint.
- **INV-NEWREC-08 Checks.** Shown for every type except decision, or once one is added.
  - "Checks · N". **Add a check** adds an editable card: "New check", **Remove**, Title (max 200),
    Statement (max 3000, "given…, when…, then…"), How it is checked (max 1000), and a Who checks it
    choice (Automatic / You).
  - When the statement field loses focus, the same verifiability check as the server runs: "It may be
    hard to verify. You can save it anyway." with the warnings (non-blocking).
- **INV-NEWREC-09 Links editor.**
  - "Links · N". Added links are listed with the type words, the target title, "CODE vN" and a Remove
    button (aria "Remove the link to CODE").
  - Adding a link:
    - Link type: Based on, Design of, Covers or Conflicts with.
    - Links to: "Choose a record…" among every record (its current version, or the latest if none is
      approved), sorted by code.
    - **Add link**, disabled until a target is chosen.
  - A duplicate (same type and target) is ignored.
  - Empty target list: "There is nothing else to link to yet."
- **INV-NEWREC-10 Aside "This new record".** "Version 1 is saved as a draft. Nothing is decided until
  you approve it."
- **INV-NEWREC-11 "To save it:" list.**
  - "Give it a title."
  - "Say which area it belongs to."
  - "The area can only have lowercase letters and underscores, like <suggestion>."
  - "Write the <X> section." (one per empty section)
  - "Add at least one check: a <type> needs them."
  - "Give the new check(s) a title, a statement and how it is checked."

  **Save draft** is disabled while anything is missing.
- **INV-NEWREC-12 Save draft.**
  - cmd `record.create` `{type, domain, title, sections[{title,content}], criteria[{carry:'new', title,
    statement, verification, check}], links[{type, target:{code, version}}]}`. The button reads
    "Saving…" meanwhile.
  - On success it navigates to `/records/<result.code>?v=<result.version>`.
  - On error it shows `Reasons` in the aside and keeps the form.
- **INV-NEWREC-13 Cancel** links to `/p/:id`, with no confirmation.
- **INV-NEWREC-14 Keyboard.** The form works by keyboard only (Tab order: title, area, sections).

#### Real-time

`stateQuery` (the area list and link targets) follows its events.

#### States handled

Validation (the missing list), pending save, errors (`Reasons`), no link targets.

#### Tests

- `test/e2e/new-record.spec.ts`, with no AC codes: a tech decision by hand, approved and in the Map; the
  keyboard-only form; links born with the version.
- `test/unit/new-record.test.ts` and `test/unit/links-editor.test.ts` (no AC codes).

#### UX problems

- **Switching type drops text.** Sections the new template does not share are dropped silently
  (`new-record/form.ts:47-54`).
- **Cancel discards everything without confirmation** (`NewRecord.tsx:103-105`).
- **The primary action looks secondary.** "Save draft" is styled secondary and sits in the right column,
  far from the end of the long form (`NewRecord.tsx:100`).
- **Wording lags the UI.** The capability text still says "decision, FDR, ADR or bug"
  (`design/data/capabilities.yaml:44`) while the UI offers 8 types.
- **Link targets are one long native select** of every record, with no search (`LinksEditor.tsx`).
- **No markdown preview.**

---

### 6. New version: `/p/$projectId/records/$code/new-version`

No search params. Files: `screens/new-version/*`.

- **Purpose.** Write the next version by hand. The change note is required, and every check of the base
  needs an explicit Keep, Change or Drop.

#### Capabilities

- **INV-NEWVER-01 Entry.** The record header "New version" link, and the review's "Change something ›
  New version".
- **INV-NEWVER-02 Load.**
  - `recordQuery`, plus `stateQuery` and `inboxQuery` for the link index.
  - 404: NotFound "the record CODE". Without a version that is not discarded: NotFound "a version of CODE
    to start from".
  - Loading skeleton; error `Reasons`.
- **INV-NEWVER-03 Base version.** The last version that is not discarded, frozen when the form mounts. The
  form is keyed by record id, so what is written survives live updates.
- **INV-NEWVER-04 Header.** Breadcrumb "Product / <base title> / New version"; eyebrow "<type> · CODE ·
  from vN"; h1 "New version of <title>"; "Say what changes, then choose what happens to each check."
- **INV-NEWVER-05 What changed.** Required, max 2000, `aria-required`, hint "Required. It tells whoever
  reads this version what it changes and why."
- **INV-NEWVER-06 Title and sections.** The title (prefilled, max 200) and the base's sections
  (prefilled markdown; titles fixed).
- **INV-NEWVER-07 Checks of the base.**
  - Each card shows "Check i", the code, the title, the statement and the verification mark.
  - A radiogroup "What to do with <title> (<code>)" with three options:
    - **Keep**: "It goes into the new version as it is."
    - **Change**: "You edit it here, under the same code." It opens the editor for title, statement
      (with the verifiability warning), how, and who.
    - **Drop**: "It leaves the new version and stays in the earlier ones." The card is struck through.
  - Undecided cards have a dashed border. Leaving Change restores the original text.
- **INV-NEWVER-08 Add a check.** Same as INV-NEWREC-08; `data-criterion="new-n"`, removable.
- **INV-NEWVER-09 Checks hint.** "A changed check keeps its code; a dropped one stays in earlier
  versions."
- **INV-NEWVER-10 Links.**
  - The base's links are carried as they are (known targets only; never an obsolete one) and listed
    read-only in the aside under "Links, carried as they are".
  - A rust note appears when some point to a version no longer shown: "N links point to a version that
    is no longer shown: they are not carried."
  - The links editor adds new ones (this record excluded). An added link of the same type and record
    replaces the carried one.
- **INV-NEWVER-11 Aside "This new version".** "vN+1 draft, from vM. Nothing changes until you approve
  it." Counts Kept / Changed / Dropped / New, or "No check has a choice yet."
- **INV-NEWVER-12 "To save it:" list.**
  - "Say what changed."
  - "Give the version a title."
  - "Write the <X> section."
  - "Choose Keep, Change or Drop for N checks."
  - "Give <code> a title, a statement and how it is checked."
  - "Give the new check(s) …"

  Save waits for the link index to load.
- **INV-NEWVER-13 Save draft.**
  - cmd `record_version.create` `{record_id, title, sections, change_note, criteria:[{carry:'kept',
    code} | {carry:'modified', derived_from, title, statement, verification, check} | {carry:'new', …}],
    discarded:[codes], links}`.
  - On success it navigates to `/records/:code?v=<result.version>`.
  - On error (e.g. a 409 because another version added a check) it shows `Reasons` naming the missing
    check, and the note and choices are kept (AC-INT-001-06).
- **INV-NEWVER-14 Cancel** links back to the record, with no confirmation.

#### Real-time

The record, state and inbox refresh, but the form keeps the frozen base and the person's input.

#### States handled

Loading, 404, no base, validation, pending save, a server 409/422, unknown link targets.

#### Tests

- `test/e2e/new-version.spec.ts`:
  - AC-INT-001-06 (a note and a choice per check; the saved version reflects each choice);
  - AC-INT-001-07 (a vague check warns on blur and saves anyway);
  - AC-INT-001-06 (a rejected save keeps the text);
  - screens of cut 4.
- `new-record.spec.ts`: a new version that adds a Conflicts with link.
- `test/unit/record-new-version.test.ts`: AC-INT-001-06 and -07.
- `test/unit/links-editor.test.ts`.

#### UX problems

- **A carried link cannot be removed** from the new version: the aside is read-only and the editor only
  handles added links (`NewVersion.tsx:167-191, 307`).
- **Choosing Keep or Drop after Change silently throws away the edits** (`NewVersion.tsx:110-114`).
- **The server's warnings are dropped.** The warnings returned by `record_version.create` are ignored;
  the page navigates away (`NewVersion.tsx:135-141`).
- **Cancel loses the note and every choice without confirmation** (`NewVersion.tsx:209-211`).
- **The primary action looks secondary.** "Save draft" is secondary and in the aside
  (`NewVersion.tsx:206`), far from the check cards the person just decided.
- **Sections are fixed.** Their titles cannot be added, removed or renamed; only the base's template
  sections can be edited.

---

### Domain model notes

#### Needs (`screens/needs-you/order.ts`, `frame.tsx`)

| Kind | Source (`GET /inbox`) | Group | Word (eyebrow) | Minutes | Catch up rank |
| --- | --- | --- | --- | --- | --- |
| conflict | each proposal of `batches[type='knowledge']` | Conflicts | Conflict | 2 | 1 if the reviewed record's current version is the one reviewed, else 3 |
| question | `questions_to_confirm` (inferred) + `open_questions` (pending, postponed), shown only | Questions | Question | 1 | 2 if it unblocks something, else 6 |
| package | non-knowledge batch with `resolution='package'` (one row) | Proposals | Package | 3 | 3 |
| proposal | each proposal of a non-knowledge `resolution='item'` batch (no `exploration` proposals) | Proposals | Proposal | 1 | 3 |
| version | `versions_to_approve` (every draft; `approvable = current===null or current<n`) | Versions to approve | Version to approve | 2 | 4 |
| link | `links_under_review` (state `needs_review`) | Links to review | Link to review | 1 | 5 |
| classification | `classifications_to_review` (`pending_review`) | Classifications to review | Classification | 1 | 5 |
| update | `rejected_updates` | Knowledge updates that failed | Knowledge update | 1 | 6 |

- `Inbox.total` = the pending proposals of pending batches (each proposal counted) + the inferred,
  pending and postponed questions already shown + draft versions + links under review + knowledge extras.
- Inbox proposals add `obsolescence: string[]` (reasons their dependencies changed), `assessment` (the
  idea check), `dependencies` and `epistemic_status`.
- The overview has a parallel ordering (`screens/overview/needs.ts`). Its kinds add `assumed`, and right
  after ratifying ("just ratified": records exist, none approved, versions waiting) versions go first.

#### Batch (`BatchDetail`)

- Fields: `id`, `kind`, `producer`, `run_id`, `context_pack_id`, `resolution_mode`, `dependencies`,
  `summary`, `tree_hash`, `state`, `created_at`, `resolved_at`, `resolved_by`, `proposals[]` and
  `import_counts` (`{origin, package}`, only for imports).
- `kind`: `agent` | `system_package` | `knowledge` | `import`.
- `resolution_mode`: `item` | `package`.
- `state` and its UI word: pending "Pending" · accepted "Accepted" · rejected "Rejected" · resolved
  "Resolved" (done) · superseded "Out of date" (stale). The tables label superseded "Obsolete".
- Commands:
  - `batch.submit` (agents and system), `design.import` (human or system): new → pending;
  - `batch.accept_package` (human, decisive; `{approve?}`; guards `package_resolution` and
    `current_dependencies`);
  - `batch.reject_package` (human; `{reason?}`);
  - `batch.close` and `batch.supersede` (system).
- `ImportCounts` keys: decision, adr, fdr, bug, versions, criteria, links, taxonomies, annexes.
- Producer actor strings: `agent:<name>:<session>`, `agent:run:<runId>`, `system:<component>@<version>`,
  `human:<person>`.

#### Proposal

- Fields: `id`, `batch_id`, `position`, `type`, `payload`, `dependencies[{type:'record', id, code,
  version}]`, `state`, `resolution`, `resolved_by`, `resolved_at`, `created_at`, `epistemic_status`.
- `resolution` holds `{reason?, obsolete?, effect?:{type:'record', code, version, approved?, state?}}`.
- Types and payloads (`packages/domain/src/proposals.ts`):

  | Type | Payload |
  | --- | --- |
  | `decision` | `title`≤200, `context`≤5000, `decision`≤5000, `consequences`≤5000, `domain?` |
  | `fdr` | `title`, `goal`, `scope`, `out_of_scope`≤5000, `behavior`≤10000, `criteria[1..12]{title≤160, statement≤1500, verification automatic\|manual, check≤600}`, `based_on?{code, version}`, `domain?` |
  | `design_record` | `record_type` (fdr, requirement, quality_requirement, threat_model, production_readiness, adr), `title`, `sections[1..8]`, `criteria[1..12]`, `domain?` |
  | `exploration` | `purpose`≤1000 |
  | `review` (knowledge only) | `record{code, version}`, `verdict` (invalidate, update, add, other), `reason`≤2000, `change{type, id, version}`, `confidence` 0..1 |
  | `imported_record`, `imported_taxonomy` | `{document, path}` |

- States: pending "Proposed" · accepted "Accepted" · accepted_edited "Accepted with edits" · rejected
  "Rejected" · superseded "Out of date" (tables: "Obsolete").
- Commands:
  - `proposal.accept` (decisive, `{approve?}`);
  - `proposal.accept_edited` (decisive, `{edit}`);
  - `proposal.reject` (`{reason?}`);
  - `proposal.create` and `proposal.supersede` (not human).
- Types that can be approved in the same gesture: decision, fdr, design_record.
- Editable fields for Change: decision (title, context, decision, consequences); fdr (title, goal, scope,
  out_of_scope, behavior); exploration (purpose).
- Idea check verdicts: `duplicates` "Duplicates", `conflicts` "Contradicts", `inconsistent` "Doesn't fit
  with", `relates` "Relates to", `none` (hidden). `types.ts` comments list duplicates, contradicts and
  relates: a naming drift.

#### Record and record type

- `RecordDetail`: `id`, `code`, `type`, `domain`, `current` (the approved n or null), `implementation`,
  `versions[]`, `incoming[]`.
- Code: `<PREFIX>-<DOM>-NNN`, with DOM the first 3 letters of the area in upper case.

| Type | Prefix | UI word | Template sections | Criteria required |
| --- | --- | --- | --- | --- |
| `decision` | DEC | Decision | Context, Decision, Consequences | no |
| `fdr` | FDR | Feature | Goal, Scope, Out of scope, Behavior | yes |
| `adr` | ADR | Tech decision | Context, Options, Decision, Consequences | yes |
| `bug` | BUG | Bug | Reproduction, Expected, Observed | yes |
| `requirement` | REQ | Requirement | Statement, Rationale, Fit criterion | yes |
| `quality_requirement` | NFR | Quality requirement | Quality attribute, Scenario, Measure | yes |
| `threat_model` | THR | Threat model | Assets, Actors and trust boundaries, Threats, Mitigations | yes |
| `production_readiness` | PRR | Production readiness | Rollout and rollback, Monitoring, Failure modes, Scalability, Support | yes |

- `ProductRow` (from `/state`, split into `decisions` and `designs`): `code`, `type`, `domain`, `title`,
  `current`, `latest{n,state}`, `epistemic_status`, `readiness`, `implementation`, `summary`, `checks`,
  `latest_id`, `current_id`, `updated_at`, `updated_by`, `origin_exploration`.
- Area regex `^[a-z][a-z_]*$`. Limits (`VERSION_LIMITS`):

  | Field | Limit |
  | --- | --- |
  | title | 200 |
  | section title | 120 |
  | section | 50,000 |
  | sections | 40 |
  | criteria | 60 |
  | links | 40 |
  | changeNote | 2000 |
  | criterionTitle | 200 |
  | statement | 3000 |
  | check | 1000 |

#### Record version

- Fields: `id`, `n`, `state`, `epistemic_status`, `current`, `title`, `sections[{title,content}]`,
  `annexes[{path,content}]`, `change_note`, `origin{type,id,version?}`, `author`, `approved_by`,
  `created_at`, `approved_at`, `origin_exploration`, `inferred_questions[{id,question,conclusion}]`,
  `criteria[]`, `links[]`, `readiness`.
- States: draft "Draft" (proposed) · approved "Approved" (confirmed) · superseded "Replaced" · discarded
  "Discarded" (dropped).
- Commands:
  - `record.create` (human; version 1 as a draft; result `{code, version}`);
  - `record_version.create` (human; guard `criteria_carry_complete`; result `{versionId, version,
    warnings}`);
  - `record_version.approve` (human, decisive; guard `without_later_approved`);
  - `record_version.discard` (human; `{reason?}`);
  - `record_version.supersede` (system).
- Rules:
  - An "earlier draft" is a draft with n below the current version; it can only be discarded.
  - The base of a new version is the last version that is not discarded.
  - The version shown by default is the current one, otherwise the latest.

#### Checks (acceptance criteria)

- `Criterion`: `id`, `code` (`AC-<DOM>-NNN-NN`), `title`, `statement`, `verification`, `check`, `carry`.
  - `verification`: `automatic` (UI "Automatic") | `manual` (UI "You").
  - `carry`: `new` | `kept` | `modified`.
- Carry-over in `record_version.create`: `{carry:'kept', code}`, `{carry:'modified', derived_from, …}`,
  `{carry:'new', …}`, plus `discarded:[codes]`.
- Verifiability (`verifiabilityWarnings`) only warns and never blocks:
  - "<code>: the statement doesn't describe an observable result (Given…, when…, then…)."
  - "<code>: "<word>" is vague; state a measure or a checkable result."

#### Links and relations

- `Link`: `id`, `type`, `from_*` and `to_*` (type, id, version), `state`, `created_by`, `created_at`, and
  the resolved `to_code`, `to_n`, `to_title`, `to_state` and `to_current`.
- Types and words: based_on "Based on", design_of "Design of", covers "Covers", origin "Comes from",
  conflicts_with "Conflicts with", derived_from "Derived from". A person can set only based_on,
  design_of, covers and conflicts_with.
- States: current "Current" · needs_review "Needs review" (problem) · kept "Kept" · changed "Changed" ·
  obsolete "Out of date" (stale). The tables label these "Pending review" and "Obsolete".
- Commands: `link.create` (human, only inside a new version), `link.flag_review` (system), and `link.keep`,
  `link.change`, `link.obsolete` (human, not decisive).
- Incoming: `IncomingLink{id, type, state, from_code, from_type, from_n, from_title, to_n, relation}`.

  | Relation | Seen from the source | Seen from the target |
  | --- | --- | --- |
  | needs | Needs | Needed by |
  | follows | Rules it follows | Followed by |
  | conflicts | Conflicts with | Conflicts with |
  | affects | Affects | Affected by |
  | null (origin, covers) | not shown | not shown |

#### Questions

- States: pending "Open" · inferred "Assumed" · confirmed "Confirmed" · postponed "Parked" · discarded
  "Dropped".
- Commands:

  | Command | From | Data | Notes |
  | --- | --- | --- | --- |
  | `question.confirm` | pending, inferred | `{conclusion?}` | decisive |
  | `question.postpone` | pending, inferred | `{reason}` | required |
  | `question.discard` | pending, inferred, postponed | `{reason}` | required |
  | `question.reopen` | confirmed, postponed, discarded | `{reason?}` | |

- Impact: high, medium, low. Questions in the reserve (`shown_at` null) are not in the inbox.

#### Readiness

- `{ready, reasons[], warnings[]}` from `GET /versions/:id/readiness`, or inline on the version and the
  row. There is none for decisions.
- Reason strings, exact (`packages/domain/src/records.ts`):
  - "Version N is superseded: the current one is M."
  - "Version N is a draft earlier than the current one (vM): it can only be discarded."
  - "Version N is not approved."
  - "It's not the current version: the current one is M."
  - "It has no acceptance criteria."
  - "Criterion X doesn't say how it's checked."
  - For fdr and adr: "It is not based on any decision.", "The decision it is based on, CODE, is not
    approved.", "It is based on CODE vN, but the current one is vM." and "The link with CODE is pending
    review."
  - "The link with <ref> is pending review."
  - "A question of its thread is open: “…”", "A question of its thread was left for later: “…”",
    "DEMIURGO assumed an answer you have not confirmed: “…”"
  - "There are N pending proposal(s) affecting it."
- Stage of the first bar:
  - `ready` when `ready` is true;
  - `doubt` (rust) when an approved current version stops being ready;
  - otherwise `not-ready`.

  Built and verified are shown as still to come (H1).

#### Other entities

- **Classification**: `{id, node_ref ('CODE@n'), axis, category, confidence 0..1, justification,
  classifier}`. States applied, pending_review "Needs review", resolved. Resolved by
  `classification.resolve {category}`, among the categories of the approved taxonomy's axis.
- **Knowledge update**: `{id, trigger{type,id,version}, failure, created_at}`. States
  queued/classifying/verifying "Updating", applied "Applied", rejected "Failed".
  `knowledge_update.retry` (human).
- **Epistemic status** (API to mark): confirmed → Confirmed, proposed → Proposed, pending → Open,
  unknown → Unknown.
  - version: approved → confirmed, draft → proposed.
  - question: confirmed → confirmed, inferred → proposed, pending or postponed → pending.
  - proposal: accepted or accepted_edited → confirmed, pending → proposed.

---

### Product vocabulary (verbatim, this area)

**Needs you and Catch up**

- **Needs you**: everything that waits for the person. The blue count is "Needs you: N things wait for
  you."
- **Catch up / Catching up**: one thing at a time, in the defined order. Controls: **Skip**, **Leave**.
  "Stop whenever you like." "What you skip stays in Needs you, in the same order."
- **In this order / In order**: the Catch up order. "What unblocks the most comes first."
- **Unblocks / What it unblocks**: the records whose readiness waits on this thing.
- **You're up to date**: nothing waits. "Nothing needs you. You can close DEMIURGO." "Everything is
  saved."
- **Conflict**: a knowledge review of a record. "may need an update / may no longer hold / may need
  something added / may be affected". Actions: **Open a review** (accept) and **Keep it as it is**
  (reject). "DEMIURGO recommends … It won't choose for you."

**Proposals and packages**

- **Proposal**: suggested and waiting for you (mark "Proposed").
- **Batch**: resolved one proposal at a time. **Package**: "accepted or rejected whole". **Package from
  DEMIURGO**. **Imported from design/**.
- **Accept / Accept as draft**: records it as a draft. **Accept and approve**: "Two things happen".
  **Change** → **Your version** / **Accept my version**. **Reject** (with an optional reason).
- **Accept package / Reject package**. **Ratify**: the import becomes DEMIURGO's ("DEMIURGO is now the
  home of your design… design/ is an export"). **Ratified**.
- **Out of date**: "What it was based on changed: it can no longer be accepted." "Nothing is lost: it
  stays here as it came." "It can't be accepted as it is": the warning before it goes out of date.
- **Starts from / Based on**: dependencies.
- **Checked against what DEMIURGO knows**: the idea check. Findings: Duplicates, Contradicts, Doesn't
  fit with, Relates to.
- **Who proposes**: You / DEMIURGO / Agent · name / Automatic / DEMIURGO's knowledge. "It only proposes:
  nothing changes until you accept."

**Records and versions**

- **Record** types: Decision, Feature, Tech decision, Bug, Requirement, Quality requirement, Threat
  model, Production readiness.
- **Version** states: Draft, Approved, Replaced, Discarded; **current**.
- **Approve**: "It becomes the current version. Approving doesn't create a new version." **Discard**:
  "The draft stays in the history". **New version**.
- **Ready to build / Not ready / In doubt**: the first of the "ready · built · verified" bars. "Before
  it can be built" lists the reasons. "N things left." "Nothing blocks it. Nothing is built yet."
- **Review it / Start review / Looks right / Change something / Leave review / Review again /
  Confirm**: the guided review in 5 parts (Context, What it's for or Why it's needed, How it works or
  What it decides, Checks, What DEMIURGO assumed). "Nothing is final until you confirm."
- **Checks**: acceptance criteria. "What must be true", "How it is checked" and "Who checks it"
  (Automatic / You). "It may be hard to verify. You can save it anyway."
- **Keep / Change / Drop**: what happens to each check in a new version. **What changed**: the change
  note. **Links, carried as they are**.
- **Context panel**: "Where it comes from", "What it changes", "What it touches". Incoming: "Needed by",
  "Followed by", "Conflicts with", "Affected by".
- **Assumed / Assumed in its thread**: DEMIURGO concluded it, not yet confirmed. "Confirm it in the
  thread." **Recommended** (the Questions tab).
- **Link verdicts**: Keep ("It still holds."), Mark as changed ("It holds, with changes."), Out of date
  ("It no longer holds.").

**Questions**

- Actions: **Answer / Confirm / Change / Park / Drop / Reopen** (Needs you). The Questions tab says
  **Not now / Doesn't apply / Answer differently / Leave it for later** for the same commands.
- **Talk about it in the thread**, **If you confirm**, **How we'll know it works**.
- **Ask DEMIURGO about this <type>**: "Sent to … · DEMIURGO is answering…", "DEMIURGO answered in …",
  "DEMIURGO couldn't answer: …", "Open the thread".

**Other**

- **Later**: a placeholder for the vision beyond H1, e.g. "Rules for the whole product".
- **Resolve**: a classification. **Retry**: a failed knowledge update.
- **Not now**: the cancel button of every dialog. **Working…**: the pending label.

## 4. Parity status

Checked against the rebuilt frontend at the end of the run. The notes say where each capability
lives now, or why it is partial or missing.

**594 items: 584 DONE · 10 PARTIAL · 0 MISSING.**

| ID | Status | Note |
| --- | --- | --- |
| INV-ACT-01 | DONE | Header line with the counts, or the explanation when there are no runs (activity/summary.ts) |
| INV-ACT-02 | DONE | Usage panel "Usage · All time", with totals, a per-part table, loading and inline error with Retry |
| INV-ACT-03 | DONE | SegmentedLinks "Filter by state": All plus 6 states, visible counts, ?state=, aria-current |
| INV-ACT-04 | DONE | Table with State, Run, Thread, Requested by, When, Duration; data-run-row |
| INV-ACT-05 | DONE | Run cell: action link, agent · model, "Attempt n" linking to the original, failure words |
| INV-ACT-06 | DONE | Thread purpose link, or "—" |
| INV-ACT-07 | DONE | Who: You / Agent · name / Automatic |
| INV-ACT-08 | DONE | DayTime, and a duration that ticks while the run is active |
| INV-ACT-09 | DONE | Empty states with or without a filter, with a way on |
| INV-ACT-10 | DONE | RowsSkeleton "Loading the runs" |
| INV-ACT-11 | DONE | Sidebar Activity and the run page breadcrumb |
| INV-AUTH-01 | DONE | Unchanged: session guard in the router, 401 in AppRoot, Sign out in PersonMenu and WorkspaceFrame |
| INV-AUTH-02 | DONE | Unchanged: session guard in the router, 401 in AppRoot, Sign out in PersonMenu and WorkspaceFrame |
| INV-AUTH-03 | DONE | Unchanged: session guard in the router, 401 in AppRoot, Sign out in PersonMenu and WorkspaceFrame |
| INV-AUTH-04 | DONE | Unchanged: session guard in the router, 401 in AppRoot, Sign out in PersonMenu and WorkspaceFrame |
| INV-AUTH-05 | DONE | SignIn: autofocus, autocomplete, Signing in…, 401 alert that keeps the user and clears the password, ErrorNotice, safeNext |
| INV-AUTH-06 | DONE | Changed: missing fields are explained under the field and focused instead of a silently disabled button |
| INV-AUTH-07 | DONE | SignIn: autofocus, autocomplete, Signing in…, 401 alert that keeps the user and clears the password, ErrorNotice, safeNext |
| INV-AUTH-08 | DONE | SignIn: autofocus, autocomplete, Signing in…, 401 alert that keeps the user and clears the password, ErrorNotice, safeNext |
| INV-AUTH-09 | DONE | SignIn: autofocus, autocomplete, Signing in…, 401 alert that keeps the user and clears the password, ErrorNotice, safeNext |
| INV-AUTH-10 | DONE | SignIn: autofocus, autocomplete, Signing in…, 401 alert that keeps the user and clears the password, ErrorNotice, safeNext |
| INV-BATCH-01 | DONE | Batch pages: breadcrumbs from the origin, not-found, error with Retry, skeleton |
| INV-BATCH-02 | DONE | Batch pages: breadcrumbs from the origin, not-found, error with Retry, skeleton |
| INV-BATCH-03 | DONE | Batch pages: breadcrumbs from the origin, not-found, error with Retry, skeleton |
| INV-BATCH-04 | DONE | Batch pages: breadcrumbs from the origin, not-found, error with Retry, skeleton |
| INV-BATCH-05 | DONE | Batch pages: breadcrumbs from the origin, not-found, error with Retry, skeleton |
| INV-BATCH-06 | DONE | Batch pages: breadcrumbs from the origin, not-found, error with Retry, skeleton |
| INV-BATCH-07 | DONE | Changed: after a decision the page jumps to the next pending proposal |
| INV-BATCH-08 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BATCH-09 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BATCH-10 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BATCH-11 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BATCH-12 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BATCH-13 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BATCH-14 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BATCH-15 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BATCH-16 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BATCH-17 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BATCH-18 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BATCH-19 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BATCH-20 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BATCH-21 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BATCH-22 | DONE | Package decision at the top and in a sticky footer; import counts with a Compared column; "Ratify N documents?" |
| INV-BP-01 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-02 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-03 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-04 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-05 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-06 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-07 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-08 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-09 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-10 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-11 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-12 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-13 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-14 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-15 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-16 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-17 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-18 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-19 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-20 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-21 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-22 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-23 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-24 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-25 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-26 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-27 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-28 | DONE | Records navigator with every type and an error state; record tabs keep ?v; Questions tab with the shared vocabulary |
| INV-BP-29 | DONE | Search lives in the command menu (Ctrl K) and uses blueprint/search.ts |
| INV-BP-30 | DONE | Search lives in the command menu (Ctrl K) and uses blueprint/search.ts |
| INV-BP-31 | DONE | Search lives in the command menu (Ctrl K) and uses blueprint/search.ts |
| INV-BP-32 | DONE | Search lives in the command menu (Ctrl K) and uses blueprint/search.ts |
| INV-BP-33 | DONE | Search lives in the command menu (Ctrl K) and uses blueprint/search.ts |
| INV-CATCH-01 | DONE | Catch up walk in words, region next to the item, persisted in sessionStorage, focus moves on, finished view |
| INV-CATCH-02 | DONE | Catch up walk in words, region next to the item, persisted in sessionStorage, focus moves on, finished view |
| INV-CATCH-03 | DONE | Catch up walk in words, region next to the item, persisted in sessionStorage, focus moves on, finished view |
| INV-CATCH-04 | DONE | Catch up walk in words, region next to the item, persisted in sessionStorage, focus moves on, finished view |
| INV-CATCH-05 | DONE | Catch up walk in words, region next to the item, persisted in sessionStorage, focus moves on, finished view |
| INV-CATCH-06 | DONE | Catch up walk in words, region next to the item, persisted in sessionStorage, focus moves on, finished view |
| INV-CATCH-07 | DONE | Catch up walk in words, region next to the item, persisted in sessionStorage, focus moves on, finished view |
| INV-CATCH-08 | DONE | Catch up walk in words, region next to the item, persisted in sessionStorage, focus moves on, finished view |
| INV-CATCH-09 | DONE | Catch up walk in words, region next to the item, persisted in sessionStorage, focus moves on, finished view |
| INV-CATCH-10 | DONE | Catch up walk in words, region next to the item, persisted in sessionStorage, focus moves on, finished view |
| INV-CATCH-11 | DONE | Catch up walk in words, region next to the item, persisted in sessionStorage, focus moves on, finished view |
| INV-CATCH-12 | DONE | Catch up walk in words, region next to the item, persisted in sessionStorage, focus moves on, finished view |
| INV-CATCH-13 | DONE | Catch up walk in words, region next to the item, persisted in sessionStorage, focus moves on, finished view |
| INV-CATCH-14 | DONE | Catch up walk in words, region next to the item, persisted in sessionStorage, focus moves on, finished view |
| INV-DEEP-01 | DONE | Deeper.tsx with the kit ResizablePanel, a sheet under 1024 px, Esc and focus return |
| INV-DEEP-02 | DONE | Deeper.tsx with the kit ResizablePanel, a sheet under 1024 px, Esc and focus return |
| INV-DEEP-03 | DONE | Deeper.tsx with the kit ResizablePanel, a sheet under 1024 px, Esc and focus return |
| INV-DEEP-04 | DONE | Deeper.tsx with the kit ResizablePanel, a sheet under 1024 px, Esc and focus return |
| INV-DEEP-05 | DONE | Deeper.tsx with the kit ResizablePanel, a sheet under 1024 px, Esc and focus return |
| INV-DEEP-06 | DONE | Deeper.tsx with the kit ResizablePanel, a sheet under 1024 px, Esc and focus return |
| INV-DEEP-07 | DONE | Deeper.tsx with the kit ResizablePanel, a sheet under 1024 px, Esc and focus return |
| INV-DEEP-08 | DONE | Deeper.tsx with the kit ResizablePanel, a sheet under 1024 px, Esc and focus return |
| INV-DEEP-09 | DONE | Deeper.tsx with the kit ResizablePanel, a sheet under 1024 px, Esc and focus return |
| INV-DEEP-10 | DONE | Deeper.tsx with the kit ResizablePanel, a sheet under 1024 px, Esc and focus return |
| INV-DEEP-11 | DONE | Deeper.tsx with the kit ResizablePanel, a sheet under 1024 px, Esc and focus return |
| INV-DEEP-12 | DONE | Deeper.tsx with the kit ResizablePanel, a sheet under 1024 px, Esc and focus return |
| INV-DEEP-13 | DONE | Changed: stays open with a notice when its question is settled elsewhere |
| INV-DEEP-14 | DONE | Deeper.tsx |
| INV-DEV-01 | DONE | Only with dev_tools in the session |
| INV-DEV-02 | DONE | The floating "Dev" tab moved to a sidebar footer button (no overlap with content) |
| INV-DEV-03 | DONE | "Snapshots…" in the person menu (in and outside a project) |
| INV-DEV-04 | DONE | Same dialog text with the database name |
| INV-DEV-05 | DONE | Label (max 60) + Save snapshot; reloads after the API restarts |
| INV-DEV-06 | DONE | List with label, day time, summary and size; loading, empty and error states |
| INV-DEV-07 | DONE | Restore asks with the app's ConfirmDialog (was window.confirm), forgets visits, goes to / |
| INV-DEV-08 | DONE | Delete asks with ConfirmDialog, then refreshes the list |
| INV-DEV-09 | DONE | Reset asks with ConfirmDialog, forgets visits, goes to / |
| INV-DEV-10 | DONE | Busy state "Restarting the API…" / "Deleting…"; the dialog can't close while busy |
| INV-DEV-11 | DONE | ErrorNotice for the list and the action |
| INV-FORK-01 | DONE | Messages.tsx and Aside.tsx; a resolved suggestion links to its thread |
| INV-FORK-02 | DONE | Messages.tsx and Aside.tsx; a resolved suggestion links to its thread |
| INV-FORK-03 | DONE | Messages.tsx and Aside.tsx; a resolved suggestion links to its thread |
| INV-FORK-04 | DONE | Messages.tsx and Aside.tsx; a resolved suggestion links to its thread |
| INV-FORK-05 | DONE | Messages.tsx and Aside.tsx; a resolved suggestion links to its thread |
| INV-FORK-06 | DONE | Messages.tsx and Aside.tsx; a resolved suggestion links to its thread |
| INV-FORK-07 | DONE | Messages.tsx and Aside.tsx; a resolved suggestion links to its thread |
| INV-FORK-08 | DONE | Messages.tsx and Aside.tsx; a resolved suggestion links to its thread |
| INV-JRN-01 | DONE | ?j replaces history; the first journey shows by default |
| INV-JRN-02 | DONE | Changed: an APG single-select listbox; each option says what waits on you |
| INV-JRN-03 | DONE | Journey title (h2), certainty, link to "CODE vN" |
| INV-JRN-04 | DONE | Step cards; "Show all n details" instead of a dead "+n more" |
| INV-JRN-05 | DONE | Paths If / When / → outcome, no longer clamped |
| INV-JRN-06 | DONE | Gaps "Not defined yet", with Answer links |
| INV-JRN-07 | DONE | Summary (data-journey-summary) and "Answer N questions" |
| INV-JRN-08 | DONE | Skeleton, error with Retry, empty state |
| INV-KEYS-01 | DONE | Sidebar Settings → Agent keys |
| INV-KEYS-02 | DONE | Title and subtitle; eyebrow "Settings" |
| INV-KEYS-03 | DONE | PromptDialog "New agent key", same texts, max 40 |
| INV-KEYS-04 | DONE | Issued panel, role=status, data-issued-key |
| INV-KEYS-05 | DONE | Secret with Copy that says "Copied" or explains a failure |
| INV-KEYS-06 | DONE | The MCP line verbatim, with its own Copy |
| INV-KEYS-07 | DONE | "I have saved it" hides the secret and moves the focus to the key's row |
| INV-KEYS-08 | DONE | Key list with the Active/Revoked badge, data-agent-key, data-key-state |
| INV-KEYS-09 | DONE | Revoke with a danger ConfirmDialog; the error resets |
| INV-KEYS-10 | DONE | Skeleton; error with Retry and no empty state under it; empty state |
| INV-KEYS-11 | DONE | Live refresh through the stream (tokens) |
| INV-KNOW-01 | DONE | Changed: APG tabs in ?tab=; switching replaces history |
| INV-KNOW-02 | DONE | Freshness badge in words, then "Graph vN · nodes · relations" |
| INV-KNOW-03 | DONE | The sidebar Knowledge signal (shell) |
| INV-KNOW-04 | DONE | Latest updates in the side column: 8, every failed one, "Show all" |
| INV-KNOW-05 | DONE | Failed update: the failure text, Retry, an error notice, announced |
| INV-KNOW-06 | DONE | Grouping line, or "Open the taxonomy" |
| INV-KNOW-07 | DONE | Type filter as a Segmented radiogroup |
| INV-KNOW-08 | DONE | Area regions with count and description |
| INV-KNOW-09 | DONE | Changed: the title links to the record; a Preview button replaces the peek |
| INV-KNOW-10 | DONE | Preview sheet with relations grouped, rows as links, "Show all n", "Open CODE" |
| INV-KNOW-11 | DONE | Skeleton, error with Retry, empty state |
| INV-KNOW-12 | DONE | Search form (role=search), on submit |
| INV-KNOW-13 | DONE | Idle, searching, error, "Nothing matches" with "Clear the search", count announced |
| INV-KNOW-14 | DONE | Result cards; one without a page says so |
| INV-KNOW-15 | DONE | Intro, one article per idea check |
| INV-KNOW-16 | DONE | Conflict badge, idea type and state, title, "Checked against graph vN", "Open its batch" |
| INV-KNOW-17 | DONE | Findings: verdict word, citation link, certainty, % sure, justification |
| INV-KNOW-18 | DONE | Skeleton, error with Retry, empty state |
| INV-KNOW-19 | DONE | Intro and "Propose a new version" / "Propose a taxonomy" |
| INV-KNOW-20 | DONE | Setup card (data-taxonomy-setup): template or blank |
| INV-KNOW-21 | DONE | Current, Proposed, "Replaced · N" (collapsed) |
| INV-KNOW-22 | DONE | Taxonomy card: axes, Proposed by / Approved by, "Its text" |
| INV-KNOW-23 | DONE | Approve with the same confirmation texts |
| INV-KNOW-24 | DONE | Editor: lists every gap, asks before removing an axis, column headers |
| INV-KNOW-25 | DONE | Skeleton, error with Retry |
| INV-KNOW-26 | DONE | Rebuild card: fingerprints, "They match" / "They don't match" with the drift |
| INV-LENS-01 | DONE | What changed: lines and codes as links, "Changed" badge with no dimming, live from the stream, own actions left out |
| INV-LENS-02 | DONE | What changed: lines and codes as links, "Changed" badge with no dimming, live from the stream, own actions left out |
| INV-LENS-03 | DONE | What changed: lines and codes as links, "Changed" badge with no dimming, live from the stream, own actions left out |
| INV-LENS-04 | DONE | What changed: lines and codes as links, "Changed" badge with no dimming, live from the stream, own actions left out |
| INV-LENS-05 | DONE | What changed: lines and codes as links, "Changed" badge with no dimming, live from the stream, own actions left out |
| INV-LENS-06 | DONE | What changed: lines and codes as links, "Changed" badge with no dimming, live from the stream, own actions left out |
| INV-LENS-07 | DONE | What changed: lines and codes as links, "Changed" badge with no dimming, live from the stream, own actions left out |
| INV-LENS-08 | DONE | What changed: lines and codes as links, "Changed" badge with no dimming, live from the stream, own actions left out |
| INV-LENS-09 | DONE | What changed: lines and codes as links, "Changed" badge with no dimming, live from the stream, own actions left out |
| INV-LENS-10 | DONE | What changed: lines and codes as links, "Changed" badge with no dimming, live from the stream, own actions left out |
| INV-LENS-11 | DONE | What changed: lines and codes as links, "Changed" badge with no dimming, live from the stream, own actions left out |
| INV-LENS-12 | DONE | What changed: lines and codes as links, "Changed" badge with no dimming, live from the stream, own actions left out |
| INV-LIVE-01 | DONE | ProjectShell opens the stream once the tables are loaded |
| INV-LIVE-02 | DONE | Same server contract (ready, one event per command, run.progress, heartbeat, Last-Event-ID) |
| INV-LIVE-03 | DONE | Listens to every command name, ready and run.progress |
| INV-LIVE-04 | DONE | Same batched invalidation, extended to map, journeys, the lens' changes and the projects list |
| INV-LIVE-05 | DONE | onProjectEvent kept |
| INV-LIVE-06 | DONE | latestEventId/onLatestEvent kept; the visits memory is unchanged (lens) |
| INV-LIVE-07 | DONE | Run progress store kept, plus when each message arrived (for Stalled) |
| INV-LIVE-08 | DONE | connecting / open / down, plus closed when the browser gives up |
| INV-LIVE-09 | DONE | Banner after 1.5 s: "Live updates paused — reconnecting…" with Retry now; "Live" / "Reconnecting…" / "Offline" in the sidebar |
| INV-LIVE-10 | DONE | After a cut or a manual retry every project query is refetched |
| INV-LIVE-11 | DONE | useCommand invalidates the project on 2xx (unchanged) |
| INV-LIVE-12 | DONE | Kept where the screens keep them (Day 1 polling, run calls polling) |
| INV-LIVE-13 | DONE | Leaving the project closes the source |
| INV-MAP-01 | DONE | ProductTabs in the page header |
| INV-MAP-02 | DONE | Header summary: records, areas, relations, questions waiting on you |
| INV-MAP-03 | DONE | Canvas with lanes per area; features first, then "Rules it follows"; the canvas scrolls with the arrow keys |
| INV-MAP-04 | DONE | Feature card: type, certainty, readiness word, open questions, title, summary, who, when, checks |
| INV-MAP-05 | DONE | Rule node: type, state icon (word in its accessible name), title, count |
| INV-MAP-06 | DONE | Relation lines, each kind with its own pattern and an arrowhead; "under review" is a separate band |
| INV-MAP-07 | DONE | Changed: pointing or focusing lights the connections without dimming the rest |
| INV-MAP-08 | DONE | Toggle buttons (aria-pressed); the selection survives zoom; Esc clears it |
| INV-MAP-09 | DONE | Selection panel (data-map-panel) with the relations as links |
| INV-MAP-10 | DONE | Legend always visible, naming every line style, "Under review" and the keys |
| INV-MAP-11 | DONE | − / % / + / Fit, and the keys + − 0; Fit can enlarge up to 130 % |
| INV-MAP-12 | DONE | Parked ideas column, with links to the threads |
| INV-MAP-13 | DONE | Skeleton, error with Retry, empty state; never error and empty together |
| INV-MODELS-01 | DONE | Sidebar Settings, the WorkspaceFrame top bar, the ErrorNotice link |
| INV-MODELS-02 | DONE | WorkspaceFrame: Your projects, New project, Models & providers, Sign out; Everywhere column only |
| INV-MODELS-03 | DONE | Eyebrow Settings, h1, subtitle |
| INV-MODELS-04 | DONE | Refresh ("Looking…"), announced; error under the header |
| INV-MODELS-05 | DONE | Providers section with its note; empty state |
| INV-MODELS-06 | DONE | StatusBadge Ready / Not ready / Not installed, version, message; data-provider |
| INV-MODELS-07 | DONE | Models with effort tags; the default effort in text |
| INV-MODELS-08 | DONE | Footer: whether it keeps a conversation, and when it was checked |
| INV-MODELS-09 | DONE | "Who does what" as a stacked list with Everywhere and This project labels |
| INV-MODELS-10 | DONE | Name, description, id@version · skills, plus Skills and limits |
| INV-MODELS-11 | DONE | data-effective, with an icon and text |
| INV-MODELS-12 | DONE | Changes apply at once, and are announced and written in the row |
| INV-MODELS-13 | DONE | Remove; "No model yet" |
| INV-MODELS-14 | DONE | "Same as everywhere" / "Use another here", with the reason when disabled |
| INV-MODELS-15 | DONE | Project selects and "Use everywhere’s" |
| INV-MODELS-16 | DONE | An error notice per row; the row is disabled while busy |
| INV-MODELS-17 | DONE | EngineSelect with the same behaviour and visible labels |
| INV-MODELS-18 | DONE | Period segments and the two spend tables |
| INV-MODELS-19 | DONE | Stats table with part names and ids, and failure kinds in words |
| INV-MODELS-20 | DONE | Skeletons, errors with Retry, empty states |
| INV-MODELS-21 | DONE | RetryWith.tsx: same export and props |
| INV-NEED-01 | DONE | Header count reconciled; queue listbox groups; row plus detail; "What it unblocks" |
| INV-NEED-02 | DONE | Header count reconciled; queue listbox groups; row plus detail; "What it unblocks" |
| INV-NEED-03 | DONE | Header count reconciled; queue listbox groups; row plus detail; "What it unblocks" |
| INV-NEED-04 | DONE | Header count reconciled; queue listbox groups; row plus detail; "What it unblocks" |
| INV-NEED-05 | PARTIAL | Minutes and Catch up in the header; the 4-item "In this order" preview is dropped (Catch up's walk shows the order) |
| INV-NEED-06 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-07 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-08 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-09 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-10 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-11 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-12 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-13 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-14 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-15 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-16 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-17 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-18 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-19 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-20 | DONE | A detail for every kind; assumed answers show Why; "Out of date" asks first; skeleton, errors with Retry |
| INV-NEED-21 | DONE | You're up to date: Today lines as links, product progress, runs in progress, third person |
| INV-NEED-22 | DONE | You're up to date: Today lines as links, product progress, runs in progress, third person |
| INV-NEED-23 | DONE | You're up to date: Today lines as links, product progress, runs in progress, third person |
| INV-NEED-24 | DONE | You're up to date: Today lines as links, product progress, runs in progress, third person |
| INV-NEED-25 | DONE | You're up to date: Today lines as links, product progress, runs in progress, third person |
| INV-NEWREC-01 | DONE | New record: type radio cards, sticky Save draft, leave guard, text kept across type switches |
| INV-NEWREC-02 | DONE | New record: type radio cards, sticky Save draft, leave guard, text kept across type switches |
| INV-NEWREC-03 | DONE | New record: type radio cards, sticky Save draft, leave guard, text kept across type switches |
| INV-NEWREC-04 | DONE | New record: type radio cards, sticky Save draft, leave guard, text kept across type switches |
| INV-NEWREC-05 | DONE | New record: type radio cards, sticky Save draft, leave guard, text kept across type switches |
| INV-NEWREC-06 | DONE | New record: type radio cards, sticky Save draft, leave guard, text kept across type switches |
| INV-NEWREC-07 | DONE | New record: type radio cards, sticky Save draft, leave guard, text kept across type switches |
| INV-NEWREC-08 | DONE | New record: type radio cards, sticky Save draft, leave guard, text kept across type switches |
| INV-NEWREC-09 | DONE | New record: type radio cards, sticky Save draft, leave guard, text kept across type switches |
| INV-NEWREC-10 | DONE | New record: type radio cards, sticky Save draft, leave guard, text kept across type switches |
| INV-NEWREC-11 | DONE | New record: type radio cards, sticky Save draft, leave guard, text kept across type switches |
| INV-NEWREC-12 | DONE | New record: type radio cards, sticky Save draft, leave guard, text kept across type switches |
| INV-NEWREC-13 | DONE | New record: type radio cards, sticky Save draft, leave guard, text kept across type switches |
| INV-NEWREC-14 | DONE | New record: type radio cards, sticky Save draft, leave guard, text kept across type switches |
| INV-NEWVER-01 | DONE | New version: Keep/Change/Drop radio groups, removable carried links, edits kept, "Saved, with warnings" |
| INV-NEWVER-02 | DONE | New version: Keep/Change/Drop radio groups, removable carried links, edits kept, "Saved, with warnings" |
| INV-NEWVER-03 | DONE | New version: Keep/Change/Drop radio groups, removable carried links, edits kept, "Saved, with warnings" |
| INV-NEWVER-04 | DONE | New version: Keep/Change/Drop radio groups, removable carried links, edits kept, "Saved, with warnings" |
| INV-NEWVER-05 | DONE | New version: Keep/Change/Drop radio groups, removable carried links, edits kept, "Saved, with warnings" |
| INV-NEWVER-06 | DONE | New version: Keep/Change/Drop radio groups, removable carried links, edits kept, "Saved, with warnings" |
| INV-NEWVER-07 | DONE | New version: Keep/Change/Drop radio groups, removable carried links, edits kept, "Saved, with warnings" |
| INV-NEWVER-08 | DONE | New version: Keep/Change/Drop radio groups, removable carried links, edits kept, "Saved, with warnings" |
| INV-NEWVER-09 | DONE | New version: Keep/Change/Drop radio groups, removable carried links, edits kept, "Saved, with warnings" |
| INV-NEWVER-10 | DONE | New version: Keep/Change/Drop radio groups, removable carried links, edits kept, "Saved, with warnings" |
| INV-NEWVER-11 | DONE | New version: Keep/Change/Drop radio groups, removable carried links, edits kept, "Saved, with warnings" |
| INV-NEWVER-12 | DONE | New version: Keep/Change/Drop radio groups, removable carried links, edits kept, "Saved, with warnings" |
| INV-NEWVER-13 | DONE | New version: Keep/Change/Drop radio groups, removable carried links, edits kept, "Saved, with warnings" |
| INV-NEWVER-14 | DONE | New version: Keep/Change/Drop radio groups, removable carried links, edits kept, "Saved, with warnings" |
| INV-ONB-01 | DONE | New project: visible label, aria-pressed examples, errors on the fields, retry never creates a second project, draft kept |
| INV-ONB-02 | DONE | New project: visible label, aria-pressed examples, errors on the fields, retry never creates a second project, draft kept |
| INV-ONB-03 | DONE | New project: visible label, aria-pressed examples, errors on the fields, retry never creates a second project, draft kept |
| INV-ONB-04 | DONE | New project: visible label, aria-pressed examples, errors on the fields, retry never creates a second project, draft kept |
| INV-ONB-05 | DONE | New project: visible label, aria-pressed examples, errors on the fields, retry never creates a second project, draft kept |
| INV-ONB-06 | DONE | New project: visible label, aria-pressed examples, errors on the fields, retry never creates a second project, draft kept |
| INV-ONB-07 | DONE | New project: visible label, aria-pressed examples, errors on the fields, retry never creates a second project, draft kept |
| INV-ONB-08 | DONE | New project: visible label, aria-pressed examples, errors on the fields, retry never creates a second project, draft kept |
| INV-ONB-09 | DONE | New project: visible label, aria-pressed examples, errors on the fields, retry never creates a second project, draft kept |
| INV-ONB-10 | DONE | New project: visible label, aria-pressed examples, errors on the fields, retry never creates a second project, draft kept |
| INV-ONB-11 | DONE | New project: visible label, aria-pressed examples, errors on the fields, retry never creates a second project, draft kept |
| INV-ONB-12 | DONE | New project: visible label, aria-pressed examples, errors on the fields, retry never creates a second project, draft kept |
| INV-ONB-13 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-14 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-15 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-16 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-17 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-18 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-19 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-20 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-21 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-22 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-23 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-24 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-25 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-26 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-27 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-28 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-29 | DONE | Changed: Correct something is in the What I understood header |
| INV-ONB-30 | DONE | Start and live reading: RunStateBadge, live progress, timer, Cancel with confirmation, the real state of every item, data hooks kept |
| INV-ONB-31 | DONE | One question at a time: Question i of N, Meter, Why it matters, ChoiceGroup with multi-select and exclusive options |
| INV-ONB-32 | DONE | One question at a time: Question i of N, Meter, Why it matters, ChoiceGroup with multi-select and exclusive options |
| INV-ONB-33 | DONE | One question at a time: Question i of N, Meter, Why it matters, ChoiceGroup with multi-select and exclusive options |
| INV-ONB-34 | DONE | One question at a time: Question i of N, Meter, Why it matters, ChoiceGroup with multi-select and exclusive options |
| INV-ONB-35 | DONE | One question at a time: Question i of N, Meter, Why it matters, ChoiceGroup with multi-select and exclusive options |
| INV-ONB-36 | DONE | One question at a time: Question i of N, Meter, Why it matters, ChoiceGroup with multi-select and exclusive options |
| INV-ONB-37 | DONE | One question at a time: Question i of N, Meter, Why it matters, ChoiceGroup with multi-select and exclusive options |
| INV-ONB-38 | DONE | One question at a time: Question i of N, Meter, Why it matters, ChoiceGroup with multi-select and exclusive options |
| INV-ONB-39 | DONE | Renamed: Not now is Park, through QuestionActions |
| INV-ONB-40 | DONE | One question at a time: Question i of N, Meter, Why it matters, ChoiceGroup with multi-select and exclusive options |
| INV-ONB-41 | DONE | One question at a time: Question i of N, Meter, Why it matters, ChoiceGroup with multi-select and exclusive options |
| INV-ONB-42 | DONE | One question at a time: Question i of N, Meter, Why it matters, ChoiceGroup with multi-select and exclusive options |
| INV-ONB-43 | DONE | One question at a time: Question i of N, Meter, Why it matters, ChoiceGroup with multi-select and exclusive options |
| INV-ONB-44 | DONE | One question at a time: Question i of N, Meter, Why it matters, ChoiceGroup with multi-select and exclusive options |
| INV-ONB-45 | DONE | Your starting point: data hooks, the Needs you count, Parked for later, You can close DEMIURGO |
| INV-ONB-46 | DONE | Your starting point: data hooks, the Needs you count, Parked for later, You can close DEMIURGO |
| INV-ONB-47 | DONE | Changed: Review the decisions opens Needs you when they span several batches |
| INV-ONB-48 | DONE | Your starting point: data hooks, the Needs you count, Parked for later, You can close DEMIURGO |
| INV-ONB-49 | DONE | Your starting point: data hooks, the Needs you count, Parked for later, You can close DEMIURGO |
| INV-ONB-50 | DONE | Your starting point: data hooks, the Needs you count, Parked for later, You can close DEMIURGO |
| INV-ONB-51 | DONE | Your starting point: data hooks, the Needs you count, Parked for later, You can close DEMIURGO |
| INV-ONB-52 | DONE | Your starting point: data hooks, the Needs you count, Parked for later, You can close DEMIURGO |
| INV-ONB-53 | DONE | Your starting point: data hooks, the Needs you count, Parked for later, You can close DEMIURGO |
| INV-ORIG-01 | DONE | Tabs, h1 Origins, the sentence |
| INV-ORIG-02 | DONE | Three columns; the third is relabelled "Features and other records" |
| INV-ORIG-03 | DONE | Edges as before |
| INV-ORIG-04 | DONE | Layout from buildOrigins |
| INV-ORIG-05 | DONE | Changed: the thread node toggles the trace; it opens from the Why panel |
| INV-ORIG-06 | DONE | Changed: the record node toggles the trace; readiness includes In doubt |
| INV-ORIG-07 | DONE | "Not from a thread" start node |
| INV-ORIG-08 | DONE | Changed: the trace is pinned on click or Enter and never follows the pointer |
| INV-ORIG-09 | DONE | Why panel grows with its text; links; announced only on a click |
| INV-ORIG-10 | DONE | Clear trace (and Esc) moves the focus to the panel |
| INV-ORIG-11 | DONE | Changed: Tab walks the nodes, Enter pins the trace, opening is from the Why panel |
| INV-ORIG-12 | DONE | Progressive loading with a meter; a record that fails shows an inline error with Retry |
| INV-OVW-01 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-02 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-03 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-04 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-05 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-06 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-07 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-08 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-09 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-10 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-11 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-12 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-13 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-14 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-15 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-16 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-17 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-18 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-19 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-20 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-21 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-22 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-23 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-24 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-25 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-26 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-27 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-28 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-29 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-OVW-30 | DONE | Overview: readiness line with SegmentedBar and text legend, stages stepper, sections per type, title links plus Preview sheet, side column (Needs you in Catch up order, Running now, TaxonomyHint, AskBox), own states per part |
| INV-PROJ-01 | DONE | Your projects in WorkspaceFrame; New project primary; state badge from the tables; skeleton, error with Retry; rename in ProjectSwitcher |
| INV-PROJ-02 | DONE | Your projects in WorkspaceFrame; New project primary; state badge from the tables; skeleton, error with Retry; rename in ProjectSwitcher |
| INV-PROJ-03 | DONE | Your projects in WorkspaceFrame; New project primary; state badge from the tables; skeleton, error with Retry; rename in ProjectSwitcher |
| INV-PROJ-04 | DONE | Your projects in WorkspaceFrame; New project primary; state badge from the tables; skeleton, error with Retry; rename in ProjectSwitcher |
| INV-PROJ-05 | DONE | Your projects in WorkspaceFrame; New project primary; state badge from the tables; skeleton, error with Retry; rename in ProjectSwitcher |
| INV-PROJ-06 | DONE | Your projects in WorkspaceFrame; New project primary; state badge from the tables; skeleton, error with Retry; rename in ProjectSwitcher |
| INV-PROJ-07 | DONE | Your projects in WorkspaceFrame; New project primary; state badge from the tables; skeleton, error with Retry; rename in ProjectSwitcher |
| INV-PROJ-08 | DONE | Your projects in WorkspaceFrame; New project primary; state badge from the tables; skeleton, error with Retry; rename in ProjectSwitcher |
| INV-PROP-01 | DONE | Proposal view in batch/ProposalView.tsx: allowed actions, dialogs with effects, errors, people marks, record chips, body by type |
| INV-PROP-02 | DONE | Proposal view in batch/ProposalView.tsx: allowed actions, dialogs with effects, errors, people marks, record chips, body by type |
| INV-PROP-03 | DONE | Proposal view in batch/ProposalView.tsx: allowed actions, dialogs with effects, errors, people marks, record chips, body by type |
| INV-PROP-04 | DONE | Proposal view in batch/ProposalView.tsx: allowed actions, dialogs with effects, errors, people marks, record chips, body by type |
| INV-PROP-05 | DONE | Proposal view in batch/ProposalView.tsx: allowed actions, dialogs with effects, errors, people marks, record chips, body by type |
| INV-PROP-06 | DONE | Proposal view in batch/ProposalView.tsx: allowed actions, dialogs with effects, errors, people marks, record chips, body by type |
| INV-PROP-07 | DONE | Proposal view in batch/ProposalView.tsx: allowed actions, dialogs with effects, errors, people marks, record chips, body by type |
| INV-PROP-08 | DONE | Proposal view in batch/ProposalView.tsx: allowed actions, dialogs with effects, errors, people marks, record chips, body by type |
| INV-PROP-09 | DONE | Proposal view in batch/ProposalView.tsx: allowed actions, dialogs with effects, errors, people marks, record chips, body by type |
| INV-PROP-10 | DONE | Proposal view in batch/ProposalView.tsx: allowed actions, dialogs with effects, errors, people marks, record chips, body by type |
| INV-PROP-11 | DONE | Proposal view in batch/ProposalView.tsx: allowed actions, dialogs with effects, errors, people marks, record chips, body by type |
| INV-PROP-12 | DONE | Proposal view in batch/ProposalView.tsx: allowed actions, dialogs with effects, errors, people marks, record chips, body by type |
| INV-PROP-13 | DONE | Changed: a blocked Accept stays visible and inactive with its reason |
| INV-PROP-14 | DONE | Out-of-date notice, Accept as draft, Accept and approve, caption and "What's the difference?", inline Change, Reject, resolved block |
| INV-PROP-15 | DONE | Out-of-date notice, Accept as draft, Accept and approve, caption and "What's the difference?", inline Change, Reject, resolved block |
| INV-PROP-16 | DONE | Out-of-date notice, Accept as draft, Accept and approve, caption and "What's the difference?", inline Change, Reject, resolved block |
| INV-PROP-17 | DONE | Out-of-date notice, Accept as draft, Accept and approve, caption and "What's the difference?", inline Change, Reject, resolved block |
| INV-PROP-18 | DONE | Out-of-date notice, Accept as draft, Accept and approve, caption and "What's the difference?", inline Change, Reject, resolved block |
| INV-PROP-19 | DONE | Out-of-date notice, Accept as draft, Accept and approve, caption and "What's the difference?", inline Change, Reject, resolved block |
| INV-PROP-20 | DONE | Out-of-date notice, Accept as draft, Accept and approve, caption and "What's the difference?", inline Change, Reject, resolved block |
| INV-PROP-21 | DONE | Out-of-date notice, Accept as draft, Accept and approve, caption and "What's the difference?", inline Change, Reject, resolved block |
| INV-REC-01 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-02 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-03 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-04 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-05 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-06 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-07 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-08 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-09 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-10 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-11 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-12 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-13 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-14 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-15 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-16 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-17 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-18 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-19 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-20 | DONE | Record page: Approve first, stacked notices, guided review with "Part n of 5", readiness reasons with links, one-column checks |
| INV-REC-21 | DONE | Changed: "Open in Origins" opens /origins?record=CODE with that record's trace pinned |
| INV-REC-22 | DONE | Record page: history in words, versions, incoming links, "Approved. What needs you next" only after approving here |
| INV-REC-23 | DONE | Record page: history in words, versions, incoming links, "Approved. What needs you next" only after approving here |
| INV-REC-24 | DONE | Record page: history in words, versions, incoming links, "Approved. What needs you next" only after approving here |
| INV-REC-25 | DONE | Record page: history in words, versions, incoming links, "Approved. What needs you next" only after approving here |
| INV-REC-26 | DONE | Record page: history in words, versions, incoming links, "Approved. What needs you next" only after approving here |
| INV-REC-27 | DONE | Record page: history in words, versions, incoming links, "Approved. What needs you next" only after approving here |
| INV-REC-28 | DONE | Record page: history in words, versions, incoming links, "Approved. What needs you next" only after approving here |
| INV-REC-29 | DONE | Record page: history in words, versions, incoming links, "Approved. What needs you next" only after approving here |
| INV-REC-30 | DONE | Record page: history in words, versions, incoming links, "Approved. What needs you next" only after approving here |
| INV-REC-31 | DONE | Record page: history in words, versions, incoming links, "Approved. What needs you next" only after approving here |
| INV-RUN-01 | DONE | 404 "We couldn't find this run", error with Retry, PageSkeleton |
| INV-RUN-02 | DONE | Breadcrumbs Activity › "Action · day time" |
| INV-RUN-03 | DONE | Eyebrow: run icon, "Run", RunStateBadge (Late and Stalled included) |
| INV-RUN-04 | DONE | h1 "Draft a feature" or the action word |
| INV-RUN-05 | DONE | Cancel with a ConfirmDialog that says what is kept |
| INV-RUN-06 | DONE | Retry, then navigate to the new run |
| INV-RUN-07 | DONE | Retry with…, then navigate to the new run |
| INV-RUN-08 | DONE | RetryWith popover: same texts, engine picker, error kept (data-retry-with) |
| INV-RUN-09 | DONE | Meta line: agent · engine, From decision, In the thread, Requested by · when |
| INV-RUN-10 | DONE | Status card: waiting or working, live progress, timer, Stalled/Late reading |
| INV-RUN-11 | DONE | Finished: "Review →" to the batch, or "Open the thread →" |
| INV-RUN-12 | DONE | Failed / interrupted / cancelled in words, "What it said:", a different next step for each |
| INV-RUN-13 | DONE | Engine calls tab: polled while active, Pause/Resume live updates, FAILURE_WORDS, raw events |
| INV-RUN-14 | DONE | Context tab: readable, with dependencies as links; hash; "What it read" with the raw JSON |
| INV-RUN-15 | DONE | Output tab: readable view plus Raw JSON |
| INV-RUN-16 | DONE | Details as KeyValue; where each figure comes from is visible text |
| INV-RUN-17 | DONE | Attempts, oldest first, the current one marked; data-run-retry-of and data-run-retries |
| INV-RUN-18 | DONE | Events tab as a Timeline, with the date when not today |
| INV-RUN-19 | DONE | LiveProgress export kept for the thread and Day 1 |
| INV-RUN-20 | DONE | runDuration ticks on the run page, Right now and Activity |
| INV-RUN-21 | DONE | Entry from Activity rows, Right now, attempts, and the thread's Details |
| INV-SHELL-01 | DONE | Skip link to #main in shell/AppRoot |
| INV-SHELL-02 | DONE | components/Tooltip TooltipProvider; tooltips on hover and focus |
| INV-SHELL-03 | PARTIAL | The self-opening legend became Help (? and sidebar button), which lists every symbol (D-014) |
| INV-SHELL-04 | DONE | Dev panel reachable on every screen: sidebar footer button and person menu (shell/DevPanel) |
| INV-SHELL-05 | DONE | Router behaviour unchanged; plus a per-route document.title with the Needs-you count (shell/title.ts) |
| INV-SHELL-06 | DONE | Query defaults unchanged (main.tsx) |
| INV-SHELL-07 | DONE | Not found: "We couldn't find {thing}." with one way back; its own frame at router level |
| INV-SHELL-08 | DONE | "Back to the product" only for an existing project, otherwise "Back to DEMIURGO" |
| INV-SHELL-09 | DONE | Wordmark (link to /) and the project name in the project switcher, at the top of the sidebar |
| INV-SHELL-10 | DONE | Switch: the project switcher lists the projects and "All projects" |
| INV-SHELL-11 | DONE | "New project" in the project switcher |
| INV-SHELL-12 | DONE | Sections as sidebar links (nav "Sections", aria-current), current also on their sub-routes |
| INV-SHELL-13 | DONE | "Needs you" with the accent count (data-count) in the sidebar, live |
| INV-SHELL-14 | DONE | The Knowledge item shows its freshness (updating dot, "behind" alert icon), with the words in the tooltip and for screen readers; the version is in the words and on the Knowledge page |
| INV-SHELL-15 | DONE | Person menu at the bottom of the sidebar ("Signed in as …") |
| INV-SHELL-16 | DONE | Models & providers is a Settings item in the sidebar (and in the command menu) |
| INV-SHELL-17 | DONE | "Rename the project…" is in the project switcher (a project setting), with the same dialog and command |
| INV-SHELL-18 | DONE | Agent keys is a Settings item in the sidebar |
| INV-SHELL-19 | DONE | "Snapshots…" in the person menu (dev tools only) |
| INV-SHELL-20 | DONE | Sign out in the person menu, also outside a project (shell/WorkspaceFrame) |
| INV-SHELL-21 | DONE | shell/ProductTabs (Overview · Map · Journeys · Origins) |
| INV-SHELL-22 | DONE | Command menu combobox (shell/CommandMenu), 2 characters, 200 ms debounce |
| INV-SHELL-23 | DONE | Ctrl/⌘ K from anywhere in a project; also the sidebar Search button |
| INV-SHELL-24 | DONE | knowledgeSearchQuery + stateQuery for the owners of checks |
| INV-SHELL-25 | DONE | Type icon with its word for screen readers, highlighted title and excerpt, certainty badge |
| INV-SHELL-26 | DONE | ↑/↓ with aria-activedescendant, Enter opens; record, check (tab=checks) and thread targets, now for every record prefix |
| INV-SHELL-27 | DONE | "It has no page of its own." and aria-disabled |
| INV-SHELL-28 | DONE | "Searching…", "No matches" / "n matches", an error shown inside the menu without taking the focus |
| INV-SHELL-29 | DONE | Esc closes the menu (the text resets); choosing a result navigates and closes |
| INV-SHELL-30 | DONE | Replaced: the sidebar Search button is always labelled and shows "Ctrl K" (no hidden magnifier) |
| INV-SHELL-31 | DONE | components/Page: PageBody and WithAside (labelled complementary side column) |
| INV-SHELL-32 | DONE | components/SidePanel ResizablePanel: arrows, Shift+arrows, Home/End, double-click reset, aria-valuemax, width remembered |
| INV-SHELL-33 | DONE | PageHeader (eyebrow, h1, meta, actions, tabs), Section, Card, Breadcrumbs |
| INV-SHELL-34 | DONE | Skeleton, RowsSkeleton, PageSkeleton (role=status with a label, shown after 300 ms) |
| INV-SHELL-35 | DONE | EmptyState (narrow and spacious) |
| INV-SHELL-36 | DONE | ConfirmDialog (AlertDialog; tone danger; pending label) |
| INV-SHELL-37 | DONE | PromptDialog: keeps text on error, required hint, character counter |
| INV-SHELL-38 | DONE | ErrorNotice + explain(): the same titles per status and the reasons verbatim |
| INV-SHELL-39 | DONE | "Open Models & providers" as a router link (no full reload), project or workspace scope |
| INV-SHELL-40 | PARTIAL | Help lists every symbol, not only those on screen (D-014) |
| INV-SHELL-41 | PARTIAL | Deliberately never opens by itself (it covered actions, INVENTORY §2 #1); Help is one click or "?" away (D-014) |
| INV-SHELL-42 | DONE | The Help button in the sidebar footer, in the same place on every page |
| INV-SHELL-43 | DONE | "?" opens Help from anywhere except while typing; Esc closes |
| INV-SHELL-44 | PARTIAL | No pointing-highlights-the-marks: every badge carries its word, so no mark needs finding (D-014) |
| INV-SHELL-45 | PARTIAL | Replaced by Help's two tabs (Symbols, Keyboard) |
| INV-SHELL-46 | PARTIAL | No "The legend stays here" notice: nothing opens by itself any more |
| INV-SHELL-47 | PARTIAL | No per-person seen list: nothing to fold |
| INV-SHELL-48 | DONE | StatusBadge: symbol, shape, color and word, with the phrase as its title (data-status) |
| INV-SHELL-49 | DONE | StatusBadge, EntityState, Certainty, StateText, WorkingDot |
| INV-SHELL-50 | DONE | components/Meter Readiness: word plus the ready · built · verified track (data-stage) |
| INV-SHELL-51 | DONE | components/Badge Count (hidden at zero, sr-only meaning) |
| INV-SHELL-52 | DONE | components/Who: You / DEMIURGO / Agent · name / Automatic, distinct shapes, phrase as title |
| INV-SHELL-53 | DONE | components/icons + components/types: every record type (incl. requirement, quality, threat, production) and thing |
| INV-SHELL-54 | PARTIAL | No hover delay: the facts open with a visible Preview button (D-015) |
| INV-SHELL-55 | PARTIAL | One click opens the page everywhere; Preview keeps the facts beside the page (D-015) |
| INV-SHELL-56 | DONE | Preview by keyboard (Tab to Preview, Enter), Esc closes and returns focus (components/Preview) |
| INV-SHELL-57 | DONE | components/AskBox, subject product or record, label and placeholder from components/ask.ts |
| INV-SHELL-58 | DONE | Same sending sequence (fresh threads, reuse or exploration.open, message.post respond) |
| INV-SHELL-59 | DONE | Enter asks, Shift+Enter new line (IME-safe), grows, max 20,000, "Sending…" |
| INV-SHELL-60 | DONE | prefill() handle kept |
| INV-SHELL-61 | DONE | Status line (role=status, data-ask-status): answering / answered / failed with links to the thread |
| INV-SHELL-62 | DONE | ErrorNotice above the form, text kept; hidden unless the tables allow both commands |
| INV-SRC-01 | DONE | Title and sentence |
| INV-SRC-02 | DONE | Table: "Untrusted input" explained in text; absolute time visible; full hash in a per-row disclosure |
| INV-SRC-03 | DONE | Skeleton, error with Retry, empty state |
| INV-SRC-04 | DONE | Form from the schema with written labels, hints and a counter; the success notice stays until the next edit |
| INV-THR-01 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-02 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-03 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-04 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-05 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-06 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-07 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-08 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-09 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-10 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-11 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-12 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-13 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-14 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-15 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-16 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-17 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-18 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-19 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-20 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-21 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-22 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-23 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-24 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-25 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-26 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-27 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-28 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-29 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-30 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-31 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-32 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-33 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-34 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-35 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-36 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-37 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-38 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-39 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-40 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-41 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-42 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-43 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-44 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-45 | DONE | Thread.tsx and parts: header, stage Meter, log conversation, question cards with ChoiceGroup, drafts, Confirm and send per item |
| INV-THR-46 | DONE | Redesigned (D-013): Enter sends, Shift+Enter adds a line, Ctrl/Cmd+Enter asks DEMIURGO; hint always visible |
| INV-THR-47 | DONE | Redesigned (D-013): Enter sends, Shift+Enter adds a line, Ctrl/Cmd+Enter asks DEMIURGO; hint always visible |
| INV-THR-48 | DONE | Composer errors, Draft it menu, run cards (Queued, Late, Working, Stalled; Retry and Retry with…) |
| INV-THR-49 | DONE | Composer errors, Draft it menu, run cards (Queued, Late, Working, Stalled; Retry and Retry with…) |
| INV-THR-50 | DONE | Composer errors, Draft it menu, run cards (Queued, Late, Working, Stalled; Retry and Retry with…) |
| INV-THR-51 | DONE | Composer errors, Draft it menu, run cards (Queued, Late, Working, Stalled; Retry and Retry with…) |
| INV-THR-52 | DONE | Composer errors, Draft it menu, run cards (Queued, Late, Working, Stalled; Retry and Retry with…) |
| INV-THR-53 | DONE | Composer errors, Draft it menu, run cards (Queued, Late, Working, Stalled; Retry and Retry with…) |
| INV-THR-54 | DONE | Composer errors, Draft it menu, run cards (Queued, Late, Working, Stalled; Retry and Retry with…) |
| INV-THR-55 | DONE | Composer errors, Draft it menu, run cards (Queued, Late, Working, Stalled; Retry and Retry with…) |
| INV-THR-56 | DONE | Composer errors, Draft it menu, run cards (Queued, Late, Working, Stalled; Retry and Retry with…) |
| INV-THR-57 | DONE | Composer errors, Draft it menu, run cards (Queued, Late, Working, Stalled; Retry and Retry with…) |
| INV-THR-58 | DONE | Composer errors, Draft it menu, run cards (Queued, Late, Working, Stalled; Retry and Retry with…) |
| INV-THR-59 | DONE | "Ask DEMIURGO about this" is the kit AskBox |
| INV-THR-60 | DONE | Park, Drop, Reopen in each question's More actions menu (D-012) |
| INV-THRS-01 | DONE | Treegrid list with state filter, Purpose dialog, EntityState badges, waiting count, error with Retry, empty state |
| INV-THRS-02 | DONE | Treegrid list with state filter, Purpose dialog, EntityState badges, waiting count, error with Retry, empty state |
| INV-THRS-03 | DONE | Treegrid list with state filter, Purpose dialog, EntityState badges, waiting count, error with Retry, empty state |
| INV-THRS-04 | DONE | Treegrid list with state filter, Purpose dialog, EntityState badges, waiting count, error with Retry, empty state |
| INV-THRS-05 | DONE | Treegrid list with state filter, Purpose dialog, EntityState badges, waiting count, error with Retry, empty state |
| INV-THRS-06 | DONE | Treegrid list with state filter, Purpose dialog, EntityState badges, waiting count, error with Retry, empty state |
| INV-THRS-07 | DONE | Treegrid list with state filter, Purpose dialog, EntityState badges, waiting count, error with Retry, empty state |
| INV-THRS-08 | DONE | Treegrid list with state filter, Purpose dialog, EntityState badges, waiting count, error with Retry, empty state |
| INV-THRS-09 | DONE | Treegrid list with state filter, Purpose dialog, EntityState badges, waiting count, error with Retry, empty state |
| INV-THRS-10 | DONE | Treegrid list with state filter, Purpose dialog, EntityState badges, waiting count, error with Retry, empty state |
| INV-THRS-11 | DONE | Treegrid list with state filter, Purpose dialog, EntityState badges, waiting count, error with Retry, empty state |
| INV-THRS-12 | DONE | Treegrid list with state filter, Purpose dialog, EntityState badges, waiting count, error with Retry, empty state |
