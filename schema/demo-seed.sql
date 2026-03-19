-- OpenClaw Project Dashboard - Demo Seed Data
-- Run this after the base schema to populate with example data.
-- Designed to showcase all dashboard features.

-- =========================================================================
-- WORKFLOWS
-- =========================================================================

-- Default Kanban workflow
INSERT INTO workflows (name, states, is_default) VALUES
  ('Default Kanban', ARRAY['backlog','ready','in_progress','blocked','review','completed','archived'], true);

-- Content Pipeline workflow
INSERT INTO workflows (name, states, is_default) VALUES
  ('Content Pipeline', ARRAY['draft','research','writing','editing','review','published','archived'], false);

-- Bug Triage workflow
INSERT INTO workflows (name, states, is_default) VALUES
  ('Bug Triage', ARRAY['reported','confirmed','in_progress','testing','verified','closed'], false);

-- =========================================================================
-- PROJECTS
-- =========================================================================

-- Main dashboard project
INSERT INTO projects (name, description, status, tags, metadata, qmd_project_namespace, default_workflow_id)
VALUES (
  'OpenClaw Dashboard',
  'Core project management dashboard for the OpenClaw agent system. Kanban boards, agent work queues, and operational views.',
  'active',
  ARRAY['dashboard', 'openclaw', 'core'],
  '{"icon": "📊", "color": "#3b82f6"}'::jsonb,
  'openclaw/dashboard',
  (SELECT id FROM workflows WHERE name = 'Default Kanban' LIMIT 1)
);

INSERT INTO projects (name, description, status, tags, metadata, qmd_project_namespace, default_workflow_id)
VALUES (
  'Content Operations',
  'Article pipeline for multi-site content operations. Covers research, writing, editing, and publishing.',
  'active',
  ARRAY['content', 'seo', 'publishing'],
  '{"icon": "📝", "color": "#8b5cf6"}'::jsonb,
  'ops/content',
  (SELECT id FROM workflows WHERE name = 'Content Pipeline' LIMIT 1)
);

INSERT INTO projects (name, description, status, tags, metadata, qmd_project_namespace, default_workflow_id)
VALUES (
  'Infrastructure',
  'Server health, monitoring, deployments, and system maintenance tasks.',
  'active',
  ARRAY['infra', 'devops', 'monitoring'],
  '{"icon": "🔧", "color": "#f59e0b"}'::jsonb,
  'ops/infra',
  (SELECT id FROM workflows WHERE name = 'Default Kanban' LIMIT 1)
);

INSERT INTO projects (name, description, status, tags, metadata, qmd_project_namespace, default_workflow_id)
VALUES (
  'Bug Tracker',
  'Track and resolve bugs across all projects.',
  'active',
  ARRAY['bugs', 'triage'],
  '{"icon": "🐛", "color": "#ef4444"}'::jsonb,
  'bugs/tracker',
  (SELECT id FROM workflows WHERE name = 'Bug Triage' LIMIT 1)
);

INSERT INTO projects (name, description, status, tags, metadata, qmd_project_namespace, default_workflow_id)
VALUES (
  'API Integrations',
  'Third-party API integrations, webhooks, and data pipelines.',
  'active',
  ARRAY['api', 'integrations'],
  '{"icon": "🔌", "color": "#06b6d4"}'::jsonb,
  'ops/api-integrations',
  (SELECT id FROM workflows WHERE name = 'Default Kanban' LIMIT 1)
);

-- Archived project
INSERT INTO projects (name, description, status, tags, metadata, qmd_project_namespace, default_workflow_id)
VALUES (
  'Legacy Migration',
  'Migration of legacy dashboard to the new architecture. Completed Q1 2026.',
  'archived',
  ARRAY['legacy', 'completed'],
  '{"icon": "📦", "color": "#6b7280"}'::jsonb,
  'ops/legacy-migration',
  (SELECT id FROM workflows WHERE name = 'Default Kanban' LIMIT 1)
);

-- =========================================================================
-- TASKS — OpenClaw Dashboard
-- =========================================================================

