#!/bin/bash
# Clean up stale local recording files when R2 storage is enabled.
#
# When using R2, source recordings are only needed temporarily during
# processing. This script removes any that were left behind (e.g., from
# older code that didn't clean up, or from interrupted processing).
#
# Safe to run on every deploy — it only deletes files when R2 is confirmed
# as the storage backend.

set -e

DATA_DIR="${JAM_DATA_DIR:-.}"
RECORDINGS_DIR="$DATA_DIR/recordings"

# Only clean up if R2 is enabled
if [ -z "$JAM_R2_BUCKET" ]; then
    echo "R2 not configured — skipping local recordings cleanup"
    exit 0
fi

if [ ! -d "$RECORDINGS_DIR" ]; then
    echo "No recordings directory found — nothing to clean up"
    exit 0
fi

# Count files before cleanup
FILE_COUNT=$(find "$RECORDINGS_DIR" -type f | wc -l | tr -d ' ')

if [ "$FILE_COUNT" -eq 0 ]; then
    echo "No stale recordings found"
    exit 0
fi

# Calculate total size
TOTAL_SIZE=$(du -sh "$RECORDINGS_DIR" 2>/dev/null | cut -f1)

echo "Found $FILE_COUNT stale local recording(s) ($TOTAL_SIZE) — removing..."
find "$RECORDINGS_DIR" -type f -delete
echo "Cleanup complete"
