# QA Branch Deployments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy feature branches automatically to `<branch>.jam-jar.app` for review on any device.

**Architecture:** Caddy reverse proxy in front of production and QA containers on a shared Docker network. GitHub Actions deploys QA instances on push to non-main branches and cleans them up on branch delete/PR close.

**Tech Stack:** Docker Compose, Caddy (with Cloudflare DNS module), GitHub Actions, shell scripts

**Spec:** `docs/superpowers/specs/2026-03-22-qa-branch-deployments-design.md`

---

### Task 1: Create the QA entrypoint script

**Files:**
- Create: `scripts/qa-entrypoint.sh`

- [ ] **Step 1: Create `scripts/qa-entrypoint.sh`**

```sh
#!/bin/sh
set -e

if [ ! -f /data/jam_sessions.db ]; then
    echo "Seeding QA database..."
    python /app/scripts/seed-db.py /data/jam_sessions.db
fi

exec jam-session serve
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/qa-entrypoint.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/qa-entrypoint.sh
git commit -m "feat: add QA entrypoint script that seeds database on first boot"
```

---

### Task 2: Create the custom Caddy Dockerfile

**Files:**
- Create: `Dockerfile.caddy`

- [ ] **Step 1: Create `Dockerfile.caddy`**

```dockerfile
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

- [ ] **Step 2: Commit**

```bash
git add Dockerfile.caddy
git commit -m "feat: add custom Caddy Dockerfile with Cloudflare DNS module"
```

---

### Task 3: Create the Caddyfile

**Files:**
- Create: `Caddyfile`

- [ ] **Step 1: Create `Caddyfile`**

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

**How this works:**
- `jam-jar.app` routes to the production container (hostname `jamjar-prod` on the Docker network)
- `*.jam-jar.app` extracts the subdomain via `{labels.2}` (zero-indexed from right: `app`=0, `jam-jar`=1, subdomain=2) and proxies to a container with that hostname
- QA containers set their Docker hostname to their sanitized branch name, so Caddy resolves them automatically
- The `tls` block uses DNS-01 challenge via Cloudflare for the wildcard cert
- The bare domain uses HTTP-01 (default) since Caddy binds ports 80/443

- [ ] **Step 2: Commit**

```bash
git add Caddyfile
git commit -m "feat: add Caddyfile for production and wildcard QA routing"
```

---

### Task 4: Update production `docker-compose.yml` to add Caddy

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Update `docker-compose.yml`**

Replace the entire file with:

```yaml
services:
  app:
    build: .
    hostname: jamjar-prod
    volumes:
      - jam-data:/data
    environment:
      - JAM_DATA_DIR=/data
      - JAM_STATIC_DIR=/app/static
      - JAM_JWT_SECRET=${JAM_JWT_SECRET}
      - JAM_API_KEY=${JAM_API_KEY}
      - JAM_CORS_ORIGINS=${JAM_CORS_ORIGINS:-https://jam-jar.app}
      - JAM_R2_ENABLED=${JAM_R2_ENABLED:-false}
      - JAM_R2_ACCOUNT_ID=${JAM_R2_ACCOUNT_ID:-}
      - JAM_R2_ACCESS_KEY_ID=${JAM_R2_ACCESS_KEY_ID:-}
      - JAM_R2_SECRET_ACCESS_KEY=${JAM_R2_SECRET_ACCESS_KEY:-}
      - JAM_R2_BUCKET=${JAM_R2_BUCKET:-}
      - JAM_R2_CUSTOM_DOMAIN=${JAM_R2_CUSTOM_DOMAIN:-}
      - JAM_SMTP_HOST=${JAM_SMTP_HOST:-}
      - JAM_SMTP_PORT=${JAM_SMTP_PORT:-587}
      - JAM_SMTP_USER=${JAM_SMTP_USER:-}
      - JAM_SMTP_PASSWORD=${JAM_SMTP_PASSWORD:-}
      - JAM_SMTP_FROM=${JAM_SMTP_FROM:-}
      - JAM_APP_URL=${JAM_APP_URL:-}
    networks:
      - jamjar-net
    restart: unless-stopped

  caddy:
    build:
      context: .
      dockerfile: Dockerfile.caddy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    environment:
      - CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}
    networks:
      - jamjar-net
    restart: unless-stopped

