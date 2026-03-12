-- OpenClaw Project Dashboard Schema
-- PostgreSQL 13+
-- Consolidated schema: base + all migrations through 015
-- This file creates the complete database from scratch.

BEGIN;

-- ============================================================================
-- Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Helper Functions
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- ============================================================================
-- Schema Migrations Tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  migration_name TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum TEXT
);

-- ============================================================================
-- Projects
-- ============================================================================

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  tags TEXT[] NOT NULL DEFAULT '{}',
  default_workflow_id UUID NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  qmd_project_namespace TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_tags ON projects USING GIN(tags);
CREATE INDEX idx_projects_metadata ON projects USING GIN(metadata);

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Workflows (Templates)
-- ============================================================================

CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  states TEXT[] NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  project_id UUID NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE projects ADD CONSTRAINT fk_projects_default_workflow
  FOREIGN KEY (default_workflow_id) REFERENCES workflows(id) ON DELETE SET NULL;

CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Departments
-- ============================================================================

CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  color VARCHAR(7) DEFAULT '#6366f1',
  icon VARCHAR(50) DEFAULT 'folder',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_departments_sort_order ON departments(sort_order);
CREATE INDEX idx_departments_active ON departments(is_active);

-- ============================================================================
-- Agent Profiles
-- ============================================================================

CREATE TABLE agent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(255) NOT NULL UNIQUE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  display_name VARCHAR(255) NOT NULL,
  role VARCHAR(100),
  model_primary VARCHAR(255),
  capabilities JSONB DEFAULT '[]',
  status VARCHAR(50) DEFAULT 'active',
  workspace_path TEXT,
  metadata JSONB DEFAULT '{}',
  last_heartbeat TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_profiles_agent_id ON agent_profiles(agent_id);
CREATE INDEX idx_agent_profiles_department ON agent_profiles(department_id);
CREATE INDEX idx_agent_profiles_status ON agent_profiles(status);

-- ============================================================================
-- Workflow Templates (Business-Aware)
-- ============================================================================

CREATE TABLE workflow_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  default_owner_agent TEXT NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]',
  required_approvals JSONB NOT NULL DEFAULT '[]',
  success_criteria JSONB NOT NULL DEFAULT '{}',
  category TEXT NOT NULL DEFAULT 'general',
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- Business context columns (migrated from 011)
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  service_id UUID NULL,
  input_schema JSONB NOT NULL DEFAULT '{}',
  artifact_contract JSONB NOT NULL DEFAULT '{}',
  blocker_policy JSONB NOT NULL DEFAULT '{}',
  escalation_policy JSONB NOT NULL DEFAULT '{}',
  runbook_ref TEXT NULL,
  ui_category TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_templates_category ON workflow_templates(category);
CREATE INDEX idx_workflow_templates_is_active ON workflow_templates(is_active);
CREATE INDEX idx_workflow_templates_department_id ON workflow_templates(department_id);
CREATE INDEX idx_workflow_templates_service_id ON workflow_templates(service_id);
CREATE INDEX idx_workflow_templates_ui_category ON workflow_templates(ui_category);

CREATE TRIGGER update_workflow_templates_updated_at BEFORE UPDATE ON workflow_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Service Catalog
-- ============================================================================

CREATE TABLE service_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  default_agent_id VARCHAR(255),
  workflow_template_id UUID REFERENCES workflow_templates(id) ON DELETE SET NULL,
  intake_fields JSONB DEFAULT '[]',
  sla_hours INTEGER DEFAULT 72,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_service_catalog_slug ON service_catalog(slug);
CREATE INDEX idx_service_catalog_department ON service_catalog(department_id);
CREATE INDEX idx_service_catalog_active ON service_catalog(is_active);

-- ============================================================================
-- Service Requests
-- ============================================================================

