# Standalone Install

Use this mode when you want the dashboard outside the OpenClaw workspace, but still want it to communicate with an OpenClaw installation.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- A reachable OpenClaw workspace and config file

## Quick Install

```bash
# 1. Clone the repo anywhere
git clone https://github.com/pgedeon/openclaw-project-dashboard.git /opt/openclaw-project-dashboard
cd /opt/openclaw-project-dashboard

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
```

Edit `.env` and set these values explicitly:

```bash
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=openclaw_dashboard
POSTGRES_USER=openclaw
POSTGRES_PASSWORD=your-secure-password

# OpenClaw paths (required in standalone mode)
OPENCLAW_WORKSPACE=/root/.openclaw/workspace
OPENCLAW_CONFIG_FILE=/root/.openclaw/openclaw.json
OPENCLAW_BIN=openclaw

# Server
PORT=3876
STORAGE_TYPE=postgres
```

```bash
# 4. Create the database and apply schema
createdb openclaw_dashboard
psql -U openclaw -d openclaw_dashboard -f schema/openclaw-dashboard.sql

# 5. (Optional) Load demo data
psql -U openclaw -d openclaw_dashboard -f schema/demo-seed.sql

# 6. Start the dashboard
npm start

# 7. Open http://localhost:3876/
```

## Install Via OpenClaw Prompt

> Install the OpenClaw Project Dashboard from github.com/pgedeon/openclaw-project-dashboard to /opt/openclaw-project-dashboard as a standalone install.

## What Changes In Standalone Mode

| Aspect | OpenClaw Mode | Standalone Mode |
|--------|--------------|-----------------|
| Workspace path | Auto-detected | Must set `OPENCLAW_WORKSPACE` |
| Config file | Auto-detected | Must set `OPENCLAW_CONFIG_FILE` |
| Agent bridge | Full integration | Full (if paths are correct) |
| Port | 3876 (default) | Configurable via `PORT` |

All dashboard features work identically — only the path discovery differs.

## Verifying The Install

```bash
curl http://localhost:3876/api/health
# {"status":"ok","timestamp":"...","storage_type":"postgres","port":"3876"}
```

## Systemd Service

```ini
[Unit]
Description=OpenClaw Project Dashboard
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/openclaw-project-dashboard
EnvironmentFile=/opt/openclaw-project-dashboard/.env
ExecStart=/usr/bin/node task-server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now openclaw-dashboard
```

## Docker (Optional)

A minimal Docker setup:

```dockerfile
FROM node:18-slim
RUN apt-get update && apt-get install -y postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3876
CMD ["node", "task-server.js"]
```

```bash
docker build -t openclaw-dashboard .
docker run -d -p 3876:3876 --env-file .env openclaw-dashboard
```
