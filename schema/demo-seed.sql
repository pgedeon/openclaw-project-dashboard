-- OpenClaw Project Dashboard - Demo Seed Data
-- Run after schema: psql -U openclaw -d openclaw_dashboard -f schema/demo-seed.sql
-- This creates a realistic demo environment with departments, agents, projects, tasks, and workflow runs.

BEGIN;

-- ============================================================================
-- Demo Project & Workflow
-- ============================================================================

INSERT INTO workflows (id, name, states, is_default) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Default Workflow', '{"backlog","ready","in_progress","review","completed"}', true);

INSERT INTO projects (id, name, description, status, tags, default_workflow_id, qmd_project_namespace, metadata) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'OpenClaw Platform', 'Core platform development and maintenance', 'active', '{"platform","core"}', 'a0000000-0000-0000-0000-000000000001', 'openclaw-platform', '{"color":"#6366f1"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Content Pipeline', 'Blog content, SEO, and affiliate publishing', 'active', '{"content","publishing"}', 'a0000000-0000-0000-0000-000000000001', 'content-pipeline', '{"color":"#22c55e"}'),
  ('b0000000-0000-0000-0000-000000000003', '3dput.com', '3D printing filaments and settings web app', 'active', '{"web","3d-printing"}', 'a0000000-0000-0000-0000-000000000001', '3dput', '{"color":"#f59e0b"}');

-- ============================================================================
-- Demo Departments (already seeded by migration 006, but ensure consistency)
-- ============================================================================

INSERT INTO departments (name, description, color, icon, sort_order, metadata) VALUES
  ('Core Platform', 'Primary orchestrator and platform agents', '#6366f1', 'cpu', 10, '{"agents": ["main", "coder"]}'),
  ('Content & Publishing', 'Blog content, SEO, affiliate, and publishing pipeline', '#22c55e', 'file-text', 20, '{}'),
  ('Web Properties', 'Website management and development', '#06b6d4', 'globe', 60, '{}'),
  ('Media & Vision', 'Image processing, vision, and media generation', '#ec4899', 'image', 70, '{}')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- Demo Agent Profiles
-- ============================================================================

INSERT INTO agent_profiles (agent_id, department_id, display_name, role, model_primary, capabilities) VALUES
  ('main', (SELECT id FROM departments WHERE name = 'Core Platform'), 'Main Agent', 'orchestrator', 'openrouter/hunter-alpha', '["orchestration","coding","analysis"]'),
  ('coder', (SELECT id FROM departments WHERE name = 'Core Platform'), 'Coder', 'specialist', 'zai/glm-5', '["coding","debugging","refactoring"]'),
  ('3dput', (SELECT id FROM departments WHERE name = 'Web Properties'), '3dput', 'specialist', 'zai/glm-4.7', '["3d-printing","website","wordpress"]'),
  ('affiliate-editorial', (SELECT id FROM departments WHERE name = 'Content & Publishing'), 'Affiliate Editorial', 'specialist', 'zai/glm-4.7', '["content","seo","affiliate"]'),
  ('qa-auditor', (SELECT id FROM departments WHERE name = 'Content & Publishing'), 'QA Auditor', 'specialist', 'zai/glm-4.7', '["quality","auditing"]'),
  ('comfyui-image-agent', (SELECT id FROM departments WHERE name = 'Media & Vision'), 'ComfyUI Agent', 'specialist', 'stepfun/step-3.5-flash:free', '["image-generation","comfyui"]')
ON CONFLICT (agent_id) DO NOTHING;

-- ============================================================================
-- Demo Service Catalog Entries
-- ============================================================================

