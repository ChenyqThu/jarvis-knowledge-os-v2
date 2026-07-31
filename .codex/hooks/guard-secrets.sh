#!/usr/bin/env bash
# PreToolUse(Edit|Write|NotebookEdit + Bash) — block two documented footguns:
#   1. Writing gitignored secret files (.env.local, *.plist, oauth-clients/*.json).
#   2. `gbrain init --pglite` without --dir, which CLOBBERS the global
#      ~/.gbrain/config.json (production Postgres pointer).
# See CLAUDE.md "Fork-specific rules" / "Secrets stay out of git".
set -euo pipefail

input="$(cat)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // empty')"

case "$tool" in
  Edit|Write|NotebookEdit)
    path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
    [ -z "$path" ] && exit 0
    base="$(basename "$path")"

    case "$path" in
      *.plist.template) exit 0 ;;   # tracked template — safe
    esac

    case "$base" in
      .env.local|.env)
        echo "BLOCKED: $base is gitignored and holds secrets (NANO_BANANA_API_KEY / KOS_API_TOKEN). Don't author it through the agent (CLAUDE.md: secrets stay out of git)." >&2
        exit 2 ;;
    esac

    case "$path" in
      *.plist)
        echo "BLOCKED: $path — launchd plists are gitignored and carry API keys. Edit the matching *.plist.template instead (CLAUDE.md: only *.plist.template is tracked)." >&2
        exit 2 ;;
      */oauth-clients/*)
        echo "BLOCKED: $path — OAuth client identities contain plaintext client_secret (mode 600, never commit). Re-register via 'gbrain auth register-client' instead (CLAUDE.md)." >&2
        exit 2 ;;
    esac
    exit 0 ;;

  Bash)
    cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
    [ -z "$cmd" ] && exit 0
    if printf '%s' "$cmd" | grep -q 'gbrain init' \
       && printf '%s' "$cmd" | grep -q -- '--pglite' \
       && ! printf '%s' "$cmd" | grep -q -- '--dir'; then
      echo "BLOCKED: 'gbrain init --pglite' without --dir will CLOBBER ~/.gbrain/config.json (production engine=postgres pointer). Pass --dir /tmp/... AND inspect/restore ~/.gbrain/config.json afterward; backup at ~/.gbrain/config.json.before-sync-fix (CLAUDE.md fork rules)." >&2
      exit 2
    fi
    exit 0 ;;

  *) exit 0 ;;
esac
