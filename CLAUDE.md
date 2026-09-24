# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `AGENTS.md` first. It holds the product intent and hard rules: the artifact hierarchy, human acceptance of agent proposals, and "work only against the stable instance on `127.0.0.1:8000`". The UI, docs, error messages and commit-facing text are in Spanish, so keep new user-facing strings in Spanish.

## Commands

Windows/PowerShell (use `npm.cmd`, not `npm`):

```powershell
python -m pip install -r requirements-dev.txt          # runtime + pytest/httpx
python -m pytest -q                                     # backend tests
python -m pytest tests/test_journey.py::test_name -q    # single test
cd frontend; npm.cmd install; npm.cmd run build         # tsc -b && vite build -> frontend/dist
npm.cmd run test:e2e                                    # browser E2E (in frontend/)
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
python -m app.restore .\demiurgo-backup-FECHA.db [--target path]   # server must be stopped
```

- The backend serves `frontend/dist`, so rebuild the frontend before checking UI changes through the backend. `npm.cmd run dev` runs Vite and proxies `/api` to `:8000`.
- `e2e.mjs` starts its own backends on `:8010`/`:8012`, each with a temporary `e2e-<pid>.db` in the repo root. It drives local Chrome through `playwright-core`; set `CHROME_PATH` if Chrome is not at the default Windows path. Screenshots go to `artifacts/`. `DEMIURGO_E2E_BASE_URL` points it at an existing server instead (CI does this against the container).
- `test:e2e:codex` and `test:e2e:source` call the real Codex service. They use the local Codex auth and consume quota, so run them only when asked.
- Stable instance: `docker compose -p demiurgo-stable up -d --build` with `DEMIURGO_DATA_DIR` / `DEMIURGO_CODEX_DIR` set, as described in `docs/development-and-releases.md`. Data and Codex auth live in `%LOCALAPPDATA%\Demiurgo\stable`, never in the repo.
- CI (`.github/workflows/ci.yml`) runs pytest, the frontend build and E2E, then builds the Docker image and reruns E2E against the container with `DEMIURGO_DISABLE_CODEX=1`.
- The release gate and manual evaluation are in `docs/evaluation-quality.md`, with results in `docs/evaluations/vN.0.0.md`.

## Architecture

**Backend (`app/`)**: FastAPI over raw `sqlite3`. There is no ORM, and SQLAlchemy is used only by Alembic.
- `db.py`: `DB_PATH` comes from `DEMIURGO_DB` (default `demiurgo.db`). `transaction()` opens a `BEGIN IMMEDIATE` connection per unit of work, and `rows()`/`domain.one()` return dicts. Tests monkeypatch `db.DB_PATH` **and** `main.DB_PATH`.
- `main.py`: all HTTP routes plus a catch-all SPA route. On startup it sets WAL mode, runs `alembic upgrade head`, and marks leftover `running` AI runs as `interrupted`. `GET /api/state` is the aggregate snapshot the frontend polls and rerenders from.
- `domain.py`: shared helpers (`uid(prefix)`, `now()`, `fail()` → HTTPException, `audit()`, `index()` for the `search_index` table) plus record, revision, link, criterion, task and changeset logic. Records (`decision`/`adr`/`fdr`) are versioned through `revisions` and carry `origin_type`/`origin_id` provenance. Every mutation should write an `audit_events` row.
- `codex.py`: AI runs. `start*()` inserts an `ai_runs` row and spawns a daemon thread named `demiurgo-run-<id>`; tests join these threads. There are two providers. Codex runs as `codex exec --json` in a temp dir with a read-only sandbox, `--output-schema`, and `DEMIURGO_*` env vars stripped. Qwen uses an OpenAI-compatible HTTP API. JSONL events are stored in `ai_events`. Model output must be `{reply, proposals[]}` validated against `.demiurgo/agents/exploration/schema.json`. The prompt method is loaded from `.demiurgo/agents/exploration/{METHOD_VERSION}.md`, so bumping `METHOD_VERSION` needs a matching file. The AI never writes the DB directly; it only produces **proposals**.
- `ai_config.py`: provider profiles and per-action overrides. The action keys are `exploration_initial`, `exploration_chat`, `question_response`, `round_review` and `source_analysis`. Profiles resolve by scope (card → exploration → …).
- `observability.py`: OpenTelemetry spans are exported locally into the DB so that each run can be inspected through `/api/runs/{id}`.
- `project_state.py`: the canonical facts of a project and their fingerprint, used for the versioned `project_summaries`. It also turns confirmed cards into draft decisions.
- `context.py` / `exporter.py`: export and import of portable context (imports never carry tasks, Change Sets or evidence, and imported designs become drafts), plus the full JSON and Markdown exports.

**Proposal flow (core invariant)**: AI output lands in `proposal_batches`/`proposals` with status `pending`. A human resolves them through `/api/batches/{id}/resolve` or `PATCH /api/proposals/{id}`. A later human change supersedes stale pending proposals (`supersede_pending_proposals`). Never auto-accept AI proposals or turn hypotheses into approved records.

**Domain terms in the schema**: `projects` → `explorations` (tree via `parent_id` / `origin_record_id`, where the root is "Exploración inicial") → `cards` (questions, each with its own message thread and `conclusion`) and `exploration_rounds` (closing a round triggers a `round_review` run that proposes new lines). `messages` are keyed by `exploration_id` plus an optional `card_id`. `sources` hold imported documents such as `VISION.md`.

**Migrations**: `migrations/versions/NNNN_*.py` are hand-written Alembic scripts with sequential string revisions (`"0013"`) and raw SQL through `op.execute`. The app applies them on startup.

**Frontend (`frontend/src`)**: a React 19 + Vite + TypeScript SPA with no router or state library. `App.tsx` holds the global `State` from `/api/state` and a small `api()` fetch helper. Components (`Artifacts`, `ConversationPane`, `Runs`, `AISettings`, …) receive state and callbacks as props. The E2E test finds elements by accessible role and Spanish labels, so renaming visible text can break `e2e.mjs`.
