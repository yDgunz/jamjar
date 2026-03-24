# QA Branch Deployments

Deploy feature branches to `<branch>.jam-jar.app` for review on any device.

## Problem

Development currently requires `localhost` — no way to review UI changes on a phone or from a browser-based Claude Code session. Merging to `main` is the only way to see changes on a real URL, which means production is the first time changes are tested in a real environment.

## Solution

Add a Caddy reverse proxy in front of the production app. When a `deploy-qa` label is added to a PR, build and deploy a QA instance at `<branch-name>.jam-jar.app` with a seeded test database. Tear it down when the label is removed or the PR is closed/merged. A weekly scheduled workflow cleans up any orphaned environments.

## Architecture

```
Internet → Caddy (systemd on host, :80/:443, auto TLS via Let's Encrypt)
              ├── jam-jar.app              → localhost:8000 (production)
              ├── fix-login.jam-jar.app    → localhost:8001 (QA container)
              └── new-feat.jam-jar.app     → localhost:8002 (QA container)
```

Caddy runs as a systemd service on the VPS host. Each QA environment is a separate Docker Compose project with its own container, volume, and dynamically assigned port. Caddy routes are managed via per-environment config files and `caddy reload`.

## Infrastructure Changes

### Caddy (systemd service on host)

Caddy runs directly on the host (not in Docker) to keep networking simple and let it manage TLS certificates via Let's Encrypt without Docker complexity.

**Base Caddyfile** (`/etc/caddy/Caddyfile`):

```
jam-jar.app {
    reverse_proxy localhost:8000
}

import /etc/caddy/qa-sites/*
```

The `import` directive loads per-QA site config files. Each QA deploy writes a file to `/etc/caddy/qa-sites/` and runs `caddy reload`. This approach survives Caddy restarts — unlike the admin API, file-based configs are persistent.

**Per-QA config file** (`/etc/caddy/qa-sites/<branch>.caddy`):

```
feature-xyz.jam-jar.app {
    reverse_proxy localhost:8001
}
```

**Route management:**

```bash
# Add a QA route
cat > /etc/caddy/qa-sites/feature-xyz.caddy <<EOF
feature-xyz.jam-jar.app {
    reverse_proxy localhost:8001
}
EOF
sudo caddy reload --config /etc/caddy/Caddyfile

# Remove a QA route
rm /etc/caddy/qa-sites/feature-xyz.caddy
sudo caddy reload --config /etc/caddy/Caddyfile
```

### Production compose changes

Port mapping changes from `"80:8000"` to `"8000:8000"`. Caddy handles all external traffic on ports 80/443.

### DNS

Add a wildcard A record: `*.jam-jar.app → <VPS IP>`. One-time manual step. The bare `jam-jar.app` A record should already exist.

## Branch Name Sanitization

All workflows must produce identical sanitized names. The logic:

1. Convert to lowercase
2. Replace `/` and any non-alphanumeric characters (except hyphens) with `-`
3. Collapse consecutive hyphens to a single hyphen
4. Strip leading and trailing hyphens
5. Truncate to 63 characters (DNS label limit)
6. Reject reserved names: `main`, `master`, `prod`

Examples:
- `feature/my-thing` → `feature-my-thing`
- `Fix/Login_Bug` → `fix-login-bug`
- `--weird--branch--` → `weird-branch`

This logic should be a shared shell function used by all three workflows.

## QA Compose Setup

Each QA environment runs as its own Docker Compose project. Rather than a committed `docker-compose.qa.yml`, the deploy script generates a compose file on the fly since each environment needs different port/volume/project names.

**Generated compose structure:**

```yaml
services:
  app:
    build: .
    ports:
      - "<dynamic-port>:8000"
    environment:
      - JAM_DATA_DIR=/data
      - JAM_STATIC_DIR=/app/static
      - JAM_JWT_SECRET=<generated-per-deploy>
      - JAM_APP_URL=https://<branch>.jam-jar.app
      - JAM_CORS_ORIGINS=https://<branch>.jam-jar.app
      - JAM_QA_PASSWORD=<from-server-env>
    volumes:
      - qa-data:/data
    mem_limit: 512m
    cpus: 1.0
    restart: unless-stopped

volumes:
  qa-data:
```

