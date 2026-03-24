# QA Branch Deploys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy feature branches to `<branch>.jam-jar.app` for testing, triggered by adding a `deploy-qa` label to a PR, with automatic teardown and weekly orphan cleanup.

**Architecture:** Caddy runs as a systemd service on the VPS, reverse-proxying `jam-jar.app` to prod and `<branch>.jam-jar.app` to per-branch QA containers. GitHub Actions workflows manage the lifecycle: deploy on label, teardown on unlabel/close, weekly cleanup of orphans. Each QA env is an isolated Docker Compose project with a seeded DB and local-only storage.

**Tech Stack:** GitHub Actions, Docker Compose, Caddy, Bash scripts

**Spec:** `docs/superpowers/specs/2026-03-22-qa-branch-deployments-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/qa-deploy.sh` | Create | Server-side deploy: clone branch, assign port, generate compose file, build, seed DB, configure Caddy |
| `scripts/qa-teardown.sh` | Create | Server-side teardown: remove Caddy config, stop compose, delete workspace |
| `.github/workflows/qa-deploy.yml` | Create | GitHub Actions workflow triggered by `deploy-qa` label |
| `.github/workflows/qa-teardown.yml` | Create | GitHub Actions workflow triggered by label removal or PR close |
| `.github/workflows/qa-cleanup.yml` | Create | Weekly scheduled workflow to clean up orphaned QA environments |
| `scripts/seed-db.py` | Modify | Read `JAM_QA_PASSWORD` env var, use as password when set |
| `docker-compose.yml` | Modify | Change port mapping from `"80:8000"` to `"127.0.0.1:8000:8000"` |
| `CLAUDE.md` | Modify | Document QA deploy process |

---

### Task 1: Modify seed script to support QA password

**Files:**
- Modify: `scripts/seed-db.py:34,807`

- [ ] **Step 1: Update DEFAULT_PASSWORD logic**

In `scripts/seed-db.py`, change line 34 from:

```python
DEFAULT_PASSWORD = "test"
```

to:

```python
DEFAULT_PASSWORD = os.environ.get("JAM_QA_PASSWORD", "test")
```

Add `import os` at the top of the file (after `from pathlib import Path`, line 14). The `DEFAULT_PASSWORD` assignment stays at line 34.

- [ ] **Step 2: Test locally**

Run the seed script without the env var and verify it still uses "test":

```bash
source .venv/bin/activate
rm -f /tmp/test-seed.db
python scripts/seed-db.py /tmp/test-seed.db
```

Expected: Seeds successfully, prints `All users have password: test`

- [ ] **Step 3: Test with QA password**

```bash
JAM_QA_PASSWORD=qapass123 python scripts/seed-db.py /tmp/test-seed-qa.db
```

Expected: Seeds successfully, prints `All users have password: qapass123`

- [ ] **Step 4: Clean up and commit**

```bash
rm -f /tmp/test-seed.db /tmp/test-seed-qa.db
git add scripts/seed-db.py
git commit -m "feat: support JAM_QA_PASSWORD env var in seed script"
```

---

### Task 2: Create the QA deploy script

**Files:**
- Create: `scripts/qa-deploy.sh`

- [ ] **Step 1: Create the deploy script**

Create `scripts/qa-deploy.sh`:

