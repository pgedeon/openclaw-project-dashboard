#!/bin/bash
# Dashboard Health Monitor
# Checks if the project dashboard is running and restarts if needed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_WORKSPACE_ROOT="$(cd "$REPO_ROOT/.." && pwd)"

DASHBOARD_PORT="${PORT:-3876}"
WORKSPACE_ROOT="${OPENCLAW_WORKSPACE:-$DEFAULT_WORKSPACE_ROOT}"
DASHBOARD_SCRIPT="${DASHBOARD_SCRIPT:-$REPO_ROOT/task-server.js}"
LOG_DIR="${DASHBOARD_LOG_DIR:-$WORKSPACE_ROOT/logs}"
LOG_FILE="${DASHBOARD_HEALTH_LOG_FILE:-$LOG_DIR/dashboard-health.log}"
SERVER_LOG_FILE="${DASHBOARD_SERVER_LOG_FILE:-$LOG_DIR/dashboard-server.log}"
PID_FILE="${DASHBOARD_PID_FILE:-$WORKSPACE_ROOT/.dashboard.pid}"

log() {
    echo "[$(date -Iseconds)] $1" >> "$LOG_FILE"
}

is_running() {
    # Check if port is listening
    if ss -tlnp 2>/dev/null | grep -q ":$DASHBOARD_PORT "; then
        return 0
    fi
    return 1
}

check_health() {
    # Try to connect to the dashboard
    if curl -s --max-time 5 "http://localhost:$DASHBOARD_PORT/" > /dev/null 2>&1; then
        return 0
    fi
    return 1
}

start_dashboard() {
    log "Starting dashboard server..."
    mkdir -p "$(dirname "$SERVER_LOG_FILE")"
    setsid env PORT="$DASHBOARD_PORT" OPENCLAW_WORKSPACE="$WORKSPACE_ROOT" node "$DASHBOARD_SCRIPT" >> "$SERVER_LOG_FILE" 2>&1 < /dev/null &
    echo $! > "$PID_FILE"
    sleep 2
    
    if check_health; then
        log "Dashboard started successfully (PID: $(cat "$PID_FILE"))"
        return 0
    else
        log "ERROR: Failed to start dashboard"
        return 1
    fi
}

stop_dashboard() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            log "Stopping dashboard (PID: $pid)..."
            kill "$pid" 2>/dev/null
            sleep 1
        fi
        rm -f "$PID_FILE"
    fi
    
    # Kill any process on the port
    local port_pid=$(ss -tlnp 2>/dev/null | grep ":$DASHBOARD_PORT " | grep -oP 'pid=\K[0-9]+')
    if [ -n "$port_pid" ]; then
        log "Killing orphan process on port $DASHBOARD_PORT (PID: $port_pid)"
        kill "$port_pid" 2>/dev/null
    fi
}

# Main health check logic
main() {
    mkdir -p "$(dirname "$LOG_FILE")"
    
    if ! is_running; then
        log "Dashboard not running on port $DASHBOARD_PORT"
        start_dashboard
        exit $?
    fi
    
    if ! check_health; then
        log "Dashboard not responding to health check"
        stop_dashboard
        start_dashboard
        exit $?
    fi
    
    # Healthy
    exit 0
}

# Handle command line arguments
case "${1:-check}" in
    check)
        main
        ;;
    start)
        mkdir -p "$(dirname "$LOG_FILE")"
        start_dashboard
        ;;
    stop)
        mkdir -p "$(dirname "$LOG_FILE")"
        stop_dashboard
        ;;
    status)
        if is_running && check_health; then
        echo "Dashboard is healthy"
        exit 0
    else
        echo "Dashboard is down"
        exit 1
        fi
        ;;
    *)
        echo "Usage: $0 {check|start|stop|status}"
        exit 1
        ;;
esac
