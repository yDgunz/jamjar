#!/bin/bash
# Block git push unless user explicitly directs it
# Uses word boundary to match "git push" as the actual command, not in strings/comments
CMD=$(cat | jq -r '.tool_input.command // empty')
if echo "$CMD" | grep -qE '^\s*git\s+push|&&\s*git\s+push|\|\|\s*git\s+push|;\s*git\s+push'; then
  echo "Blocked: git push requires explicit user directive" >&2
  exit 2
fi
