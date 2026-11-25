# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Interaction Modes

The user prefixes messages to signal how much autonomy to give:

- **`discuss:`** — Back-and-forth mode. Check in at decision points, present options, ask for input before acting.
- **`go:`** — Autonomous mode. Make reasonable assumptions and execute. Only stop for genuinely ambiguous or risky decisions.
- **No prefix** — defaults to `discuss:` mode.

## General Behavior

- When asked to implement something, start coding immediately. Do not spend excessive time on codebase exploration, task creation, or planning unless explicitly asked to plan. Bias toward action.
- After committing and pushing, stop. Do not automatically start new tasks, brainstorming, or invoke skills unless the user explicitly asks for the next thing.
- Claude owns day-to-day development and maintenance. Commit and push to non-`main` branches (feature branches, `claude/*` branches) without asking; open PRs when work is ready for review.
- Land changes on `main` via PR, never by pushing directly. Claude may merge its own PRs (and Dependabot PRs) once CI is green — merging deploys to production, so only merge work that is tested, non-breaking, and reversible. Ask the user first for anything risky: data migrations, auth changes that could lock users out, infra/deploy changes that can't be easily rolled back.
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
| `gdrive.py` | Read-only Google Drive client via a service account (JWT → token, list folder audio recursively, stream downloads); `get_drive_client()` is None when unconfigured |
| `transcribe.py` | Optional local speech-to-text (faster-whisper, CPU): rough transcript of a track's vocals, chunked to keep memory flat |
| `song_match.py` | Pure-Python text matching (TF-IDF over word n-grams) of a transcript against chart lyrics and tagged takes' transcripts |
| `refine.py` | Corrects a detected split from what is sung: cuts a track at a dip in level when the two sides are different songs, joins neighbouring takes of the same song (pure planning on stored transcripts + `apply` through `track_ops`) |
| `identify.py` | The automatic song-tagging run: transcribe pending tracks, refine freshly detected splits, then re-assess every untagged track and tag the recognised ones |
| `tab_clean.py` | Mechanical cleanup of guitar tabs from tab sites: drops title block, credits, e-mail addresses, symbol legend, chord diagrams and chords-over-lyrics the chart already has, by deleting whole lines (staff lines are never edited); pulls the source line out as `tab_source` |
| `storage.py` | Storage abstraction: `LocalStorage` (filesystem) and `R2Storage` (Cloudflare R2), incl. `list_objects()` for usage stats |
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
notes, kind                audio_path, notes              UNIQUE(group_id, name)
created_at                 created_at                     background,
                                                          background_sources,
                                                          tab,
                                                          score_path (nullable)

jobs                           setlists                       setlist_songs
──────────────                ──────────────                 ─────────────────
id (PK, TEXT)                 id (PK)                        id (PK)
type                          group_id (FK→groups)           setlist_id (FK→setlists)
group_id (FK→groups)          name                           song_id (FK→songs)
status (pending→…)            date                           position
progress (TEXT)               notes                          UNIQUE(setlist_id, position)
session_id (nullable)         created_at
error                         UNIQUE(group_id, name)
detail (JSON, nullable)
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

group_songs                    song_links
──────────────                ──────────────
group_id (FK→groups)          id (PK)
song_id (FK→songs)            song_id (FK→songs)
notes  (per-band notes)       kind (lesson|backing_track|other)
created_at                    url, title
PRIMARY KEY (group_id,        created_by (FK→users, nullable)
             song_id)         created_at

share_links                    invite_tokens
──────────────                ──────────────
id (PK)                       id (PK)
token (UNIQUE)                token (UNIQUE)
kind (track|session|          user_id (FK→users)
      setlist|song)           expires_at
track_id / session_id /       used_at (nullable)
  setlist_id (one set,        created_at
  each UNIQUE, CASCADE)
song_id (CASCADE;
  UNIQUE(song_id, group_id))