CREATE TABLE service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES service_catalog(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  task_id UUID NULL,
  requested_by VARCHAR(255) NOT NULL,
  requested_for VARCHAR(255),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status VARCHAR(50) NOT NULL DEFAULT 'new',
  priority VARCHAR(50) NOT NULL DEFAULT 'medium',
  target_department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  target_agent_id VARCHAR(255),
  input_payload JSONB DEFAULT '{}',
  routing_decision JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT service_requests_status_check CHECK (
    status IN ('new', 'triaged', 'planned', 'running', 'waiting_for_approval', 'blocked', 'completed', 'failed', 'cancelled')
  ),
  CONSTRAINT service_requests_priority_check CHECK (
    priority IN ('low', 'medium', 'high', 'critical')
  )
);

CREATE INDEX idx_service_requests_service_id ON service_requests(service_id);
CREATE INDEX idx_service_requests_status ON service_requests(status);
CREATE INDEX idx_service_requests_priority ON service_requests(priority);
CREATE INDEX idx_service_requests_target_department ON service_requests(target_department_id);
CREATE INDEX idx_service_requests_target_agent ON service_requests(target_agent_id);
CREATE INDEX idx_service_requests_project ON service_requests(project_id);
CREATE INDEX idx_service_requests_created_at ON service_requests(created_at DESC);

-- ============================================================================
-- Tasks
-- ============================================================================

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT NOT NULL DEFAULT 'medium',
  owner TEXT NULL,
  due_date DATE NULL,
  start_date DATE NULL,
  estimated_effort NUMERIC NULL,
  actual_effort NUMERIC NULL,
  parent_task_id UUID NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_ids UUID[] NOT NULL DEFAULT '{}',
  labels TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  recurrence_rule TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  execution_lock TIMESTAMPTZ NULL,
  execution_locked_by TEXT NULL,
  -- Workflow linkage
  active_workflow_run_id UUID NULL,
  -- Blocker classification
  blocker_type TEXT NULL,
  blocker_description TEXT NULL,
  -- Agent observability
  retry_count INTEGER NOT NULL DEFAULT 0,
  -- Soft delete / archive
  archived_at TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT valid_priority CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT valid_status CHECK (status IN (
    'backlog', 'ready', 'archived', 'review', 'completed', 'in_progress', 'blocked',
    'topic_candidate', 'drafting', 'image_pending', 'image_ready',
    'qa_pending', 'ready_to_publish', 'published',
    'retrying', 'failed', 'cancelled'
  ))
);

CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_owner ON tasks(owner);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX idx_tasks_completed_at ON tasks(completed_at);
CREATE INDEX idx_tasks_updated_at ON tasks(updated_at);
CREATE INDEX idx_tasks_dependency_ids ON tasks USING GIN(dependency_ids);
CREATE INDEX idx_tasks_labels ON tasks USING GIN(labels);
CREATE INDEX idx_tasks_metadata ON tasks USING GIN(metadata);
CREATE INDEX idx_tasks_active_workflow_run_id ON tasks(active_workflow_run_id);
CREATE INDEX idx_tasks_blocker_type ON tasks(blocker_type);
CREATE INDEX idx_tasks_status_archived ON tasks(status, archived_at);
CREATE INDEX idx_tasks_deleted_at ON tasks(deleted_at);

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Audit Log
-- ============================================================================

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  old_value JSONB NULL,
  new_value JSONB NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_task_id ON audit_log(task_id);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_log_actor ON audit_log(actor);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_actor_action ON audit_log(actor, action);

-- ============================================================================
-- Saved Views
-- ============================================================================

CREATE TABLE saved_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  sort TEXT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_saved_views_project_id ON saved_views(project_id);
CREATE INDEX idx_saved_views_created_by ON saved_views(created_by);

-- ============================================================================
-- Agent Heartbeats & Task Runs
-- ============================================================================

CREATE TABLE agent_heartbeats (
  agent_name TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'online',
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_agent_heartbeats_last_seen ON agent_heartbeats(last_seen_at);

CREATE TABLE task_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  error_summary TEXT NULL,
  output_summary TEXT NULL,
  CONSTRAINT valid_task_run_status CHECK (status IN ('pending', 'running', 'success', 'failure'))
);

