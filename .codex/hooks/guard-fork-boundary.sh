#!/usr/bin/env bash
# PreToolUse(Edit|Write|NotebookEdit) — enforce the gbrain fork boundary.
#
# This repo is a fork of garrytan/gbrain. All Jarvis-specific logic lives under
# skills/kos-jarvis/. src/* and other upstream skills/* are off-limits to avoid
# merge-conflict tax (see CLAUDE.md "Fork-specific rules"). This hook turns that
# rule into a hard guarantee: exit 2 blocks the write and tells Claude why.
set -euo pipefail

input="$(cat)"
path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
[ -z "$path" ] && exit 0

case "$path" in
  */skills/kos-jarvis/*)
    exit 0 ;;                       # the fork extension pack — always allowed
  */skills/manifest.json)
    exit 0 ;;                       # fork registers its skills here
  */skills/RESOLVER.md)
    echo "REMINDER: skills/RESOLVER.md is upstream. Only APPEND inside the '## KOS-Jarvis extensions (fork-only, append-only)' section at the end — never edit upstream routing rows (CLAUDE.md fork rules)." >&2
    exit 0 ;;                       # editable, but only the append-only section
  */src/*)
    echo "BLOCKED: $path is upstream (src/*). All Jarvis logic belongs under skills/kos-jarvis/. If you truly need an upstream change, file a fork issue instead of editing src/ (CLAUDE.md fork rules)." >&2
    exit 2 ;;
  */skills/*)
    echo "BLOCKED: $path is an upstream skill. Add fork behavior under skills/kos-jarvis/ instead of modifying upstream skills/* (CLAUDE.md fork rules)." >&2
    exit 2 ;;
  *)
    exit 0 ;;                       # docs/, CLAUDE.md, .claude/, root files: allowed
esac
