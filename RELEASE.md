# Release Notes

## v2.0.0-rc.3 — 2026-03-12

### New: Business Operations Platform

The dashboard has been overhauled from a task board into a full business operations platform.

**Organizational Modeling**
- Departments table with explicit agent-to-department mapping
- Agent profiles with capabilities, roles, and model assignments
- 9 departments, 40+ agent profiles seeded from OpenClaw config

**Service Catalog & Requests**
- Structured service intake with customizable fields per service type
- SLA tracking, routing, and workflow launch from service requests
- 8 service types: Bug Report, Content Creation, Site Fix, Code Change, etc.

**Workflow Engine**
- Multi-step workflow runs with step timelines and retry logic
- 7 workflow templates: affiliate-article, image-generation, wordpress-publish, site-fix, incident-investigation, code-change, qa-review
- Heartbeat monitoring, stuck-run detection, gateway session binding

**Approval Gates**
- Workflow-aware approvals with escalation, due dates, and artifact linking
- Approval inbox with approve/reject controls and required notes
- Run-state sync (waiting_for_approval, approved, blocked)

**Blocker Intelligence**
- Automatic blocker detection and classification
- Operator pause/resume/escalate/reassign controls
- Org-level blocker radar and per-agent blocker console

**Department Operating Views**
- Per-department dashboards with workload, queue, blocked work, and overdue items
- Approval, artifact, and reliability sections
- Lead and staffing context

**Business Metrics**
- Org, department, agent, service, and site scorecards
- Department daily metric snapshots with trend data
- Scheduled aggregation via cron

**Governance & Audit**
- Role-based action enforcement (launch, approve, reject, cancel, override)
- Extended audit filtering by workflow, entity, and governance action
- Embedded runbooks for workflow templates

### Consolidated Schema

- Single `schema/openclaw-dashboard.sql` creates the entire database from scratch
- All 15 migrations baked in — no incremental migration needed for fresh installs
- `schema/demo-seed.sql` provides realistic demo data for evaluation

### Install Improvements

- Two documented install paths: OpenClaw workspace and standalone
- OpenClaw prompt install support
- Systemd service examples
- Docker example for standalone mode
- Demo data included in repo

### Technical

- 6 modular API route files (projects, org, services, service-requests, workflow-runs, metrics)
- Governance policy helper module
- Department metrics aggregation script
- Dashboard health, restart, smoke-test, and validation scripts
- 20+ regression test files

---

## v2.0.0-rc.2 — 2026-02-16

- Agent observability: heartbeats, task run history
- Saved views, soft delete, audit log indexes
- Incremental sync, virtual scrolling, skeleton loaders
- Offline support with IndexedDB and service worker

## v2.0.0-rc.1 — 2026-02-15

- Initial release candidate
- Hierarchical boards, task composer, agent queue
- OpenClaw bridge endpoints