volumes:
  jam-data:
  caddy-data:
  caddy-config:

networks:
  jamjar-net:
    name: jamjar-net
```

Key changes from current file:
- Removed `ports: - "80:8000"` from `app` (Caddy handles this now)
- Added `hostname: jamjar-prod` to `app` (so Caddy can route to it by hostname, avoiding DNS conflicts with QA containers)
- Added `JAM_CORS_ORIGINS` defaulting to `https://jam-jar.app` (required now that Caddy serves HTTPS — without this, API calls from the frontend would fail CORS checks)
- Added `caddy` service with custom Dockerfile, port bindings, and Caddyfile mount
- Added `jamjar-net` network with explicit name (so QA containers on external projects can join it)
- Added `caddy-data` and `caddy-config` volumes for Caddy's TLS cert storage

- [ ] **Step 2: Verify the compose file is valid**

Run: `docker compose config --quiet`
Expected: no output (valid config)

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add Caddy reverse proxy, move production behind shared network"
```

---

### Task 5: Create the QA Docker Compose file

**Files:**
- Create: `docker-compose.qa.yml`

- [ ] **Step 1: Create `docker-compose.qa.yml`**

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

Key design decisions:
- `hostname` matches the branch name so Caddy's `{labels.2}` resolves to this container
- `container_name` also matches for easier `docker ps` identification
- `labels: qa=true` enables the resource guard to count QA containers
- `jamjar-net` is declared `external` — it must exist before starting (created by production compose or the deploy script)
- No R2 or SMTP env vars — QA uses local storage only, no emails
- Hardcoded JWT secret is fine since QA only has test data
- Volume gets project-name-prefixed by Docker Compose (`qa-<branch>_qa-data`), ensuring isolation

- [ ] **Step 2: Commit**

```bash
git add docker-compose.qa.yml
git commit -m "feat: add QA Docker Compose file for branch deployments"
```

---

### Task 6: Update the production deploy workflow

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Update `.github/workflows/deploy.yml`**

Add network creation before `docker compose up`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Pre-deploy database backup
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          passphrase: ${{ secrets.SSH_PASSPHRASE }}
          script: |
            set -e
            cd /opt/jamjar
            docker compose exec -T app /app/scripts/backup-db.sh || echo "Pre-deploy backup skipped (container not running)"

      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          passphrase: ${{ secrets.SSH_PASSPHRASE }}
          script: |
            set -e
            cd /opt/jamjar
            git pull
            docker network create jamjar-net || true
            docker compose up --build -d
            docker image prune -f

      - name: Set up daily backup cron job
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          passphrase: ${{ secrets.SSH_PASSPHRASE }}
          script: |
            CRON_CMD="0 3 * * * cd /opt/jamjar && docker compose exec -T app /app/scripts/backup-db.sh >> /var/log/jam-backup.log 2>&1"
            (crontab -l 2>/dev/null | grep -v "backup-db.sh" ; echo "$CRON_CMD") | crontab -
```

The only change is adding `docker network create jamjar-net || true` before `docker compose up`. The `|| true` makes it idempotent — if the network already exists, it's a no-op.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat: ensure shared Docker network exists before production deploy"
```

---

### Task 7: Create the QA deploy workflow

**Files:**
- Create: `.github/workflows/qa-deploy.yml`

- [ ] **Step 1: Create `.github/workflows/qa-deploy.yml`**

```yaml
name: QA Deploy

on:
  push:
    branches-ignore: [main]

