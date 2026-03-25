#!/bin/bash
# Block edits to binary/data files (SQLite databases, audio files)
FILE=$(cat | jq -r '.tool_input.file_path // empty')
if [[ "$FILE" == *.db || "$FILE" == *.m4a || "$FILE" == *.wav || "$FILE" == *.mp3 ]]; then
  echo "Blocked: $FILE is a binary/data file — do not edit directly" >&2
  exit 2
fi
