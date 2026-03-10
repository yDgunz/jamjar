# Shareable Track Links

## Overview

Allow authenticated users to generate permanent, public share links for individual tracks. Recipients can stream and download the track without a JamJar account via a simple branded landing page.

## Data Model

New `share_links` table:

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `token` | TEXT UNIQUE | Random URL-safe string (16 bytes, base64url-encoded → 22 chars) |
| `track_id` | FK → tracks | CASCADE delete. UNIQUE constraint (one link per track) |
| `created_by` | FK → users (nullable) | Who created the link. SET NULL on user delete. |
| `created_at` | TIMESTAMP | Default now |

- Group scoping is inherited through the track FK (`tracks → sessions → groups`). No direct `group_id` column needed.
- One share link per track. Creating a share link for an already-shared track returns the existing link.
- Revoking a share link deletes the row. A new link can be created afterward (with a new token).
- Deleting a track cascades to delete its share link.
- Deleting the user who created a link sets `created_by` to NULL (link remains active).
- Token collision: 128 bits of entropy makes collision astronomically unlikely. On UNIQUE constraint violation, retry once with a new token.

## API Endpoints

### Authenticated (existing auth required)

**`POST /api/tracks/{id}/share`**
- Available to all authenticated users with group access to the track
- Creates a share link if none exists, otherwise returns the existing one
- Response: `{ "token": "...", "url": "/share/..." }` (relative path; frontend constructs full URL from `window.location.origin`)

**`DELETE /api/tracks/{id}/share`**
- Revokes the share link (deletes the row)
- Available to the link creator, or any admin/superadmin in the group
- Returns 404 if no share link exists

### Existing endpoint modification

**`GET /api/tracks/{id}/audio`**
- Add `?download=1` query param support: sets `Content-Disposition: attachment` with filename derived from track/song name

### Public (no auth)

**`GET /share/{token}`**
- Server-rendered HTML page (not part of the React SPA)
- Returns 404 if token is invalid
- See "Share Landing Page" section for contents

**`GET /api/share/{token}/audio`**
- Streams or redirects to the track audio (same logic as `/api/tracks/{id}/audio`)
- `?download=1` query param sets `Content-Disposition: attachment` with a filename
- Returns 404 if token is invalid

Both public endpoints are added to `_PUBLIC_PATHS` (or handled via path prefix check) to bypass auth middleware.

## Share Landing Page

Server-rendered HTML at `/share/{token}`. Dark themed (gray-950 background), styled inline to avoid external dependencies.

Contents:
- "JamJar" app name at top
- Track name (and song name if tagged)
- Session name and date
- HTML5 `<audio>` element with controls, `src` pointing to `/api/share/{token}/audio`
- Download button linking to `/api/share/{token}/audio?download=1`

## Audio Player Download Button

Add a download button to the existing audio player component (`web/src/components/AudioPlayer.tsx` or equivalent) across the entire app — not just the share page.

- For authenticated users: download URL is the existing `/api/tracks/{id}/audio?download=1` endpoint (add `?download=1` support to the authenticated track audio endpoint as well)
- For the share page: download URL uses the public share audio endpoint

## UI Integration

### Session Detail View (track rows)

- Add a share icon/button to each track row
- On click: calls `POST /api/tracks/{id}/share`, copies the full URL to clipboard, shows a brief toast confirmation
- If a share link already exists, indicate it visually (e.g., filled vs outline icon)
- Provide a way to revoke the share link (e.g., secondary action or confirmation dialog)

## Auth Middleware Changes

The `/share/` and `/api/share/` path prefixes need to bypass authentication. Update the auth middleware to allow these paths through without JWT or API key validation.

## Storage Considerations

No changes to the storage layer. The public audio endpoint resolves and serves audio using the same `get_storage()` abstraction:
- Local storage: `FileResponse`
- R2 storage: 307 redirect to presigned URL (or custom domain URL)

## Scope

- Per-track sharing only (no session-level sharing)
- Permanent links (no expiry)
- All authenticated users can create share links (no role restriction)
- Revocation available to link creator or admins
- No rate limiting on public endpoints (out of scope for now)
- Update CLAUDE.md (schema, endpoints) and docs as part of implementation
