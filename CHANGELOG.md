# Changelog

All notable changes to the Project Dashboard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] – 2026-02-15

### Added
- **Keyboard Shortcuts Help Modal**: Press `?` to show an accessible modal with a list of keyboard shortcuts. Includes proper ARIA attributes, focus trapping, and restore focus on close. Modal can be dismissed with Escape or close button.
- **Performance Monitor Panel**: Real-time performance metrics display (toggle with `Ctrl+Shift+P` or via URL hash `#perf`). Shows render times, filter/sort operations, view switches, and DOM operation statistics. Includes actionable recommendations based on metrics. Auto-refreshes every 2 seconds while open.
- **Global Keyboard Event Handling**: Standardized keyboard shortcuts with context awareness (does not trigger when typing in inputs). Escape key closes any open modal or panel.
- **Audit History Center Filters**: Added search, actor/action filters, date range, pagination controls, and a changes-only toggle with task links.

### Improved
- Dashboard UI accessibility with skip links, ARIA labels, focus management, and keyboard navigation support.
- Performance CSS styling with optimized table layout for metrics display.

### Added (continued)
- **Enhanced Toolbar Filters**: Added four new filter buttons to the toolbar:
  - **My tasks**: Shows tasks assigned to the current user (configurable via `state.currentUser` in localStorage)
  - **Overdue**: Shows pending tasks with a due date that has passed
  - **Blocked**: Shows pending tasks with status set to `blocked`
  - **No due date**: Shows pending tasks that have no due date set
- The filter bar now displays 7 total filters: All, Pending, Completed, My tasks, Overdue, Blocked, No due date.
- `currentUser` property added to dashboard state (defaults to `'main'`). Change via `localStorage.setItem('projectDashboardState', JSON.stringify({...existing, currentUser: 'your-name'}))`
- **Dashboard Health Monitoring**: Added `scripts/dashboard-health.sh` to monitor the dashboard server. It checks health every 5 minutes via cron and restarts if unresponsive. Also runs at boot via `@reboot` cron entry to ensure the dashboard starts automatically after system restart. This prevents ServiceWorker "Failed to fetch" errors caused by the server being down.
- **Expanded Task Edit Form**: The inline edit form now includes fields for status, priority, owner (with agent selection dropdown), start date, and due date, in addition to title and category. This provides full task management capabilities directly from the list view.
- **Debounced Autosave and State Recovery**: Implemented a 1-second debounce on all state persistence operations (IndexedDB and localStorage) to reduce storage writes and improve performance. Added backup rotation (primary state is backed up to `projectDashboardState.backup` before each write) and corruption recovery: on load, if primary state is corrupted, automatically falls back to the backup. Enhances reliability and performance.
- **Cron Job Visibility & Management**: Added a new Cron view to monitor and control scheduled cron jobs. The view displays job name, schedule, last run time, status, and provides one-click "Run Now" and log tailing. Backend endpoints `/api/cron/jobs`, `/api/cron/jobs/:id/runs`, and manual trigger `/api/cron/jobs/:id/run` added to task server. Supports live log inspection for active cron jobs defined in `crontab/` directory.
- **Board View Integration**: Completed integration of Board View into the optimized frontend module. Added `renderBoardView` function with lazy loading, proper cleanup, and project context handling. The board view now works seamlessly alongside list, timeline, and cron views.
- **Agent View**: Implemented Agent View as a lazy-loaded module in the optimized frontend. Provides agent task queue monitoring, claim/release actions, and pre-execution guard checks. Includes stats cards, auto-refresh heartbeat, and pause/resume controls.

### Improved
- **Modular Frontend Architecture**: Replaced monolithic inline JavaScript (1663 lines) with ES6 module system. The dashboard now imports `./dashboard/src/dashboard-integration-optimized.mjs`, reducing HTML size by ~70% and enabling lazy loading of view components. All functionality preserved with improved maintainability.
- **Persistent Sync Error Banner**: Added a persistent error banner at the top of the dashboard that appears when a sync operation fails after all retries. The banner displays the failure details and offers "Retry All" and "Dismiss" buttons, improving error visibility and user recovery.
- Filter counts now update dynamically for all 7 filter types.
- Task data model now preserves `owner`, `status`, `due_date`, `start_date`, and `priority` fields during normalization (previously these were discarded).
- **Quick Owner Assignment**: Each task now displays an owner chip when an owner is assigned. Clicking the chip opens a dropdown to quickly re-assign or clear the owner. Agents list is fetched from `/api/agents`.
- **Visual Priority & Overdue Indicators**: Task items show left border color based on priority (critical=red, high=orange, medium=accent, low=muted) and an 'overdue' visual style for past-due tasks.
- **Undo for Destructive Actions**: Deleting a task or archiving completed tasks now shows an undo snackbar with a 6-second window to recover the lost data.
- **Board & Timeline Views**: These views were already implemented but now properly initialized and integrated into the view switcher with error handling and lazy loading. Board view uses Kanban columns based on task status; Timeline view displays tasks chronologically.
- **Mobile Responsiveness**: Added media queries to ensure toolbar wraps gracefully on narrow screens. Filters and search input stack vertically at <=720px; button sizes adjust at <=500px.
- **Stats Performance**: `updateStats()` now computes all filter counts in optimized single-pass loops, reducing repeated `Date()` object creation.
- **Input Validation**: `addTask` and `updateTask` now validate that task text/title are non-empty strings and enforce a maximum length of 1000 characters, preventing invalid or excessively long task data.