-- Backlog items
INSERT INTO tasks (project_id, title, description, status, priority, owner, labels, due_date, start_date, estimated_effort) VALUES
  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'Add Gantt chart view',
   'Implement a Gantt/timeline view alongside the existing board and list views. Should support drag-to-reschedule.',
   'backlog', 'low', NULL, ARRAY['feature', 'ui'], '2026-05-01', NULL, 24),

  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'Custom field support',
   'Allow projects to define custom fields (text, number, select) on tasks.',
   'backlog', 'medium', NULL, ARRAY['feature', 'schema'], '2026-05-15', NULL, 40),

  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'Email notification preferences',
   'Per-user notification settings for task assignments, due dates, and mentions.',
   'backlog', 'low', NULL, ARRAY['feature', 'notifications'], NULL, NULL, 16);

-- Ready items
INSERT INTO tasks (project_id, title, description, status, priority, owner, labels, due_date, start_date, estimated_effort) VALUES
  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'Dark/light theme toggle persistence',
   'Save theme preference to localStorage and sync across tabs. Currently resets on reload.',
   'ready', 'medium', 'dashboard-agent', ARRAY['bug', 'ui'], '2026-03-25', NULL, 4),

  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'Mobile responsive task list',
   'Optimize task list layout for screens under 768px. Cards should stack vertically.',
   'ready', 'high', NULL, ARRAY['feature', 'ui', 'mobile'], '2026-04-01', NULL, 8);

-- In-progress items
INSERT INTO tasks (project_id, title, description, status, priority, owner, labels, due_date, start_date, estimated_effort, actual_effort) VALUES
  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'Agent heartbeat monitoring panel',
   'Real-time panel showing last heartbeat, queue depth, and status for each registered agent.',
   'in_progress', 'high', 'ops-agent', ARRAY['feature', 'agents'], '2026-03-22', '2026-03-10', 16, 8),

  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'Batch task operations',
   'Select multiple tasks and perform bulk actions: move, assign, archive, delete.',
   'in_progress', 'medium', 'dashboard-agent', ARRAY['feature', 'ux'], '2026-03-28', '2026-03-12', 20, 6);

-- Blocked items
INSERT INTO tasks (project_id, title, description, status, priority, owner, labels, due_date, start_date, estimated_effort) VALUES
  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'WebSocket real-time sync',
   'Replace polling with WebSocket for live task updates across browser tabs and agents.',
   'blocked', 'high', NULL, ARRAY['feature', 'infrastructure'], '2026-04-10', NULL, 32);

-- Review items
INSERT INTO tasks (project_id, title, description, status, priority, owner, labels, due_date, start_date, estimated_effort, actual_effort) VALUES
  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'Audit log viewer improvements',
   'Add filtering by actor, action type, and date range. Show before/after diffs in expandable rows.',
   'review', 'medium', 'dashboard-agent', ARRAY['improvement', 'audit'], '2026-03-20', '2026-03-05', 12, 10),

  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'API rate limiting middleware',
   'Add configurable rate limiting to all API endpoints. Default 100 req/min per IP.',
   'review', 'high', 'ops-agent', ARRAY['security', 'api'], '2026-03-19', '2026-03-08', 8, 7);

-- Completed items
INSERT INTO tasks (project_id, title, description, status, priority, owner, labels, due_date, start_date, estimated_effort, actual_effort, completed_at) VALUES
  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'Kanban board drag-and-drop',
   'Implement drag-and-drop task movement between status columns on the board view.',
   'completed', 'high', 'dashboard-agent', ARRAY['feature', 'ui'], '2026-03-10', '2026-02-20', 16, 14, NOW() - INTERVAL '9 days'),

  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'Task priority color coding',
   'Visual indicators for task priority: critical=red, high=orange, medium=blue, low=gray.',
   'completed', 'low', 'ops-agent', ARRAY['ui', 'polish'], '2026-03-05', '2026-02-25', 2, 1.5, NOW() - INTERVAL '14 days');

-- =========================================================================
-- TASKS — Content Operations
-- =========================================================================