INSERT INTO service_catalog (name, slug, description, department_id, default_agent_id, sla_hours, intake_fields, sort_order) VALUES
  ('Bug Report', 'bug-report', 'Report a bug or defect',
   (SELECT id FROM departments WHERE name = 'Core Platform'), 'main', 48,
   '[{"name":"title","type":"text","required":true,"label":"Bug Title"},{"name":"description","type":"textarea","required":true,"label":"Description"},{"name":"severity","type":"select","required":true,"options":["critical","high","medium","low"],"label":"Severity"}]', 10),
  ('Content Creation', 'content-creation', 'Request new content or article',
   (SELECT id FROM departments WHERE name = 'Content & Publishing'), 'affiliate-editorial', 72,
   '[{"name":"title","type":"text","required":true,"label":"Content Title"},{"name":"description","type":"textarea","required":true,"label":"Brief"}]', 40),
  ('Image Generation', 'image-generation', 'Request image creation',
   (SELECT id FROM departments WHERE name = 'Media & Vision'), 'comfyui-image-agent', 48,
   '[{"name":"title","type":"text","required":true,"label":"Image Title"},{"name":"description","type":"textarea","required":true,"label":"Description"}]', 60),
  ('Website Update', 'website-update', 'Request changes to a web property',
   (SELECT id FROM departments WHERE name = 'Web Properties'), '3dput', 72,
   '[{"name":"title","type":"text","required":true,"label":"Update Title"},{"name":"description","type":"textarea","required":true,"label":"Description"},{"name":"site","type":"select","required":true,"options":["3dput.com","sailboats.fr"],"label":"Website"}]', 70)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- Demo Tasks
-- ============================================================================

INSERT INTO tasks (id, project_id, title, description, status, priority, owner, labels, due_date) VALUES
  -- Platform tasks
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'Set up CI/CD pipeline', 'Configure GitHub Actions for automated testing and deployment', 'in_progress', 'high', 'coder',
   '{"infrastructure","ci-cd"}', CURRENT_DATE + INTERVAL '3 days'),

  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001',
   'Add rate limiting to API', 'Implement rate limiting middleware for public endpoints', 'ready', 'medium', 'main',
   '{"security","api"}', CURRENT_DATE + INTERVAL '7 days'),

  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001',
   'Fix memory leak in worker', 'Investigate and fix memory leak reported in dashboard worker process', 'blocked', 'critical', 'coder',
   '{"bug","performance"}', CURRENT_DATE + INTERVAL '1 day'),

  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001',
   'Write API documentation', 'Document all public API endpoints with examples', 'backlog', 'low', NULL,
   '{"documentation"}', CURRENT_DATE + INTERVAL '14 days'),

  -- Content tasks
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002',
   'Draft: Best PLA Filaments 2026', 'Research and write affiliate article on top PLA filaments', 'in_progress', 'high', 'affiliate-editorial',
   '{"affiliate","article","pla"}', CURRENT_DATE + INTERVAL '5 days'),

  ('c0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000002',
   'QA Review: PETG Comparison', 'Quality review of the PETG comparison article before publish', 'review', 'medium', 'qa-auditor',
   '{"qa","review"}', CURRENT_DATE + INTERVAL '2 days'),

  ('c0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000002',
   'Generate hero images for March posts', 'Create hero images for 5 upcoming blog posts', 'ready', 'medium', 'comfyui-image-agent',
   '{"images","content"}', CURRENT_DATE + INTERVAL '4 days'),

  -- 3dput.com tasks
  ('c0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000003',
   'Update printer database with Q1 2026 releases', 'Add new printer models released in Q1 2026', 'in_progress', 'medium', '3dput',
   '{"data","printers"}', CURRENT_DATE + INTERVAL '5 days'),

  ('c0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000003',
   'Fix temperature chart rendering on mobile', 'Temperature comparison chart overflows on screens < 768px', 'ready', 'high', '3dput',
   '{"bug","mobile","ui"}', CURRENT_DATE + INTERVAL '2 days'),

  ('c0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000003',
   'Add Bambu Lab A1 mini profiles', 'Add default print profiles for Bambu Lab A1 mini', 'backlog', 'low', NULL,
   '{"feature","printers"}', CURRENT_DATE + INTERVAL '10 days');

-- ============================================================================
-- Demo Task Relationships
-- ============================================================================

