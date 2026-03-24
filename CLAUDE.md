# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General Behavior

- When asked to implement something, start coding immediately. Do not spend excessive time on codebase exploration, task creation, or planning unless explicitly asked to plan. Bias toward action.
- After committing and pushing, stop. Do not automatically start new tasks, brainstorming, or invoke skills unless the user explicitly asks for the next thing.
- Never commit anything without an explicit approval from the user. 
- Never push anything to GitHub without an explicit directive from the user.
- Never introduce breaking changes (schema migrations that lose data, removed/renamed API fields, changed defaults) without an explicit plan for migration of the deployed application.

## Project Overview

Tool for processing and cataloging band jam session recordings. Splits full iPhone recordings into individual songs, stores them in a catalog database, and provides a web UI for reviewing, tagging, and comparing takes across sessions.

## Quick Reference

| Item | Value |
|------|-------|
| Stack | Python 3.12 (FastAPI) + React/TypeScript/Tailwind |
| Database | SQLite (`jam_sessions.db`) |
| Audio | FFmpeg, AAC/M4A 192kbps |
| Auth | JWT cookies + API key header |
| Storage | Local filesystem or Cloudflare R2 |
| Dev ports | API `:8000`, Frontend `:5173` |
| Deploy | Docker Compose via GitHub Actions to VPS |

## Architecture

### System Layers

```
Web Frontend (React + TypeScript + Tailwind) → localhost:5173
REST API (FastAPI) → localhost:8000
Database (SQLite) → jam_sessions.db
Processing Pipeline (Python) → metadata → detection → export
Audio Engine (FFmpeg) → decoding, conversion, extraction
```

### Python Modules (`src/jam_session_processor/`)

| Module | Responsibility |
|--------|---------------|
| `config.py` | Environment-based config singleton (`get_config()`), path resolution |
| `cli.py` | Click CLI: `serve`, `upload`, user/group admin commands |
| `auth.py` | Password hashing (bcrypt), JWT creation/verification |
| `metadata.py` | `AudioMetadata` dataclass, `extract_metadata()`, `parse_date_from_filename()` |
| `splitter.py` | `compute_rms_profile()`, `smooth_profile()`, `detect_songs()`, `export_segment()` |
| `output.py` | Output filename generation, segment export orchestration |
| `db.py` | SQLite schema, `Database` class with user/group/session/track/song CRUD |
| `track_ops.py` | Merge/split track operations: re-export, renumber |
| `storage.py` | Storage abstraction: `LocalStorage` (filesystem) and `R2Storage` (Cloudflare R2) |
| `api.py` | FastAPI app, auth middleware, Pydantic models, REST endpoints, audio streaming |

### Database Schema

```
users                      groups                     user_groups
──────────────            ──────────────             ─────────────────
id (PK)                   id (PK)                    user_id (FK→users)
email (UNIQUE)            name (UNIQUE)              group_id (FK→groups)
name                      created_at                 PRIMARY KEY (user_id, group_id)
role
password_hash
last_active_at
created_at

sessions                    tracks                        songs
────────────────           ─────────────────────          ──────────────
id (PK)                    id (PK)                        id (PK)
group_id (FK→groups)       session_id (FK→sessions)       group_id (FK→groups)
name                       song_id (FK→songs)             name
date                       track_number                   artist
source_file                start_sec, end_sec             sheet, notes
duration_sec               duration_sec                   created_at
notes                      audio_path, notes              UNIQUE(group_id, name)
created_at                 created_at

jobs                           setlists                       setlist_songs
──────────────                ──────────────                 ─────────────────
id (PK, TEXT)                 id (PK)                        id (PK)
type                          group_id (FK→groups)           setlist_id (FK→setlists)
group_id (FK→groups)          name                           song_id (FK→songs)
status (pending→…)            date                           position
progress (TEXT)               notes                          UNIQUE(setlist_id, position)
session_id (nullable)         created_at
error                         UNIQUE(group_id, name)
created_at, updated_at

activity_log
──────────────
id (PK)
user_id (FK→users)
group_id (FK→groups, nullable)
event_type
detail
created_at
(indexes: user, event_type, created_at)

events                          event_responses
──────────────                 ─────────────────
id (PK)                        id (PK)
group_id (FK→groups)           event_id (FK→events)
type                           user_id (FK→users)
name                           status
date                           comment
time                           responded_at
location                       UNIQUE(event_id, user_id)
status
notes
created_by (FK→users)
updated_by (FK→users)
updated_at
created_at

share_links                    invite_tokens
──────────────                ──────────────
id (PK)                       id (PK)
token (UNIQUE)                token (UNIQUE)
track_id (FK→tracks, UNIQUE)  user_id (FK→users)
created_by (FK→users, nullable) expires_at
created_at                    used_at (nullable)
                              created_at
```

