# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public landing page at `/` that explains JamJar's features and has a "Request Access" form that emails the site owner.

**Architecture:** New `Landing.tsx` page component as a top-level route (outside `AuthProvider`). Backend gets a `POST /api/access-request` public endpoint that sends an email via existing SMTP infra. Share pages get a cross-link to the landing page.

**Tech Stack:** React/TypeScript/Tailwind (frontend), FastAPI/Python (backend), existing SMTP email module.

---

## Chunk 1: Backend — Config + Access Request Endpoint

### Task 1: Add `access_request_email` to Config

**Files:**
- Modify: `src/jam_session_processor/config.py:36-37` (add field to dataclass)
- Modify: `src/jam_session_processor/config.py:103-104` (add env var loading)
- Test: `tests/test_api.py`

- [ ] **Step 1: Add field to Config dataclass**

In `src/jam_session_processor/config.py`, add after line 37 (`app_url: str`):

```python
    access_request_email: str
```

- [ ] **Step 2: Add env var loading in `_build_config()`**

In `src/jam_session_processor/config.py`, add after line 104 (`app_url=...`):

```python
        access_request_email=os.environ.get("JAM_ACCESS_REQUEST_EMAIL", ""),
```

- [ ] **Step 3: Run tests to verify no regressions**

Run: `pytest tests/ -x -q`
Expected: All existing tests pass (Config is rebuilt from env in each test via `reset_config()`).

- [ ] **Step 4: Commit**

```bash
git add src/jam_session_processor/config.py
git commit -m "feat: add JAM_ACCESS_REQUEST_EMAIL config field"
```

### Task 2: Add `send_access_request_email` to email module

**Files:**
- Modify: `src/jam_session_processor/email.py` (add new function after line 79)
- Test: `tests/test_api.py`

- [ ] **Step 1: Write the test**

Add to `tests/test_api.py`:

```python
def test_access_request_sends_email(client, monkeypatch):
    """POST /api/access-request sends an email and returns 200."""
    sent_emails = []

    def mock_send(to_email, requester_email, band_name, message):
        sent_emails.append({"to": to_email, "band_name": band_name, "requester": requester_email})
        return True

    monkeypatch.setattr("jam_session_processor.api._send_access_request_email", mock_send)
    monkeypatch.setenv("JAM_ACCESS_REQUEST_EMAIL", "admin@example.com")
    reset_config()

    resp = client.post("/api/access-request", json={
        "email": "newband@example.com",
        "band_name": "The Testers",
        "message": "We jam every Tuesday",
    })
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert len(sent_emails) == 1
    assert sent_emails[0]["to"] == "admin@example.com"
    assert sent_emails[0]["band_name"] == "The Testers"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py::test_access_request_sends_email -v`
Expected: FAIL (endpoint does not exist yet).

- [ ] **Step 3: Add `send_access_request_email` function**

Add to `src/jam_session_processor/email.py` after the `send_password_reset_email` function:

```python
def send_access_request_email(to_email: str, requester_email: str, band_name: str, message: str) -> bool:
    """Send an access request notification to the site admin."""
    body = (
        f"New JamJar access request:\n\n"
        f"Email: {requester_email}\n"
        f"Band: {band_name}\n\n"
        f"Message:\n{message}\n"
    )
    return _send_email(to_email, f"JamJar Access Request: {band_name}", body)
```

- [ ] **Step 4: Commit**

```bash
git add src/jam_session_processor/email.py
git commit -m "feat: add send_access_request_email function"
```

### Task 3: Add `POST /api/access-request` endpoint

**Files:**
- Modify: `src/jam_session_processor/api.py` (add to `_PUBLIC_PATHS`, add rate limiter, add endpoint)
- Test: `tests/test_api.py`

- [ ] **Step 1: Write validation tests**

Add to `tests/test_api.py`:

```python
def test_access_request_missing_fields(client):
    """POST /api/access-request with missing fields returns 422."""
    resp = client.post("/api/access-request", json={"email": "a@b.com"})
    assert resp.status_code == 422


def test_access_request_invalid_email(client):
    resp = client.post("/api/access-request", json={
        "email": "not-an-email",
        "band_name": "Band",
        "message": "Hi",
    })
    assert resp.status_code == 422


def test_access_request_rate_limited(client, monkeypatch):
    """Fourth access request from same IP within an hour is rate-limited."""
    monkeypatch.setattr("jam_session_processor.api._send_access_request_email", lambda *a: True)
    monkeypatch.setenv("JAM_ACCESS_REQUEST_EMAIL", "admin@example.com")
    reset_config()
    api._access_request_limiter._attempts.clear()  # Reset rate limiter state

    for _ in range(3):
        resp = client.post("/api/access-request", json={
            "email": "test@example.com",
            "band_name": "Band",
            "message": "Hi",
        })
        assert resp.status_code == 200

    resp = client.post("/api/access-request", json={
        "email": "test@example.com",
        "band_name": "Band",
        "message": "Hi",
    })
    assert resp.status_code == 429


def test_access_request_smtp_not_configured(client):
    """Access request without SMTP still returns 200 (no error revealed)."""
    resp = client.post("/api/access-request", json={
        "email": "test@example.com",
        "band_name": "Band",
        "message": "Hi",
    })
    assert resp.status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_api.py -k "access_request" -v`
Expected: All FAIL (endpoint does not exist).

- [ ] **Step 3: Implement the endpoint**

In `src/jam_session_processor/api.py`:

1. Add to `_PUBLIC_PATHS` set (line 90):
```python
_PUBLIC_PATHS = {"/health", "/api/auth/login", "/api/auth/forgot-password", "/api/auth/reset-password", "/api/auth/reset-password/validate", "/api/access-request"}
```

2. Add rate limiter after `_login_limiter` (after line 85):
```python
_access_request_limiter = RateLimiter(max_attempts=3, window_seconds=3600)
```

3. Add Pydantic model (near other request models):
```python
class AccessRequest(BaseModel):
    email: str
    band_name: str
    message: str
```

4. Add module-level import so it can be monkeypatched in tests. Near the top of the file, after other email imports:
```python
from jam_session_processor.email import send_access_request_email as _send_access_request_email
```

5. Add endpoint (near the health endpoint or after auth endpoints):
```python
@app.post("/api/access-request")
async def request_access(body: AccessRequest, request: Request):
    import re
    email = body.email.strip()
    band_name = body.band_name.strip()
    message = body.message.strip()

    if not email or not band_name or not message:
        raise HTTPException(422, "All fields are required")
    if not re.match(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(422, "Invalid email address")

    ip = request.client.host if request.client else "unknown"
    if _access_request_limiter.is_blocked(ip):
        raise HTTPException(429, "Too many requests. Please try again later.")
    _access_request_limiter.record(ip)

    cfg = get_config()
    recipient = cfg.access_request_email or cfg.smtp_from
    if recipient:
        _send_access_request_email(recipient, email, band_name, message)
    else:
        logger.warning("No access request email configured — request from %s (%s) logged only", email, band_name)

    return {"ok": True, "message": "Thanks! We'll be in touch."}
```

- [ ] **Step 4: Run all access request tests**

Run: `pytest tests/test_api.py -k "access_request" -v`
Expected: All PASS.

- [ ] **Step 5: Run full test suite**