-- Subtasks
INSERT INTO tasks (id, project_id, title, description, status, priority, owner, parent_task_id, labels) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'Configure test runner', 'Set up Jest/Vitest for unit tests', 'completed', 'medium', 'coder',
   'c0000000-0000-0000-0000-000000000001', '{"ci-cd","testing"}'),

  ('c1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001',
   'Add deployment step', 'Configure auto-deploy on main branch merge', 'in_progress', 'medium', 'coder',
   'c0000000-0000-0000-0000-000000000001', '{"ci-cd","deployment"}'),

  ('c1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002',
   'Research PLA filament specs', 'Gather specs for top 10 PLA filaments', 'completed', 'high', 'affiliate-editorial',
   'c0000000-0000-0000-0000-000000000005', '{"research","affiliate"}'),

  ('c1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002',
   'Write comparison table', 'Create comparison table with key specs', 'in_progress', 'high', 'affiliate-editorial',
   'c0000000-0000-0000-0000-000000000005', '{"writing","affiliate"}');

-- Set dependency (memory leak fix depends on CI/CD pipeline)
UPDATE tasks SET dependency_ids = ARRAY['c0000000-0000-0000-0000-000000000001']::uuid[]
WHERE id = 'c0000000-0000-0000-0000-000000000003';

-- ============================================================================
-- Demo Workflow Runs
-- ============================================================================

INSERT INTO workflow_runs (id, board_id, task_id, workflow_type, owner_agent_id, initiator, status, current_step, started_at, input_payload, department_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000005',
   'affiliate-article', 'affiliate-editorial', 'main', 'running', 'drafting',
   NOW() - INTERVAL '2 hours',
   '{"topic":"Best PLA Filaments 2026","site":"3dput.com","keyword":"best pla filament"}',
   (SELECT id FROM departments WHERE name = 'Content & Publishing')),

  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000006',
   'qa-review', 'qa-auditor', 'main', 'waiting_for_approval', 'review',
   NOW() - INTERVAL '6 hours',
   '{"article_url":"https://3dput.com/blog/petg-comparison","review_type":"pre-publish"}',
   (SELECT id FROM departments WHERE name = 'Content & Publishing')),

  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000009',
   'site-fix', '3dput', 'main', 'completed', 'testing',
   NOW() - INTERVAL '1 day',
   '{"site":"3dput.com","issue":"responsive-chart","severity":"high"}',
   (SELECT id FROM departments WHERE name = 'Web Properties'));

-- Update the completed run
UPDATE workflow_runs SET
  finished_at = NOW() - INTERVAL '20 hours',
  output_summary = '{"fix":"Applied CSS grid to chart container","live_url":"https://3dput.com/filaments","status":"verified"}',
  actual_artifact_count = 1
WHERE id = 'd0000000-0000-0000-0000-000000000003';

-- Link tasks to workflow runs
UPDATE tasks SET active_workflow_run_id = 'd0000000-0000-0000-0000-000000000001'
WHERE id = 'c0000000-0000-0000-0000-000000000005';

-- ============================================================================
-- Demo Workflow Steps
-- ============================================================================

