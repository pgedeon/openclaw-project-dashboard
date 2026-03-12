# Changelog

All notable changes to the OpenClaw Project Dashboard.

## 2.0.0-rc.3 (2026-03-12)

### Added
- Departments table with explicit org modeling (9 departments)
- Agent profiles with capabilities, roles, and model assignments (40+ agents)
- Service catalog with customizable intake fields (8 service types)
- Service requests with SLA tracking, routing, and workflow launch
- Workflow runs with multi-step tracking, retry logic, and heartbeat monitoring
- Workflow templates (7 built-in: affiliate-article, image-generation, etc.)
- Workflow steps timeline and output tracking
- Workflow artifacts with type classification and status tracking
- Approval gates with escalation, due dates, artifact linking, and required notes
- Blocker intelligence: detection, classification, pause/resume/escalate controls
- Department operating views with workload, queue, and reliability sections
- Business metrics: org/department/agent/service/site scorecards
- Department daily metric snapshots with trend aggregation
- Governance policy helper with role-based action enforcement
- Extended audit trail with workflow and governance filtering
- Embedded runbooks for workflow templates
- Modular API architecture (6 route modules)
- Consolidated schema file (single install, no incremental migrations)
- Demo seed data for evaluation and development
- Two install paths: OpenClaw workspace and standalone
- Systemd service examples
- Dashboard health, restart, smoke-test, and validation scripts
- 20+ regression test files

### Changed
- README rewritten for the business operations platform
- Install docs updated with demo data and OpenClaw prompt support
- Release notes restructured

### Technical
- Base schema: projects, tasks, workflows, audit_log, saved_views
- Migrations 001-015 consolidated into schema
- Business context columns on workflow_templates and workflow_runs
- Blocker intelligence columns on workflow_runs
- Department daily metrics snapshots table

## 2.0.0-rc.2 (2026-02-16)

### Added
- Agent observability: heartbeats and task run history tables
- Saved views for filter/sort combinations
- Soft delete and archiving support (archived_at, deleted_at)
- Audit log search indexes
- Cron job runs tracking table
- Updated_at index on tasks for incremental sync
- Incremental sync and pagination
- Virtual scrolling for large lists
- Skeleton loaders for perceived performance
- Offline support: service worker, IndexedDB, sync manager
- i18n framework with English locale
- Performance monitoring
- Security module for secrets management

## 2.0.0-rc.1 (2026-02-15)

### Added
- Initial release candidate
- Hierarchical boards with parent/child projects
- Rich task composer with agent assignment, model selection, priority, recurrence
- Agent queue visibility and per-agent detail rail
- OpenClaw bridge endpoints for agent bidirectional sync
- Board, timeline, and list views
- Task filtering and subtask expansion
- Live stats and project context manager
- PostgreSQL storage backend