```bash
#!/usr/bin/env bash
# Deploy a QA environment for a feature branch.
# Usage: qa-deploy.sh <sanitized-branch-name> <git-repo-url> <git-ref>
#
# Expects JAM_QA_PASSWORD to be set in the environment.
# Creates workspace at /opt/jamjar-qa/<branch>/, builds and starts a Docker
# Compose project, seeds the DB, and registers a Caddy route.

set -euo pipefail

BRANCH="$1"
REPO_URL="$2"
GIT_REF="$3"

QA_BASE="/opt/jamjar-qa"
WORKSPACE="${QA_BASE}/${BRANCH}"
PROJECT_NAME="jamjar-qa-${BRANCH}"
CADDY_SITES="/etc/caddy/qa-sites"
CADDYFILE="/etc/caddy/Caddyfile"
MAX_QA_ENVS=3
PORT_START=8001

# --- Validate environment ---
if [ -z "${JAM_QA_PASSWORD:-}" ]; then
    echo "ERROR: JAM_QA_PASSWORD is not set. Cannot deploy QA environment."
    exit 1
fi

# --- Check concurrent environment limit ---
active_count=$(find "$QA_BASE" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
# Don't count this branch if it already has a workspace (redeployment)
if [ -d "$WORKSPACE" ]; then
    active_count=$((active_count - 1))
fi
if [ "$active_count" -ge "$MAX_QA_ENVS" ]; then
    echo "ERROR: Maximum $MAX_QA_ENVS QA environments already running. Tear one down first."
    exit 1
fi

# --- Assign a port ---
find_available_port() {
    local port=$PORT_START
    while true; do
        # Check if any existing workspace uses this port
        local in_use=false
        for port_file in "$QA_BASE"/*/port; do
            [ -f "$port_file" ] || continue
            if [ "$(cat "$port_file")" = "$port" ]; then
                in_use=true
                break
            fi
        done
        if [ "$in_use" = false ] && ! ss -tlnp | grep -q ":${port} "; then
            echo "$port"
            return
        fi
        port=$((port + 1))
        if [ "$port" -gt 8099 ]; then
            echo "ERROR: No available ports in range 8001-8099" >&2
            exit 1
        fi
    done
}

# --- Tear down existing deployment for this branch (if redeploying) ---
if [ -d "$WORKSPACE" ]; then
    echo "=== Tearing down existing deployment for ${BRANCH} ==="
    rm -f "${CADDY_SITES}/${BRANCH}.caddy"
    cd "$WORKSPACE"
    docker compose -p "$PROJECT_NAME" down -v 2>/dev/null || true
    cd /
    rm -rf "$WORKSPACE"
fi

# --- Clone the branch ---
echo "=== Cloning ${GIT_REF} into ${WORKSPACE} ==="
mkdir -p "$WORKSPACE"
git clone --depth 1 --branch "$GIT_REF" "$REPO_URL" "$WORKSPACE"
cd "$WORKSPACE"

# --- Save original branch name (for cleanup workflow API lookups) ---
echo "$GIT_REF" > "${WORKSPACE}/original-branch"

# --- Assign port and save ---
PORT=$(find_available_port)
echo "$PORT" > "${WORKSPACE}/port"
echo "=== Assigned port ${PORT} ==="

# --- Generate docker-compose.qa.yml ---
JWT_SECRET=$(openssl rand -hex 32)

cat > "${WORKSPACE}/docker-compose.qa.yml" <<YAML
services:
  app:
    build: .
    ports:
      - "127.0.0.1:${PORT}:8000"
    environment:
      - JAM_DATA_DIR=/data
      - JAM_STATIC_DIR=/app/static
      - JAM_JWT_SECRET=${JWT_SECRET}
      - JAM_APP_URL=https://${BRANCH}.jam-jar.app
      - JAM_CORS_ORIGINS=https://${BRANCH}.jam-jar.app
      - JAM_QA_PASSWORD=${JAM_QA_PASSWORD}
    volumes:
      - qa-data:/data
    mem_limit: 512m
    cpus: 1.0
    restart: unless-stopped

volumes:
  qa-data:
YAML

# --- Build and start ---
echo "=== Building and starting QA environment ==="
docker compose -p "$PROJECT_NAME" -f docker-compose.qa.yml up --build -d

# --- Seed the database ---
echo "=== Seeding database ==="
docker compose -p "$PROJECT_NAME" -f docker-compose.qa.yml exec -T app \
    python /app/scripts/seed-db.py /data/jam_sessions.db

# --- Register Caddy route ---
echo "=== Registering Caddy route ==="
cat > "${CADDY_SITES}/${BRANCH}.caddy" <<CADDY
${BRANCH}.jam-jar.app {
    reverse_proxy localhost:${PORT}
}
CADDY

sudo caddy reload --config "$CADDYFILE"

# --- Health check ---
echo "=== Running health check ==="
if curl --retry 10 --retry-delay 5 --retry-max-time 120 --retry-connrefused \
    -sf "http://localhost:${PORT}/health" > /dev/null; then
    echo "=== QA environment ready: https://${BRANCH}.jam-jar.app ==="
else
    echo "=== Health check failed. Last 50 log lines: ==="
    docker compose -p "$PROJECT_NAME" -f docker-compose.qa.yml logs --tail 50
    exit 1
fi
```