- **Multi-tenancy:** groups own sessions, songs, and setlists; users belong to groups via `user_groups`
- **Roles:** `superadmin`, `admin`, `editor`, `readonly` — enforced in API middleware
- `groups → sessions/songs/jobs/setlists/events`: one-to-many, CASCADE delete
- `sessions → tracks`: one-to-many, CASCADE delete
- `tracks → songs`: many-to-one (nullable), SET NULL on delete
- `jobs → sessions`: many-to-one (nullable), SET NULL on delete
- `setlists → setlist_songs`: one-to-many, CASCADE delete
- `setlist_songs → songs`: many-to-one, CASCADE on delete
- `activity_log → users/groups`: many-to-one, tracks user activity for admin stats
- `share_links → tracks`: one-to-one, CASCADE delete
- `share_links → users`: many-to-one (nullable), SET NULL on delete
- `invite_tokens → users`: many-to-one, CASCADE delete
- Songs are created on first tag and reused across sessions within a group
- `events → event_responses`: one-to-many, CASCADE delete
- `event_responses → users`: many-to-one, CASCADE delete
- Setlists are group-scoped ordered collections of songs, independent of sessions
- Events are group-scoped scheduling entries (rehearsals/gigs) with per-member RSVP responses

### REST API

All `/api` endpoints require authentication (JWT cookie or API key header). Role requirements noted in parentheses.

**Auth:** `POST /api/auth/login` | `POST /api/auth/logout` | `GET /api/auth/me` | `PUT /api/auth/password`
**Sessions:** `GET /api/sessions` | `GET /api/sessions/{id}` | `GET /api/sessions/{id}/tracks` | `GET /api/sessions/{id}/audio` | `PUT /api/sessions/{id}/name` | `PUT /api/sessions/{id}/notes` | `PUT /api/sessions/{id}/date` | `PUT /api/sessions/{id}/group` (admin) | `DELETE /api/sessions/{id}` (admin) | `POST /api/sessions/{id}/reprocess` (admin) | `POST /api/sessions/upload/init` (admin, returns presigned URL + job) | `POST /api/sessions/upload/complete` (admin, starts processing after R2 upload) | `POST /api/sessions/upload` (admin, direct multipart fallback, returns 202 + job)
**Jobs:** `GET /api/jobs/{id}` — poll for upload progress (status: pending → processing → completed/failed)
**Tracks:** `POST /api/tracks/{id}/tag` | `DELETE /api/tracks/{id}/tag` | `PUT /api/tracks/{id}/notes` | `GET /api/tracks/{id}/audio` | `POST /api/tracks/{id}/merge` (admin) | `POST /api/tracks/{id}/split` (admin) | `PUT /api/tracks/{id}/trim` (admin) | `POST /api/tracks/{id}/share` | `DELETE /api/tracks/{id}/share`
**Share (public):** `GET /share/{token}` | `GET /api/share/{token}/audio`
**Invite (public):** `POST /api/invite/validate` | `POST /api/invite/accept`
**Songs:** `GET /api/songs` | `POST /api/songs` (editor) | `GET /api/songs/{id}` | `GET /api/songs/{id}/tracks` | `PUT /api/songs/{id}/details` | `PUT /api/songs/{id}/name` | `PUT /api/songs/{id}/group` (admin) | `POST /api/songs/{id}/fetch-lyrics` (editor) | `DELETE /api/songs/{id}` (admin)
**Events:** `GET /api/events` | `POST /api/events` (editor) | `GET /api/events/{id}` | `PUT /api/events/{id}` (editor) | `DELETE /api/events/{id}` (admin) | `POST /api/events/{id}/respond` | `DELETE /api/events/{id}/respond` | `GET /api/events/{id}/responses`
**Setlists:** `GET /api/setlists` | `POST /api/setlists` (editor) | `GET /api/setlists/{id}` | `GET /api/setlists/{id}/songs` | `PUT /api/setlists/{id}/name` (editor) | `PUT /api/setlists/{id}/date` (editor) | `PUT /api/setlists/{id}/notes` (editor) | `PUT /api/setlists/{id}/songs` (editor, replace order) | `POST /api/setlists/{id}/songs` (editor, add song) | `DELETE /api/setlists/{id}/songs/{position}` (editor) | `DELETE /api/setlists/{id}` (admin)
**Admin:** `GET/POST /api/admin/users` | `DELETE /api/admin/users/{id}` | `POST .../resend-invite` | `PUT .../password` | `PUT .../role` | `PUT .../name` | `POST/DELETE .../groups/{id}` | `GET/POST /api/admin/groups` | `DELETE /api/admin/groups/{id}` | `GET /api/admin/stats` (all superadmin)
**Public:** `GET /` (landing page) | `POST /api/access-request`
**Health:** `GET /health`

## Build & Development Commands

