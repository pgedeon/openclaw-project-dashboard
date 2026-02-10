# OpenClaw Project Dashboard

A web-based task management dashboard designed to work with OpenClaw's task system.

## Features

- 📋 Task management with priorities (High, Medium, Low)
- 🏷️ Category-based organization
- 🤖 OpenClaw integration (tasks tagged with `#openclaw` are picked up by OpenClaw for automatic execution)
- 📊 Dashboard with filtering (All, Pending, Completed)
- 💾 File-based storage using tasks.md
- 🎨 Clean, modern UI

## Getting Started

### Prerequisites

- Node.js (v14 or higher)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/pgedeon/openclaw-project-dashboard.git
cd openclaw-project-dashboard
```

2. Start the server:
```bash
node task-server.js
```

3. Open your browser:
```
http://localhost:3876
```

## Usage

### Adding Tasks

Tasks are stored in `tasks.md` using markdown checkboxes:

```markdown
## High Priority
- [ ] Task description here #openclaw

## Medium Priority
- [ ] Another task

## Completed
- [x] Done task ✅ 2026-02-10
```

### OpenClaw Integration

Tasks tagged with `#openclaw` will be automatically picked up by OpenClaw for execution. When OpenClaw completes a task, it marks it with `- [x]` and adds a completion date.

### Task Format

```markdown
- [ ] Task description #tag due:YYYY-MM-DD
```

- `- [ ]` = Pending task
- `- [x]` = Completed task
- `#openclaw` = Tag for OpenClaw to execute
- `due:YYYY-MM-DD` = Optional due date

## API

The dashboard includes a simple API:

- `GET /api/tasks` - Get current tasks.md content
- `POST /api/tasks` - Update tasks.md content

## License

MIT License