INSERT INTO workflow_steps (workflow_run_id, step_name, step_order, status, started_at, finished_at, output) VALUES
  -- PLA article steps
  ('d0000000-0000-0000-0000-000000000001', 'topic_discovery', 1, 'completed', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour 45 min',
   '{"topic":"Best PLA Filaments 2026","keywords":["pla filament","best pla","pla 3d printing"]}'),
  ('d0000000-0000-0000-0000-000000000001', 'product_matching', 2, 'completed', NOW() - INTERVAL '1 hour 45 min', NOW() - INTERVAL '1 hour 30 min',
   '{"products":["eSun PLA+","Overture PLA","Polymaker PolyTerra"],"count":10}'),
  ('d0000000-0000-0000-0000-000000000001', 'drafting', 3, 'in_progress', NOW() - INTERVAL '1 hour 30 min', NULL, '{}'),

  -- QA review steps
  ('d0000000-0000-0000-0000-000000000002', 'intake', 1, 'completed', NOW() - INTERVAL '6 hours', NOW() - INTERVAL '5 hours 30 min',
   '{"article_id":"petg-comparison-2026","word_count":3200}'),
  ('d0000000-0000-0000-0000-000000000002', 'review', 2, 'completed', NOW() - INTERVAL '5 hours 30 min', NOW() - INTERVAL '4 hours',
   '{"issues_found":2,"severity":"minor","notes":"Minor formatting issues, one broken link"}'),

  -- Site fix steps
  ('d0000000-0000-0000-0000-000000000003', 'investigation', 1, 'completed', NOW() - INTERVAL '1 day', NOW() - INTERVAL '23 hours',
   '{"root_cause":"Chart container using fixed width","affected_pages":["/filaments"]}'),
  ('d0000000-0000-0000-0000-000000000003', 'fix_implementation', 2, 'completed', NOW() - INTERVAL '23 hours', NOW() - INTERVAL '22 hours',
   '{"changes":["CSS grid layout","responsive breakpoints"]}'),
  ('d0000000-0000-0000-0000-000000000003', 'testing', 3, 'completed', NOW() - INTERVAL '22 hours', NOW() - INTERVAL '21 hours',
   '{"viewport_tests":["375px","768px","1024px","1440px"],"all_passing":true}');

-- ============================================================================
-- Demo Approvals
-- ============================================================================

INSERT INTO workflow_approvals (workflow_run_id, step_name, approver_id, status, requested_by, requested_at, decision, decided_at, decided_by, metadata, approval_type, due_at) VALUES
  ('d0000000-0000-0000-0000-000000000002', 'final_approval', 'main', 'pending', 'qa-auditor',
   NOW() - INTERVAL '4 hours', NULL, NULL, NULL,
   '{"review_notes":"2 minor issues found: formatting + 1 broken link","article_url":"https://3dput.com/blog/petg-comparison"}',
   'step_gate', NOW() + INTERVAL '20 hours'),

  ('d0000000-0000-0000-0000-000000000001', 'draft_approval', 'main', 'pending', 'affiliate-editorial',
   NOW() - INTERVAL '30 minutes', NULL, NULL, NULL,
   '{"word_count_estimate":2500,"products_count":10}',
   'step_gate', NOW() + INTERVAL '23 hours');

-- ============================================================================
-- Demo Artifacts
-- ============================================================================

INSERT INTO workflow_artifacts (workflow_run_id, task_id, artifact_type, label, uri, mime_type, status, created_by) VALUES
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000009',
   'published_url', 'Live Fix', 'https://3dput.com/filaments', 'text/html', 'approved', '3dput'),

  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005',
   'draft', 'Draft Outline', 'file://drafts/pla-filaments-2026-outline.md', 'text/markdown', 'generated', 'affiliate-editorial');

-- ============================================================================
-- Demo Service Requests
-- ============================================================================

INSERT INTO service_requests (id, service_id, requested_by, title, description, status, priority, target_department_id, target_agent_id, input_payload) VALUES
  ('e0000000-0000-0000-0000-000000000001',
   (SELECT id FROM service_catalog WHERE slug = 'content-creation'),
   'main', 'March Blog Content Batch', 'Generate 5 affiliate articles for March publishing schedule',
   'running', 'high',
   (SELECT id FROM departments WHERE name = 'Content & Publishing'),
   'affiliate-editorial',
   '{"count":5,"site":"3dput.com","theme":"spring-3d-printing"}'),

  ('e0000000-0000-0000-0000-000000000002',
   (SELECT id FROM service_catalog WHERE slug = 'website-update'),
   'main', 'Mobile chart fix', 'Fix temperature chart overflow on mobile devices',
   'completed', 'high',
   (SELECT id FROM departments WHERE name = 'Web Properties'),
   '3dput',
   '{"site":"3dput.com","page":"/filaments","issue":"responsive-chart"}'),

  ('e0000000-0000-0000-0000-000000000003',
   (SELECT id FROM service_catalog WHERE slug = 'bug-report'),
   'main', 'Memory leak in dashboard worker', 'Dashboard worker process memory grows unbounded after 24h',
   'new', 'critical',
   (SELECT id FROM departments WHERE name = 'Core Platform'),
   'main',
   '{"component":"dashboard-worker","symptoms":"RSS grows to 2GB+","frequency":"daily"}');

