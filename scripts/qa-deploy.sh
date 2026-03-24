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