group_id (FK→groups, CASCADE)
created_by (FK→users, nullable)
created_at
expires_at (UTC; NULL = never)
```

- **Multi-tenancy:** groups own sessions and setlists; users belong to groups via `user_groups`
- **Shared song catalog:** songs are standalone; `group_songs` links each song to every band that plays it (with per-band notes). A user sees a song if any of their groups is linked. `songs.group_id` is the song's *home* band (always also linked; re-homed if unlinked or the group is deleted) and `UNIQUE(group_id, name)` is legacy. Song names are unique per band (case-insensitive) across links. Tagging, creating a song, adding to a setlist, or moving a session reuses/links a same-named song from the caller's other bands instead of duplicating it. Take counts and song tracks are scoped to the caller's bands.
- **Roles:** `superadmin`, `admin`, `editor`, `readonly` — enforced in API middleware
- `sessions.kind`: what a recording is — `jam`, `gig`, `demo`, `studio`, or `''` (not set, the default). Shown as a badge on the Recordings list, the recording page and a song's takes; the Recordings list can filter by it. A song's takes list studio recordings first
- `jobs.detail`: JSON with a job's structured progress (`started_at`, `step`, `steps`, `current`, `total`, `duration_sec`, `segments`, `levels`); `update_job_progress(job_id, text, detail)` merges into it. Only read by `GET /api/jobs/{id}`
- `groups → sessions/jobs/setlists`: one-to-many, CASCADE delete
- `groups ↔ songs` via `group_songs`: many-to-many, CASCADE on both sides; deleting a group deletes songs only that group plays
- `sessions → tracks`: one-to-many, CASCADE delete
- `tracks → songs`: many-to-one (nullable), SET NULL on delete
- `jobs → sessions`: many-to-one (nullable), SET NULL on delete
- `setlists → setlist_songs`: one-to-many, CASCADE delete
- `setlist_songs → songs`: many-to-one, CASCADE on delete
- `activity_log → users/groups`: many-to-one, tracks user activity for admin stats
- `song_activity (user_id, song_id, last_opened_at, last_performed_at)`: per-user "recently opened/performed" timestamps (UTC), CASCADE on user/song delete, merged (latest wins) on song merge. Recorded by the song page (opened) and Perform mode (performed)
- `songs.tab`: guitar tablature (intros, riffs, solos) kept apart from the chords/lyrics `sheet`; shown as a Tab tab on the song page only when set, never in Perform mode. Filled from merged songs on merge
- `songs.tab_source`: where the tab came from, kept out of the tab's text: a URL (what the library-curation routine stores) or text like `Ultimate Guitar, 186 votes, 4.8★` (taken from the source line of older tabs). Cleared with the tab; left alone by edits that don't send one; carried over with the tab on a song merge
- `tab_flags (id, song_id CASCADE, tab, source, reason wrong_song|inaccurate|messy|other, removed, flagged_by, created_at, resolved_at)`: tabs someone marked as bad, with the tab and its source as they were. `messy` (`removed = 0`): the tab gets the mechanical cleanup at once and stays on the song until the library-curation routine has gone over it. Any other reason (`removed = 1`): the tab is taken off the song at once and the routine looks for a different version. Rows are kept after that: the API key (the routine) can't set a tab whose `source` matches a removed one for that song (409), while a person can. A person saving the tab by hand closes the song's open flags. Moved over by song merges
- `songs.score_path`: notated sheet music — the storage key of one uploaded MusicXML file (`scores/<song_id>-<sha256-16>.<mxl|musicxml>`, relative to `JAM_DATA_DIR`). The API exposes it as `score_format` / `score_version` (the content hash), never the path. The song page shows a Score tab only when set (and opens on it when the song has no chart). The file is deleted with the song, when the score is removed or replaced, and when a group delete takes the song with it; on a song merge the kept song's score wins and the other file is deleted (or carried over if the kept song has none). `GET /api/admin/storage` counts score files as referenced
- `songs.background` / `background_sources`: a short written history of the song ("About" tab) with a JSON list of `{title, url}` sources. Written offline by Claude from web sources and stored as static content through the API (the server never calls an LLM); filled from the merged song on a song merge
- `curation_runs (id, summary, items JSON, created_at)`: log of the scheduled library-curation routine (a daily Claude session that adds songs and fills in videos/histories through the API). `items` is a list of `{song_id, song_name, action}` with action `added_song`/`added_lesson`/`added_backing_track`/`added_original`/`added_tab`/`added_background`/`replaced_video` (a video marked as bad was replaced)/`removed_video` (marked as bad, no replacement found)/`cleaned_tab` (clutter removed from a tab)/`replaced_tab` (a tab marked as bad was replaced)/`removed_tab` (marked as bad, no other version found)/`cleaned_chart` (metadata clutter removed from a chart)/`fixed_label` (wrong or misspelled name/artist corrected)/`updated_chart`
- `drive_folders (id, folder_id UNIQUE, name, group_id nullable = mixed bands, created_by)`: Drive folders shared with the service account; `drive_imports (drive_file_id PK, file_name, status imported|skipped|duplicate, session_id SET NULL, group_id, created_by)`: which Drive files were already handled, so they aren't offered again
- `sessions.split_state`: how the tracks were cut — `auto` (by detection, on upload/import/re-detect; waiting to be refined from the transcripts), `refined` (detected, then split/merged by song once) or `''` (by hand: manual split, single-song import, any track merge/split/trim, merged recordings; and everything from before this existed). Only `auto` recordings are ever re-cut automatically
- `track_transcripts (track_id PK CASCADE, audio_path, model, text, segments, levels)`: rough speech-to-text transcript of a track's vocals, redone when the track's `audio_path` changes; `segments` is a JSON list of timed phrases `[start, end, text, compression_ratio]` and `levels` the loudness (dB) per second, both NULL on older transcripts and used only to refine splits; `track_auto_tags (track_id PK CASCADE, song_id CASCADE, score, source lyrics|takes)`: the song the nightly run last tagged a track with. A track is "auto-tagged" while its `song_id` still equals it; a track is never auto-tagged with the same song twice, so removing a wrong tag sticks
- `song_links → songs`: many-to-one, CASCADE delete. Reference videos (how-to lessons, backing tracks, and `other` = the original recording, ideally the official music video, shown as "Original") shared by every band that plays the song; moved over by song merges
- `video_flags (id, song_id CASCADE, kind, url, title, video_key, reason wrong_song|wrong_instrument|poor_quality|unavailable|other, flagged_by, created_at, resolved_at)`: videos someone marked as bad. Flagging moves the row here out of `song_links`, so the video leaves the song at once; the library-curation routine looks for a replacement and resolves the flag. Rows are kept after that: the API key (the routine) can't add the same video (`video_key` = YouTube id, else the URL) to that song again (409), while a person adding it again clears the flag. Moved over by song merges
- `video_misses (song_id CASCADE, kind, reason not_found|not_applicable, created_at, PK (song_id, kind))`: kinds of video the library-curation routine searched for and couldn't get for a song, so it doesn't search again every night. `not_found` counts for 30 days (`Database.VIDEO_MISS_DAYS`), `not_applicable` (e.g. a backing track for a solo piano piece) for good. Adding a video of that kind to the song removes the row; carried over by song merges
- `share_links`: public, read-only links to one track, recording (`session`), setlist or song. Exactly one target column is set, per `kind`; deleting the target deletes its link. One link per track/recording/setlist, and per song per band (`group_id` is the band the link belongs to; for a song, a band of the person who shared it). `expires_at` is UTC (`NULL` = never); new links default to `JAM_SHARE_EXPIRY_DAYS` (30). An expired link answers 410 and is replaced by a new token when shared again. Song links follow a song merge. The old track-only table is dropped and recreated on upgrade (old links don't carry over)
- `share_links → users`: many-to-one (nullable), SET NULL on delete
- `invite_tokens → users`: many-to-one, CASCADE delete
- Songs are created on first tag and reused across sessions and bands
- Setlists are group-scoped ordered collections of songs, independent of sessions
- **Removed scheduling feature:** the events/RSVP feature was removed. Existing production DBs still contain orphaned `events` and `event_responses` tables (and groups may still have `scheduling` in `groups.features`); no code reads them. They are left in place deliberately (no data loss) and can be dropped later. Fresh DBs don't create them. The generic `groups.features` flag mechanism remains for future feature flags.

### REST API

All `/api` endpoints require authentication (JWT cookie or API key header). Role requirements noted in parentheses.

**Auth:** `POST /api/auth/login` | `POST /api/auth/logout` | `GET /api/auth/me` | `PUT /api/auth/password`
**Sessions:** `GET /api/sessions` | `GET /api/sessions/{id}` (also carries `tagging`: `{state: running|queued, transcribed, total}` while a tagging run is working on the recording or queued for it, else null) | `GET /api/sessions/{id}/tracks` | `GET /api/sessions/{id}/audio` | `PUT /api/sessions/{id}/name` | `PUT /api/sessions/{id}/notes` | `PUT /api/sessions/{id}/date` | `PUT /api/sessions/{id}/kind` (editor, `{kind}`: `jam`/`gig`/`demo`/`studio`/`""`) | `POST /api/sessions/{id}/merge` (admin, `{session_ids: [...]}`: merges those recordings of the same band into this one, in order; 202 + job) | `PUT /api/sessions/{id}/group` (admin) | `DELETE /api/sessions/{id}` (admin) | `POST /api/sessions/{id}/reprocess` (admin; `{single}` to re-detect, or `{segments: [[start, end], ...]}` to split by hand) | `POST /api/sessions/upload/init` (admin, returns presigned URL + job) | `POST /api/sessions/upload/complete` (admin, starts processing after R2 upload) | `POST /api/sessions/upload` (admin, direct multipart fallback, returns 202 + job)
**Google Drive import** (admin): `GET /api/drive` (`{configured, service_account_email}`) | `GET /api/drive/folders` | `POST /api/drive/folders` (`{url, group_id?}`; folder must be shared with the service account) | `PUT /api/drive/folders/{id}/group` | `DELETE /api/drive/folders/{id}` (imports are kept) | `GET /api/drive/folders/{id}/files` (audio in the folder and subfolders, newest first, with `status` new/imported/skipped/duplicate and `suggested_date`) | `POST /api/drive/import` (`{file_id, group_id, name?, date?, single?, force?}`, 202 + job like an upload; duplicates by duration fail the job and mark the file `duplicate`) | `POST /api/drive/skip` (`{file_id, file_name?, skipped}`). UI: Recordings → Upload → Import from Google Drive (`/import/drive`)
**Jobs:** `GET /api/jobs/{id}` — poll for upload progress (status: pending → processing → completed/failed). Besides the `progress` text, processing jobs report optional structured progress: `step` (`download`/`analyze`/`upload`/`detect`/`export`/`save`/`merge`), `steps` (the steps this job goes through), `current`/`total` (tracks cut or saved), `elapsed_sec` (since the work started; null when not running), `duration_sec`, `segments` (the songs found) and `levels` (96 loudness values 0–1 along the recording). All are null on jobs that only report text
**Tracks:** (responses from `GET /api/sessions/{id}/tracks` carry `auto_tagged`: the tag was set by the nightly run) `POST /api/tracks/{id}/tag` | `DELETE /api/tracks/{id}/tag` | `PUT /api/tracks/{id}/notes` | `GET /api/tracks/{id}/audio` | `POST /api/tracks/{id}/merge` (admin) | `POST /api/tracks/{id}/split` (admin) | `PUT /api/tracks/{id}/trim` (admin)
**Share links:** (any role can share what it can see; the creator, an admin of the link's band, or a superadmin can change or revoke) `GET /api/shares` (the caller's own links; admins also every link in their bands, superadmins all; includes expired, with `expired`, `title`, `app_path`, `can_manage`) | `GET /api/shares/lookup?kind=&id=` (`{link | null, default_expiry_days}`) | `POST /api/shares` (`{kind: track|session|setlist|song, id, expires_in_days?}`: days 1–3650, `null` = never, left out = the default; returns the live link if there is one, setting its expiry when given) | `PUT /api/shares/{id}/expiry` (`{expires_in_days}`, also renews an expired link) | `DELETE /api/shares/{id}`
**Share (public, no auth; 404 unknown/revoked, 410 expired):** `GET /api/share/{token}` (`{kind, expires_at, track|session|setlist|song}`: a take's audio; a recording's tracks; a setlist's songs; a song's chart, tab, history and videos — never notes or other recordings) | `GET /api/share/{token}/audio` (track link) | `GET /api/share/{token}/tracks/{track_id}/audio` (recording link) | `GET /api/share/{token}/songs/{song_id}` (chart of a song in a shared setlist). The page itself is the SPA route `/share/:token` (and `/share/:token/songs/:songId`); in production `GET /share/...` returns the SPA's `index.html` with the shared thing's name in `<title>` and Open Graph tags (for link previews), `noindex` (meta + `X-Robots-Tag`), and status 404/410 for unknown/expired links
**Invite (public):** `POST /api/invite/validate` | `POST /api/invite/accept`
**Songs:** `GET /api/songs` (`?group_id=`, `?summary=true` leaves out `sheet`/`background` for list views; `has_sheet` says whether a chart exists) | `GET /api/songs/search?q=` (songs whose chart/lyrics contain `q`, with the first matching line; min 2 chars) | `POST /api/songs` (editor) | `GET /api/songs/{id}` | `GET /api/songs/{id}/tracks` | `PUT /api/songs/{id}/details` | `PUT /api/songs/{id}/name` | `PUT /api/songs/{id}/group` (admin, move home band) | `POST /api/songs/{id}/groups` (editor, link a band) | `DELETE /api/songs/{id}/groups/{group_id}` (admin, unlink) | `PUT /api/songs/{id}/groups/{group_id}/notes` (editor, per-band notes) | `POST /api/songs/merge` (admin, `{keep_id, merge_id}`) | `POST /api/songs/{id}/links` (editor, `{url, kind, title?}`; YouTube titles auto-filled via oEmbed) | `DELETE /api/songs/{id}/links/{link_id}` (editor) | `POST /api/songs/{id}/links/{link_id}/flag` (editor, `{reason}`: marks the video as bad; it is removed now and replaced by the library-curation routine) | `POST /api/songs/{id}/activity` (`{event: opened|performed}`, 204; no-op for API key). Song responses include `created_at` and the caller's `last_opened_at` / `last_performed_at` | `PUT /api/songs/{id}/tab` (editor, `{tab, source?}`; empty clears it; `source` is where it came from and is kept when left out; 409 for the API key when that source was marked as bad for the song; song responses include `tab`, `has_tab`, `tab_source` and `tab_flag` (the reason of an open flag, else null), and summary lists leave `tab` empty) | `POST /api/songs/{id}/tab/clean` (editor; runs the mechanical tab cleanup, safe to repeat) | `POST /api/songs/{id}/tab/flag` (editor, `{reason}`: `messy` cleans it now and keeps it for the routine to finish; `wrong_song`/`inaccurate`/`other` remove it now for the routine to replace) | `PUT /api/songs/{id}/background` (editor, `{text, sources: [{title, url}]}`; text cites sources with `[n]` markers, every marker must match a source) | `DELETE /api/songs/{id}/background` (editor). Song responses include `background: {text, sources} | null`; the song page shows an About tab only when it is set | `GET /api/songs/{id}/score` (the MusicXML file) | `PUT /api/songs/{id}/score` (editor, multipart `file`: `.mxl`/`.musicxml`/`.xml`, max 20 MB, replaces any existing score) | `DELETE /api/songs/{id}/score` (editor) | `POST /api/songs/{id}/fetch-lyrics` (editor) | `DELETE /api/songs/{id}` (admin)
**Setlists:** `GET /api/setlists` | `POST /api/setlists` (editor) | `GET /api/setlists/{id}` | `GET /api/setlists/{id}/songs` | `PUT /api/setlists/{id}/name` (editor) | `PUT /api/setlists/{id}/date` (editor) | `PUT /api/setlists/{id}/notes` (editor) | `PUT /api/setlists/{id}/songs` (editor, replace order) | `POST /api/setlists/{id}/songs` (editor, add song) | `DELETE /api/setlists/{id}/songs/{position}` (editor) | `DELETE /api/setlists/{id}` (admin)
**Admin:** `GET/POST /api/admin/users` | `DELETE /api/admin/users/{id}` | `POST .../resend-invite` | `PUT .../password` | `PUT .../role` | `PUT .../name` | `POST/DELETE .../groups/{id}` | `GET/POST /api/admin/groups` (each group carries its stats for Admin → Groups: `member_count`, `members` (names), `song_count`, `setlist_count`, `session_count`, `track_count`, `tagged_track_count`, `recorded_sec`, `last_session_date`, `created_at`) | `DELETE /api/admin/groups/{id}` | `GET /api/admin/stats` | `GET /api/admin/users/{id}/song-activity` (read-only per-song opened/performed timestamps for one user, newest first; used by the library-curation routine) | `POST /api/admin/curation-runs` (`{summary, items: [{song_id?, song_name, action}]}`, logs one run of the library-curation routine) | `GET /api/admin/curation-runs` (newest first; shown in Admin → Library) | `GET /api/admin/video-flags` (videos marked as bad that the routine hasn't handled yet, oldest first; `?include_resolved=true` for all) | `POST /api/admin/video-flags/{id}/resolve` (204; the routine is done with it) | `GET /api/admin/tab-flags` (tabs marked as bad that the routine hasn't handled yet, oldest first, each with the flagged `tab`, its `source` and `removed`; `?include_resolved=true` for all) | `POST /api/admin/tab-flags/{id}/resolve` (204) | `GET /api/admin/video-misses` (the `{song_id, kind, reason, created_at}` pairs the routine should not search for now) | `POST /api/admin/video-misses` (a list of `{song_id, kind, reason?}`, 204; records what a run couldn't find) | `DELETE /api/admin/video-misses/{song_id}/{kind}` (204; search for it again) | `GET /api/admin/song-identification` (automatic song-tagging status: `available`, `model`, `nightly_hour_utc`, `running`, `queued`, track/untagged/pending-transcript/auto-tagged counts) | `POST /api/admin/song-identification/run` (start a full run now, queued behind a running one; `?session_id=` transcribes only that recording, then re-assesses every untagged track; 202, 409 if the same run is already running or queued, 404 for an unknown recording, 503 without speech-to-text) | `GET /api/admin/storage` (file storage usage from listing the R2 bucket or local disk: totals, per-folder, unreferenced files, DB paths with missing files, and a per-recording breakdown of original + split-track bytes; cached 10 min, `?refresh=true` to re-list; shown in Admin → Storage) (all superadmin)
**Public:** `GET /` (landing page) | `POST /api/access-request`
**Health:** `GET /health` — runs a query against SQLite; returns 503 if the DB is unusable (used by the Docker `HEALTHCHECK`)

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
jam-session identify-songs                 # transcribe new tracks + tag untagged ones it recognises (--match-only, --max-minutes N, --session ID)
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
- **Always run `cd web && npm run build`** before pushing to catch TypeScript and build errors across the entire frontend, not just in files you changed. This runs `tsc -b` (build mode, which enforces project references and stricter checks like `verbatimModuleSyntax`) followed by `vite build`.
- Test fixtures generate synthetic audio (sine tones + silence) so tests run fast with no real audio files needed
- Commit each phase/feature independently
- **Keep docs up to date** — when changing behavior (new/modified endpoints, CLI commands, env vars, schema changes, defaults), update `CLAUDE.md` and `docs/pipeline.md` in the same commit

### UI Refinement Workflow

When making UI/CSS changes, follow this workflow for **each** change:

1. Read the current component code
2. Make the CSS/JSX change (prefer minimal CSS changes over restructuring HTML)
3. Run `npx playwright screenshot http://localhost:5173/[path] /tmp/screenshot.png --color-scheme dark` to capture the result (note: authenticated pages will show the login screen unless `--load-storage` is used with a saved auth state)
4. Verify the build compiles with no errors (`cd web && npm run build`)
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

