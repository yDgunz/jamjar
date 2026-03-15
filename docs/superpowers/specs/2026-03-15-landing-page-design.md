# Public Landing Page

## Overview

A public landing page at `/` that explains what JamJar does and provides a "Request Access" form. Unauthenticated visitors see the landing page; authenticated users are redirected to the app.

## Audience

- General public discovering JamJar (social media, forums, word of mouth)
- People who receive an invite link and want to understand what they're signing up for

## Page Structure

Single-page scroll with six sections:

### 1. Navigation Bar

- JamJar logo (`/logo.png`) + "JamJar" text
- Anchor links: "Features", "Request Access"
- "Log In" button (links to `/login`)
- Sticky on scroll

### 2. Hero

- Large JamJar logo
- Headline: "Jam session recordings, song charts, setlists, and scheduling for your band"
- Subtitle expanding on the value prop: upload recordings, auto-split, shared songbook, setlists, scheduling
- Two CTAs: "Request Access" (scrolls to form) and "See what it does" (scrolls to features)

### 3. Feature Pillars — "Four tools, one app"

2x2 grid of feature cards:

- **Jam Sessions** — Upload full rehearsal recordings. Auto-split into individual takes via energy-based detection. Tag, add notes, compare takes across sessions.
- **Song Catalog** — Living songbook with charts, lyrics, notes, and every recorded take. Usable on stage or in the practice room.
- **Setlists** — Build ordered setlists from the catalog for gigs, rehearsals, or planning.
- **Schedule** — Create rehearsals and gigs with RSVP. Band members confirm attendance.

### 4. How It Works — "From rehearsal to catalog in minutes"

Three numbered steps describing the recording workflow:

1. Record your jam (phone, one long recording)
2. Upload & auto-split (energy-based song detection)
3. Tag, organize, share (name takes, link to songs, share via link)

### 5. Request Access Form

Fields:
- Email address (required)
- Band / project name (required)
- "Tell us about your band..." textarea (required)
- Submit button

### 6. Footer

Simple tagline: "Built for bands that jam."

## Request Access Mechanism

Form submission sends an email to a configured address. No database storage.

### Frontend Success State

After successful submission, the form is replaced with a confirmation message: "Thanks! We'll be in touch." The user stays on the page (no redirect).

### Backend

- New public API endpoint: `POST /api/access-request`
- Accepts JSON: `{ email, band_name, message }`
- Validates fields are non-empty, email matches `[^@]+@[^@]+\.[^@]+`
- Sends an email via the existing SMTP infrastructure (`email.py`) to a configured recipient address
- New env var: `JAM_ACCESS_REQUEST_EMAIL` — the address that receives request notifications. Falls back to `JAM_SMTP_FROM` if unset.
- If SMTP is not configured (or send fails), log the request at WARNING level and return 200 with success message (do not reveal backend config to the user)
- Returns 200 on success with a confirmation message
- Duplicate submissions from the same email are fine — just send another email, return 200
- Rate-limited using the existing `RateLimiter` class: `RateLimiter(max_attempts=3, window_seconds=3600)`, keyed by IP address (matching the login rate limiter pattern)

### Email Format

Subject: "JamJar Access Request: {band_name}"
Body: email, band name, message text. Plain text is fine.

## Routing Changes

### Frontend (App.tsx)

The `<Landing />` route must be a **top-level route** in `App`, outside `AuthenticatedApp` and `AuthProvider` — same level as `/login`, `/forgot-password`, etc. This avoids firing a `/api/auth/me` call and showing a loading spinner before the landing page renders.

Route structure:
```
App routes (top-level, no AuthProvider):
  /                  → Landing (public; checks auth silently, redirects to /sessions if logged in)
  /login             → Login
  /forgot-password   → ForgotPassword
  /reset-password/:t → ResetPassword
  /invite/:token     → AcceptInvite
  /*                 → AuthenticatedApp (wrapped in AuthProvider)
```

- `Landing` component makes a lightweight `getMe()` call on mount. If authenticated, redirect to `/sessions`. Otherwise render the landing page.
- Login page: the existing logo/title become a `<Link to="/">` so users can navigate back to the landing page.
- Post-login redirect changes from `/` to `/sessions` to avoid the Landing→redirect hop.
- The inner `/` route inside `AuthenticatedApp` (SessionList) can be removed — the top-level `/` intercepts first, and authenticated users get redirected to `/sessions` anyway.

### Backend (api.py)

- Add `/api/access-request` to `_PUBLIC_PATHS`
- The SPA catch-all continues to serve `index.html` for `/` — React Router handles showing Landing vs authenticated app

## Design

- Dark theme matching the app: `#030712` background
- JamJar emerald accent colors (`#059669` primary, `#34d399` headings)
- Actual `/logo.png` asset in nav and hero
- Polished but not corporate — music-forward tone
- Mobile-responsive: feature grid collapses to single column on small screens
- Tailwind CSS, consistent with the rest of the frontend

## New Files

- `web/src/pages/Landing.tsx` — the landing page component
- No new backend files — endpoint added to `api.py`, email sending uses existing `email.py`

## Modified Files

- `web/src/App.tsx` — add Landing route, adjust auth redirect logic
- `src/jam_session_processor/api.py` — add `/api/access-request` endpoint and public path
- `src/jam_session_processor/config.py` — add `JAM_ACCESS_REQUEST_EMAIL` env var
- `CLAUDE.md` — add `JAM_ACCESS_REQUEST_EMAIL` to the Environment Variables table

## Share Page Cross-Link

The existing server-rendered share page (`/share/{token}`) gets a "Check out JamJar" link pointing to `/` (the landing page). This gives public share link visitors a path to learn about the app. Added to the footer area of the share page HTML template in `api.py`.

## Out of Scope

- Admin panel for viewing/managing access requests (email-only for now)
- Analytics or tracking on the landing page
- A/B testing or multiple landing page variants
- Blog, about page, or other marketing pages
