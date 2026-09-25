# Backlog: what a better experience would need beyond this rebuild

The rebuild consumes the backend as it is and adds no product features (D-001, D-002). This file
lists what the research or the design pointed to, but that needs either:
- **backend** changes: new or changed API, data or events, outside the frontend scope; or
- a **new feature**: a capability the product does not have today.

Each entry says what it would change, the source that suggests it, and how the rebuild works around
it today.

## Backend: data or API changes

| # | Need | Why | Today's workaround in the frontend |
| --- | --- | --- | --- |
| B-01 | `last_event_at` on runs (list and detail), and the server time in `run.progress` | "Stalled" is computed from progress messages this tab received, so it resets on reload [R29][R09] | Stalled is labelled as the UI's reading ("no sign of activity for 2 min"), with a 90 s threshold (D-011) |
| B-02 | The inbox reports packages and their proposals separately (`items`, `packages`, `proposals_in_packages`) | `inbox.total` counts every proposal of a package while the list shows one row (INVENTORY §2 #6) | The header states the reconciliation in words: "7 things: 1 package of 4 proposals…" |
| B-03 | Failed and invalid runs as inbox kinds | The attention set should hold every outcome that needs the person [R69][R24] | Failures show in the sidebar Activity roll-up and on Activity, not in Needs you |
| B-04 | `GET /sources/:id` with the content | A source can't be read after it is registered (INV-SRC, UX problem) | Unchanged: the list shows name, who, when and hash |
| B-05 | Paging and a total on `GET /runs` (the limit is 500 today) | Silent truncation (INV-ACT, UX problem) | Activity says "Showing the latest 500 runs" when the list has 500 |
| B-06 | One call for the records' links used by Origins | Origins makes one request per record (N+1) and blanks on any failure | The tree renders progressively and shows per-record errors inline |
| B-07 | Readiness reasons as structured data (`kind`, `ref`, `code`) besides the text | The reasons can't be acted on: the UI can only show the verbatim strings (INV-REC, UX problem) | Record codes inside a reason are turned into links by pattern |
| B-08 | Search results that carry their target (record code and version, thread id) | The UI parses refs; four record prefixes were unreachable (INVENTORY §2 #20) | The ref pattern now accepts every record prefix |
| B-09 | Draft answers and fork choices stored on the server | Drafts live in one browser's localStorage and can diverge between tabs (INV-THR-37) | Kept in localStorage, plus a `storage` event listener so tabs stay in sync |
| B-10 | Run attempts numbered by the server, with who triggered each attempt | "Attempt n" is derived from `retry_of` chains [R02] | Derived on the client from the runs list |
| B-11 | A proposal of a change to an existing record carries the base version's content | A rendered before/after diff needs the base text [R67] | The proposal shows the proposed content, and "Starts from" links to the base version |
| B-12 | Usage per period (today, 7 days) for the project, like the workspace consumption | Activity's usage is all-time and says so [R14] | The panel title states the period: "All time · counts engine calls" |
| B-13 | `project` entity events carrying the new name | The project name was never refreshed live | The stream now invalidates `['projects']` on any `project` event |

## New features suggested by the research (not built: no new product features)

| # | Feature | Source |
| --- | --- | --- |
| F-01 | Snooze, Save and Mute on Needs-you items ("until new activity") | [R30][R33] |
| F-02 | Single-key decisions (A accept, R reject, J/K move) and bulk accept of a selection | [R30][R13][R32] |
| F-03 | "Pause all agents", a global control | [R20] G17 |
| F-04 | Agent cards with reliability stats (accepted without edits, rejected, retry rate) | [R20] G2, [R25] |
| F-05 | Reject reasons as quick chips (wrong fact, out of scope, duplicate, too vague) | [R20] G8/G9 |
| F-06 | Runs grouped by purpose, and an agent-health grid (agents × last runs) | [R17][R07] |
| F-07 | Run event permalinks and range selection (`#e40-e52`), and event search | [R01][R71] |
| F-08 | Compact density preference for tables and lists | [R49][R43] |
| F-09 | Compare two forks side by side | [R13] |
| F-10 | Thumbs up/down feedback on a run's output, separate from accept/reject | [R27][R14] |
| F-11 | An "uses your subscription" notice with an estimate before starting a Claude or Codex run | [R23] |
| F-12 | Deep link to a single question or message in a thread (`?question=`) | INVENTORY: Journeys "Answer" goes to the thread, not the question |
