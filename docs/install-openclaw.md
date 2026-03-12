# Install In OpenClaw Workspace

Use this mode when the dashboard should be part of an existing OpenClaw installation and read the local OpenClaw config and workspace state directly.

## Target Layout

```text
~/.openclaw/
├── openclaw.json
└── workspace/
    ├── dashboard/          ← this repo
    ├── scripts/
    ├── tasks.md
    └── ...
```

When cloned into `~/.openclaw/workspace/dashboard`, no extra path configuration is required.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- An existing OpenClaw install with `~/.openclaw/openclaw.json`

## Quick Install

```bash
# 1. Clone into the OpenClaw workspace
git clone https://github.com/pgedeon/openclaw-project-dashboard.git ~/.openclaw/workspace/dashboard
cd ~/.openclaw/workspace/dashboard

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD at minimum

# 4. Create the database and apply schema
createdb openclaw_dashboard
psql -U openclaw -d openclaw_dashboard -f schema/openclaw-dashboard.sql

# 5. (Optional) Load demo data for a test drive
psql -U openclaw -d openclaw_dashboard -f schema/demo-seed.sql

# 6. Start the dashboard
npm start

# 7. Open http://localhost:3876/
```

## Install Via OpenClaw Prompt

You can also install this dashboard by asking your OpenClaw agent:

> Install the OpenClaw Project Dashboard from github.com/pgedeon/openclaw-project-dashboard into my workspace.

The agent will clone the repo, configure the environment, and set up the database automatically.

## What Gets Auto-Detected

When installed at `~/.openclaw/workspace/dashboard`:

| Setting | Auto-Detected Value |
|---------|-------------------|
| `OPENCLAW_WORKSPACE` | `~/.openclaw/workspace` |
| `OPENCLAW_CONFIG_FILE` | `~/.openclaw/openclaw.json` |
| `OPENCLAW_BIN` | `openclaw` (from PATH) |

Only `POSTGRES_*` settings need manual configuration.

## Verifying The Install

```bash
# Health check
curl http://localhost:3876/api/health

# Expected response:
# {"status":"ok","timestamp":"...","storage_type":"postgres","port":"3876"}

# Run the smoke test
bash scripts/smoke-test-dashboard.sh
```

## Operational Scripts

```bash
# Start with health monitoring
./scripts/dashboard-health.sh start

# Check status
./scripts/dashboard-health.sh status

# Restart the server
bash scripts/restart-task-server.sh
```

## Systemd Service (Optional)

```ini
[Unit]
Description=OpenClaw Project Dashboard
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=%h/.openclaw/workspace/dashboard
EnvironmentFile=%h/.openclaw/workspace/dashboard/.env
ExecStart=/usr/bin/node task-server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
sudo systemctl enable --now openclaw-dashboard
```

## Updating

```bash
cd ~/.openclaw/workspace/dashboard
git pull origin main
npm install
# Review and apply any new migrations in schema/migrations/
npm start
```
