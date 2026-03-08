# Release Candidate v2.0.0-rc.1 – 2026-03-08

## Summary

This release candidate turns the dashboard into a publishable OpenClaw project instead of a workspace-only implementation. It packages the current UI and backend as `openclaw-project-dashboard`, adds install documentation, and includes the recent hierarchy, task composer, and OpenClaw bridge improvements.

## Highlights

- Folder-style board tree in the project workspace panel
- Project management actions directly in the project context area
- Task composer with agent and preferred-model assignment
- OpenClaw-aware `/api/task-options` and agent heartbeat/status surfaces
- Better filter correctness, subtask visibility, and stats consistency
- Runtime path configuration through `OPENCLAW_WORKSPACE` and `OPENCLAW_CONFIG_FILE`

## Release Artifacts

- Git tag: `v2.0.0-rc.1`
- Default branch target: `main`
- Repository target: `github.com/pgedeon/openclaw-project-dashboard`

## Validation

- `node --check task-server.js`
- `node --check src/dashboard-integration-optimized.mjs`
- `bash -n scripts/dashboard-health.sh`
- `bash -n scripts/restart-task-server.sh`
- `node scripts/dashboard-validation.js`
- Live health check at `http://localhost:3876/api/health`

## Migration Notes

No schema migration was added for this RC. Existing dashboard databases remain compatible.

## Install References

- [docs/install-openclaw.md](docs/install-openclaw.md)
- [docs/install-standalone.md](docs/install-standalone.md)