Key details:
- **Dynamic port** — starting at 8001, scanning for unused ports (see Port Assignment below)
- **Resource limits** — 512MB RAM and 1 CPU per QA container to protect production from resource starvation
- **No R2 env vars** — local-only storage, no risk of touching production audio
- **No SMTP env vars** — no emails sent from QA
- **Generated JWT secret** — QA cookies don't work on production and vice versa
- **Own data volume** — Docker Compose prefixes with project name, ensuring isolation
- **`JAM_QA_PASSWORD`** — passed from server `.env`, used by seed script for all test users

### Port Assignment

The deploy script assigns ports starting at 8001 by checking existing workspace port files:

1. Read all `/opt/jamjar-qa/*/port` files to find ports currently in use
2. Starting at 8001, find the first port not in any port file
3. Verify the port is not bound: `ss -tlnp | grep :<port>`
4. Write the assigned port to `/opt/jamjar-qa/<branch>/port`

This avoids race conditions between deploys since the concurrency group prevents parallel deploys to the same branch, and the port file check prevents collisions across branches.

### Maximum Concurrent Environments

The deploy script checks how many QA environments are currently running. If 3 or more exist, the deploy fails with a comment on the PR explaining the limit. This prevents resource exhaustion on the shared VPS.

## Seed Script Changes

`scripts/seed-db.py` is modified to:
- Read `JAM_QA_PASSWORD` env var
- If set, use it as the password for all seeded users (replacing `DEFAULT_PASSWORD = "test"`)
- If not set, fall back to the existing `DEFAULT_PASSWORD = "test"` (preserving local dev workflow)

The `JAM_QA_PASSWORD` requirement is enforced in the deploy script, not the seed script — the deploy script checks that `JAM_QA_PASSWORD` is set in the server environment before starting and exits with an error if it's missing. This keeps the seed script working for local development without any env var.

## GitHub Actions Workflows

### QA Deploy (`.github/workflows/qa-deploy.yml`)

**Trigger:** `pull_request: types: [labeled]` — fires when the `deploy-qa` label is added to a PR.

**Condition:** Only runs if the added label is `deploy-qa`.

**Concurrency:** `concurrency: { group: qa-${{ github.event.pull_request.head.ref }}, cancel-in-progress: true }` — prevents concurrent deploys to the same branch.

**Steps:**

1. Sanitize branch name (reject reserved names)
2. SSH into VPS and run `scripts/qa-deploy.sh <branch-name> <git-ref>`:
   a. Check `JAM_QA_PASSWORD` is set in server environment; exit with error if missing
   b. Count running QA environments; exit with error if >= 3
   c. Create workspace at `/opt/jamjar-qa/<branch-name>/`
   d. Shallow clone the branch: `git clone --depth 1 --branch <ref> <repo-url> .`
   e. Assign a port (see Port Assignment) and write to `port` file
   f. Generate a compose file with the assigned port and resource limits
   g. Build and start: `docker compose -p jamjar-qa-<branch> up --build -d`
   h. Seed the database: `docker compose -p jamjar-qa-<branch> exec app python /app/scripts/seed-db.py /data/jam_sessions.db`
   i. Write Caddy config file and reload: `sudo caddy reload --config /etc/caddy/Caddyfile`
   j. Health check: `curl --retry 10 --retry-delay 5 --retry-max-time 120 --retry-connrefused https://<branch>.jam-jar.app/health`
   k. On health check failure, dump last 50 container log lines for debugging
3. Post a comment on the PR with the QA URL, using a hidden HTML marker (`<!-- qa-deploy -->`) to identify it for later editing

### QA Teardown (`.github/workflows/qa-teardown.yml`)

**Triggers:**
- `pull_request: types: [closed]` — PR merged or closed
- `pull_request: types: [unlabeled]` — `deploy-qa` label removed

**Condition:** For `unlabeled`, only runs if the removed label is `deploy-qa`. For `closed`, only runs if the PR has the `deploy-qa` label.

**Concurrency:** `concurrency: { group: qa-${{ github.event.pull_request.head.ref }} }` — prevents deploy/teardown races.

**Steps:**

1. Sanitize branch name
2. SSH into VPS and run `scripts/qa-teardown.sh <branch-name>`:
   a. Remove Caddy config file: `rm -f /etc/caddy/qa-sites/<branch>.caddy`
   b. Reload Caddy: `sudo caddy reload --config /etc/caddy/Caddyfile`
   c. Stop and remove Compose project with volumes: `docker compose -p jamjar-qa-<branch> down -v`
   d. Remove workspace directory: `rm -rf /opt/jamjar-qa/<branch-name>/`
   e. Prune unused images: `docker image prune -f`