### Fixed
- **Critical**: `normalizeTask` now retains extended task fields (`owner`, `status`, `priority`, `due_date`, `start_date`) which were previously dropped, breaking filter functionality.
- **Critical**: `getFilteredTasks` now includes null-checks for optional fields (`task.owner`, `task.status`, `task.due_date`) preventing runtime errors when these are absent.
- **Critical**: `updateStats()` now defensively accesses `state.currentUser` with fallback, preventing undefined comparisons in "My tasks" count.
- **Critical**: Added missing `lib/qmd-security.js` development stub to prevent AsanaStorage initialization failure. This resolves `GET /api/projects 503` and `agents.map is not a function` errors that prevented project selector and agent assignment from working.
- **Critical**: Fixed PATCH 400 errors when editing tasks. The client's `normalizeTask` discarded server-provided UUIDs, causing invalid ID errors. Also, server responses now map `title` → `text` and `labels` → `category` to match client expectations. This ensures task edits work correctly.
- **Project Selector**: Changing the project now loads tasks for the selected project and updates the UI in all views (list, board, timeline, agent, audit). Previously, the project selection had no effect in list view.
- Toolbar layout uses CSS Grid for consistent horizontal arrangement of filters and search input.
- Event listeners for filter buttons are automatically attached to all `.filter-btn` elements on page load.
- Mobile toolbar overflow prevented by stacking `.toolbar-left` on small screens.
- **Data Integrity**: Fixed missing workflow assignment for project "Test Alert Project" (ID: 7646301d-5423-424a-a548-5ed24a79e712). All projects now have a valid `default_workflow_id`.
- **Validation Script**: Updated `checkQMDIntegration()` to use correct relative path (`../../data/qmd` instead of `data/qmd`). QMD integration check now passes.

## [Unreleased]

## [2.0.0-rc.2] – 2026-03-08

### Added
- Dedicated `/agents` page inspired by an operations floor layout, with grouped agent cards, a live focus panel, search, and presence filters
- Standalone packaging now includes `agents.html`, `src/agents-page.mjs`, and `sw.js`

### Changed
- Project dashboard layout tightened around the project workspace, task composer, and inline task editing flows
- Agent page card layout, text hierarchy, and overflow handling were reworked for better readability on desktop and narrow screens
- Release metadata now targets `2.0.0-rc.2`

### Fixed
- Filter/list mismatches when parent tasks and subtasks were counted differently
- Missing stats DOM bindings that caused `updateStats()` runtime failures
- Category filter state getting out of sync with the currently loaded project
- Agent card clipping and hidden text on the new `/agents` page

## [2.0.0-rc.1] – 2026-03-08

### Added
- Standalone packaging for `openclaw-project-dashboard`
- OpenClaw installation guide and standalone installation guide
- Folder-style board hierarchy in the project workspace block
- Project manager actions for creating root boards, child boards, editing boards, and archiving boards
- Rich task composer with owner, preferred model, recurrence, and scheduling fields
- OpenClaw bridge status surfacing in task metadata and agent heartbeat views

### Changed
- Project context navigation now renders as a tree instead of a flat related-board strip
- Dashboard runtime scripts now respect `OPENCLAW_WORKSPACE` and `OPENCLAW_CONFIG_FILE`
- Package metadata now targets `github.com/pgedeon/openclaw-project-dashboard`
- Release is versioned as `2.0.0-rc.1`

### Fixed
- Filter counts and list rendering now stay aligned when subtasks are present
- Missing archived stats DOM reference in `updateStats()`
- Category filtering and async project-switch races in the optimized frontend
- Hardcoded `/root/.openclaw/workspace` assumptions in release-facing operational scripts

