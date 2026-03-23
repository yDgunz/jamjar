# QA Branch Deployments

Deploy feature branches to `<branch>.jam-jar.app` for review on any device.

## Problem

Development currently requires `localhost` — no way to review UI changes on a phone or from a browser-based Claude Code session. Merging to `main` is the only way to see changes on a real URL, which means production is the first time changes are tested in a real environment.

## Solution

Add a Caddy reverse proxy in front of the production app. On push to any non-`main` branch, automatically build and deploy a QA instance at `<branch-name>.jam-jar.app` with a seeded test database. Tear it down when the branch is deleted or merged.

## Architecture

```
Internet → Caddy (:80/:443, wildcard TLS via Cloudflare DNS challenge)
              ├── jam-jar.app            → production container (:8000)
              ├── fix-login.jam-jar.app  → QA container qa-fix-login (:8000)
              └── new-feat.jam-jar.app   → QA container qa-new-feat (:8000)
```

All containers share a Docker network (`jamjar-net`). Caddy is the only service with host port bindings. QA containers are ephemeral — they have their own data volumes and no access to production data or R2.

## Infrastructure Changes

### Caddy service (added to `docker-compose.yml`)

Caddy requires the Cloudflare DNS module for wildcard TLS, which is not included in the stock image. A custom Caddy Dockerfile builds the image with `xcaddy` and the `github.com/caddy-dns/cloudflare` module.

Caddy runs as a service in the production compose file:

- Binds ports 80 and 443
- Uses a `Caddyfile` checked into the repo
- Uses the Caddy Cloudflare DNS module for wildcard TLS (`*.jam-jar.app`)
- Requires a `CLOUDFLARE_API_TOKEN` env var with Zone:DNS:Edit permissions for the domain

### Custom Caddy Dockerfile (`Dockerfile.caddy`)

```dockerfile
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

### Production compose changes

- Remove `ports: - "80:8000"` from the `app` service
- Add `hostname: jamjar-prod` to the `app` service (prevents DNS conflicts with QA containers that also have service name `app`)
- Add both `app` and `caddy` to the shared `jamjar-net` network
- Add the Caddy service definition

### Caddyfile

```
jam-jar.app {
    reverse_proxy jamjar-prod:8000
}

*.jam-jar.app {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }
    reverse_proxy {labels.2}:8000
}
```

**How routing works:**

- The bare domain routes to hostname `jamjar-prod` — the production container's explicit hostname on the shared network.
- The wildcard block extracts the subdomain via `{labels.2}` (zero-indexed from the right: `app`=0, `jam-jar`=1, subdomain=2) and proxies to a container with that hostname on the Docker network.
- QA containers set `hostname: ${QA_BRANCH_NAME}` so they are resolvable by branch name on `jamjar-net`.
- Production sets `hostname: jamjar-prod` to avoid conflicts with QA services that are also named `app` in their compose files.

No per-branch config files or Caddy reloads needed. Requests to non-existent subdomains will get a 502 (no container to proxy to); this is expected and harmless.

Note: Caddy automatically redirects HTTP to HTTPS. Existing `http://jam-jar.app` bookmarks will redirect seamlessly. The bare domain uses HTTP-01/TLS-ALPN-01 for its certificate (ports 80/443 are bound to Caddy). If Cloudflare proxy (orange cloud) is enabled for the bare domain, add the `tls { dns cloudflare ... }` directive to the bare domain block as well.

### DNS

Add a wildcard A record: `*.jam-jar.app → <VPS IP>`. This is a one-time manual step. The bare `jam-jar.app` A record should already exist.

### Cloudflare API token

Create a scoped API token with `Zone:DNS:Edit` permission for `jam-jar.app`. Add as `CLOUDFLARE_API_TOKEN` in the VPS `.env` file and as a GitHub Actions secret.

## QA Compose File

New file: `docker-compose.qa.yml`

```yaml
services:
  app:
    build: .
    container_name: ${QA_BRANCH_NAME}
    hostname: ${QA_BRANCH_NAME}
    labels:
      - "qa=true"
    environment:
      - JAM_DATA_DIR=/data
      - JAM_STATIC_DIR=/app/static
      - JAM_JWT_SECRET=qa-shared-secret-not-for-production
      - JAM_APP_URL=https://${QA_BRANCH_NAME}.jam-jar.app
      - JAM_CORS_ORIGINS=https://${QA_BRANCH_NAME}.jam-jar.app
    volumes:
      - qa-data:/data
    networks:
      - jamjar-net
    restart: unless-stopped
    entrypoint: ["/app/scripts/qa-entrypoint.sh"]

volumes:
  qa-data:

networks:
  jamjar-net:
    external: true
```

Key details:
- **Hostname matches subdomain** — `hostname: ${QA_BRANCH_NAME}` makes the container resolvable by branch name on the Docker network; Caddy's `{labels.2}` resolves to this hostname
- **`qa=true` label** — used by the resource guard to count active QA containers
- **No port mapping** — Caddy routes via Docker network
- **R2 disabled** — local storage only, no risk of touching production audio
- **SMTP disabled** — no emails sent from QA
- **Hardcoded JWT secret** — QA instances use test data only; a static secret is acceptable and avoids secret management complexity
- **Own data volume** — Docker Compose prefixes with project name (`qa-<name>_qa-data`), ensuring isolation between branches
- **Custom entrypoint** seeds the database on first boot