-- ============================================================================
-- Demo Audit Log Entries
-- ============================================================================

INSERT INTO audit_log (task_id, actor, action, old_value, new_value, timestamp) VALUES
  ('c0000000-0000-0000-0000-000000000009', '3dput', 'update',
   '{"status":"ready"}', '{"status":"in_progress"}', NOW() - INTERVAL '1 day'),
  ('c0000000-0000-0000-0000-000000000009', '3dput', 'update',
   '{"status":"in_progress"}', '{"status":"completed"}', NOW() - INTERVAL '20 hours'),
  ('c0000000-0000-0000-0000-000000000005', 'affiliate-editorial', 'claim',
   '{"owner":null}', '{"owner":"affiliate-editorial"}', NOW() - INTERVAL '2 hours'),
  ('c0000000-0000-0000-0000-000000000001', 'main', 'create',
   NULL, '{"title":"Set up CI/CD pipeline","priority":"high"}', NOW() - INTERVAL '2 days'),
  ('c0000000-0000-0000-0000-000000000003', 'main', 'update',
   '{"status":"in_progress","blocker_type":null}', '{"status":"blocked","blocker_type":"waiting_on_agent"}', NOW() - INTERVAL '1 day');

-- ============================================================================
-- Demo Agent Heartbeats
-- ============================================================================

INSERT INTO agent_heartbeats (agent_name, last_seen_at, status, metadata) VALUES
  ('main', NOW() - INTERVAL '30 seconds', 'online', '{"model":"openrouter/hunter-alpha"}'),
  ('coder', NOW() - INTERVAL '2 minutes', 'online', '{"model":"zai/glm-5","current_task":"CI/CD pipeline"}'),
  ('3dput', NOW() - INTERVAL '5 minutes', 'online', '{"model":"zai/glm-4.7"}'),
  ('affiliate-editorial', NOW() - INTERVAL '1 minute', 'online', '{"model":"zai/glm-4.7","current_task":"PLA article drafting"}'),
  ('qa-auditor', NOW() - INTERVAL '10 minutes', 'online', '{"model":"zai/glm-4.7"}'),
  ('comfyui-image-agent', NOW() - INTERVAL '45 minutes', 'offline', '{"model":"stepfun/step-3.5-flash:free"}');

-- ============================================================================
-- Demo Department Metrics Snapshot
-- ============================================================================

INSERT INTO department_daily_metrics (department_id, metric_date, metrics) VALUES
  ((SELECT id FROM departments WHERE name = 'Core Platform'), CURRENT_DATE - INTERVAL '1 day',
   '{"tasks_total":12,"tasks_completed":8,"tasks_blocked":1,"workflow_runs_active":0,"workflow_runs_completed":3,"avg_completion_hours":18.5}'),
  ((SELECT id FROM departments WHERE name = 'Content & Publishing'), CURRENT_DATE - INTERVAL '1 day',
   '{"tasks_total":15,"tasks_completed":10,"tasks_blocked":0,"workflow_runs_active":2,"workflow_runs_completed":5,"avg_completion_hours":24.2,"articles_published":3}'),
  ((SELECT id FROM departments WHERE name = 'Web Properties'), CURRENT_DATE - INTERVAL '1 day',
   '{"tasks_total":8,"tasks_completed":6,"tasks_blocked":0,"workflow_runs_active":0,"workflow_runs_completed":2,"avg_completion_hours":8.5}');

-- Track demo seed as applied
INSERT INTO schema_migrations (migration_name) VALUES ('demo_seed_data') ON CONFLICT DO NOTHING;

COMMIT;