```bash
# Activate the venv (Python 3.12 via Homebrew)
source .venv/bin/activate

# Install in development mode
pip install -e ".[dev]"

# Run the CLI
jam-session serve                          # start API server
jam-session upload <file> -s URL -g GROUP  # upload to remote server
jam-session add-user EMAIL                 # create user + send invite (or --password to set directly)
jam-session add-group NAME                 # create group
jam-session assign-user EMAIL GROUP        # add user to group
jam-session remove-user EMAIL GROUP         # remove user from group
jam-session list-users / list-groups       # list entities
jam-session reset-password EMAIL           # change password
jam-session set-role EMAIL ROLE            # change user role
jam-session reset-db                       # wipe all data (with confirmation)

# Nuke DB + files, re-seed test data, and restart the server
./scripts/nuke-and-restart.sh

# Seed the database with test data only (no restart)
python scripts/seed-db.py

# Run all tests
pytest

# Run a single test
pytest tests/test_splitter.py::test_function_name

# Lint
ruff check src/ tests/

# Format
ruff format src/ tests/

# Start the frontend dev server
cd web && npm run dev
```

## Development Process

- **Always run `pytest` after every code change** to catch regressions early
- **Always run `ruff check src/ tests/`** before committing to catch lint errors
- **Always run `cd web && npx tsc --noEmit`** before pushing to catch TypeScript errors across the entire frontend, not just in files you changed
- Test fixtures generate synthetic audio (sine tones + silence) so tests run fast with no real audio files needed
- Commit each phase/feature independently
- **Keep docs up to date** — when changing behavior (new/modified endpoints, CLI commands, env vars, schema changes, defaults), update `CLAUDE.md` and `docs/pipeline.md` in the same commit

### UI Refinement Workflow

When making UI/CSS changes, follow this workflow for **each** change:

1. Read the current component code
2. Make the CSS/JSX change (prefer minimal CSS changes over restructuring HTML)
3. Run `npx playwright screenshot http://localhost:5173/[path] /tmp/screenshot.png --color-scheme dark` to capture the result (note: authenticated pages will show the login screen unless `--load-storage` is used with a saved auth state)
4. Verify the build compiles with no errors (`cd web && npx tsc --noEmit`)
5. If positioning/layout change, check computed styles for mobile (375px) and desktop (1280px) viewports

Rules:
- Commit each logical change separately with descriptive messages
- If a change requires more than 3 files, stop and explain why before proceeding

### Key patterns for working in this codebase

- **Config/storage singletons:** `get_config()` and `get_storage()` are module-level singletons. In tests, call `reset_config()` and `reset_storage()` (via `monkeypatch` env vars) to reinitialize.
- **Auth in tests:** API tests need `JAM_JWT_SECRET` set. Use the `auth_client` fixture pattern from `test_api.py`: create a user/group, log in via `/api/auth/login`, and the cookie is set on the test client.
- **Group scoping:** Almost all data is scoped to a group. When adding endpoints or DB queries, ensure they filter by the user's `group_ids`. Use `_require_group_access()` in API endpoints.
- **Storage abstraction:** Never read/write audio files directly with `Path` in API code. Use `get_storage()` so the code works with both local files and R2. The `storage.put()/get()/delete()` methods handle both backends.
- **Relative paths in DB:** Audio paths stored in the DB are relative to `JAM_DATA_DIR`. Use `config.make_relative()` when storing and `config.resolve_path()` when reading.

## System Dependencies

- **Python 3.12** — installed via `brew install python@3.12`, venv at `.venv/`
- **FFmpeg** — installed via `brew install ffmpeg`
- **Node.js** — required for the web frontend (Vite + React)

## Deployment

The app runs in Docker via `docker compose`. CI/CD is via GitHub Actions (`.github/workflows/deploy.yml`): push to `main` triggers SSH deploy to the VPS.

**Required GitHub Secrets:** `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_PASSPHRASE`

**SQLite backups:** `scripts/backup-db.sh` uses `sqlite3 .backup` for safe copies. Add a cron job in the container or host to run it periodically.

## QA Deployments

Feature branches can be deployed to `<branch>.jam-jar.app` for testing on any device.

**How it works:**
1. Create a PR from your feature branch
2. Add the `deploy-qa` label to the PR
3. GitHub Actions builds and deploys a QA environment with seeded test data
4. A comment appears on the PR with the QA URL
5. Log in with any seeded user (e.g., `test`) using the QA password from `JAM_QA_PASSWORD`
6. Removing the label or closing/merging the PR tears down the environment

**Constraints:** Max 3 concurrent QA environments. Each gets 512MB RAM, 1 CPU.

**Infrastructure:** Caddy (systemd on VPS) reverse-proxies subdomains to per-branch Docker Compose projects. QA config files live in `/etc/caddy/qa-sites/`. Workspaces live in `/opt/jamjar-qa/<branch>/`.