Run: `pytest tests/ -x -q`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/jam_session_processor/api.py tests/test_api.py
git commit -m "feat: add POST /api/access-request public endpoint"
```

## Chunk 2: Frontend — Landing Page + Routing

### Task 4: Add `requestAccess` API function

**Files:**
- Modify: `web/src/api.ts`

- [ ] **Step 1: Add the API function**

Add to the `api` object in `web/src/api.ts`:

```typescript
  requestAccess: (email: string, band_name: string, message: string) =>
    fetchJson<{ ok: boolean; message: string }>(`${BASE}/access-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, band_name, message }),
    }),
```

- [ ] **Step 2: Verify build compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/api.ts
git commit -m "feat: add requestAccess API function"
```

### Task 5: Create `Landing.tsx` page component

**Files:**
- Create: `web/src/pages/Landing.tsx`

- [ ] **Step 1: Create the Landing page component**

Create `web/src/pages/Landing.tsx` with the full landing page. Key structure:

```tsx
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router";
import { api } from "../api";

export default function Landing() {
  const [authChecked, setAuthChecked] = useState(false);
  const navigate = useNavigate();

  // Check auth with raw fetch to avoid fetchJson's 401→/login redirect
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" }).then((resp) => {
      if (resp.ok) {
        navigate("/sessions", { replace: true });
      } else {
        setAuthChecked(true);
      }
    }).catch(() => {
      setAuthChecked(true);
    });
  }, [navigate]);

  if (!authChecked) return null; // Brief blank while checking auth

  return <LandingContent />;
}

