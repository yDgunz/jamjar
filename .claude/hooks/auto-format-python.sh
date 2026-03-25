#!/bin/bash
# Auto-format Python files after edits using ruff
FILE=$(cat | jq -r '.tool_input.file_path // empty')
if [[ "$FILE" == *.py ]]; then
  ruff check --fix "$FILE" 2>/dev/null
  ruff format "$FILE" 2>/dev/null
fi
