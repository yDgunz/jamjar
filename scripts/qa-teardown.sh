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
