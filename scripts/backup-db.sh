#!/usr/bin/env bash
# Backup the jam_sessions.db SQLite database.
#
# Uses `sqlite3 .backup` for a safe, consistent copy even while
# the application is running.
#
# Usage:
#   ./scripts/backup-db.sh [db_path] [backup_dir]
#
# Defaults:
#   db_path   = $JAM_DATA_DIR/jam_sessions.db (or ./jam_sessions.db)
#   backup_dir = $JAM_DATA_DIR/backups        (or ./backups)
#
# Cron example (daily at 3 AM):
#   0 3 * * * /opt/jam-session-processor/scripts/backup-db.sh >> /var/log/jam-backup.log 2>&1

set -euo pipefail

DATA_DIR="${JAM_DATA_DIR:-.}"
DB_PATH="${1:-${DATA_DIR}/jam_sessions.db}"
BACKUP_DIR="${2:-${DATA_DIR}/backups}"

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: Database not found at $DB_PATH"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/jam_sessions_${TIMESTAMP}.db"

sqlite3 "$DB_PATH" ".backup '${BACKUP_FILE}'"
gzip "$BACKUP_FILE"

echo "$(date -Iseconds) Backup created: ${BACKUP_FILE}.gz ($(du -h "${BACKUP_FILE}.gz" | cut -f1))"

# Keep last 30 local backups, remove older ones
ls -1t "${BACKUP_DIR}"/jam_sessions_*.db.gz 2>/dev/null | tail -n +31 | xargs -r rm -f

# Push offsite to R2 if configured
if [ -n "${JAM_R2_BUCKET:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  python3 "${SCRIPT_DIR}/backup-to-r2.py" "${BACKUP_FILE}.gz"
fi