3. Edit the PR comment (found via `<!-- qa-deploy -->` marker) to say "QA environment torn down"

Teardown is idempotent — running it when no QA instance exists is a no-op.

### QA Orphan Cleanup (`.github/workflows/qa-cleanup.yml`)

**Trigger:** `schedule: - cron: '0 6 * * 0'` — weekly, Sunday at 6am UTC.

**Steps:**

1. SSH into VPS
2. List all directories in `/opt/jamjar-qa/`
3. For each directory, use the GitHub API (via `curl` with `GITHUB_TOKEN`) to check whether an open PR with the `deploy-qa` label exists for that branch
4. If no matching PR exists, run the teardown: remove Caddy config file, reload Caddy, `docker compose down -v`, remove workspace directory
5. Final `docker image prune -f`

Note: The cleanup workflow uses the GitHub API directly (via `curl` with `GITHUB_TOKEN`) rather than `gh` CLI, avoiding the need to install `gh` on the VPS.

## Manual Setup Tasks

These must be completed before the first QA deploy:

1. **Add wildcard DNS record:** `*.jam-jar.app → <VPS IP>` (with DNS provider)
2. **Install Caddy on VPS:**
   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update
   sudo apt install caddy
   ```
3. **Create QA sites directory:** `sudo mkdir -p /etc/caddy/qa-sites`
4. **Write Caddyfile** at `/etc/caddy/Caddyfile` with prod reverse proxy and `import /etc/caddy/qa-sites/*`
5. **Enable and start Caddy:** `sudo systemctl enable --now caddy`
6. **Verify Caddy is running:** `curl localhost:2019/config/` should return a valid JSON response
7. **Update prod docker-compose.yml** port from `"80:8000"` to `"8000:8000"` and restart
8. **Verify** `https://jam-jar.app` works through Caddy
9. **Add `JAM_QA_PASSWORD`** to the VPS `.env` file
10. **Create QA directory:** `sudo mkdir -p /opt/jamjar-qa`
11. **Grant deploy user Caddy reload permission:** ensure the SSH deploy user can run `sudo caddy reload` without a password (e.g., via sudoers rule)
12. **Verify firewall:** ports 80/443 must be open for Caddy; dynamic QA ports (8001+) should NOT be externally accessible (Caddy proxies via localhost)
13. **Verify existing GitHub Actions SSH secrets** work for the QA workflows (same secrets as production deploy)

## File Changes Summary

**New files:**
- `.github/workflows/qa-deploy.yml` — deploy workflow (label trigger)
- `.github/workflows/qa-teardown.yml` — teardown workflow (unlabel/close trigger)
- `.github/workflows/qa-cleanup.yml` — weekly orphan cleanup
- `scripts/qa-deploy.sh` — server-side deploy script
- `scripts/qa-teardown.sh` — server-side teardown script

**Modified files:**
- `scripts/seed-db.py` — read `JAM_QA_PASSWORD` env var, use it if set, fall back to default if not
- `docker-compose.yml` — port mapping `"80:8000"` → `"8000:8000"`
- `CLAUDE.md` — document QA deploy process

**No changes to:**
- `Dockerfile` — reused as-is for QA builds
- Application code (`api.py`, `db.py`, etc.)
- Production deploy workflow (`.github/workflows/deploy.yml`)

## Security Considerations

- **QA password from env var** — test user credentials are not in the repo; controlled via `JAM_QA_PASSWORD` in the server's `.env` file. Deploy script validates this is set before proceeding.
- **Separate JWT secret** — generated per QA deploy; QA cookies don't work on production and vice versa
- **Cookie isolation** — cookies on `<branch>.jam-jar.app` are not sent to `jam-jar.app` (subdomain cookies don't propagate to parent domains). This must not be broken by setting `domain=.jam-jar.app` on cookies in the future.
- **No production data access** — QA uses separate Docker volumes with seeded test data only
- **No R2 access** — local-only storage, no risk of reading/writing production audio
- **No SMTP** — QA environments don't send emails
- **Resource limits** — 512MB RAM, 1 CPU per QA container; max 3 concurrent environments
- **Firewall** — QA ports (8001+) should not be externally accessible; all traffic goes through Caddy on 80/443

## Out of Scope

- Per-branch database snapshots from production
- Slack/email notifications on QA deploy
- Multi-server deployment
- Real audio file generation for QA seed data
- Caddy basic auth layer (using `JAM_QA_PASSWORD` for app-level auth instead)