concurrency:
  group: qa-${{ github.ref_name }}
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Sanitize branch name
        id: branch
        run: |
          NAME=$(echo "${{ github.ref_name }}" \
            | tr '[:upper:]' '[:lower:]' \
            | sed 's/[^a-z0-9-]/-/g' \
            | sed 's/--*/-/g' \
            | sed 's/^-//;s/-$//' \
            | cut -c1-63)
          echo "name=$NAME" >> "$GITHUB_OUTPUT"

      - name: Check resource limit
        id: guard
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          passphrase: ${{ secrets.SSH_PASSPHRASE }}
          script: |
            COUNT=$(docker ps --filter "label=qa=true" -q | wc -l)
            echo "qa_count=$COUNT"
            if [ "$COUNT" -ge 5 ]; then
              echo "RESOURCE_LIMIT_HIT=true"
              exit 1
            fi

      - name: Comment resource limit warning
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            const pulls = await github.rest.pulls.list({
              owner: context.repo.owner,
              repo: context.repo.repo,
              head: `${context.repo.owner}:${context.repo.ref.replace('refs/heads/', '')}`,
              state: 'open'
            });
            for (const pr of pulls.data) {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: pr.number,
                body: '⚠️ **QA Deploy skipped:** 5 QA instances already running. Delete an old branch to free a slot.'
              });
            }

      - name: Deploy QA instance
        if: success()
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          passphrase: ${{ secrets.SSH_PASSPHRASE }}
          script: |
            set -e
            QA_NAME="${{ steps.branch.outputs.name }}"
            REPO_URL="https://github.com/${{ github.repository }}.git"
            WORKSPACE="/opt/jamjar-qa/$QA_NAME"

            # Clone or update workspace
            if [ -d "$WORKSPACE" ]; then
              cd "$WORKSPACE"
              git fetch origin
              git checkout "${{ github.ref_name }}"
              git reset --hard "origin/${{ github.ref_name }}"
            else
              git clone --branch "${{ github.ref_name }}" --single-branch "$REPO_URL" "$WORKSPACE"
              cd "$WORKSPACE"
            fi

            # Ensure shared network exists
            docker network create jamjar-net || true

            # Build and start QA container
            export QA_BRANCH_NAME="$QA_NAME"
            docker compose -p "qa-$QA_NAME" -f docker-compose.qa.yml up --build -d

      - name: Health check
        if: success()
        run: |
          QA_NAME="${{ steps.branch.outputs.name }}"
          for i in 1 2 3 4 5; do
            if curl -sf "https://$QA_NAME.jam-jar.app/health" > /dev/null 2>&1; then
              echo "QA instance is healthy at https://$QA_NAME.jam-jar.app"
              exit 0
            fi
            echo "Attempt $i: waiting for QA instance..."
            sleep 5
          done
          echo "Warning: health check did not pass after 5 attempts"
          exit 0  # Don't fail the workflow, instance may still be starting

      - name: Comment on PR
        if: success()
        uses: actions/github-script@v7
        with:
          script: |
            const qaName = '${{ steps.branch.outputs.name }}';
            const qaUrl = `https://${qaName}.jam-jar.app`;
            const body = `🔍 **QA Preview:** ${qaUrl}\n\nLogin: \`test\` / \`test\``;

            // Find existing PR for this branch
            const pulls = await github.rest.pulls.list({
              owner: context.repo.owner,
              repo: context.repo.repo,
              head: `${context.repo.owner}:${context.repo.ref.replace('refs/heads/', '')}`,
              state: 'open'
            });

            for (const pr of pulls.data) {
              // Check for existing QA comment
              const comments = await github.rest.issues.listComments({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: pr.number
              });
              const existing = comments.data.find(c => c.body.includes('QA Preview:'));
              if (existing) {
                await github.rest.issues.updateComment({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  comment_id: existing.id,
                  body: body
                });
              } else {
                await github.rest.issues.createComment({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: pr.number,
                  body: body
                });
              }
            }
```

**Branch name sanitization logic:**
1. `tr '[:upper:]' '[:lower:]'` — lowercase
2. `sed 's/[^a-z0-9-]/-/g'` — replace non-alphanumeric (except hyphens) with `-`
3. `sed 's/--*/-/g'` — collapse consecutive hyphens
4. `sed 's/^-//;s/-$//'` — strip leading/trailing hyphens
5. `cut -c1-63` — truncate to 63 chars (DNS label limit)

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/qa-deploy.yml
git commit -m "feat: add GitHub Actions workflow for QA branch deployments"
```

---

### Task 8: Create the QA cleanup workflow

**Files:**
- Create: `.github/workflows/qa-cleanup.yml`

- [ ] **Step 1: Create `.github/workflows/qa-cleanup.yml`**

