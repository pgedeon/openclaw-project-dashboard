# OpenClaw Project Dashboard

Operations-first dashboard for OpenClaw. Hierarchical boards, agent-aware task routing, workflow tracking, approval gates, service requests, business metrics, and a live bridge back to the OpenClaw runtime.

## Features

- **Hierarchical Projects** — folder-style boards with parent/child relationships
- **Agent-Aware Task Routing** — compose tasks with agent assignment, model selection, priority, and recurrence
- **Workflow Engine** — track multi-step workflow runs with step timelines, retry logic, and heartbeat monitoring
- **Service Catalog & Requests** — structured intake for bugs, features, content, and incidents with SLA tracking
- **Approval Gates** — workflow-aware approvals with escalation, due dates, and artifact linking
- **Blocker Intelligence** — automatic blocker detection, classification, and operator pause/resume controls
- **Department Operating Views** — org-level dashboards by department with workload, queue, and reliability sections
- **Business Metrics** — org, department, agent, service, and site scorecards with trend snapshots
- **Governance & Audit** — role-based action enforcement, filtered audit trail, and embedded runbooks
- **Offline Support** — service worker with IndexedDB caching and sync-on-reconnect
- **OpenClaw Bridge** — live agent status, heartbeat tracking, and bidirectional task sync

## Install

| Mode | When To Use |
|------|------------|
| [OpenClaw Workspace Install](docs/install-openclaw.md) | Dashboard lives inside `~/.openclaw/workspace/dashboard` |
| [Standalone Install](docs/install-standalone.md) | Dashboard lives anywhere on disk |

**Quick start (OpenClaw mode):**

```bash
git clone https://github.com/pgedeon/openclaw-project-dashboard.git ~/.openclaw/workspace/dashboard
cd ~/.openclaw/workspace/dashboard
npm install
cp .env.example .env
# Edit .env, set POSTGRES_PASSWORD
createdb openclaw_dashboard
psql -U openclaw -d openclaw_dashboard -f schema/openclaw-dashboard.sql
psql -U openclaw -d openclaw_dashboard -f schema/demo-seed.sql  # optional demo data
npm start
# → http://localhost:3876/
```

**Install via OpenClaw prompt:**

> Install the OpenClaw Project Dashboard from github.com/pgedeon/openclaw-project-dashboard into my workspace.

## Screenshots

![Dashboard Overview](docs/screenshots/dashboard-overview-dark-full.png)
![Agents Workspace](docs/screenshots/agents-overview-dark-full.png)

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser (dashboard.html / agents.html)         │
│  ┌───────────────────────────────────────────┐  │
│  │  Service Worker + IndexedDB (offline)     │  │
│  │  dashboard-integration-optimized.mjs      │  │
│  └──────────────────┬────────────────────────┘  │
│                     │ fetch()                    │
├─────────────────────┼───────────────────────────┤
│  task-server.js     │  (Node.js, port 3876)     │
│  ┌──────────────────┴────────────────────────┐  │
│  │  Route Modules:                           │  │
│  │  ├─ projects-api.js     /api/projects     │  │
│  │  ├─ org-api.js          /api/org/*        │  │
│  │  ├─ services-api.js     /api/services/*   │  │
│  │  ├─ service-requests    /api/service-req  │  │
│  │  ├─ workflow-runs-api   /api/workflow-*   │  │
│  │  ├─ metrics-api.js      /api/metrics/*    │  │
│  │  └─ governance.js       (policy helpers)  │  │
│  └──────────────────┬────────────────────────┘  │
│                     │ pg                        │
├─────────────────────┼───────────────────────────┤
│  PostgreSQL         │  (openclaw_dashboard)     │
│  ┌──────────────────┴────────────────────────┐  │
│  │  Projects, Tasks, Workflow Runs,          │  │
│  │  Approvals, Artifacts, Service Requests,  │  │
│  │  Departments, Agent Profiles, Metrics,    │  │
│  │  Audit Log, Saved Views, Cron Runs        │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## API Endpoints

| Module | Endpoints |
|--------|-----------|
| Projects | `GET/POST/PATCH/DELETE /api/projects` |
| Org | `GET /api/org/departments`, `/agents`, `/summary` |
| Services | `GET /api/services`, `POST/GET/PATCH /api/service-requests` |
| Workflows | `GET/POST /api/workflow-runs`, `/templates`, `/blockers`, `/approvals`, `/artifacts` |
| Metrics | `GET /api/metrics/org`, `/departments`, `/agents`, `/services`, `/sites` |
| Health | `GET /api/health` |

Full API reference: [docs/api.md](docs/api.md)

## Configuration

See [.env.example](.env.example) for all environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3876` | Server port |
| `STORAGE_TYPE` | `postgres` | Storage backend |
| `POSTGRES_HOST` | `localhost` | PostgreSQL host |
| `POSTGRES_DB` | `openclaw_dashboard` | Database name |
| `OPENCLAW_WORKSPACE` | auto | OpenClaw workspace path |
| `OPENCLAW_CONFIG_FILE` | auto | OpenClaw config file path |

## Documentation

- [Install (OpenClaw Workspace)](docs/install-openclaw.md)
- [Install (Standalone)](docs/install-standalone.md)
- [API Reference](docs/api.md)
- [User Guide](docs/user-guide.md)
- [Admin Guide](docs/admin-guide.md)
- [Developer Guide](docs/development.md)

## Schema & Migrations

The full schema is in `schema/openclaw-dashboard.sql`. For existing databases, incremental migrations are in `schema/migrations/`.

To load demo data for development or evaluation:

```bash
psql -U openclaw -d openclaw_dashboard -f schema/demo-seed.sql
```

Demo data includes: 3 projects, 14 tasks (with subtasks and dependencies), 3 workflow runs with steps, pending approvals, artifacts, service requests, agent heartbeats, and department metrics.

## Development

```bash
npm install
npm run validate        # Run validation suite
node tests/test-org-api.js  # Run specific tests
```

## License

MIT. See [LICENSE](LICENSE).