INSERT INTO tasks (project_id, title, description, status, priority, owner, labels, due_date, start_date, estimated_effort) VALUES
  ((SELECT id FROM projects WHERE name = 'Content Operations'),
   'Write affiliate product comparison: budget 3D printers 2026',
   'Compare top 5 budget 3D printers under $300. Include specs, pros/cons, affiliate links.',
   'backlog', 'medium', 'content-agent', ARRAY['affiliate', '3d-printers'], '2026-04-15', NULL, 6),

  ((SELECT id FROM projects WHERE name = 'Content Operations'),
   'Filament temperature guide update',
   'Update the master filament settings table with new materials tested in Q1 2026.',
   'in_progress', 'high', 'content-agent', ARRAY['guide', 'filament'], '2026-03-25', '2026-03-15', 4),

  ((SELECT id FROM projects WHERE name = 'Content Operations'),
   'SEO audit: product review pages',
   'Audit top 20 product review pages for meta descriptions, structured data, and internal links.',
   'ready', 'medium', 'seo-agent', ARRAY['seo', 'audit'], '2026-03-30', NULL, 8),

  ((SELECT id FROM projects WHERE name = 'Content Operations'),
   'Publish Q1 content performance report',
   'Aggregate GA4 data into a content performance summary with actionable recommendations.',
   'completed', 'medium', 'ops-agent', ARRAY['reporting', 'analytics'], '2026-03-15', '2026-03-01', 6, 5, NOW() - INTERVAL '4 days');

-- =========================================================================
-- TASKS — Infrastructure
-- =========================================================================

INSERT INTO tasks (project_id, title, description, status, priority, owner, labels, due_date, start_date, estimated_effort) VALUES
  ((SELECT id FROM projects WHERE name = 'Infrastructure'),
   'PostgreSQL backup automation',
   'Set up automated daily pg_dump with retention policy (30 days). Store compressed backups.',
   'in_progress', 'critical', 'ops-agent', ARRAY['backup', 'database'], '2026-03-21', '2026-03-14', 4),

  ((SELECT id FROM projects WHERE name = 'Infrastructure'),
   'SSL certificate renewal monitoring',
   'Add monitoring for certificate expiry with 14-day warning. Auto-renew via certbot.',
   'ready', 'high', NULL, ARRAY['security', 'ssl'], '2026-04-01', NULL, 3),

  ((SELECT id FROM projects WHERE name = 'Infrastructure'),
   'Upgrade Node.js to v22 LTS',
   'Plan and execute Node.js upgrade across all services. Test compatibility first.',
   'backlog', 'low', NULL, ARRAY['maintenance', 'nodejs'], '2026-05-01', NULL, 8);

-- =========================================================================
-- TASKS — Bug Tracker
-- =========================================================================

INSERT INTO tasks (project_id, title, description, status, priority, owner, labels, due_date, start_date, estimated_effort) VALUES
  ((SELECT id FROM projects WHERE name = 'Bug Tracker'),
   'Task description markdown not rendering',
   'Markdown in task descriptions is displayed as raw text in the detail panel.',
   'confirmed', 'high', NULL, ARRAY['ui', 'markdown'], '2026-03-22', '2026-03-18', 3),

  ((SELECT id FROM projects WHERE name = 'Bug Tracker'),
   'Filter state lost on page reload',
   'Active filter selection resets when the page is refreshed. Should persist in URL hash.',
   'in_progress', 'medium', 'dashboard-agent', ARRAY['bug', 'filters'], '2026-03-24', '2026-03-16', 4),

  ((SELECT id FROM projects WHERE name = 'Bug Tracker'),
   'Agent heartbeat 404 after server restart',
   'After server restart, agent heartbeat POST returns 404 until first GET /api/agents/status.',
   'reported', 'medium', NULL, ARRAY['api', 'agents'], '2026-03-28', NULL, 2),

  ((SELECT id FROM projects WHERE name = 'Bug Tracker'),
   'Duplicate subtasks created on double-click',
   'Rapid double-click on "Add Subtask" creates two duplicate entries.',
   'closed', 'low', 'dashboard-agent', ARRAY['bug', 'ui'], '2026-03-12', '2026-03-08', 1, 0.5, NOW() - INTERVAL '7 days');

-- =========================================================================
-- TASKS — API Integrations
-- =========================================================================