CREATE INDEX idx_task_runs_task_id ON task_runs(task_id);
CREATE INDEX idx_task_runs_agent_name ON task_runs(agent_name);
CREATE INDEX idx_task_runs_started_at ON task_runs(started_at DESC);
CREATE INDEX idx_task_runs_task_agent_attempt ON task_runs(task_id, agent_name, attempt_number);

-- ============================================================================
-- Cron Job Runs
-- ============================================================================

CREATE TABLE cron_job_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NULL,
  exit_code INTEGER NULL,
  output TEXT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  duration_ms INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cron_job_runs_job_id ON cron_job_runs(job_id);
CREATE INDEX idx_cron_job_runs_started_at ON cron_job_runs(started_at DESC);
CREATE INDEX idx_cron_job_runs_status ON cron_job_runs(status);

-- ============================================================================
-- Workflow Runs
-- ============================================================================

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id UUID NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID NULL REFERENCES tasks(id) ON DELETE CASCADE,
  workflow_type TEXT NOT NULL,
  owner_agent_id TEXT NOT NULL,
  initiator TEXT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  current_step TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  last_heartbeat_at TIMESTAMPTZ NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT NULL,
  last_error_at TIMESTAMPTZ NULL,
  input_payload JSONB NOT NULL DEFAULT '{}',
  output_summary JSONB NOT NULL DEFAULT '{}',
  gateway_session_id TEXT NULL,
  gateway_session_active BOOLEAN NOT NULL DEFAULT false,
  -- Blocker classification (004)
  blocker_type TEXT NULL,
  blocker_description TEXT NULL,
  -- Business context (011)
  service_request_id UUID NULL REFERENCES service_requests(id) ON DELETE SET NULL,
  department_id UUID NULL REFERENCES departments(id) ON DELETE SET NULL,
  run_priority TEXT NULL,
  approval_state TEXT NULL,
  outcome_code TEXT NULL,
  operator_notes TEXT NULL,
  expected_artifact_count INTEGER NOT NULL DEFAULT 0,
  actual_artifact_count INTEGER NOT NULL DEFAULT 0,
  value_score NUMERIC NULL,
  customer_scope TEXT NULL,
  -- Blocker intelligence (014)
  blocker_detected_at TIMESTAMPTZ NULL,
  blocker_source TEXT NULL,
  blocker_metadata JSONB NOT NULL DEFAULT '{}',
  escalation_status TEXT NULL,
  escalated_at TIMESTAMPTZ NULL,
  escalated_to TEXT NULL,
  escalation_reason TEXT NULL,
  paused_at TIMESTAMPTZ NULL,
  paused_by TEXT NULL,
  pause_reason TEXT NULL,
  resumed_at TIMESTAMPTZ NULL,
  resumed_by TEXT NULL,
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_workflow_run_status CHECK (status IN (
    'queued', 'running', 'waiting_for_approval', 'blocked', 'retrying', 'completed', 'failed', 'cancelled'
  ))
);

CREATE INDEX idx_workflow_runs_board_id ON workflow_runs(board_id);
CREATE INDEX idx_workflow_runs_task_id ON workflow_runs(task_id);
CREATE INDEX idx_workflow_runs_owner_agent_id ON workflow_runs(owner_agent_id);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX idx_workflow_runs_workflow_type ON workflow_runs(workflow_type);
CREATE INDEX idx_workflow_runs_started_at ON workflow_runs(started_at);
CREATE INDEX idx_workflow_runs_last_heartbeat_at ON workflow_runs(last_heartbeat_at);
CREATE INDEX idx_workflow_runs_gateway_session ON workflow_runs(gateway_session_id);
CREATE INDEX idx_workflow_runs_input_payload ON workflow_runs USING GIN(input_payload);
CREATE INDEX idx_workflow_runs_output_summary ON workflow_runs USING GIN(output_summary);
CREATE INDEX idx_workflow_runs_blocker_type ON workflow_runs(blocker_type);
CREATE INDEX idx_workflow_runs_service_request_id ON workflow_runs(service_request_id);
CREATE INDEX idx_workflow_runs_department_id ON workflow_runs(department_id);
CREATE INDEX idx_workflow_runs_run_priority ON workflow_runs(run_priority);
CREATE INDEX idx_workflow_runs_approval_state ON workflow_runs(approval_state);
CREATE INDEX idx_workflow_runs_blocker_detected_at ON workflow_runs(blocker_detected_at);
CREATE INDEX idx_workflow_runs_escalation_status ON workflow_runs(escalation_status);
CREATE INDEX idx_workflow_runs_escalated_to ON workflow_runs(escalated_to);
CREATE INDEX idx_workflow_runs_paused_at ON workflow_runs(paused_at);

