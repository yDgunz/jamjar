#!/usr/bin/env bash
# Server health report for jam-jar.app
#
# Usage:
#   ./scripts/server-health.sh
#
# Run on the VPS to get a quick overview of system and app health.

set -euo pipefail

PROD_DIR="/opt/jamjar"
QA_DIR="/opt/jamjar-qa"
APP_PORT=8000

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }

section() { echo -e "\n${BOLD}── $1 ──${NC}"; }

# ── System ──

section "System"
echo "  $(hostname) | $(date '+%Y-%m-%d %H:%M %Z')"
echo "  $(uptime)"

section "Memory"
mem_total=$(free -m | awk '/Mem:/ {print $2}')
mem_used=$(free -m | awk '/Mem:/ {print $3}')
mem_pct=$((mem_used * 100 / mem_total))
if [ "$mem_pct" -gt 90 ]; then
    fail "RAM: ${mem_used}MB / ${mem_total}MB (${mem_pct}%)"
elif [ "$mem_pct" -gt 75 ]; then
    warn "RAM: ${mem_used}MB / ${mem_total}MB (${mem_pct}%)"
else
    ok "RAM: ${mem_used}MB / ${mem_total}MB (${mem_pct}%)"
fi

section "Disk"
while read -r pct mount; do
    pct_num=${pct%\%}
    if [ "$pct_num" -gt 90 ]; then
        fail "$mount: $pct used"
    elif [ "$pct_num" -gt 75 ]; then
        warn "$mount: $pct used"
    else
        ok "$mount: $pct used"
    fi
done < <(df -h --output=pcent,target / | tail -n +2)

# ── Services ──

section "Services"
if systemctl is-active --quiet caddy 2>/dev/null; then
    ok "Caddy: active"
else
    fail "Caddy: not running"
fi

if systemctl is-active --quiet docker 2>/dev/null; then
    ok "Docker: active"
else
    fail "Docker: not running"
fi

# ── Prod App ──

section "Production"
if [ -d "$PROD_DIR" ]; then
    prod_status=$(docker compose -f "$PROD_DIR/docker-compose.yml" ps --format json 2>/dev/null | head -1)
    if [ -n "$prod_status" ]; then
        container_state=$(echo "$prod_status" | python3 -c "import sys,json; print(json.load(sys.stdin).get('State','unknown'))" 2>/dev/null || echo "unknown")
        container_name=$(echo "$prod_status" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Name','unknown'))" 2>/dev/null || echo "unknown")
        if [ "$container_state" = "running" ]; then
            ok "Container ($container_name): running"
            # Resource usage
            stats=$(docker stats --no-stream --format "CPU: {{.CPUPerc}}, Mem: {{.MemUsage}}" "$container_name" 2>/dev/null)
            [ -n "$stats" ] && echo "    $stats"
        else
            fail "Container ($container_name): $container_state"
        fi
    else
        fail "No containers found"
    fi

    # Health endpoint
    if health=$(curl -sf --max-time 5 "http://localhost:${APP_PORT}/health" 2>/dev/null); then
        ok "Health endpoint: $health"
    else
        fail "Health endpoint: unreachable"
    fi

    # HTTPS check
    if curl -sf --max-time 5 "https://jam-jar.app/health" >/dev/null 2>&1; then
        ok "HTTPS (jam-jar.app): reachable"
    else
        warn "HTTPS (jam-jar.app): unreachable (may be expected if running locally)"
    fi
else
    fail "Prod directory not found: $PROD_DIR"
fi

# ── Database ──

section "Database"
db_path="$PROD_DIR/jam-data/jam_sessions.db"
if [ -f "$db_path" ]; then
    db_size=$(du -h "$db_path" | cut -f1)
    ok "Database: $db_size"

    # Check inside the container for sqlite3
    container=$(docker compose -f "$PROD_DIR/docker-compose.yml" ps -q 2>/dev/null | head -1)
    if [ -n "$container" ]; then
        sessions=$(docker exec "$container" sqlite3 /data/jam_sessions.db "SELECT COUNT(*) FROM sessions;" 2>/dev/null || echo "?")
        tracks=$(docker exec "$container" sqlite3 /data/jam_sessions.db "SELECT COUNT(*) FROM tracks;" 2>/dev/null || echo "?")
        users=$(docker exec "$container" sqlite3 /data/jam_sessions.db "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "?")
        groups=$(docker exec "$container" sqlite3 /data/jam_sessions.db "SELECT COUNT(*) FROM groups;" 2>/dev/null || echo "?")
        echo "    Sessions: $sessions | Tracks: $tracks | Users: $users | Groups: $groups"
    fi
else
    warn "Database not found at $db_path"
fi

# ── Backups ──

section "Backups"
backup_dir="$PROD_DIR/jam-data/backups"
if [ -d "$backup_dir" ]; then
    backup_count=$(find "$backup_dir" -name "*.db.gz" -type f | wc -l)
    latest=$(find "$backup_dir" -name "*.db.gz" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
    if [ -n "$latest" ]; then
        latest_name=$(basename "$latest")
        latest_age=$(( ($(date +%s) - $(stat -c %Y "$latest")) / 3600 ))
        if [ "$latest_age" -gt 48 ]; then
            fail "Latest backup: $latest_name (${latest_age}h ago) — STALE"
        elif [ "$latest_age" -gt 24 ]; then
            warn "Latest backup: $latest_name (${latest_age}h ago)"
        else
            ok "Latest backup: $latest_name (${latest_age}h ago)"
        fi
        ok "Total backups: $backup_count"
    else
        warn "No backups found in $backup_dir"
    fi
else
    warn "Backup directory not found: $backup_dir"
fi

# ── QA Environments ──

section "QA Environments"
if [ -d "$QA_DIR" ]; then
    qa_count=0
    for qa in "$QA_DIR"/*/; do
        [ -d "$qa" ] || continue
        branch=$(basename "$qa")
        qa_compose="$qa/docker-compose.qa.yml"
        if [ -f "$qa_compose" ]; then
            qa_state=$(docker compose -f "$qa_compose" ps --format json 2>/dev/null | head -1)
            if [ -n "$qa_state" ]; then
                state=$(echo "$qa_state" | python3 -c "import sys,json; print(json.load(sys.stdin).get('State','unknown'))" 2>/dev/null || echo "unknown")
                if [ "$state" = "running" ]; then
                    ok "$branch.jam-jar.app: running"
                else
                    warn "$branch.jam-jar.app: $state"
                fi
            else
                warn "$branch: no containers"
            fi
            qa_count=$((qa_count + 1))
        fi
    done
    [ "$qa_count" -eq 0 ] && ok "No QA environments active"
else
    ok "No QA environments (directory doesn't exist)"
fi

# ── Docker Cleanup ──

section "Docker"
dangling=$(docker images -f "dangling=true" -q 2>/dev/null | wc -l)
if [ "$dangling" -gt 10 ]; then
    warn "Dangling images: $dangling (run 'docker image prune' to clean up)"
else
    ok "Dangling images: $dangling"
fi

echo ""
