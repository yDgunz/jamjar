#!/bin/bash
# Upload all audio files from references/ to jam-jar.app for group "5th Business"
# Usage: ./scripts/upload-references.sh <API_KEY>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../.venv/bin/activate"

API_KEY="${1:?Usage: $0 <API_KEY>}"
SERVER="https://jam-jar.app"
GROUP="5th Business"
DIR="$(dirname "$0")/../references"

if [ ! -d "$DIR" ]; then
  echo "Error: references/ directory not found"
  exit 1
fi

TOTAL=$(find "$DIR" -maxdepth 1 -type f \( -name '*.m4a' -o -name '*.wav' -o -name '*.mp3' -o -name '*.mp4' \) | wc -l | tr -d ' ')
echo "Found $TOTAL files to upload"
echo ""

COUNT=0
FAILED=0

for FILE in "$DIR"/*.m4a "$DIR"/*.wav; do
  [ -f "$FILE" ] || continue
  COUNT=$((COUNT + 1))
  NAME=$(basename "$FILE")
  echo "[$COUNT/$TOTAL] $NAME"
  if jam-session upload "$FILE" -s "$SERVER" -g "$GROUP" --api-key "$API_KEY"; then
    echo "  OK"
  else
    echo "  FAILED"
    FAILED=$((FAILED + 1))
  fi
  echo ""
done

echo "Done: $COUNT uploaded, $FAILED failed"