ALTER TABLE tasks ADD CONSTRAINT fk_tasks_active_workflow_run
  FOREIGN KEY (active_workflow_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL;

CREATE TRIGGER update_workflow_runs_updated_at BEFORE UPDATE ON workflow_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Workflow Steps
-- ============================================================================

CREATE TABLE workflow_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  output JSONB NOT NULL DEFAULT '{}',
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_workflow_step_status CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped'))
);

CREATE INDEX idx_workflow_steps_run_id ON workflow_steps(workflow_run_id);
CREATE INDEX idx_workflow_steps_status ON workflow_steps(status);
CREATE INDEX idx_workflow_steps_step_order ON workflow_steps(step_order);

CREATE TRIGGER update_workflow_steps_updated_at BEFORE UPDATE ON workflow_steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Workflow Artifacts
-- ============================================================================

CREATE TABLE workflow_artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  task_id UUID NULL REFERENCES tasks(id) ON DELETE SET NULL,
  artifact_type TEXT NOT NULL,
  label TEXT NOT NULL,
  uri TEXT NOT NULL,
  mime_type TEXT NULL,
  status TEXT NOT NULL DEFAULT 'generated',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workflow_artifacts_status_check CHECK (status IN ('generated', 'attached', 'approved', 'rejected', 'archived'))
);

CREATE INDEX idx_workflow_artifacts_run_id ON workflow_artifacts(workflow_run_id);
CREATE INDEX idx_workflow_artifacts_task_id ON workflow_artifacts(task_id);
CREATE INDEX idx_workflow_artifacts_type ON workflow_artifacts(artifact_type);
CREATE INDEX idx_workflow_artifacts_status ON workflow_artifacts(status);
CREATE INDEX idx_workflow_artifacts_created_by ON workflow_artifacts(created_by);
CREATE INDEX idx_workflow_artifacts_created_at ON workflow_artifacts(created_at DESC);

CREATE TRIGGER update_workflow_artifacts_updated_at BEFORE UPDATE ON workflow_artifacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Workflow Approvals
-- ============================================================================

CREATE TABLE workflow_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decision TEXT NULL,
  decided_at TIMESTAMPTZ NULL,
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}',
  -- Extended approval fields (013)
  approval_type TEXT NOT NULL DEFAULT 'step_gate',
  artifact_id UUID NULL REFERENCES workflow_artifacts(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NULL,
  escalated_at TIMESTAMPTZ NULL,
  escalated_to TEXT NULL,
  escalation_reason TEXT NULL,
  required_note BOOLEAN NOT NULL DEFAULT true,
  decided_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_approval_status CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);

CREATE INDEX idx_workflow_approvals_run_id ON workflow_approvals(workflow_run_id);
CREATE INDEX idx_workflow_approvals_status ON workflow_approvals(status);
CREATE INDEX idx_workflow_approvals_approver_id ON workflow_approvals(approver_id);
CREATE INDEX idx_workflow_approvals_artifact_id ON workflow_approvals(artifact_id);
CREATE INDEX idx_workflow_approvals_due_at ON workflow_approvals(due_at);
CREATE INDEX idx_workflow_approvals_expires_at ON workflow_approvals(expires_at);
CREATE INDEX idx_workflow_approvals_escalated_to ON workflow_approvals(escalated_to);

