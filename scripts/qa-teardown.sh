#!/usr/bin/env bash
# Tear down a QA environment for a feature branch.
# Usage: qa-teardown.sh <sanitized-branch-name>
#
# Idempotent — safe to run even if the environment doesn't exist.

set -euo pipefail

BRANCH="$1"

# The name becomes a directory, a Compose project and a subdomain: accept only a
# DNS label, so nothing else can reach the rm -rf and Caddy config below
if [[ ! "$BRANCH" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
    echo "ERROR: '$BRANCH' is not a valid QA environment name (lowercase letters, digits, hyphens)."
    exit 1
fi

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
    docker compose -p "$PROJECT_NAME" -f docker-compose.qa.yml down -v --rmi all 2>/dev/null || true
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