- [ ] **Step 2: Make it executable and commit**

```bash
chmod +x scripts/qa-deploy.sh
git add scripts/qa-deploy.sh
git commit -m "feat: add QA deploy script"
```

---

### Task 3: Create the QA teardown script

**Files:**
- Create: `scripts/qa-teardown.sh`

- [ ] **Step 1: Create the teardown script**

Create `scripts/qa-teardown.sh`:

```bash
#!/usr/bin/env bash
# Tear down a QA environment for a feature branch.
# Usage: qa-teardown.sh <sanitized-branch-name>
#
# Idempotent — safe to run even if the environment doesn't exist.

set -euo pipefail

BRANCH="$1"

QA_BASE="/opt/jamjar-qa"
WORKSPACE="${QA_BASE}/${BRANCH}"
PROJECT_NAME="jamjar-qa-${BRANCH}"
CADDY_SITES="/etc/caddy/qa-sites"
CADDYFILE="/etc/caddy/Caddyfile"

echo "=== Tearing down QA environment for ${BRANCH} ==="

# --- Remove Caddy route ---
if [ -f "${CADDY_SITES}/${BRANCH}.caddy" ]; then
    echo "Removing Caddy config..."
    rm -f "${CADDY_SITES}/${BRANCH}.caddy"
    sudo caddy reload --config "$CADDYFILE"
fi

# --- Stop and remove Docker Compose project ---
if [ -d "$WORKSPACE" ]; then
    echo "Stopping Docker Compose project..."
    cd "$WORKSPACE"
    docker compose -p "$PROJECT_NAME" -f docker-compose.qa.yml down -v 2>/dev/null || true
    cd /
fi

# --- Remove workspace ---
if [ -d "$WORKSPACE" ]; then
    echo "Removing workspace..."
    rm -rf "$WORKSPACE"
fi

# --- Prune unused images ---
echo "Pruning unused images..."
docker image prune -f

echo "=== Teardown complete for ${BRANCH} ==="
```

- [ ] **Step 2: Make it executable and commit**

```bash
chmod +x scripts/qa-teardown.sh
git add scripts/qa-teardown.sh
git commit -m "feat: add QA teardown script"
```

---

### Task 4: Create the QA deploy workflow

**Files:**
- Create: `.github/workflows/qa-deploy.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/qa-deploy.yml`:

```yaml
name: QA Deploy

on:
  pull_request:
    types: [labeled]

concurrency:
  group: qa-${{ github.event.pull_request.head.ref }}
  cancel-in-progress: true

jobs:
  deploy:
    if: github.event.label.name == 'deploy-qa'
    runs-on: ubuntu-latest
    steps:
      - name: Sanitize branch name
        id: branch
        run: |
          RAW="${{ github.event.pull_request.head.ref }}"
          SANITIZED=$(echo "$RAW" | tr '[:upper:]' '[:lower:]' | sed 's|[^a-z0-9-]|-|g' | sed 's|-\+|-|g' | sed 's|^-\+||;s|-\+$||' | cut -c1-63)

          if [[ "$SANITIZED" =~ ^(main|master|prod)$ ]]; then
            echo "::error::Reserved branch name: $SANITIZED"
            exit 1
          fi

          echo "name=$SANITIZED" >> "$GITHUB_OUTPUT"

      - name: Deploy QA environment
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          passphrase: ${{ secrets.SSH_PASSPHRASE }}
          script: |
            set -e
            source /opt/jamjar/.env
            export JAM_QA_PASSWORD
            /opt/jamjar/scripts/qa-deploy.sh \
              "${{ steps.branch.outputs.name }}" \
              "https://github.com/${{ github.repository }}.git" \
              "${{ github.event.pull_request.head.ref }}"

      - name: Comment on PR
        uses: actions/github-script@v7
        with:
          script: |
            const branch = '${{ steps.branch.outputs.name }}';
            const url = `https://${branch}.jam-jar.app`;
            const marker = '<!-- qa-deploy -->';
            const body = `${marker}\n🔗 **QA environment deployed:** ${url}\n\nLogin with any seeded user and the QA password.`;

            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.payload.pull_request.number,
            });

            const existing = comments.find(c => c.body.includes(marker));
            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.payload.pull_request.number,
                body,
              });
            }
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/qa-deploy.yml
git commit -m "feat: add QA deploy GitHub Actions workflow"
```

---

### Task 5: Create the QA teardown workflow

**Files:**
- Create: `.github/workflows/qa-teardown.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/qa-teardown.yml`:

```yaml
name: QA Teardown

on:
  pull_request:
    types: [closed, unlabeled]

concurrency:
  group: qa-${{ github.event.pull_request.head.ref }}

jobs:
  teardown:
    if: >
      (github.event.action == 'closed' && contains(github.event.pull_request.labels.*.name, 'deploy-qa')) ||
      (github.event.action == 'unlabeled' && github.event.label.name == 'deploy-qa')
    runs-on: ubuntu-latest
    steps:
      - name: Sanitize branch name
        id: branch
        run: |
          RAW="${{ github.event.pull_request.head.ref }}"
          SANITIZED=$(echo "$RAW" | tr '[:upper:]' '[:lower:]' | sed 's|[^a-z0-9-]|-|g' | sed 's|-\+|-|g' | sed 's|^-\+||;s|-\+$||' | cut -c1-63)
          echo "name=$SANITIZED" >> "$GITHUB_OUTPUT"

      - name: Teardown QA environment
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          passphrase: ${{ secrets.SSH_PASSPHRASE }}
          script: |
            set -e
            /opt/jamjar/scripts/qa-teardown.sh "${{ steps.branch.outputs.name }}"

      - name: Update PR comment
        uses: actions/github-script@v7
        with:
          script: |
            const marker = '<!-- qa-deploy -->';
            const body = `${marker}\n~~QA environment torn down.~~`;

            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.payload.pull_request.number,
            });

            const existing = comments.find(c => c.body.includes(marker));
            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body,
              });
            }
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/qa-teardown.yml
git commit -m "feat: add QA teardown GitHub Actions workflow"
```

---

### Task 6: Create the weekly cleanup workflow

**Files:**
- Create: `.github/workflows/qa-cleanup.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/qa-cleanup.yml`:

```yaml
name: QA Cleanup