## Agent-Driven Workflow

This project uses an agent-driven development workflow where GitHub Issues serve as the shared backlog. See `docs/superpowers/specs/2026-03-23-agent-driven-development-design.md` for the full spec.

### Session Startup Protocol

When beginning a work session (not just answering a quick question):

1. **Read project memory** (automatic) — MEMORY.md loads with current focus, decisions, and patterns
2. **Check GitHub state** — run `gh issue list --label in-progress` and `gh pr list` to see what's active
3. **Summarize status** — briefly tell the user what's in flight and ask what to work on (unless they've already said)

### Session End Protocol

At the end of any session where work state changed:

1. **Update `current-focus.md`** in project memory with current issue/PR state
2. **Update labels** on GitHub issues to reflect current status

### Issue Workflow

- Issues are created with the `backlog` label using the work-item template
- Label transitions: `backlog` → `in-progress` → `review` → merged
- Claude owns all label transitions and merges (see General Behavior for when to ask first)
- Priority: oldest `backlog` issue first, unless `priority-high` label is present
- Feature branches: `feature/<short-description>`
- Merging to `main` deploys to production; check the deploy succeeded (`/health`) after merging

## System Dependencies

- **Python 3.12** — installed via `brew install python@3.12`, venv at `.venv/`
- **FFmpeg** — installed via `brew install ffmpeg`
- **Node.js** — required for the web frontend (Vite + React)

