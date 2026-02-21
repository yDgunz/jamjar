#!/usr/bin/env bash
# Nuke the database, re-seed with test data, and restart the local server.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "=== Stopping any running server ==="
pkill -f 'uvicorn.*jam_session_processor' 2>/dev/null && echo "Killed uvicorn." || echo "No server running."
sleep 0.5

echo ""
echo "=== Wiping database and track files ==="
rm -f jam_sessions.db
rm -rf tracks/
rm -rf recordings/
echo "Removed jam_sessions.db, tracks/, recordings/"

echo ""
echo "=== Seeding database ==="
source .venv/bin/activate
python scripts/seed-db.py

echo ""
echo "=== Starting server ==="
jam-session serve --reload &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

echo ""
echo "=== Ready ==="
echo "  API:      http://localhost:8000"
echo "  Frontend: http://localhost:5173  (run 'cd web && npm run dev' separately)"
echo "  Login:    eric@example.com / testpass123"
echo ""
echo "Press Ctrl+C to stop the server."
wait $SERVER_PID
