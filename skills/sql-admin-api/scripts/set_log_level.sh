#!/usr/bin/env bash
# set_log_level.sh — temporarily change Oxla log level via the admin API
#
# Usage:
#   ./set_log_level.sh [LEVEL] [ADMIN_URL]
#
# Examples:
#   ./set_log_level.sh LOG_LEVEL_DEBUG
#   ./set_log_level.sh LOG_LEVEL_VERBOSE http://oxla-node-1:9090
#
# Valid levels: LOG_LEVEL_NONE LOG_LEVEL_FATAL LOG_LEVEL_ERROR
#               LOG_LEVEL_WARNING LOG_LEVEL_INFO LOG_LEVEL_DEBUG LOG_LEVEL_VERBOSE
#
# The script saves the current level, sets the new level, waits for you to press
# Enter, then restores the original level.

set -euo pipefail

LEVEL="${1:-LOG_LEVEL_DEBUG}"
ADMIN_URL="${2:-http://localhost:9090}"

VALID_LEVELS="LOG_LEVEL_NONE LOG_LEVEL_FATAL LOG_LEVEL_ERROR LOG_LEVEL_WARNING LOG_LEVEL_INFO LOG_LEVEL_DEBUG LOG_LEVEL_VERBOSE"
if ! echo "$VALID_LEVELS" | grep -qw "$LEVEL"; then
  echo "ERROR: Unknown level '$LEVEL'. Valid values: $VALID_LEVELS" >&2
  exit 1
fi

rpc() {
  local method="$1"
  local body="$2"
  curl -sf -X POST "${ADMIN_URL}/oxla.admin.v1.LoggingService/${method}" \
    -H "Content-Type: application/json" \
    -d "$body"
}

echo "=== Oxla Log Level Manager ==="
echo "Admin URL: ${ADMIN_URL}"

# 1. Read current level
echo "Getting current log level..."
RESPONSE=$(rpc GetLogLevel '{}')
CURRENT=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['level'])")
echo "Current level: ${CURRENT}"

if [ "$CURRENT" = "$LEVEL" ]; then
  echo "Already at ${LEVEL}. Nothing to do."
  exit 0
fi

# 2. Set new level
echo "Setting log level to: ${LEVEL}"
rpc SetLogLevel "{\"level\":\"${LEVEL}\"}" > /dev/null
echo "Log level is now: ${LEVEL}"
echo ""
echo ">>> Press Enter to restore the original level (${CURRENT}), or Ctrl+C to leave it changed <<<"
read -r

# 3. Restore original level
echo "Restoring log level to: ${CURRENT}"
rpc SetLogLevel "{\"level\":\"${CURRENT}\"}" > /dev/null
echo "Log level restored to: ${CURRENT}"