### Added
- **Soft-Delete & Archiving**: Implemented server-side soft-delete for tasks (deleted_at timestamp) and archiving (archived_at). Added `archiveTask` and `restoreTask` storage methods, new API endpoints (`POST /api/tasks/:id/archive`, `POST /api/tasks/:id/restore`), and extended state manager with `archiveTask`/`restoreTask` functions that queue ARCHIVE/RESTORE sync operations. By default, list responses exclude tasks with `deleted_at` or `archived_at` set; archived tasks can be fetched with `?archived=true`. **UI integration completed**: Added Archive/Restore buttons in task actions, Archived filter in toolbar, and implemented task loading for archived view. Updated state-manager to preserve `archived_at`/`deleted_at` and worker filter logic to support 'archived' filter separately.
- **Database Migration**: `20260216_add_archive_deleted_to_tasks.sql` adds `archived_at`, `deleted_at` columns to `tasks` table and creates indexes `idx_tasks_status_archived` and `idx_tasks_deleted_at` for efficient filtering.
- **Sync Manager Enhancements**: Extended `sync-manager.mjs` to handle `ARCHIVE` and `RESTORE` custom operations by routing them to `/api/tasks/:id/archive` and `/api/tasks/:id/restore` respectively, with appropriate POST methods.
- **API Documentation**: Updated `docs/api.md` to document new endpoints and extended `GET /api/tasks/all` query parameters (`archived` flag) and `GET /api/tasks/:id` optional `include_archived`/`include_deleted` (for administrative use).

### Added (Incremental Sync + Pagination)
- **Incremental Sync Support**: Added `updated_since` query parameter to `GET /api/tasks/all`. The storage layer now filters tasks by `updated_at > timestamp`, enabling clients to fetch only changed tasks since last sync. This reduces bandwidth and speeds up sync for large projects.
- **Client State Enhancement**: Added `lastSyncTime` to dashboard state to track the most recent successful sync timestamp.
- **Automatic Periodic Sync**: The dashboard now performs an incremental sync every 5 minutes when online, automatically pulling in changes since the last sync. The initial full load sets `lastSyncTime`; subsequent runs merge updates into the existing task list.
- **Database Index**: Added `idx_tasks_updated_at` index to accelerate `updated_since` queries.

### Added (Agent Observability)
- **Agent Heartbeats**: Added `agent_heartbeats` table to track agent liveness. Introduced API endpoints: `POST /api/agents/heartbeat` and `GET /api/agents/status`. Agent View now sends a heartbeat on each auto-refresh cycle, and the server records `last_seen_at` automatically.
- **Task Run History**: New `task_runs` table logs every execution attempt with `attempt_number`, `status` (running/success/failure), timestamps, and optional error/output summaries. Modified `claimTask` to automatically create a new `task_runs` entry on task claim, setting `attempt_number = retry_count + 1`.
- **Retry Mechanism**: Added `retry_count` column to tasks and `POST /api/tasks/:id/retry` endpoint. Retry resets task status to `ready`, clears execution lock, and increments `retry_count`. Tasks with a failed last run display a "Retry" button in the Agent View.
- **Agent View Enhancements**: Agent queue now includes `lastRun` and `retryCount` fields per task. UI displays last run status with time ago, shows retry count, and provides a Retry button for failed tasks. Added `formatTimeAgo` utility for human-readable timestamps.
- **Database Migration**: `20260216_add_agent_observability.sql` creates `agent_heartbeats` and `task_runs` tables with indexes, and adds `retry_count` to `tasks`.
- **Storage Layer**: Extended `AsanaStorage` with methods: `recordAgentHeartbeat()`, `getAgentStatus()`, `listAgentStatuses()`, `createTaskRun()`, `updateTaskRun()`, `getTaskRuns()`, and `retryTask()`. `getAgentQueue` now batches fetch of latest run and attaches `lastRun` to each task.
- **API Integration**: `/api/views/agent` returns enhanced task objects with `lastRun` and `retryCount`. No breaking changes to existing consumers.

### Added (Saved Views + Power Filters)
- **Saved Views**: Users can now save the current filter/sort state as a named view and re-apply it later. Provides quick access to common task configurations and reduces repetitive filtering.
- **UI Integration**: Added "Save view" button and a dropdown to select saved views in the toolbar. Includes apply and delete functionality.
- **State Management**: Extended state manager with `savedViews` array and `activeSavedViewId`. Added actions to set, add, update, and remove saved views.
- **API Endpoints**: Implemented full CRUD for saved views under `/api/views` (GET list, POST create, GET single, PATCH update, DELETE).
- **Database Migration**: `20260216_add_saved_views.sql` adds `saved_views` table with appropriate indexes and triggers.

### Fixed
- **Task Edit & Toggle Errors**: Fixed 400 Bad Request when editing tasks. Root causes: sending legacy `category` instead of `labels`, and backend `array_cat` on `history` jsonb. Frontend now maps `category` to `labels` and sends only transformed fields (`title`, `labels`, etc.) in PATCH payload. Backend uses JSONB concatenation for `history` and excludes it from generic updates. Added improved error messages (`No valid fields to update` now lists received fields) and fixed server error handler bug.
- **Task Server Startup**: Corrected restart script to use `dashboard/task-server.js` as entry point.

## [1.1.0] – 2026-02-15