```yaml
name: QA Cleanup

on:
  delete:
  pull_request:
    types: [closed]

concurrency:
  group: qa-${{ github.event.ref || github.head_ref }}

jobs:
  cleanup:
    runs-on: ubuntu-latest
    # Only run for branch deletions (not tag deletions)
    if: github.event_name == 'pull_request' || github.event.ref_type == 'branch'
    steps:
      - name: Sanitize branch name
        id: branch
        run: |
          REF="${{ github.event.ref || github.head_ref }}"
          NAME=$(echo "$REF" \
            | tr '[:upper:]' '[:lower:]' \
            | sed 's/[^a-z0-9-]/-/g' \
            | sed 's/--*/-/g' \
            | sed 's/^-//;s/-$//' \
            | cut -c1-63)
          echo "name=$NAME" >> "$GITHUB_OUTPUT"

      - name: Clean up QA instance
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          passphrase: ${{ secrets.SSH_PASSPHRASE }}
          script: |
            set -e
            QA_NAME="${{ steps.branch.outputs.name }}"
            WORKSPACE="/opt/jamjar-qa/$QA_NAME"

            # Tear down the container and volume (if workspace exists)
            if [ -d "$WORKSPACE" ]; then
              cd "$WORKSPACE"
              docker compose -p "qa-$QA_NAME" -f docker-compose.qa.yml down -v || true
            else
              # Try to stop container directly if workspace is gone
              docker rm -f "$QA_NAME" 2>/dev/null || true
            fi

            # Remove workspace directory
            rm -rf "$WORKSPACE"

            # Clean up images
            docker image prune -f
```

**Key details:**
- Triggers on both `delete` (branch deletion) and `pull_request: closed` (PR merge without branch deletion)
- The `if` condition filters out tag deletions
- Branch name for `delete` events comes from `github.event.ref`, for PR events from `github.head_ref`
- Concurrency group matches the deploy workflow to prevent races
- Cleanup is fully idempotent — every step uses `|| true` or checks for existence
- Falls back to `docker rm -f` if workspace is already gone but container still exists

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/qa-cleanup.yml
git commit -m "feat: add GitHub Actions workflow for QA cleanup on branch delete/PR close"
```

---

### Task 9: Manual setup steps (documentation)

These steps must be done by the user on the VPS and Cloudflare dashboard. No code changes needed.

- [ ] **Step 1: Add wildcard DNS record**

In Cloudflare DNS settings for `jam-jar.app`:
- Add an A record: `*` → `<VPS IP address>` (DNS only / gray cloud — do NOT proxy)
- The existing `jam-jar.app` A record should remain as-is

- [ ] **Step 2: Create Cloudflare API token**

In Cloudflare dashboard → My Profile → API Tokens:
- Create token with `Zone:DNS:Edit` permission for the `jam-jar.app` zone
- Copy the token value

- [ ] **Step 3: Add token to VPS**

SSH into the VPS and add to `/opt/jamjar/.env`:
```
CLOUDFLARE_API_TOKEN=<your-token>
```

- [ ] **Step 4: Add secrets to GitHub**

In the repo settings → Secrets and variables → Actions, add:
- `CLOUDFLARE_API_TOKEN` — same token as above (used by QA deploy workflow for health checks; the VPS reads it from `.env`)

- [ ] **Step 5: Create the QA workspace directory on VPS**

```bash
ssh <user>@<host>
sudo mkdir -p /opt/jamjar-qa
sudo chown $(whoami):$(whoami) /opt/jamjar-qa
```

- [ ] **Step 6: Deploy and verify**

Push the changes to `main` to trigger the production deploy. This will:
1. Build the custom Caddy image
2. Create the `jamjar-net` network
3. Start both `app` and `caddy` containers
4. Caddy obtains TLS certs and begins routing

Verify:
- `https://jam-jar.app` loads (production, now via Caddy with HTTPS)
- `https://nonexistent.jam-jar.app` returns 502 (expected — no container)

- [ ] **Step 7: Test QA deployment**

Create a test branch, push it, and verify:
```bash
git checkout -b test-qa-deploy
# Make a small change (e.g., add a comment to any file)
git push -u origin test-qa-deploy
```

Watch the GitHub Actions "QA Deploy" workflow. Once complete:
- Visit `https://test-qa-deploy.jam-jar.app`
- Log in with `test` / `test`
- Delete the branch to verify cleanup works:
```bash
git checkout main
git push origin --delete test-qa-deploy
git branch -d test-qa-deploy
```