INSERT INTO tasks (project_id, title, description, status, priority, owner, labels, due_date, start_date, estimated_effort) VALUES
  ((SELECT id FROM projects WHERE name = 'API Integrations'),
   'GitHub webhook for issue sync',
   'Receive GitHub issue webhooks and auto-create dashboard tasks with bidirectional sync.',
   'backlog', 'medium', NULL, ARRAY['github', 'webhook'], '2026-04-20', NULL, 16),

  ((SELECT id FROM projects WHERE name = 'API Integrations'),
   'Slack notification integration',
   'Post task status changes to a Slack channel with configurable event filters.',
   'ready', 'low', NULL, ARRAY['slack', 'notifications'], '2026-04-15', NULL, 8);

-- =========================================================================
-- PARENT/CHILD RELATIONSHIPS (subtasks)
-- =========================================================================

-- "Batch task operations" has two subtasks
INSERT INTO tasks (project_id, title, description, status, priority, owner, labels, parent_task_id, estimated_effort) VALUES
  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'Selection UI: shift-click range selection',
   'Implement shift-click to select a range of tasks in the list view.',
   'in_progress', 'medium', 'dashboard-agent', ARRAY['ux'],
   (SELECT id FROM tasks WHERE title = 'Batch task operations' LIMIT 1), 4),

  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'Bulk action dropdown menu',
   'Floating action menu with available bulk operations for selected tasks.',
   'backlog', 'medium', NULL, ARRAY['ux'],
   (SELECT id FROM tasks WHERE title = 'Batch task operations' LIMIT 1), 6);

-- "Gantt chart view" has subtask
INSERT INTO tasks (project_id, title, description, status, priority, owner, labels, parent_task_id, estimated_effort) VALUES
  ((SELECT id FROM projects WHERE name = 'OpenClaw Dashboard'),
   'Date range picker for Gantt view',
   'Custom date range selector to zoom into specific time windows on the Gantt chart.',
   'backlog', 'low', NULL, ARRAY['feature', 'ui'],
   (SELECT id FROM tasks WHERE title = 'Add Gantt chart view' LIMIT 1), 8);

-- =========================================================================
-- AUDIT LOG (sample entries)
-- =========================================================================

INSERT INTO audit_log (task_id, actor, action, old_value, new_value) VALUES
  ((SELECT id FROM tasks WHERE title = 'Kanban board drag-and-drop' LIMIT 1),
   'dashboard-agent', 'create',
   NULL, '{"title": "Kanban board drag-and-drop", "status": "backlog", "priority": "high"}'::jsonb),

  ((SELECT id FROM tasks WHERE title = 'Kanban board drag-and-drop' LIMIT 1),
   'dashboard-agent', 'move',
   '{"status": "backlog"}'::jsonb, '{"status": "in_progress"}'::jsonb),

  ((SELECT id FROM tasks WHERE title = 'Kanban board drag-and-drop' LIMIT 1),
   'dashboard-agent', 'move',
   '{"status": "in_progress"}'::jsonb, '{"status": "review"}'::jsonb),

  ((SELECT id FROM tasks WHERE title = 'Kanban board drag-and-drop' LIMIT 1),
   'ops-agent', 'move',
   '{"status": "review"}'::jsonb, '{"status": "completed"}'::jsonb),

  ((SELECT id FROM tasks WHERE title = 'Agent heartbeat monitoring panel' LIMIT 1),
   'ops-agent', 'claim',
   '{"owner": null}'::jsonb, '{"owner": "ops-agent"}'::jsonb),

  ((SELECT id FROM tasks WHERE title = 'Agent heartbeat monitoring panel' LIMIT 1),
   'ops-agent', 'move',
   '{"status": "backlog"}'::jsonb, '{"status": "in_progress"}'::jsonb),

  ((SELECT id FROM tasks WHERE title = 'Audit log viewer improvements' LIMIT 1),
   'dashboard-agent', 'create',
   NULL, '{"title": "Audit log viewer improvements", "status": "backlog"}'::jsonb),

  ((SELECT id FROM tasks WHERE title = 'Audit log viewer improvements' LIMIT 1),
   'dashboard-agent', 'update',
   '{"description": ""}'::jsonb, '{"description": "Add filtering by actor, action type, and date range."}'::jsonb);

COMMIT;
