#!/bin/bash
# Restart the Project Dashboard task-server
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_WORKSPACE_ROOT="$(cd "$REPO_ROOT/.." && pwd)"

cd "$REPO_ROOT"

PORT="${PORT:-3876}"
WORKSPACE_ROOT="${OPENCLAW_WORKSPACE:-$DEFAULT_WORKSPACE_ROOT}"
PID_FILE="${DASHBOARD_PID_FILE:-$WORKSPACE_ROOT/.dashboard.pid}"
SERVER_LOG_FILE="${DASHBOARD_SERVER_LOG_FILE:-$WORKSPACE_ROOT/logs/dashboard-server.log}"

mkdir -p "$(dirname "$SERVER_LOG_FILE")"

# Stop existing server if running
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping task server (PID $PID)..."
    kill "$PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

# Start server
echo "Starting task server..."
nohup env PORT="$PORT" OPENCLAW_WORKSPACE="$WORKSPACE_ROOT" node task-server.js > "$SERVER_LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "Task server started with PID $(cat "$PID_FILE")"
echo "Dashboard: http://localhost:$PORT/"