**Scripts:**
- `scripts/qa-deploy.sh <branch> <repo-url> <git-ref>` — deploy a QA environment
- `scripts/qa-teardown.sh <branch>` — tear down a QA environment

**Environment:** QA environments use local-only storage (no R2), no SMTP, and a unique JWT secret. The seeded database uses `JAM_QA_PASSWORD` for all user passwords.

## Environment Variables

All configuration is via `JAM_*` environment variables. Defaults match pre-config behavior — nothing breaks without a `.env` file.

| Variable | Default | Description |
|----------|---------|-------------|
| `JAM_DATA_DIR` | `.` (cwd) | Root for recordings/, tracks/, jam_sessions.db |
| `JAM_DB_PATH` | `jam_sessions.db` | SQLite path (relative to DATA_DIR or absolute) |
| `JAM_INPUT_DIR` | `recordings` | Upload destination (relative to DATA_DIR or absolute) |
| `JAM_OUTPUT_DIR` | `tracks` | Exported tracks base dir (relative to DATA_DIR or absolute) |
| `JAM_CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `JAM_PORT` | `8000` | API server port |
| `JAM_MAX_UPLOAD_MB` | `500` | Maximum upload file size in MB |
| `JAM_JWT_SECRET` | *(empty)* | JWT signing key (required for auth) |
| `JAM_API_KEY` | *(empty)* | API key for CLI uploads (X-API-Key header) |
| `JAM_STATIC_DIR` | *(unset)* | SPA static file directory (enables catch-all route) |
| `JAM_R2_ACCOUNT_ID` | *(empty)* | Cloudflare R2 account ID |
| `JAM_R2_ACCESS_KEY_ID` | *(empty)* | R2 access key |
| `JAM_R2_SECRET_ACCESS_KEY` | *(empty)* | R2 secret key |
| `JAM_R2_BUCKET` | *(empty)* | R2 bucket name (enables remote storage when set) |
| `JAM_R2_ENABLED` | *(empty)* | Enable R2 storage (`true`/`1`/`yes`). Redundant if `JAM_R2_BUCKET` is set |
| `JAM_R2_CUSTOM_DOMAIN` | *(empty)* | Custom domain for R2 public URLs (skips presigned URLs) |
| `JAM_SMTP_HOST` | *(empty)* | SMTP server hostname (enables invite emails) |
| `JAM_SMTP_PORT` | `587` | SMTP server port |
| `JAM_SMTP_USER` | *(empty)* | SMTP username |
| `JAM_SMTP_PASSWORD` | *(empty)* | SMTP password |
| `JAM_SMTP_FROM` | *(empty)* | From address for emails (falls back to SMTP_USER) |
| `JAM_APP_URL` | `http://localhost:5173` | Public URL of the app (used in invite links) |
| `JAM_ACCESS_REQUEST_EMAIL` | *(empty)* | Email address for access request notifications (falls back to `JAM_SMTP_FROM`) |

Path values stored in the DB are relative to `JAM_DATA_DIR`. The `config.resolve_path()` method resolves them to absolute at runtime. Already-absolute paths (from old DBs) pass through unchanged.

## Design Decisions

- **Output format:** AAC in M4A container at 192kbps. AAC was chosen over Opus for Safari/iOS compatibility.
- **Song detection:** Energy-based, not silence-based. A 15-second smoothing window and minimum duration filter distinguish actual songs from brief noodling between them.
- **Default threshold:** -20 dB with 120s minimum duration. For louder rooms or more noodling, raise the threshold (e.g., -15). For quieter recordings, lower it (e.g., -25).
- **Performance:** ffmpeg handles all decoding and segment export at the C level. A 1.5hr session processes in ~10 seconds.
- **Database:** SQLite — no server, portable, lives in the project directory
- **Backend API:** FastAPI — serves JSON endpoints and static audio files
- **Frontend:** React + TypeScript + Tailwind via Vite — clean separation from backend
- **Auth:** JWT in httponly cookies for browser sessions, API key via `X-API-Key` header for CLI. Bcrypt for password hashing.
- **Multi-tenancy:** Groups own sessions and songs. Users are assigned to groups. Role-based access control (superadmin > admin > editor > readonly).
- **Storage:** Pluggable backend via `storage.py`. Local filesystem by default; Cloudflare R2 when `JAM_R2_BUCKET` is set. Audio served via presigned URLs (or custom domain) when remote.
- **Song tagging:** Manual via web UI. Songs are scoped to groups and auto-created on first tag.

## Detailed Documentation

- [`docs/pipeline.md`](docs/pipeline.md) — processing pipeline data flow
- [`docs/operations.md`](docs/operations.md) — server reset and bulk upload procedures
- [`docs/roadmap.md`](docs/roadmap.md) — current, next, and future work items