on:
  schedule:
    - cron: '0 6 * * 0'  # Sunday at 6am UTC
  workflow_dispatch:       # Allow manual trigger

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Find and clean orphaned QA environments
        uses: appleboy/ssh-action@v1
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GH_REPO: ${{ github.repository }}
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          passphrase: ${{ secrets.SSH_PASSPHRASE }}
          envs: GH_TOKEN,GH_REPO
          script: |
            set -e
            QA_BASE="/opt/jamjar-qa"
            CADDY_SITES="/etc/caddy/qa-sites"
            CADDYFILE="/etc/caddy/Caddyfile"
            CLEANED=0

            if [ ! -d "$QA_BASE" ] || [ -z "$(ls -A "$QA_BASE" 2>/dev/null)" ]; then
              echo "No QA environments found."
              exit 0
            fi

            for workspace in "$QA_BASE"/*/; do
              [ -d "$workspace" ] || continue
              BRANCH=$(basename "$workspace")

              echo "Checking QA environment: $BRANCH"

              # Read original branch name (saved during deploy) for accurate API lookup
              ORIGINAL_BRANCH="$BRANCH"
              if [ -f "${workspace}original-branch" ]; then
                ORIGINAL_BRANCH=$(cat "${workspace}original-branch")
              fi

              # Query GitHub API for open PRs with deploy-qa label matching this branch
              HAS_PR=$(curl -sf \
                -H "Authorization: token $GH_TOKEN" \
                -H "Accept: application/vnd.github+json" \
                "https://api.github.com/repos/${GH_REPO}/pulls?state=open&head=${GH_REPO%%/*}:${ORIGINAL_BRANCH}" \
                | python3 -c "
            import json, sys
            prs = json.load(sys.stdin)
            has_label = any(
                any(l['name'] == 'deploy-qa' for l in pr.get('labels', []))
                for pr in prs
            )
            print('yes' if has_label else 'no')
            " 2>/dev/null || echo "no")

              if [ "$HAS_PR" = "no" ]; then
                echo "  No matching open PR with deploy-qa label. Cleaning up..."
                /opt/jamjar/scripts/qa-teardown.sh "$BRANCH"
                CLEANED=$((CLEANED + 1))
              else
                echo "  Active PR found. Skipping."
              fi
            done

            echo "Cleanup complete. Removed $CLEANED orphaned environment(s)."
```

Note: The cleanup workflow uses the `GITHUB_TOKEN` (automatically provided by GitHub Actions) to query the API. The `head` filter on the PR search uses the original branch name (saved to `original-branch` file during deploy) for accurate API lookups, since the sanitized branch name may not match the GitHub branch name.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/qa-cleanup.yml
git commit -m "feat: add weekly QA orphan cleanup workflow"
```

---

### Task 7: Update docker-compose.yml for Caddy

**Files:**
- Modify: `docker-compose.yml:5`

- [ ] **Step 1: Change the port mapping**

In `docker-compose.yml`, change line 5 from:

```yaml
      - "80:8000"
```

to:

```yaml
      - "127.0.0.1:8000:8000"
```

This binds to localhost only, preventing direct access that bypasses Caddy. Production is accessed via Caddy reverse proxy on port 443/80.

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: move prod behind Caddy reverse proxy (bind to localhost:8000)"
```

---

### Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add QA deploy documentation**

Add a new section to `CLAUDE.md` after the "Deployment" section:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add QA deployments section to CLAUDE.md"
```

---

### Task 9: End-to-end verification

This task is performed after the manual setup tasks on the VPS are complete (Caddy installed, wildcard DNS configured, etc.).

- [ ] **Step 1: Create a test branch and PR**

```bash
git checkout -b test/qa-deploy
echo "# QA deploy test" > /tmp/qa-test.md
git add /tmp/qa-test.md || true
git commit --allow-empty -m "test: verify QA deploy pipeline"
git push -u origin test/qa-deploy
gh pr create --title "Test QA deploy" --body "Testing the QA deploy pipeline"
```

- [ ] **Step 2: Add the deploy-qa label**

```bash
gh pr edit --add-label deploy-qa
```

- [ ] **Step 3: Verify deployment**

Wait for the GitHub Actions workflow to complete, then:
- Check the PR for the QA URL comment
- Visit `https://test-qa-deploy.jam-jar.app` in a browser
- Log in with a seeded user and the QA password
- Verify the health endpoint: `curl https://test-qa-deploy.jam-jar.app/health`

- [ ] **Step 4: Verify teardown**

```bash
gh pr close
```

Wait for the teardown workflow, then verify:
- PR comment updated to "torn down"
- `https://test-qa-deploy.jam-jar.app` no longer resolves
- SSH into VPS and confirm `/opt/jamjar-qa/test-qa-deploy/` is gone

- [ ] **Step 5: Clean up**

```bash
git checkout main
git branch -d test/qa-deploy
git push origin --delete test/qa-deploy
```