Note: Audio playback in QA will return 404s since the seed script creates placeholder paths without actual audio files. This is acceptable for UI testing.

## QA Entrypoint Script

New file: `scripts/qa-entrypoint.sh`

```sh
#!/bin/sh
set -e

if [ ! -f /data/jam_sessions.db ]; then
    echo "Seeding QA database..."
    python /app/scripts/seed-db.py /data/jam_sessions.db
fi

exec jam-session serve
```

Seeds the database on first start only. Restarts preserve data.

## Branch Name Sanitization

Both deploy and cleanup workflows must produce identical sanitized names. The logic:

1. Convert to lowercase
2. Replace `/` and any non-alphanumeric characters (except hyphens) with `-`
3. Collapse consecutive hyphens to a single hyphen
4. Strip leading and trailing hyphens
5. Truncate to 63 characters (DNS label limit)

Examples:
- `feature/my-thing` → `feature-my-thing`
- `Fix/Login_Bug` → `fix-login-bug`
- `--weird--branch--` → `weird-branch`

This logic should be extracted into a shared shell function or inline script used by both workflows to guarantee consistency.

## GitHub Actions Workflows

### QA Deploy (`.github/workflows/qa-deploy.yml`)

**Trigger:** Push to any branch except `main`.

**Concurrency:** `concurrency: { group: qa-${{ github.ref_name }}, cancel-in-progress: true }` — prevents concurrent deploys to the same branch. If a second push arrives while the first is still deploying, the first is cancelled.

**Steps:**

1. Sanitize branch name (see Branch Name Sanitization above)
2. **Resource guard:** SSH into VPS and count running QA containers (`docker ps --filter "label=qa=true" -q | wc -l`). If >= 5, exit with a warning comment on the PR and skip deployment.
3. Create workspace at `/opt/jamjar-qa/<branch-name>/` if it doesn't exist
4. Pull/clone the branch into the workspace
5. Create the shared network if it doesn't exist: `docker network create jamjar-net || true`
6. Build and start: `QA_BRANCH_NAME=<name> docker compose -p qa-<name> -f docker-compose.qa.yml up --build -d`
7. **Health check:** `curl --retry 5 --retry-delay 3 --retry-connrefused https://<name>.jam-jar.app/health`
8. If a PR exists for this branch, post/update a comment with the QA URL

### QA Cleanup (`.github/workflows/qa-cleanup.yml`)

**Trigger:** Branch delete event AND `pull_request: types: [closed]` (covers merges without branch deletion).

**Concurrency:** `concurrency: { group: qa-${{ github.ref_name }} }` — matches the deploy workflow's group to prevent deploy/cleanup races.

**Steps:**

1. Sanitize branch name (same logic as deploy)
2. SSH into VPS
3. `cd /opt/jamjar-qa/<branch-name>/ && docker compose -p qa-<name> -f docker-compose.qa.yml down -v` (must run before removing workspace since compose file is in the workspace; if directory doesn't exist, skip this step)
4. Remove workspace directory `/opt/jamjar-qa/<branch-name>/`
5. `docker image prune -f`

The cleanup is idempotent — running it when no QA instance exists is a no-op. The `docker compose down` step is skipped if the workspace directory doesn't exist (e.g., if deploy never completed).

## Production Migration

The existing production deploy workflow needs updates:

1. First deploy: build custom Caddy image, create the shared network, move production behind Caddy
2. Subsequent deploys: same as today but without the port mapping

The migration is:
1. Add Caddy service + network to `docker-compose.yml`
2. Remove port 80 mapping from `app`
3. Add `Caddyfile` and `Dockerfile.caddy` to repo
4. Set up wildcard DNS record (manual, one-time)
5. Create Cloudflare API token (manual, one-time)
6. Add `CLOUDFLARE_API_TOKEN` to VPS `.env` and GitHub secrets
7. Deploy — Caddy takes over TLS and routing

Production experiences a brief downtime during the switchover (seconds, while Caddy starts and obtains the cert). Caddy automatically redirects HTTP to HTTPS, so existing bookmarks work.

## Dockerfile Changes

The existing `COPY scripts/ /app/scripts/` line already copies all scripts into the image. The only addition is making `qa-entrypoint.sh` executable (either `chmod +x` in the repo or add a `RUN chmod` in the Dockerfile).

## Security Considerations

- QA instances use a separate JWT secret — QA cookies don't work on production and vice versa
- QA has no access to production data (separate Docker volumes)
- R2 is disabled in QA — no risk of reading/writing production audio
- QA uses the seed database with test credentials only
- QA instances are publicly accessible (same as production) — acceptable since they contain only test data
- Cloudflare API token is scoped to DNS only

## Out of Scope

- Per-branch database snapshots from production
- Authentication/password protection on QA instances
- Slack/email notifications on QA deploy
- Multi-server deployment
- Real audio file generation for QA seed data
