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

# Data lives in a named Docker volume mounted at /data inside the container.
# All DB/backup checks run via docker exec.
section "Database"
container=$(docker compose -f "$PROD_DIR/docker-compose.yml" ps -q 2>/dev/null | head -1)
if [ -n "$container" ]; then
    db_size=$(docker exec "$container" du -h /data/jam_sessions.db 2>/dev/null | cut -f1)
    if [ -n "$db_size" ]; then
        ok "Database: $db_size"
        sessions=$(docker exec "$container" sqlite3 /data/jam_sessions.db "SELECT COUNT(*) FROM sessions;" 2>/dev/null || echo "?")
        tracks=$(docker exec "$container" sqlite3 /data/jam_sessions.db "SELECT COUNT(*) FROM tracks;" 2>/dev/null || echo "?")
        users=$(docker exec "$container" sqlite3 /data/jam_sessions.db "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "?")
        groups=$(docker exec "$container" sqlite3 /data/jam_sessions.db "SELECT COUNT(*) FROM groups;" 2>/dev/null || echo "?")
        echo "    Sessions: $sessions | Tracks: $tracks | Users: $users | Groups: $groups"
    else
        fail "Database not found in container"
    fi
else
    fail "No running container to check database"
fi

# Backups run inside the container (cron via deploy workflow) and are pushed to R2.
section "Backups"
if [ -n "$container" ]; then
    backup_info=$(docker exec "$container" bash -c '
        dir=/data/backups
        if [ -d "$dir" ]; then
            count=$(find "$dir" -name "*.db.gz" -type f | wc -l)
            latest=$(ls -1t "$dir"/jam_sessions_*.db.gz 2>/dev/null | head -1)
            if [ -n "$latest" ]; then
                name=$(basename "$latest")
                age=$(( ($(date +%s) - $(stat -c %Y "$latest")) / 3600 ))
                echo "$count|$name|$age"
            else
                echo "0||"
            fi
        else
            echo "nodir||"
        fi
    ' 2>/dev/null)

    backup_count=$(echo "$backup_info" | cut -d'|' -f1)
    backup_name=$(echo "$backup_info" | cut -d'|' -f2)
    backup_age=$(echo "$backup_info" | cut -d'|' -f3)

    if [ "$backup_count" = "nodir" ]; then
        warn "No local backups (backups may be R2-only)"
    elif [ "$backup_count" = "0" ] || [ -z "$backup_name" ]; then
        warn "No local backups found (backups may be R2-only)"
    else
        if [ "$backup_age" -gt 48 ]; then
            fail "Latest: $backup_name (${backup_age}h ago) — STALE"
        elif [ "$backup_age" -gt 24 ]; then
            warn "Latest: $backup_name (${backup_age}h ago)"
        else
            ok "Latest: $backup_name (${backup_age}h ago)"
        fi
        ok "Local backups: $backup_count"
    fi
else
    fail "No running container to check backups"
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