CREATE TRIGGER update_workflow_approvals_updated_at BEFORE UPDATE ON workflow_approvals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Department Daily Metrics (015)
-- ============================================================================

CREATE TABLE department_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT department_daily_metrics_unique UNIQUE (department_id, metric_date)
);

CREATE INDEX idx_department_daily_metrics_department ON department_daily_metrics(department_id);
CREATE INDEX idx_department_daily_metrics_metric_date ON department_daily_metrics(metric_date DESC);

CREATE TRIGGER update_department_daily_metrics_updated_at BEFORE UPDATE ON department_daily_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Views
-- ============================================================================

-- Task graph view
CREATE OR REPLACE VIEW task_graph AS
SELECT
  t.id, t.project_id, t.title, t.status, t.priority, t.owner,
  t.due_date, t.start_date, t.parent_task_id, t.dependency_ids,
  p.name as project_name, p.status as project_status
FROM tasks t
JOIN projects p ON t.project_id = p.id
WHERE p.status = 'active';

-- Blocked tasks view
CREATE OR REPLACE VIEW blocked_tasks AS
SELECT
  t.id, t.title, t.project_id, t.status, t.dependency_ids,
  COUNT(dep.id) FILTER (WHERE dep.status NOT IN ('completed', 'archived')) as blocking_dependencies
FROM tasks t
LEFT JOIN tasks dep ON t.dependency_ids @> ARRAY[dep.id]
WHERE t.status NOT IN ('completed', 'archived', 'blocked')
GROUP BY t.id
HAVING COUNT(dep.id) FILTER (WHERE dep.status NOT IN ('completed', 'archived')) > 0;

-- Active workflow runs view
CREATE OR REPLACE VIEW active_workflow_runs AS
SELECT
  wr.id, wr.workflow_type, wr.status, wr.current_step,
  wr.owner_agent_id, wr.initiator, wr.started_at, wr.finished_at,
  wr.last_heartbeat_at, wr.retry_count, wr.last_error,
  wr.gateway_session_id, wr.gateway_session_active,
  t.id as task_id, t.title as task_title, t.status as task_status,
  p.id as board_id, p.name as board_name,
  EXTRACT(EPOCH FROM (NOW() - wr.started_at)) as elapsed_seconds,
  CASE
    WHEN wr.last_heartbeat_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (NOW() - wr.last_heartbeat_at))
  END as heartbeat_age_seconds
FROM workflow_runs wr
LEFT JOIN tasks t ON wr.task_id = t.id
LEFT JOIN projects p ON wr.board_id = p.id
WHERE wr.status IN ('queued', 'running', 'waiting_for_approval', 'blocked', 'retrying');

-- Stuck workflow runs view
CREATE OR REPLACE VIEW stuck_workflow_runs AS
SELECT
  wr.id, wr.workflow_type, wr.status, wr.current_step,
  wr.owner_agent_id, wr.last_heartbeat_at,
  EXTRACT(EPOCH FROM (NOW() - wr.last_heartbeat_at)) as heartbeat_age_seconds,
  t.title as task_title,
  CASE
    WHEN wr.gateway_session_active = false THEN 'session_inactive'
    WHEN wr.last_heartbeat_at IS NULL THEN 'no_heartbeat'
    WHEN EXTRACT(EPOCH FROM (NOW() - wr.last_heartbeat_at)) > 600 THEN 'heartbeat_stale'
    WHEN wr.retry_count >= wr.max_retries THEN 'max_retries_exceeded'
    ELSE 'unknown'
  END as stuck_reason
FROM workflow_runs wr
LEFT JOIN tasks t ON wr.task_id = t.id
WHERE wr.status IN ('running', 'blocked', 'retrying')
  AND (
    wr.gateway_session_active = false
    OR wr.last_heartbeat_at IS NULL
    OR EXTRACT(EPOCH FROM (NOW() - wr.last_heartbeat_at)) > 600
    OR wr.retry_count >= wr.max_retries
  );

COMMIT;
