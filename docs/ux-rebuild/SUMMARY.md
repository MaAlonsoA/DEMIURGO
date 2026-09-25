# Frontend rebuild: summary

Branch `ux/frontend-rebuild-2026-09-25`: 29 commits on top of `v2.1`, not pushed and not merged.
Research in [REFERENCES](REFERENCES.md) (99 sources), requirements in [INVENTORY](INVENTORY.md),
design in [DESIGN](DESIGN.md), and every choice with its alternatives and source in
[DECISIONS](DECISIONS.md) (D-001…D-026).

## What changed

- **Visual language, built from scratch.** Semantic tokens with a light and a dark value, following
  the OS or pinned by the person. Six tones; every status carries a symbol, a shape and a word as
  well as colour. Own icons and system fonts, so no new dependencies. A test checks contrast in both
  themes and rejects any colour, size or radius outside the tokens.
- **A new shell.** A sidebar with live signals (Needs you, Activity working / stalled / failed,
  Knowledge freshness), a command menu (Ctrl K) that also searches, Help (?) instead of the
  self-opening legend, connection states with Retry, one title and focus target per page, and reflow
  down to 390 px.
- **Every screen rebuilt**, grouped by the five jobs:
  - J1 decide: Needs you as a queue plus a detail, Catch up, the batch pages;
  - J2 explore: the Threads treegrid, the thread and Go deeper;
  - J3 follow the work: Activity and runs, with derived Late and Stalled states;
  - J4 understand: overview with stages, map, journeys, origins, records, knowledge;
  - J5 start: sign in, projects, Day 1.
- **One vocabulary** for questions (Answer, Confirm, Change, Park, Drop, Reopen) on every screen.
  Park, Drop and Reopen are back in the thread.
- **Removed from the web:** the old `ui/` kit, the `@demiurgo/design-system` CSS and fonts, and
  `class-variance-authority`. The `packages/design-system` package still exists, unused by the web.

## Status

- **Parity:** 594 inventory items: **584 DONE, 10 PARTIAL, 0 MISSING** (INVENTORY §4). All ten
  PARTIAL items are deliberate:
  - the legend became Help (D-014);
  - the hover peek became Open + Preview (D-015);
  - Needs you dropped its 4-item "In this order" preview; Catch up shows the order.
- **Checks:**
  - `gate:types`, oxlint (type-aware), biome and the web build are clean;
  - 210 of 210 unit tests pass;
  - E2E: **103 of 103 pass**. Before the rebuild, 21 of 91 failed because v2.1 patches had outdated them
    (D-007); every one was rewritten against the current behaviour.
  - axe runs with no exclusions on every spec and on each of the 30 screenshots in
    [screenshots/](screenshots/).

## Deferred

- **Backend:** B-01…B-16 in [BACKLOG](BACKLOG.md). Examples: a server-side "last event" for
  Stalled, packages counted apart in the inbox, structured readiness reasons, drafts stored on the
  server.
- **Features suggested by the research, not built** (no new product features): F-01…F-12.
  Examples: snooze in Needs you, single-key decisions, deep links to a question.
- **Known, left for later:**
  - status badges and router links share `data-status`, so tests scope their selectors (D-026);
  - `CLAUDE.md` and `.design-sync/NOTES.md` still say the web uses the design-system package;
  - Day 1 keeps a local copy of the taxonomy hint;
  - "N minutes" on Day 1 still measures the thread's span of activity.

## Review these first

1. **D-019, security, outside this work.** The uncommitted changes in `providers/claude.ts` and
   `codex.ts` give the agents WebFetch and live web search, with no limit on addresses. Loopback,
   the 8100 API and Postgres are reachable, and fetched pages can carry prompt injection. Left
   untouched.
2. **D-001.** The brief described an "SDLC orchestrator"; the rebuild follows the product the repo
   describes (DEMIURGO v2 and the v2.1 patches).
3. **D-023, Needs you as a split queue and detail.** This is the biggest change in how people decide.
4. **D-012 and D-013, the thread.** Park, Drop and Reopen are back. Enter sends, Shift+Enter adds a
   line, Ctrl+Enter asks DEMIURGO, and there is no "reply" mode by default.
5. **D-014 and D-015.** The legend became Help, and the hover peek became a Preview button.
6. **D-011, Late and Stalled.** These are UI readings (queued for more than 60 s, no progress for
   90 s) until the backend sends `last_event_at` (B-01).
7. **D-026.** The web no longer uses `packages/design-system`. Decide whether that package and its
   Claude Design sync stay.