## Deployment

The app runs in Docker via `docker compose`. CI/CD is via GitHub Actions (`.github/workflows/deploy.yml`): push to `main` builds the image on the GitHub runner (with `pull`, so base images are fresh) and pushes it to GHCR as `ghcr.io/<owner>/jamjar:<commit sha>` (and `:latest`); nothing is built on the VPS. The deploy job then SSHes in, pulls that image with the job's short-lived `GITHUB_TOKEN`, tags it `jamjar:live` (the image `docker-compose.yml` runs; the image it replaces becomes `jamjar:previous`), runs `docker compose up -d --no-build`, and polls `/health` for up to ~60s. If the new version never becomes healthy it resets to the previous commit, puts `jamjar:previous` back as `jamjar:live`, restarts, and fails the workflow. The registry keeps the 10 newest images.

`IMAGE_PLATFORM` in `deploy.yml` and `qa-deploy.yml` (`linux/amd64`) must match the VPS's CPU; the deploy checks this after pulling and stops before touching the running app if it doesn't. Locally, `docker compose up --build` still builds the image.

**Required GitHub Secrets:** `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_PASSPHRASE`

**SQLite backups:** `scripts/backup-db.sh` uses `sqlite3 .backup` for safe copies. Add a cron job in the container or host to run it periodically.

