#!/bin/bash
# jarvis-pg-backup.sh — daily Postgres dump for the gbrain database.
#
# Driven by launchd plist `com.jarvis.gbrain-backup` at 03:33 local
# (off-peak, after dream-cycle 03:11). Custom-format dump (`-Fc`) is
# `pg_restore`-friendly and ~3-4x smaller than plain SQL.
#
# Retention: 14 rolling days via mtime prune. Older snapshot at
# ~/.gbrain/brain.pglite.pre-path2-1777504487 is the long-term anchor
# (kept ≥30 days post Path 3 migration, 2026-04-29).
#
# Manual invocation:
#   bash scripts/jarvis-pg-backup.sh             # produce one dump now
#   bash scripts/jarvis-pg-backup.sh --dry       # plan only, no work
#
# Exit codes:
#   0 = dump succeeded (retention prune is best-effort, never fails the run)
#   non-zero = pg_dump failed; launchd will surface via `last exit code`

set -euo pipefail

DRY_RUN=0
if [ "${1:-}" = "--dry" ] || [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

BACKUP_DIR="${HOME}/.gbrain/backups"
DB_NAME="gbrain"
RETENTION_DAYS="${JARVIS_PG_BACKUP_RETENTION_DAYS:-14}"
PG_BIN="/opt/homebrew/opt/postgresql@17/bin"

# Prefer pinned Homebrew Postgres 17 binary; fall back to PATH if the
# exact pin disappears (Brew minor upgrade that bumps the keg name).
if [ -x "${PG_BIN}/pg_dump" ]; then
  PG_DUMP="${PG_BIN}/pg_dump"
else
  PG_DUMP="$(command -v pg_dump || true)"
fi

if [ -z "${PG_DUMP}" ] || [ ! -x "${PG_DUMP}" ]; then
  echo "[$(date -u +%FT%TZ)] FATAL pg_dump not found on PATH or at ${PG_BIN}/pg_dump" >&2
  exit 2
fi

mkdir -p "${BACKUP_DIR}"

DATE_TAG="$(date +%Y%m%d)"
DUMP_PATH="${BACKUP_DIR}/${DB_NAME}-${DATE_TAG}.dump"

echo "[$(date -u +%FT%TZ)] start db=${DB_NAME} target=${DUMP_PATH} retention=${RETENTION_DAYS}d dry=${DRY_RUN}"

if [ "${DRY_RUN}" = "1" ]; then
  echo "[$(date -u +%FT%TZ)] dry-run: would call ${PG_DUMP} -Fc -d ${DB_NAME} -f ${DUMP_PATH}"
  echo "[$(date -u +%FT%TZ)] dry-run: would prune ${BACKUP_DIR}/${DB_NAME}-*.dump older than ${RETENTION_DAYS} days"
  exit 0
fi

# `-Fc` (custom format) is the pg_restore-friendly format; works against
# any compatible Postgres version. `-w` refuses password prompts (this
# host runs trust auth on local socket; if that ever changes the run
# fails loud rather than hanging launchd).
"${PG_DUMP}" -Fc -w -d "${DB_NAME}" -f "${DUMP_PATH}"

DUMP_BYTES="$(stat -f%z "${DUMP_PATH}" 2>/dev/null || stat -c%s "${DUMP_PATH}" 2>/dev/null || echo "?")"
echo "[$(date -u +%FT%TZ)] dump_ok bytes=${DUMP_BYTES}"

# Retention is best-effort: if `find` fails (read-only fs, weird perms),
# the run still succeeds — losing one prune cycle is harmless.
PRUNED_COUNT=0
if find "${BACKUP_DIR}" -maxdepth 1 -name "${DB_NAME}-*.dump" -type f -mtime "+${RETENTION_DAYS}" -print 2>/dev/null | while read -r old; do
  rm -f -- "${old}" && echo "[$(date -u +%FT%TZ)] pruned ${old}"
  PRUNED_COUNT=$((PRUNED_COUNT + 1))
done; then
  :
fi

echo "[$(date -u +%FT%TZ)] done"