function LandingContent() {
  const [email, setEmail] = useState("");
  const [bandName, setBandName] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.requestAccess(email, bandName, message);
      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-300">
      {/* Nav */}
      <nav className="sticky top-0 z-50 flex items-center justify-between border-b border-white/[0.06] bg-gray-950/95 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="JamJar" className="h-7 w-7" />
          <span className="text-lg font-bold text-white">JamJar</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#features" className="text-sm text-gray-400 hover:text-white transition">Features</a>
          <a href="#request-access" className="text-sm text-gray-400 hover:text-white transition">Request Access</a>
          <Link to="/login" className="rounded-md bg-accent-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-accent-700 transition">Log In</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-2xl px-6 pb-16 pt-20 text-center">
        <img src="/logo.png" alt="JamJar" className="mx-auto mb-6 h-16 w-16" />
        <h1 className="mb-5 text-3xl font-extrabold leading-snug tracking-tight text-white sm:text-4xl">
          Jam session recordings, song charts, setlists, and scheduling for your band
        </h1>
        <p className="mb-9 text-base leading-relaxed text-gray-400 sm:text-lg">
          Upload rehearsal recordings and JamJar splits them into songs automatically. Tag takes, build a shared songbook, plan setlists, and schedule gigs — all in one place.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a href="#request-access" className="rounded-lg bg-accent-600 px-7 py-3 text-base font-semibold text-white hover:bg-accent-700 transition">Request Access</a>
          <a href="#features" className="rounded-lg border border-gray-700 px-7 py-3 text-base text-gray-300 hover:border-gray-500 hover:text-white transition">See what it does ↓</a>
        </div>
      </section>

      <div className="mx-12 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

      {/* Features */}
      <section id="features" className="mx-auto max-w-3xl px-6 py-16">
        <h2 className="mb-12 text-center text-2xl font-bold text-white">Four tools, one app</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { icon: "🎙️", title: "Jam Sessions", desc: "Upload a full rehearsal recording. JamJar auto-splits it into individual takes using energy-based detection. Tag each one, add notes, compare takes across sessions." },
            { icon: "📖", title: "Song Catalog", desc: "Your band's living songbook. Every song with its charts, lyrics, notes, and every recorded take. Pull it up on stage or in the practice room." },
            { icon: "📋", title: "Setlists", desc: "Drag songs from your catalog into ordered setlists. Use them for gigs, rehearsals, or planning what to work on next." },
            { icon: "📅", title: "Schedule", desc: "Create rehearsals and gigs. Band members RSVP so everyone knows who's in. No more group chat confusion." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
              <div className="mb-3 text-3xl">{f.icon}</div>
              <h3 className="mb-2 text-sm font-bold text-accent-400">{f.title}</h3>
              <p className="text-sm leading-relaxed text-gray-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mx-12 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

      {/* How it works */}
      <section className="mx-auto max-w-xl px-6 py-16">
        <h2 className="mb-12 text-center text-2xl font-bold text-white">From rehearsal to catalog in minutes</h2>
        {[
          { n: "1", title: "Record your jam", desc: "Hit record on your phone at the start of rehearsal. One long recording is fine." },
          { n: "2", title: "Upload & auto-split", desc: "JamJar detects the songs automatically and splits them into separate tracks." },
          { n: "3", title: "Tag, organize, share", desc: "Name each take, link it to a song, add notes. Share tracks with anyone via link." },
        ].map((step, i) => (
          <div key={step.n} className={`flex items-start gap-4${i < 2 ? " mb-8" : ""}`}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-600 text-sm font-bold text-white">{step.n}</div>
            <div>
              <h3 className="mb-1 text-sm font-semibold text-white">{step.title}</h3>
              <p className="text-sm text-gray-400">{step.desc}</p>
            </div>
          </div>
        ))}
      </section>

      <div className="mx-12 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

      {/* Request Access */}
      <section id="request-access" className="mx-auto max-w-md px-6 py-16 text-center">
        <h2 className="mb-2 text-2xl font-bold text-white">Get early access</h2>
        <p className="mb-8 text-sm text-gray-400">Tell us about your band and we'll get you set up.</p>

        {submitted ? (
          <p className="text-lg font-medium text-accent-400">Thanks! We'll be in touch.</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-left">
            <input
              type="email" required placeholder="Email address" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
            />
            <input
              type="text" required placeholder="Band / project name" value={bandName}
              onChange={(e) => setBandName(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
            />
            <textarea
              required placeholder="Tell us about your band..." value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-[80px] w-full resize-y rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit" disabled={loading}
              className="w-full rounded-lg bg-accent-600 py-3 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50 transition"
            >
              {loading ? "Sending..." : "Request Access"}
            </button>
          </form>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-6 text-center">
        <p className="text-xs text-gray-600">Built for bands that jam.</p>
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: Verify build compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Landing.tsx
git commit -m "feat: add Landing page component"
```

### Task 6: Update App.tsx routing

**Files:**
- Modify: `web/src/App.tsx:448-462` (add Landing route, adjust AuthenticatedApp inner routes)

- [ ] **Step 1: Add Landing import**

Add to imports at the top of `web/src/App.tsx`:

```typescript
import Landing from "./pages/Landing";
```

- [ ] **Step 2: Add Landing route before the catch-all**

In `web/src/App.tsx`, change the `App` component routes (lines 452-458) to:

```tsx
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
          <Route path="/invite/:token" element={<AcceptInvite />} />
          <Route path="*" element={<AuthenticatedApp />} />
        </Routes>
```

- [ ] **Step 3: Remove the inner `/` route from AuthenticatedApp**

In `web/src/App.tsx`, inside `AuthenticatedApp` Layout routes (line 431), change:

```tsx
<Route path="/" element={<SessionList />} />
```

to:

```tsx
<Route path="/sessions" element={<SessionList />} />
```

This avoids a dead route — authenticated users land on `/sessions` via the Landing redirect.

- [ ] **Step 4: Verify build compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat: add Landing as top-level route, move sessions to /sessions"
```

### Task 7: Update Login page redirect and add home link

**Files:**
- Modify: `web/src/pages/Login.tsx:17` (change redirect target)
- Modify: `web/src/pages/Login.tsx:28-30` (make logo a link)

- [ ] **Step 1: Change post-login redirect**

In `web/src/pages/Login.tsx` line 17, change:

```typescript
window.location.href = "/";
```

to:

```typescript
window.location.href = "/sessions";
```

- [ ] **Step 2: Make the logo a link to the landing page**

In `web/src/pages/Login.tsx`, change the logo/title block (lines 28-30):

```tsx
          <img src="/logo.png" alt="JamJar" className="h-20 w-20" />
          <h1 className="text-3xl font-bold text-white">JamJar</h1>
```

to:

```tsx
          <Link to="/" className="flex flex-col items-center gap-2 hover:opacity-80 transition">
            <img src="/logo.png" alt="JamJar" className="h-20 w-20" />
            <h1 className="text-3xl font-bold text-white">JamJar</h1>
          </Link>
```

Note: `Link` is already imported from `react-router` at the top of Login.tsx (line 2).

- [ ] **Step 3: Update all internal nav links that point to `/` expecting SessionList**

Four links in `web/src/App.tsx` need updating:

1. **Desktop logo** (line 181): `<NavLink to="/"` → `<NavLink to="/sessions"`
2. **Desktop "Recordings" nav link** (line 187): `<NavLink to="/"` → `<NavLink to="/sessions"`
3. **Desktop "Recordings" active logic** (line 189): `location.pathname === "/" || location.pathname.startsWith("/sessions")` → `location.pathname.startsWith("/sessions")`
4. **Mobile "Recs" nav link** (line 299): `<NavLink to="/"` → `<NavLink to="/sessions"`
5. **Mobile "Recs" active logic** (line 300): same simplification as #3

- [ ] **Step 4: Verify build compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Login.tsx web/src/App.tsx
git commit -m "feat: update login redirect to /sessions, add landing page link"
```

## Chunk 3: Share Page Cross-Link + Docs

### Task 8: Add "Check out JamJar" link to share page

**Files:**
- Modify: `src/jam_session_processor/api.py:1633` (after the actions div in share page HTML)

- [ ] **Step 1: Add the cross-link**

In `src/jam_session_processor/api.py`, find the share page HTML template. After the closing `</div>` of the actions div (line 1633), and before the hidden SVG icons (line 1634), add:

```html
        <p style="margin-top: 1.5rem; font-size: 0.8125rem; color: #6b7280;">
            <a href="/" style="color: #34d399; text-decoration: none;">Check out JamJar →</a>
        </p>
```

- [ ] **Step 2: Run tests**

Run: `pytest tests/ -x -q`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/jam_session_processor/api.py
git commit -m "feat: add 'Check out JamJar' link to share page"
```

### Task 9: Update CLAUDE.md docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `JAM_ACCESS_REQUEST_EMAIL` to the Environment Variables table**

In `CLAUDE.md`, add a new row to the Environment Variables table after `JAM_APP_URL`:

```
| `JAM_ACCESS_REQUEST_EMAIL` | *(empty)* | Email address for access request notifications (falls back to `JAM_SMTP_FROM`) |
```

- [ ] **Step 2: Add the landing page route to the REST API section**

In the REST API section of `CLAUDE.md`, add under the public endpoints:

```
**Public:** `GET /` (landing page) | `POST /api/access-request`
```

- [ ] **Step 3: Note the `/sessions` route change**

Update the Sessions line in the REST API docs if it references `/` as the default authenticated route. The authenticated home is now `/sessions`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add access request email env var and landing page route"
```

### Task 10: Lint and final verification

- [ ] **Step 1: Run linter**

Run: `ruff check src/ tests/`
Expected: No errors.

- [ ] **Step 2: Run formatter**

Run: `ruff format src/ tests/`

- [ ] **Step 3: Run full test suite**

Run: `pytest tests/ -v`
Expected: All pass.

- [ ] **Step 4: Visual check**

Start the dev servers (`jam-session serve` and `cd web && npm run dev`), then:

1. Visit `http://localhost:5173/` — should see the landing page
2. Click "Log In" — should go to login page
3. Log in — should redirect to `/sessions`
4. Visit `http://localhost:5173/` while logged in — should redirect to `/sessions`
5. Check a share link page — should show "Check out JamJar →" link

- [ ] **Step 5: Commit any lint/format fixes**

```bash
git add -u
git commit -m "chore: lint and format fixes"
```