## QA Deployments

Feature branches can be deployed to `<branch>.jam-jar.app` for testing on any device.

**How it works:**
1. Create a PR from your feature branch
2. Add the `deploy-qa` label to the PR
3. GitHub Actions builds the image (pushed to GHCR as `ghcr.io/<owner>/jamjar-qa:<branch>`), and the VPS pulls it and starts a QA environment with seeded test data
4. A comment appears on the PR with the QA URL
5. Log in with any seeded user (e.g., `test`) using the QA password from `JAM_QA_PASSWORD`
6. Removing the label or closing/merging the PR tears down the environment

**Constraints:** One QA environment at a time (`MAX_QA_ENVS` in `scripts/qa-deploy.sh`; it shares the VPS with production). A deploy for a second branch fails until the first is torn down. It gets 512MB RAM, 1 CPU.

**Infrastructure:** Caddy (systemd on VPS) reverse-proxies subdomains to per-branch Docker Compose projects. QA config files live in `/etc/caddy/qa-sites/`. Workspaces live in `/opt/jamjar-qa/<branch>/`.

**Scripts:**
- `scripts/qa-deploy.sh <branch> <repo-url> <git-ref> [image]` — deploy a QA environment (pulls `image` when given, otherwise builds on the server)
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
| `JAM_GOOGLE_SERVICE_ACCOUNT` | *(empty)* | Google service account JSON key (raw JSON, base64 JSON, or a file path) for Drive import; Drive import is hidden/503 when unset. Needs the Google Drive API enabled on its project |
| `JAM_SHUTDOWN_GRACE_SEC` | `270` | On shutdown (deploys, restarts) wait up to this long for in-flight processing jobs to finish; keep below the compose `stop_grace_period` (5m) |
| `JAM_IDENTIFY_HOUR` | `8` | Hour of day (UTC) of the nightly automatic song-tagging run; `off` disables automatic tagging altogether (nightly and after uploads). Only runs when the `transcribe` extra is installed |
| `JAM_IDENTIFY_MAX_MINUTES` | `180` | Time budget per run for transcribing; the rest is picked up the next night |
| `JAM_IDENTIFY_WAIT_MINUTES` | `30` | How long a tagging run waits for other processing to finish and memory to be free before it skips transcribing (the nightly run picks it up) |
| `JAM_TRANSCRIBE_MODEL` | `small.en` | Whisper model for speech-to-text (`base.en` is faster and lighter, less accurate) |
| `JAM_TRANSCRIBE_MIN_FREE_MB` | `950` | A run skips transcribing when less memory than this is available |
| `JAM_SHARE_EXPIRY_DAYS` | `30` | Default lifetime of a new share link in days; `0`/`never` = links never expire. People can pick another expiry when sharing |
| `JAM_ACCESS_REQUEST_EMAIL` | *(empty)* | Email address for access request notifications (falls back to `JAM_SMTP_FROM`) |

Path values stored in the DB are relative to `JAM_DATA_DIR`. The `config.resolve_path()` method resolves them to absolute at runtime. Already-absolute paths (from old DBs) pass through unchanged.

## Design Decisions

- **Output format:** AAC in M4A container at 192kbps. AAC was chosen over Opus for Safari/iOS compatibility.
- **Song detection:** Energy-based, relative to each recording. A song is a stretch of 90+ seconds at the recording's own playing level (within 7.5 dB of its 90th-percentile loudest second; 9-second smoothing; dips under 8 seconds are bridged), so loud and quiet recordings split the same way. There is deliberately no dB setting: a fixed level (-20 dB) used to sit right on some recordings' music and shred them. The API still accepts `threshold` / `min_duration` from old clients and ignores them. When detection gets it wrong, split by hand (`segments`).
- **Performance:** ffmpeg handles all decoding and segment export at the C level. A 1.5hr session processes in ~10 seconds.
- **Merging recordings:** `track_ops.merge_sessions` joins the source files end to end into one new source (`<id>-merged-<hex>`; FLAC when every source is WAV/FLAC, otherwise AAC) and moves the tracks to the kept recording — renumbered, times shifted to their place in the joined source — so each track keeps its audio file, tag, notes and share link, and trim/split/merge still work. The merged recordings and old source files are deleted last; the kept recording keeps its name, date and type, notes are combined. API only (no UI yet)
- **Background jobs & restarts:** processing runs in executor threads that a restart would kill. Job functions are wrapped with `_tracked_job`; on shutdown the app's lifespan waits for in-flight jobs (`JAM_SHUTDOWN_GRACE_SEC`, compose `stop_grace_period: 5m`), and on startup `fail_interrupted_jobs()` fails any job still `processing` (or `pending` for >2h, i.e. an abandoned presigned upload) with an "interrupted by a server restart" error so nothing hangs
- **Processing screen:** while a recording is uploaded, re-detected or split by hand, the recording page shows `SplitProgress` instead of the track list: the recording's waveform (a ripple runs along a stand-in until detection has measured the real one), which breaks into one coloured block per song as tracks are cut and saved, the job's steps, and how long it has been running. There is deliberately no time-left estimate, only elapsed time and "3 of 9 tracks cut"
- **Response compression:** `JSONGzipMiddleware` gzips JSON responses ≥1KB when the client accepts gzip. It deliberately skips everything else (audio is served with Range requests)
- **Practice tool (`/practice`, More → Practice):** a random 5-minute guitar task from static templates in `web/src/utils/practiceTasks.ts` (8 categories, randomized keys/positions/tempos; no network or LLM), with a 5-minute timer and an inline click track via `useMetronome`. Tuner, Metronome and Practice share `ToolsHeader`
- **Chart rendering:** `sheetParser` pairs chord lines with the lyric line below (column-aligned, wraps on phones); runs of guitar-tab staff lines (`e|--3--`), plus a beat-count line under them, render as one fixed-width block that scrolls sideways. `ChordSheet` squeezes runs of blank lines to one and trims leading/trailing ones before rendering (`tidyBlankLines`); Fetch lyrics joins chart and lyrics with exactly one blank line
- **Tab viewer:** the Tab tab (song page and shared songs) draws tabs with `TabSheet` (`web/src/utils/tabParser.ts`), not the chart renderer: each staff is one block with the chord names over it at the same size (so they line up), fret numbers bright against dim string lines and technique letters in the accent colour; a staff wider than the screen wraps at a bar line (or where every string has dashes), repeating the string names, instead of scrolling sideways; `[Section]` labels become headings with a row of jump chips when there are three or more; sentences are reflowed as small notes; symbol legends in the text are hidden in favour of a built-in "Symbols" list of what the tab uses; the source is one dim line at the end. The editor still shows the plain text
- **Tab cleanup and bad tabs:** what can be decided by pattern is code (`tab_clean.py`, `POST /api/songs/{id}/tab/clean`), so it is reviewed and tested; what needs reading (a tabber's commentary, alternate versions) is left to the library-curation routine, whose instructions are kept in `docs/library-curation-routine.md` (the scheduled task holds a copy; change both together). "Mark tab as bad…" in a song's More menu mirrors bad videos: see `tab_flags`
- **Perform mode looks:** Perform mode (song and setlist) has two looks, toggled by the notebook button in its controls and remembered in `localStorage` (`perform-notebook`): the standard dark chart (`ChordSheet`) and a handwritten notebook (`NotebookSheet` + the `.nb-*` styles in `index.css`), which is the default — off-white ruled paper, lyrics in ballpoint and chords in bold red felt-tip, in the self-hosted Kalam font (`@fontsource/kalam`, precached for offline use). Every notebook row is a whole number of rules tall so the writing stays on the lines; words get a small seeded tilt so repeats don't look typeset. When a chart lists progressions by section (`Verse: C | Em | Am | F`), the notebook repeats each one beside its section headings (`[Verse 2]` falls back to `Verse`), unless that section already has chords written in
- **Perform another song:** the magnifier in the Perform mode header (song and setlist) opens a full-screen quick search (`SongQuickSearch`: the summary song list filtered client-side by name/artist; recently performed songs first before anything is typed; Enter picks the top match). From a song, picking replaces the current Perform entry in history, so leaving goes to that song's page. From a setlist it leaves the set for that song's Perform mode; going back returns to the same song in the set (the position is kept in history state)
- **iOS Home Screen app:** with the `black` status bar style the page starts right under the status bar and iOS fades content that scrolls up beneath it. `--safe-top` in `index.css` is where content may start (the top inset; no extra space is added for that fade, which left too big a gap above page titles), and `main` adds only 0.25rem below it on phones. Use it instead of `env(safe-area-inset-top)` for top padding and sticky offsets
- **Back navigation on phones:** detail pages (`/songs/:id`, `/sessions/:id`, `/setlists/:id`, `/import/*`) show a Back button at the left of the bottom tab bar (`useBack`: history back, or the parent list when opened directly); the top back links/breadcrumbs are desktop-only. Leaving Perform mode pops it off history
- **Song page back link:** pages that link to a song can pass `state={{ from: { to, label } }}` (setlists do); the song page and Perform mode keep it, so "back" returns there instead of to Songs (desktop back link; on phones the bottom-bar Back uses history)
- **List filter bar:** Songs, Recordings and Setlists share one toolbar pattern from `web/src/components/FilterChip.tsx`: a `FilterBar` row of pill chips under the title/search — `SortChip` first, then `BandChip` and other `FilterChip`s, which show the filter's name until set and are highlighted once set, with Clear at the end. Use it for any new list page. Rows show the band (when the person is in several and none is picked) at the start of the second line, not beside the title
- **Song list:** the Songs page loads the summary list once and filters/sorts client-side (artist, recorded, opened/played, band), rendering 50 rows at a time with more loaded on scroll; lyric search goes to `/api/songs/search`. Each row ends with icons for what the song has (`SongHas`): chart, guitar tab, sheet music, and recordings with their count; on wider screens the four keep fixed columns with missing ones drawn faint, on phones only the present ones show
- **Automatic song tagging:** a child process (`jam-session identify-songs`) tags untagged tracks it recognises. The server starts it right after an upload, Drive import or re-split (for that recording's tracks) and nightly at `JAM_IDENTIFY_HOUR` (everything pending); one runs at a time, others queue. It works from local speech-to-text plus text matching; no external service and no LLM. The transcript is poor but only has to pick a song out of the band's own songs: it is matched against chart lyrics (covers) and against transcripts of takes a person tagged (originals; auto-tagged takes are not used as references, so a mistake can't spread). It tags only when one song clearly stands out, never touches a tagged track, and never re-applies a tag someone removed. Before tagging, the same run corrects the split of a freshly detected recording once (`refine.py`): it cuts a track at a dip in level when the words on the two sides are different songs, and joins two takes a few seconds apart that are the same song continuing. It only does that to recordings nobody has cut, tagged or annotated by hand (`sessions.split_state`). The recording page marks such tracks "auto-tagged", and while a run is working on a recording (or queued for it) shows "Recognising the songs: listened to 7 of 23 tracks" and re-checks every 15 seconds, because splits and tags land at the end of the run. A run that finds the server busy (another recording being processed, too little memory) waits up to `JAM_IDENTIFY_WAIT_MINUTES` instead of giving up, and 90 seconds after a restart the server starts runs again for detected recordings that still have untranscribed tracks (`sessions_awaiting_tagging`), since a deploy kills the run in progress and forgets the queue. Every run transcribes its new tracks and then re-assesses every untagged one; it holds ~0.8 GB while it runs and frees it on exit. Details and measured accuracy in `docs/pipeline.md`
- **Database:** SQLite — no server, portable, lives in the project directory. `Database.conn` is a per-thread connection (FastAPI runs sync endpoints in a thread pool; a single shared `sqlite3` connection fails under concurrent requests)
- **Backend API:** FastAPI — serves JSON endpoints and static audio files
- **Frontend:** React + TypeScript + Tailwind via Vite — clean separation from backend
- **Auth:** JWT in httponly cookies for browser sessions, API key via `X-API-Key` header for CLI. Bcrypt for password hashing.
- **Multi-tenancy:** Groups own sessions and setlists; songs are shared and linked to groups. Users are assigned to groups. Role-based access control (superadmin > admin > editor > readonly).
- **Storage:** Pluggable backend via `storage.py`. Local filesystem by default; Cloudflare R2 when `JAM_R2_BUCKET` is set. Audio served via presigned URLs (or custom domain) when remote.
- **Sheet music:** MusicXML scores are stored as files through `storage.py` and always served through the API (never a presigned R2 URL), as attachments with `nosniff`, because they are user-supplied XML. The browser draws them with Verovio (WebAssembly) in a Web Worker (`web/src/score/`) and shows each drawn page through an `<img>` (a `blob:` URL), never as inline SVG, so nothing in a score can run script. The ~8 MB worker chunk is excluded from the PWA precache and loads only when a score is opened. Viewing only (zoom, full screen): no playback or annotation, and not shown in Perform mode. `scripts/import-piano-library.py` bulk-imports a piano-repertoire library (see `docs/operations.md`)
- **Share links:** a take, a recording, a setlist or a song can be shared through a public link (Share in its menu, or the share button on recording/setlist pages; `web/src/share/ShareDialog.tsx`), with an expiry picked at share time (1 day … 1 year, or never; default `JAM_SHARE_EXPIRY_DAYS`). More → Shared links (`/shares`) lists your links (admins: their bands') to copy, re-time or stop them. The public page is part of the SPA (`web/src/share/PublicShare.tsx`, outside the auth wrapper, plain `fetch` without cookies) so charts render with the same `ChordSheet` as the app; a shared setlist opens each song's chart read-only. Share data is never cached by the service worker, so revoking takes effect at once, and the service worker isn't registered for visitors who land on `/share/` (no app precache for one-off recipients). Link previews in messaging apps come from the server-filled `<title>`/`og:` tags (`share_page` in `api.py`), since those apps don't run JavaScript
- **Song tagging:** Manual via web UI, plus the nightly automatic tagging above. Songs are a shared catalog linked to bands (`group_songs`) and auto-created on first tag.

## Detailed Documentation

- [`docs/pipeline.md`](docs/pipeline.md) — processing pipeline data flow
- [`docs/operations.md`](docs/operations.md) — server reset and bulk upload procedures
