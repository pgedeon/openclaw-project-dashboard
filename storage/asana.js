/**
 * Asana-Style Storage Layer
 * PostgreSQL-backed storage for Projects, Tasks, Workflows, and Dependencies
 */

const { Pool } = require('pg');
const crypto = require('crypto'); // For UUID generation
const security = require('../lib/qmd-security');

// Default workflow states
const DEFAULT_WORKFLOW_STATES = [
  'backlog',
  'ready',
  'in_progress',
  'blocked',
  'review',
  'completed',
  'archived'
];

// Priorities
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

// Project statuses
const PROJECT_STATUSES = ['active', 'paused', 'archived'];
const PROJECT_PAGE_LIMIT_MAX = 200;
const FIXTURE_PROJECT_PATTERNS = [
  /^board test project\b/i,
  /^test project\b/i,
  /^test$/i,
  /^my new project\b/i,
  /\bfixture\b/i,
  /\bseed\b/i
];

function normalizeTaskMetadata(metadata) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {};
}

function extractPreferredModelFromMetadata(metadata) {
  const normalized = normalizeTaskMetadata(metadata);
  const openclawMeta = normalized.openclaw && typeof normalized.openclaw === 'object' && !Array.isArray(normalized.openclaw)
    ? normalized.openclaw
    : normalized;

  if (typeof openclawMeta.preferred_model === 'string' && openclawMeta.preferred_model.trim()) {
    return openclawMeta.preferred_model.trim();
  }
  if (typeof openclawMeta.model === 'string' && openclawMeta.model.trim()) {
    return openclawMeta.model.trim();
  }
  return null;
}

function summarizeAgentTaskRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    due_date: row.due_date,
    start_date: row.start_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
    project_id: row.project_id,
    project_name: row.project_name,
    parent_task_id: row.parent_task_id || null,
    execution_locked_by: row.execution_locked_by || null,
    recurrence_rule: row.recurrence_rule || null,
    preferred_model: extractPreferredModelFromMetadata(row.metadata)
  };
}

class AsanaStorage {
  constructor(config = {}) {
    this.pool = new Pool({
      host: config.host || 'localhost',
      port: config.port || 5432,
      database: config.database || 'openclaw_dashboard',
      user: config.user || 'openclaw',
      password: config.password || 'openclaw_password',
      max: config.max || 10,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
    });

    // Test connection on init
    this.connected = false;
  }

  /**
   * Sanitize data before writing to storage to prevent secrets leakage.
   * @param {any} data - The data to sanitize
   * @param {string} context - Operation name for logging (e.g., 'task.create')
   * @returns {any} Sanitized copy of the data
   */
  sanitizeData(data, context) {
    return security.safeWrite(data, context);
  }

  /**
   * Initialize storage: test connection and ensure default workflow
   */
  async init() {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      this.connected = true;
      console.log('✅ Connected to PostgreSQL database');

      // Ensure default workflow exists
      await this.ensureDefaultWorkflow();
    } catch (err) {
      console.error(`❌ Failed to connect to PostgreSQL: ${err.message}`);
      throw err;
    }
  }

  /**
   * Ensure default workflow exists
   */
  async ensureDefaultWorkflow() {
    // Check if default exists
    const checkResult = await this.pool.query(
      'SELECT id FROM workflows WHERE is_default = true LIMIT 1'
    );
    if (checkResult.rows.length === 0) {
      // No default exists, create one
      const query = `
        INSERT INTO workflows (name, states, is_default)
        VALUES ($1, $2, true)
      `;
      await this.pool.query(query, ['Default Workflow', DEFAULT_WORKFLOW_STATES]);
      console.log('✅ Created default workflow');
    }
  }

  getDefaultWorkflow() {
    return {
      id: null, // Will be fetched from DB when needed
      name: 'Default Workflow',
      states: [...DEFAULT_WORKFLOW_STATES],
      is_default: true
    };
  }

  /**
   * Transform raw DB task row to client-compatible shape.
   * - Maps `title` to `text`
   * - Maps first label to `category` (string)
   */
  transformTask(row) {
    return {
      ...row,
      text: row.title,
      category: Array.isArray(row.labels) && row.labels.length > 0 ? row.labels[0] : ''
    };
  }

  // ============================================
  // PROJECTS
  // ============================================

  async createProject(projectData) {
    // Sanitize input to prevent secrets leakage
    const cleanData = this.sanitizeData(projectData, 'project.create');

    // Get default workflow ID
    const wfResult = await this.pool.query(
      'SELECT id FROM workflows WHERE is_default = true LIMIT 1'
    );
    const defaultWorkflowId = wfResult.rows[0]?.id;

    // Determine workspace_id (vNext)
    let workspaceId = cleanData.workspace_id;
    if (!workspaceId) {
      try {
        const wsResult = await this.pool.query(
          'SELECT id FROM workspaces WHERE slug = $1 LIMIT 1',
          ['default']
        );
        workspaceId = wsResult.rows[0]?.id || null;
      } catch (err) {
        console.warn('[AsanaStorage] Could not fetch default workspace for project create:', err.message);
        workspaceId = null;
      }
    }

    const now = new Date().toISOString();
    const query = `
      INSERT INTO projects (
        name, description, status, tags, default_workflow_id, metadata,
        qmd_project_namespace, workspace_id, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      RETURNING *
    `;

    const values = [
      cleanData.name,
      cleanData.description || '',
      cleanData.status || 'active',
      cleanData.tags || [],
      defaultWorkflowId,
      cleanData.metadata || {},
      cleanData.qmd_project_namespace || `asana-tasks-${cleanData.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
      workspaceId,
      now
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  async getProject(id) {
    const result = await this.pool.query(
      'SELECT * FROM projects WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      throw new Error(`Project not found: ${id}`);
    }
    return result.rows[0];
  }

  async updateProject(id, updates) {
    // Sanitize input to prevent secrets leakage
    const cleanUpdates = this.sanitizeData(updates, 'project.update');

    const allowedFields = ['name', 'description', 'status', 'tags', 'metadata', 'qmd_project_namespace', 'workspace_id'];
    const setClause = [];
    const values = [];
    let idx = 1;

    // Build SET clause dynamically
    for (const field of allowedFields) {
      if (cleanUpdates[field] !== undefined) {
        setClause.push(`${field} = $${idx}`);
        values.push(cleanUpdates[field]);
        idx++;
      }
    }

    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }

    // Add updated_at
    setClause.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE projects
      SET ${setClause.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `;

    const result = await this.pool.query(query, values);
    if (result.rows.length === 0) {
      throw new Error(`Project not found: ${id}`);
    }

    return result.rows[0];
  }

  async archiveProject(id) {
    return this.updateProject(id, { status: 'archived' });
  }

  isTruthyFlag(value) {
    return value === true || value === 'true' || value === '1' || value === 1;
  }

  normalizePositiveInt(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
  }

  isFixtureProject(project) {
    const metadata = project?.metadata || {};
    if (metadata.is_fixture === true || metadata.fixture === true || metadata.is_test === true) {
      return true;
    }

    const name = String(project?.name || '').trim();
    const description = String(project?.description || '').trim();
    return FIXTURE_PROJECT_PATTERNS.some((pattern) => pattern.test(name) || pattern.test(description));
  }

  getProjectMetadata(project) {
    const metadata = project?.metadata;
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      return metadata;
    }
    return {};
  }

  getProjectParentId(project) {
    const parentId = this.getProjectMetadata(project).parent_project_id;
    if (typeof parentId !== 'string') return null;
    const clean = parentId.trim();
    return clean || null;
  }

  getProjectSortOrder(project) {
    const sortOrder = Number.parseInt(this.getProjectMetadata(project).sort_order, 10);
    return Number.isFinite(sortOrder) ? sortOrder : Number.MAX_SAFE_INTEGER;
  }

  getProjectActivityTimestamp(project) {
    const candidate = project?.rollup_last_task_updated_at || project?.last_task_updated_at || project?.updated_at || null;
    const timestamp = candidate ? new Date(candidate).getTime() : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  compareProjectOrdering(left, right) {
    const leftOrder = this.getProjectSortOrder(left);
    const rightOrder = this.getProjectSortOrder(right);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    const leftHasTasks = Number(left?.rollup_task_count ?? left?.task_count ?? 0) > 0;
    const rightHasTasks = Number(right?.rollup_task_count ?? right?.task_count ?? 0) > 0;
    if (leftHasTasks !== rightHasTasks) return leftHasTasks ? -1 : 1;

    const activityDelta = this.getProjectActivityTimestamp(right) - this.getProjectActivityTimestamp(left);
    if (activityDelta !== 0) return activityDelta;

    return String(left?.name || '').localeCompare(String(right?.name || ''), undefined, {
      sensitivity: 'base'
    });
  }

  buildProjectHierarchy(items = []) {
    const normalized = items.map((project) => ({
      ...project,
      metadata: this.getProjectMetadata(project)
    }));
    const projectById = new Map(normalized.map((project) => [project.id, project]));
    const childrenMap = new Map();

    normalized.forEach((project) => {
      const parentId = this.getProjectParentId(project);
      if (!parentId || parentId === project.id || !projectById.has(parentId)) {
        return;
      }
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId).push(project);
    });

    const computed = new Set();

    const computeProject = (project, ancestors = [], visiting = new Set()) => {
      if (computed.has(project.id)) {
        return project;
      }
      if (visiting.has(project.id)) {
        project.parent_project_id = null;
        project.parent_project_name = null;
        project.depth = 0;
        project.project_path_ids = [project.id];
        project.project_path_names = [project.name];
        project.project_path = project.name;
        project.child_project_ids = [];
        project.child_count = 0;
        project.descendant_count = 0;
        project.rollup_task_count = Number(project.task_count || 0);
        project.rollup_active_task_count = Number(project.active_task_count || 0);
        project.rollup_blocked_count = Number(project.blocked_count || 0);
        project.rollup_in_progress_count = Number(project.in_progress_count || 0);
        project.rollup_completed_count = Number(project.completed_count || 0);
        project.rollup_overdue_count = Number(project.overdue_count || 0);
        project.rollup_last_task_updated_at = project.last_task_updated_at || project.updated_at || null;
        project.is_folder = false;
        project.project_kind = project.metadata.project_kind || 'project';
        project._childProjects = [];
        computed.add(project.id);
        return project;
      }

      const nextVisiting = new Set(visiting);
      nextVisiting.add(project.id);

      const children = [...(childrenMap.get(project.id) || [])].sort((left, right) =>
        this.compareProjectOrdering(left, right)
      );

      const pathIds = [...ancestors.map((item) => item.id), project.id];
      const pathNames = [...ancestors.map((item) => item.name), project.name];
      const parentProject = ancestors.at(-1) || null;

      project.parent_project_id = parentProject?.id || null;
      project.parent_project_name = parentProject?.name || null;
      project.depth = ancestors.length;
      project.project_path_ids = pathIds;
      project.project_path_names = pathNames;
      project.project_path = pathNames.join(' / ');
      project.child_project_ids = children.map((child) => child.id);
      project.child_count = children.length;

      let descendantCount = 0;
      let rollupTaskCount = Number(project.task_count || 0);
      let rollupActiveTaskCount = Number(project.active_task_count || 0);
      let rollupBlockedCount = Number(project.blocked_count || 0);
      let rollupInProgressCount = Number(project.in_progress_count || 0);
      let rollupCompletedCount = Number(project.completed_count || 0);
      let rollupOverdueCount = Number(project.overdue_count || 0);
      let rollupLastUpdated = this.getProjectActivityTimestamp(project);

      children.forEach((child) => {
        computeProject(child, [...ancestors, project], nextVisiting);
        descendantCount += 1 + Number(child.descendant_count || 0);
        rollupTaskCount += Number(child.rollup_task_count || 0);
        rollupActiveTaskCount += Number(child.rollup_active_task_count || 0);
        rollupBlockedCount += Number(child.rollup_blocked_count || 0);
        rollupInProgressCount += Number(child.rollup_in_progress_count || 0);
        rollupCompletedCount += Number(child.rollup_completed_count || 0);
        rollupOverdueCount += Number(child.rollup_overdue_count || 0);
        rollupLastUpdated = Math.max(rollupLastUpdated, this.getProjectActivityTimestamp(child));
      });

      project.descendant_count = descendantCount;
      project.rollup_task_count = rollupTaskCount;
      project.rollup_active_task_count = rollupActiveTaskCount;
      project.rollup_blocked_count = rollupBlockedCount;
      project.rollup_in_progress_count = rollupInProgressCount;
      project.rollup_completed_count = rollupCompletedCount;
      project.rollup_overdue_count = rollupOverdueCount;
      project.rollup_last_task_updated_at = rollupLastUpdated > 0
        ? new Date(rollupLastUpdated).toISOString()
        : (project.last_task_updated_at || project.updated_at || null);
      project.is_folder = children.length > 0;
      project.project_kind = project.metadata.project_kind || (children.length > 0 ? 'folder' : 'project');
      project._childProjects = children;
      computed.add(project.id);

      return project;
    };

    const flattened = [];
    const visited = new Set();

    const flattenProject = (project) => {
      if (!project || visited.has(project.id)) return;
      visited.add(project.id);
      flattened.push(project);
      const children = Array.isArray(project._childProjects) ? project._childProjects : [];
      children.forEach((child) => flattenProject(child));
      delete project._childProjects;
    };

    const rootProjects = normalized
      .filter((project) => {
        const parentId = this.getProjectParentId(project);
        return !(parentId && parentId !== project.id && projectById.has(parentId));
      })
      .sort((left, right) => this.compareProjectOrdering(left, right));

    const computeAndMark = (project, ancestors = []) => {
      if (!project || computed.has(project.id)) return;
      computeProject(project, ancestors);
      computed.add(project.id);
      const children = Array.isArray(project._childProjects) ? project._childProjects : [];
      children.forEach((child) => computeAndMark(child, [...ancestors, project]));
    };

    rootProjects.forEach((project) => computeAndMark(project));
    normalized
      .filter((project) => !computed.has(project.id))
      .sort((left, right) => this.compareProjectOrdering(left, right))
      .forEach((project) => computeAndMark(project));

    rootProjects.forEach((project) => flattenProject(project));
    normalized
      .filter((project) => !visited.has(project.id))
      .sort((left, right) => this.compareProjectOrdering(left, right))
      .forEach((project) => flattenProject(project));

    return flattened;
  }

  async getProjectView(id) {
    const project = await this.getProject(id);
    const result = await this.getProjectQueryResult({
      status: project.status,
      include_test: true
    });
    return result.items.find((item) => item.id === id) || {
      ...project,
      metadata: this.getProjectMetadata(project),
      parent_project_id: this.getProjectParentId(project),
      parent_project_name: null,
      depth: 0,
      child_count: 0,
      descendant_count: 0,
      project_path_ids: [project.id],
      project_path_names: [project.name],
      project_path: project.name,
      is_folder: false,
      project_kind: this.getProjectMetadata(project).project_kind || 'project'
    };
  }

  async getProjectRollupContext(projectId) {
    const project = await this.getProject(projectId);
    const values = [];
    let query = 'SELECT id, name, description, status, default_workflow_id, created_at, updated_at, metadata FROM projects';

    if (project.status) {
      query += ' WHERE status = $1';
      values.push(project.status);
    }

    const result = await this.pool.query(query, values);
    const hierarchy = this.buildProjectHierarchy(result.rows);
    const projectMap = new Map(hierarchy.map((item) => [item.id, item]));
    const selectedProject = projectMap.get(projectId) || {
      ...project,
      metadata: this.getProjectMetadata(project),
      parent_project_id: this.getProjectParentId(project),
      parent_project_name: null,
      depth: 0,
      child_count: 0,
      descendant_count: 0,
      project_path_ids: [project.id],
      project_path_names: [project.name],
      project_path: project.name,
      is_folder: false,
      project_kind: this.getProjectMetadata(project).project_kind || 'project'
    };

    const descendantIds = [];
    const queue = [projectId];
    const seen = new Set();

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId || seen.has(currentId)) continue;
      seen.add(currentId);
      descendantIds.push(currentId);
      const currentProject = projectMap.get(currentId);
      const childIds = Array.isArray(currentProject?.child_project_ids) ? currentProject.child_project_ids : [];
      childIds.forEach((childId) => {
        if (!seen.has(childId)) {
          queue.push(childId);
        }
      });
    }

    return {
      selectedProject,
      descendantIds,
      projectMap
    };
  }

  async getProjectQueryResult(filters = {}) {
    let query = `
      SELECT
        p.*,
        COALESCE(task_summary.task_count, 0)::int AS task_count,
        COALESCE(task_summary.active_task_count, 0)::int AS active_task_count,
        COALESCE(task_summary.blocked_count, 0)::int AS blocked_count,
        COALESCE(task_summary.in_progress_count, 0)::int AS in_progress_count,
        COALESCE(task_summary.completed_count, 0)::int AS completed_count,
        COALESCE(task_summary.overdue_count, 0)::int AS overdue_count,
        task_summary.last_task_updated_at
      FROM projects p
      LEFT JOIN (
        SELECT
          project_id,
          COUNT(*) FILTER (WHERE deleted_at IS NULL) AS task_count,
          COUNT(*) FILTER (
            WHERE deleted_at IS NULL
              AND archived_at IS NULL
              AND status NOT IN ('completed', 'archived')
          ) AS active_task_count,
          COUNT(*) FILTER (
            WHERE deleted_at IS NULL
              AND archived_at IS NULL
              AND status = 'blocked'
          ) AS blocked_count,
          COUNT(*) FILTER (
            WHERE deleted_at IS NULL
              AND archived_at IS NULL
              AND status = 'in_progress'
          ) AS in_progress_count,
          COUNT(*) FILTER (
            WHERE deleted_at IS NULL
              AND archived_at IS NULL
              AND status = 'completed'
          ) AS completed_count,
          COUNT(*) FILTER (
            WHERE deleted_at IS NULL
              AND archived_at IS NULL
              AND due_date IS NOT NULL
              AND due_date < NOW()
              AND status <> 'completed'
          ) AS overdue_count,
          MAX(updated_at) FILTER (WHERE deleted_at IS NULL) AS last_task_updated_at
        FROM tasks
        GROUP BY project_id
      ) AS task_summary ON task_summary.project_id = p.id
      WHERE 1=1
    `;
    const values = [];
    let idx = 1;

    if (filters.status) {
      query += ` AND status = $${idx}`;
      values.push(filters.status);
      idx++;
    }

    if (filters.id) {
      query += ` AND p.id = $${idx}`;
      values.push(filters.id);
      idx++;
    }

    if (filters.search) {
      query += ` AND (p.name ILIKE $${idx} OR p.description ILIKE $${idx})`;
      values.push(`%${filters.search}%`);
      idx++;
    }

    query += `
      ORDER BY
        CASE WHEN COALESCE(task_summary.task_count, 0) > 0 THEN 0 ELSE 1 END,
        COALESCE(task_summary.last_task_updated_at, p.updated_at) DESC,
        p.updated_at DESC
    `;

    const result = await this.pool.query(query, values);
    let items = result.rows;

    if (!this.isTruthyFlag(filters.include_test)) {
      items = items.filter((project) => !this.isFixtureProject(project));
    }

    items = this.buildProjectHierarchy(items);

    const total = items.length;
    const offset = this.normalizePositiveInt(filters.offset, 0);
    const requestedLimit = this.normalizePositiveInt(filters.limit, 0);
    const limit = requestedLimit > 0 ? Math.min(requestedLimit, PROJECT_PAGE_LIMIT_MAX) : 0;
    if (limit > 0) {
      items = items.slice(offset, offset + limit);
    } else if (offset > 0) {
      items = items.slice(offset);
    }

    return {
      items,
      total,
      offset,
      limit
    };
  }

  async listProjects(filters = {}) {
    const result = await this.getProjectQueryResult(filters);
    return result.items;
  }

  async listProjectsPage(filters = {}) {
    return this.getProjectQueryResult(filters);
  }

  async getDefaultProject(filters = {}) {
    const preferred = await this.getProjectQueryResult({
      ...filters,
      status: filters.status || 'active',
      limit: 50,
      offset: 0
    });

    const activeLeaf = preferred.items.find((project) =>
      Number(project.child_count || 0) === 0 && Number(project.active_task_count || 0) > 0
    );
    if (activeLeaf) return activeLeaf;

    const withTasks = preferred.items.find((project) =>
      Number(project.child_count || 0) === 0 && Number(project.task_count || 0) > 0
    );
    if (withTasks) return withTasks;
    if (preferred.items.length > 0) return preferred.items[0];

    const fallback = await this.getProjectQueryResult({
      ...filters,
      status: filters.status || 'active',
      include_test: true,
      limit: 50,
      offset: 0
    });

    return fallback.items[0] || null;
  }

  // ============================================
  // TASKS
  // ============================================

  async createTask(taskData) {
    // Sanitize input to prevent secrets leakage
    taskData = this.sanitizeData(taskData, 'task.create');

    // Determine project_id: use provided or get default
    let projectId = taskData.project_id;
    if (!projectId) {
      // Get default project (first project by creation date)
      const defaultResult = await this.pool.query(
        'SELECT id FROM projects ORDER BY created_at ASC LIMIT 1'
      );
      if (defaultResult.rows.length === 0) {
        throw new Error('No projects exist. Create a project first.');
      }
      projectId = defaultResult.rows[0].id;
    } else {
      // Validate project exists
      const projectResult = await this.pool.query(
        'SELECT id FROM projects WHERE id = $1',
        [projectId]
      );
      if (projectResult.rows.length === 0) {
        throw new Error(`Project not found: ${projectId}`);
      }
    }

    // Get project's workspace_id for the task (vNext)
    let workspaceId = taskData.workspace_id;
    if (!workspaceId) {
      const projectFull = await this.pool.query(
        'SELECT workspace_id FROM projects WHERE id = $1',
        [projectId]
      );
      if (projectFull.rows[0]?.workspace_id) {
        workspaceId = projectFull.rows[0].workspace_id;
      } else {
        // Fallback: try to get default workspace (vNext), but don't fail if permission denied
        try {
          const wsResult = await this.pool.query(
            'SELECT id FROM workspaces WHERE slug = $1 LIMIT 1',
            ['default']
          );
          workspaceId = wsResult.rows[0]?.id || null;
        } catch (err) {
          // Permission denied or table doesn't exist - workspace_id remains null
          console.warn('[AsanaStorage] Could not fetch default workspace (permission? existence?):', err.message);
          workspaceId = null;
        }
      }
    }

    // Validate parent if provided
    if (taskData.parent_task_id) {
      const parentResult = await this.pool.query(
        'SELECT id, project_id FROM tasks WHERE id = $1',
        [taskData.parent_task_id]
      );
      if (parentResult.rows.length === 0) {
        throw new Error(`Parent task not found: ${taskData.parent_task_id}`);
      }
      if (parentResult.rows[0].project_id !== projectId) {
        throw new Error('Parent task must be in the same project');
      }
    }

    // Check for circular reference before inserting
    if (taskData.parent_task_id) {
      const wouldCreateCircular = await this.wouldCreateCircular(
        taskData.parent_task_id,
        taskData.id || null // If creating new, no ID yet, can't be in its own subtree
      );
      if (wouldCreateCircular) {
        throw new Error('Circular subtask relationship detected');
      }
    }

    const now = new Date().toISOString();

    // Build dynamic INSERT based on available columns (graceful degradation)
    const columns = [
      'id', 'project_id', 'workspace_id', 'title', 'description', 'status', 'priority', 'owner',
      'due_date', 'start_date', 'estimated_effort', 'parent_task_id',
      'dependency_ids', 'labels', 'created_at', 'updated_at', 'recurrence_rule', 'metadata'
    ];

    const values = [
      taskData.id || null, // will be generated as uuid if null
      projectId,
      workspaceId,
      taskData.title,
      taskData.description || '',
      taskData.status || 'backlog',
      taskData.priority || 'medium',
      taskData.owner || null,
      taskData.due_date || null,
      taskData.start_date || null,
      taskData.estimated_effort || null,
      taskData.parent_task_id || null,
      // Omit empty arrays to rely on DEFAULT '{}'; also omit undefined
      taskData.dependency_ids?.length ? taskData.dependency_ids : undefined,
      taskData.labels?.length ? taskData.labels : undefined,
      now, // created_at
      now, // updated_at
      taskData.recurrence_rule || null,
      taskData.metadata || {}
    ];

    // Check if vNext columns exist in the tasks table, add them if present and explicitly provided
    const vnextColumns = [
      'retry_count',
      'max_retries',
      'blockers',
      'qmd_namespace',
      'knowledge_artifacts',
      'history',
      'custom_fields'
    ];

    for (const colName of vnextColumns) {
      try {
        // Quick check: does column exist?
        const colCheck = await this.pool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = $1",
          [colName]
        );
        if (colCheck.rows.length > 0 && taskData[colName] !== undefined) {
          columns.push(colName);
          values.push(taskData[colName]);
        }
      } catch (err) {
        // Column doesn't exist or query failed - skip gracefully
        this.logger?.info(`Column ${colName} not found, skipping in INSERT`);
      }
    }

    // Note: execution_lock and execution_locked_by already exist in original schema
    if (taskData.execution_lock !== undefined) {
      columns.push('execution_lock');
      values.push(taskData.execution_lock);
    }
    if (taskData.execution_locked_by !== undefined) {
      columns.push('execution_locked_by');
      values.push(taskData.execution_locked_by);
    }

    // Filter out columns with undefined values or empty arrays (use DB defaults)
    const filteredEntries = [];
    for (let i = 0; i < columns.length; i++) {
      const val = values[i];
      if (val === undefined) continue;
      // Skip empty arrays (including [] and '[]' strings) to rely on DB DEFAULT '{}'
      if (Array.isArray(val) && val.length === 0) continue;
      if (typeof val === 'string' && val === '[]') continue;
      filteredEntries.push({ col: columns[i], val });
    }
    let finalColumns = filteredEntries.map(e => e.col);
    let finalValues = filteredEntries.map(e => e.val);

    // Generate UUID for id if not provided (null or undefined)
    finalValues = finalValues.map((val, idx) => {
      if (finalColumns[idx] === 'id' && (val === null || val === undefined)) {
        return crypto.randomUUID();
      }
      return val;
    });

    const finalPlaceholders = finalValues.map((_, i) => `$${i + 1}`).join(', ');

    const query = `
      INSERT INTO tasks (${finalColumns.join(', ')})
      VALUES (${finalPlaceholders})
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, finalValues);
      const task = result.rows[0];
      this.audit(task.id, 'system', 'create', null, task);
      return task;
    } catch (err) {
      // Check for constraint violations
      if (err.code === '23514') { // check_violation
        throw new Error(`Constraint violation: ${err.detail}`);
      }
      throw err;
    }
  }

  async getTask(id, options = {}) {
    const result = await this.pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      throw new Error(`Task not found: ${id}`);
    }

    const task = result.rows[0];

    // Respect soft-delete and archival filters
    if (task.deleted_at !== null && !options.include_deleted) {
      throw new Error(`Task not found: ${id}`);
    }
    if (task.archived_at !== null && !options.include_archived) {
      throw new Error(`Task not found: ${id}`);
    }

    if (options.includeGraph) {
      // Include subtasks recursively
      task.subtasks = await this.getSubtasksRecursive(id);
      // Include dependency details
      task.dependencies = await this.getDependenciesWithDetails(id);
    }

    // Transform to client-compatible shape
    const transformed = this.transformTask(task);
    if (options.includeGraph) {
      // Transform subtasks if present
      if (transformed.subtasks && Array.isArray(transformed.subtasks)) {
        transformed.subtasks = transformed.subtasks.map(sub => this.transformTask(sub));
      }
      // Transform dependencies if present (they are task objects)
      if (transformed.dependencies && Array.isArray(transformed.dependencies)) {
        transformed.dependencies = transformed.dependencies.map(dep => this.transformTask(dep));
      }
    }
    return transformed;
  }

  async getSubtasksRecursive(parentId) {
    const result = await this.pool.query(
      'SELECT * FROM tasks WHERE parent_task_id = $1 ORDER BY created_at',
      [parentId]
    );

    const subtasks = result.rows;
    const tasks = [];

    for (const subtask of subtasks) {
      const node = { ...subtask };
      node.subtasks = await this.getSubtasksRecursive(subtask.id);
      tasks.push(node);
    }

    return tasks;
  }

  async updateTask(id, updates) {
    // Sanitize input to prevent secrets leakage
    updates = this.sanitizeData(updates, 'task.update');

    const allowedFields = [
      'title', 'description', 'status', 'priority', 'owner',
      'due_date', 'start_date', 'estimated_effort', 'actual_effort',
      'labels', 'metadata', 'parent_task_id',
      // vNext fields
      'retry_count', 'max_retries', 'last_error', 'blockers',
      'qmd_namespace', 'knowledge_artifacts', 'custom_fields',
      'execution_lock', 'execution_locked_by'
      // 'history' is handled separately below for JSONB concatenation
    ];
    const setClause = [];
    const values = [];
    let idx = 1;

    // Build SET clause dynamically
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        // Skip workspace_id - it's derived from project, not directly updatable
        if (field === 'workspace_id') continue;
        setClause.push(`${field} = $${idx}`);
        values.push(updates[field]);
        idx++;
      }
    }

    if (setClause.length === 0) {
      const received = Object.keys(updates).filter(k => updates[k] !== undefined).join(', ');
      throw new Error(`No valid fields to update. Received fields: ${received || 'none'}`);
    }

    // Get current task for audit and circular check
    const currentResult = await this.pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [id]
    );
    if (currentResult.rows.length === 0) {
      throw new Error(`Task not found: ${id}`);
    }
    const currentTask = currentResult.rows[0];

    // Check for circular reference if changing parent
    if (updates.parent_task_id !== undefined && updates.parent_task_id !== currentTask.parent_task_id) {
      if (updates.parent_task_id) {
        const wouldCreateCircular = await this.wouldCreateCircular(
          updates.parent_task_id,
          id
        );
        if (wouldCreateCircular) {
          throw new Error('Circular subtask relationship detected');
        }
      }
    }

    // Add updated_at
    setClause.push(`updated_at = NOW()`);

    // Handle completed_at if status changes to completed/archived
    if (updates.status && ['completed', 'archived'].includes(updates.status) && !currentTask.completed_at) {
      setClause.push(`completed_at = NOW()`);
    }

    // Append history if provided (JSONB array concatenation)
    if (updates.history && Array.isArray(updates.history)) {
      // Use JSONB concatenation; ensure the parameter is JSON stringified
      setClause.push(`history = COALESCE(history, '[]') || $${idx}::jsonb`);
      values.push(JSON.stringify(updates.history));
      idx++;
    }

    values.push(id);

    const query = `
      UPDATE tasks
      SET ${setClause.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `;

    const result = await this.pool.query(query, values);
    const updatedTask = result.rows[0];

    this.audit(id, 'system', 'update', currentTask, updatedTask);
    return updatedTask;
  }

  async deleteTask(id) {
    // Get task to check for subtasks
    const subtaskResult = await this.pool.query(
      'SELECT COUNT(*) FROM tasks WHERE parent_task_id = $1',
      [id]
    );
    const subtaskCount = parseInt(subtaskResult.rows[0].count);

    if (subtaskCount > 0) {
      throw new Error(`Cannot delete task with ${subtaskCount} subtasks. Delete subtasks first.`);
    }

    // Get task for audit
    const taskResult = await this.pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [id]
    );
    if (taskResult.rows.length === 0) {
      throw new Error(`Task not found: ${id}`);
    }
    const task = taskResult.rows[0];

    // Soft delete: set deleted_at, clear archived_at
    const result = await this.pool.query(
      'UPDATE tasks SET deleted_at = NOW(), archived_at = NULL WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      throw new Error(`Task not found: ${id}`);
    }

    this.audit(id, 'system', 'delete', task, null);
    return { deleted: true, id };
  }

  async archiveTask(id) {
    // Get task to ensure exists and not already deleted
    const taskResult = await this.pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [id]
    );
    if (taskResult.rows.length === 0) {
      throw new Error(`Task not found: ${id}`);
    }
    const task = taskResult.rows[0];

    if (task.deleted_at !== null) {
      throw new Error(`Cannot archive a deleted task`);
    }

    // Archive: set archived_at to now (if not already)
    const result = await this.pool.query(
      'UPDATE tasks SET archived_at = NOW() WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      throw new Error(`Task not found: ${id}`);
    }

    this.audit(id, 'system', 'archive', task, result.rows[0]);
    return { archived: true, task: result.rows[0] };
  }

  async restoreTask(id) {
    // Get task
    const taskResult = await this.pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [id]
    );
    if (taskResult.rows.length === 0) {
      throw new Error(`Task not found: ${id}`);
    }
    const task = taskResult.rows[0];

    // Restore: clear both archived_at and deleted_at
    const result = await this.pool.query(
      'UPDATE tasks SET archived_at = NULL, deleted_at = NULL WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      throw new Error(`Task not found: ${id}`);
    }

    this.audit(id, 'system', 'restore', task, result.rows[0]);
    return { restored: true, task: result.rows[0] };
  }

  async moveTask(id, newStatus) {
    return this.updateTask(id, { status: newStatus });
  }

  async listTasks(projectId, options = {}) {
    const rollupContext = options.include_child_projects
      ? await this.getProjectRollupContext(projectId)
      : null;
    const projectIds = rollupContext?.descendantIds?.length ? rollupContext.descendantIds : [projectId];
    const projectPathLookup = rollupContext
      ? new Map(Array.from(rollupContext.projectMap.entries()).map(([id, project]) => [id, project.project_path || project.name]))
      : new Map();

    let query = `
      SELECT t.*, p.name AS project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE ${projectIds.length > 1 ? 't.project_id = ANY($1::uuid[])' : 't.project_id = $1'}
    `;
    const values = [projectIds.length > 1 ? projectIds : projectId];
    let idx = 2;

    // Filter out deleted tasks by default (soft-delete)
    if (!options.include_deleted) {
      query += ` AND deleted_at IS NULL`;
    }
    // Filter out archived tasks by default
    if (!options.include_archived) {
      query += ` AND archived_at IS NULL`;
    }

    if (options.status) {
      query += ` AND status = $${idx}`;
      values.push(options.status);
      idx++;
    }

    if (options.owner) {
      query += ` AND owner = $${idx}`;
      values.push(options.owner);
      idx++;
    }

    if (options.parent_task_id !== undefined) {
      if (options.parent_task_id === null) {
        query += ` AND parent_task_id IS NULL`;
      } else {
        query += ` AND parent_task_id = $${idx}`;
        values.push(options.parent_task_id);
        idx++;
      }
    }

    // Filter by updated_since for incremental sync
    if (options.updated_since) {
      // Accept Date object or ISO string
      const since = options.updated_since instanceof Date ? options.updated_since.toISOString() : options.updated_since;
      query += ` AND updated_at > $${idx}`;
      values.push(since);
      idx++;
    }

    // Sorting
    // Sort by priority (custom order), then created_at
    query += ' ORDER BY array_position(ARRAY[\'critical\',\'high\',\'medium\',\'low\'], priority), created_at';

    // If depth requested, return hierarchical
    if (options.depth !== undefined && options.depth > 0) {
      // Fetch all tasks for project matching filters
      const allResult = await this.pool.query(query, values);
      const allTasks = allResult.rows.map((task) => ({
        ...task,
        project_path: projectPathLookup.get(task.project_id) || task.project_name || null
      }));

      // Build tree
      const buildTree = (parentId, currentDepth) => {
        if (currentDepth > options.depth) return [];
        const children = allTasks.filter(t => t.parent_task_id === parentId);
        return children.map(child => {
          const node = this.transformTask(child);
          node.subtasks = buildTree(child.id, currentDepth + 1);
          return node;
        });
      };

      return buildTree(null, 0);
    }

    const result = await this.pool.query(query, values);
    return result.rows.map((task) => this.transformTask({
      ...task,
      project_path: projectPathLookup.get(task.project_id) || task.project_name || null,
      project_rollup: Boolean(rollupContext) && task.project_id !== projectId
    }));
  }

  // ============================================
  // DEPENDENCIES
  // ============================================

  async hasDependencyPath(fromId, toId) {
    // Fetch all tasks to build adjacency map
    const allResult = await this.pool.query('SELECT id, dependency_ids FROM tasks');
    const depsMap = {};
    allResult.rows.forEach(t => {
      depsMap[t.id] = t.dependency_ids || [];
    });
    // DFS from fromId to find toId
    const visited = new Set();
    const stack = [fromId];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === toId) return true;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const curDeps = depsMap[cur] || [];
      for (const dep of curDeps) {
        if (!visited.has(dep)) stack.push(dep);
      }
    }
    return false;
  }

  async addDependency(taskId, dependencyId) {
    // Verify both tasks exist
    const [taskRes, depRes] = await Promise.all([
      this.pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]),
      this.pool.query('SELECT * FROM tasks WHERE id = $1', [dependencyId])
    ]);

    if (taskRes.rows.length === 0) throw new Error(`Task not found: ${taskId}`);
    if (depRes.rows.length === 0) throw new Error(`Dependency not found: ${dependencyId}`);

    const task = taskRes.rows[0];
    // Check for circular dependency
    const wouldCycle = await this.hasDependencyPath(dependencyId, taskId);
    if (wouldCycle) {
      throw new Error('Adding this dependency would create a circular dependency');
    }
    if (!task.dependency_ids.includes(dependencyId)) {
      const newDeps = [...task.dependency_ids, dependencyId];
      await this.pool.query(
        'UPDATE tasks SET dependency_ids = $1, updated_at = NOW() WHERE id = $2',
        [newDeps, taskId]
      );
    }

    this.audit(taskId, 'system', 'dependency_add', null, { dependency_id: dependencyId });
    return { task_id: taskId, dependencies: newDeps || task.dependency_ids };
  }

  async removeDependency(taskId, dependencyId) {
    const taskRes = await this.pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [taskId]
    );

    if (taskRes.rows.length === 0) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const task = taskRes.rows[0];
    const newDeps = task.dependency_ids.filter(id => id !== dependencyId);

    await this.pool.query(
      'UPDATE tasks SET dependency_ids = $1, updated_at = NOW() WHERE id = $2',
      [newDeps, taskId]
    );

    this.audit(taskId, 'system', 'dependency_remove', { dependency_id: dependencyId }, null);
    return { task_id: taskId, dependencies: newDeps };
  }

  async getDependencies(taskId) {
    const task = await this.getTask(taskId);
    const deps = [];

    for (const depId of task.dependency_ids) {
      const dep = await this.getTask(depId).catch(() => null);
      if (dep) deps.push(dep);
    }

    return deps;
  }

  async getDependenciesWithDetails(taskId) {
    const task = await this.getTask(taskId);
    const deps = [];

    for (const depId of task.dependency_ids) {
      const depRes = await this.pool.query(
        'SELECT id, title, status, priority, completed_at FROM tasks WHERE id = $1',
        [depId]
      );
      if (depRes.rows.length > 0) {
        deps.push(depRes.rows[0]);
      }
    }

    return deps;
  }

  // ============================================
  // SUBTASKS
  // ============================================

  async addSubtask(parentId, taskId) {
    // Verify both tasks exist and are in same project
    const [parentRes, childRes] = await Promise.all([
      this.pool.query('SELECT * FROM tasks WHERE id = $1', [parentId]),
      this.pool.query('SELECT * FROM tasks WHERE id = $1', [taskId])
    ]);

    if (parentRes.rows.length === 0) throw new Error(`Parent task not found: ${parentId}`);
    if (childRes.rows.length === 0) throw new Error(`Task not found: ${taskId}`);

    const parent = parentRes.rows[0];
    const child = childRes.rows[0];

    if (child.project_id !== parent.project_id) {
      throw new Error('Parent and child must be in the same project');
    }

    // Check for circular reference
    if (await this.wouldCreateCircular(parentId, taskId)) {
      throw new Error('Circular subtask relationship detected');
    }

    await this.pool.query(
      'UPDATE tasks SET parent_task_id = $1, updated_at = NOW() WHERE id = $2',
      [parentId, taskId]
    );

    this.audit(parentId, 'system', 'subtask_add', null, { subtask_id: taskId });
    return { parent_id: parentId, subtask_id: taskId };
  }

  async wouldCreateCircular(parentId, childId) {
    // If childId is null (new task), there's no circular reference yet
    if (!childId) return false;

    // Check if parentId is already an ancestor of childId
    let current = await this.getTask(childId).catch(() => null);
    const visited = new Set();

    while (current && current.parent_task_id) {
      if (current.parent_task_id === parentId) return true;
      if (visited.has(current.parent_task_id)) break;
      visited.add(current.parent_task_id);
      current = await this.getTask(current.parent_task_id).catch(() => null);
    }

    // Also check if childId is a descendant of parentId (we're moving/adding)
    const checkDown = async (taskId) => {
      const descendants = await this.pool.query(
        'SELECT id FROM tasks WHERE parent_task_id = $1',
        [taskId]
      );
      for (const desc of descendants.rows) {
        if (desc.id === childId) return true;
        const found = await checkDown(desc.id);
        if (found) return true;
      }
      return false;
    };

    if (await checkDown(parentId)) return true;

    return false;
  }

  async getSubtasks(parentId) {
    const result = await this.pool.query(
      'SELECT * FROM tasks WHERE parent_task_id = $1',
      [parentId]
    );
    return result.rows;
  }

  // ============================================
  // VIEWS
  // ============================================

  async getBoardView(projectId, options = {}) {
    const rollupContext = options.include_child_projects
      ? await this.getProjectRollupContext(projectId)
      : null;
    const project = rollupContext?.selectedProject || await this.getProject(projectId);
    const workflow = await this.pool.query(
      'SELECT * FROM workflows WHERE id = $1',
      [project.default_workflow_id]
    );

    const workflowStates = workflow.rows[0]?.states || DEFAULT_WORKFLOW_STATES;

    const projectIds = rollupContext?.descendantIds?.length ? rollupContext.descendantIds : [projectId];
    const tasksQuery = `
      SELECT t.*, p.name AS project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE ${projectIds.length > 1 ? 't.project_id = ANY($1::uuid[])' : 't.project_id = $1'}
        AND t.archived_at IS NULL
        AND t.deleted_at IS NULL
    `;
    const tasksResult = await this.pool.query(tasksQuery, [projectIds.length > 1 ? projectIds : projectId]);

    const tasks = tasksResult.rows;

    const columns = {};
    for (const state of workflowStates) {
      columns[state] = tasks.filter(t => t.status === state);
    }

    return {
      project: {
        id: project.id,
        name: project.name,
        project_path: project.project_path || project.name,
        aggregated: Boolean(rollupContext) && projectIds.length > 1,
        child_count: Number(project.child_count || 0)
      },
      workflow: workflowStates,
      columns
    };
  }

  async getTimelineView(projectId, startDate, endDate, options = {}) {
    const rollupContext = options.include_child_projects
      ? await this.getProjectRollupContext(projectId)
      : null;
    const project = rollupContext?.selectedProject || await this.getProject(projectId);
    const workflow = await this.pool.query(
      'SELECT * FROM workflows WHERE id = $1',
      [project.default_workflow_id]
    );
    const workflowStates = workflow.rows[0]?.states || DEFAULT_WORKFLOW_STATES;

    const projectIds = rollupContext?.descendantIds?.length ? rollupContext.descendantIds : [projectId];
    const tasksQuery = `
      SELECT t.*, p.name AS project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE ${projectIds.length > 1 ? 't.project_id = ANY($1::uuid[])' : 't.project_id = $1'}
        AND t.archived_at IS NULL
        AND t.deleted_at IS NULL
    `;
    const tasksResult = await this.pool.query(tasksQuery, [projectIds.length > 1 ? projectIds : projectId]);

    const parseDate = (value) => {
      if (!value) return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed;
    };

    const toIso = (date) => (date ? date.toISOString() : null);

    const now = new Date();
    const windowStart = parseDate(startDate) || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const windowEnd = parseDate(endDate) || new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const items = [];
    const unscheduled = [];

    for (const t of tasksResult.rows) {
      const start = parseDate(t.start_date);
      const due = parseDate(t.due_date);
      const dependencies = Array.isArray(t.dependency_ids) ? t.dependency_ids : [];
      const base = {
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        owner: t.owner,
        start_date: toIso(start),
        due_date: toIso(due),
        dependencies,
        labels: t.labels || [],
        qmd_namespace: t.qmd_namespace || null,
        project_id: t.project_id,
        completed_at: toIso(t.completed_at)
      };

      if (!start && !due) {
        unscheduled.push(base);
        continue;
      }

      const rangeStart = start || due;
      const rangeEnd = due || start;
      const overlaps = rangeStart <= windowEnd && rangeEnd >= windowStart;
      if (!overlaps) continue;

      items.push(base);
    }

    return {
      project: {
        id: project.id,
        name: project.name,
        qmd_project_namespace: project.qmd_project_namespace,
        workspace_id: project.workspace_id
      },
      workflow: workflowStates,
      range: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString()
      },
      items,
      unscheduled
    };
  }

  async getAgentQueue(agentName, statuses = ['ready', 'in_progress'], options = {}) {
    const { page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await this.pool.query(
      `SELECT COUNT(*) as total FROM tasks
       WHERE owner = $1 AND status = ANY($2)`,
      [agentName, statuses]
    );
    const total = parseInt(countResult.rows[0].total);

    // Fetch paginated tasks with ordering
    const query = `
      SELECT * FROM tasks
      WHERE owner = $1 AND status = ANY($2)
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END,
        due_date ASC NULLS LAST,
        created_at ASC
      LIMIT $3 OFFSET $4
    `;

    const result = await this.pool.query(query, [agentName, statuses, limit, offset]);

    const tasks = result.rows.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      dueDate: t.due_date,
      startDate: t.start_date,
      project_id: t.project_id,
      lockedBy: t.execution_locked_by || null,
      lockedAt: t.execution_lock || null,
      retryCount: t.retry_count || 0
    }));

    // Fetch latest task run for each task in batch
    const taskIds = tasks.map(t => t.id);
    let lastRunsMap = {};
    if (taskIds.length > 0) {
      const runsResult = await this.pool.query(`
        SELECT DISTINCT ON (task_id) *
        FROM task_runs
        WHERE task_id = ANY($1)
        ORDER BY task_id, started_at DESC
      `, [taskIds]);
      runsResult.rows.forEach(run => {
        lastRunsMap[run.task_id] = {
          id: run.id,
          status: run.status,
          startedAt: run.started_at,
          completedAt: run.completed_at,
          errorSummary: run.error_summary,
          outputSummary: run.output_summary,
          agentName: run.agent_name,
          attemptNumber: run.attempt_number
        };
      });
    }

    // Attach lastRun to each task
    tasks.forEach(t => {
      t.lastRun = lastRunsMap[t.id] || null;
    });

    return {
      tasks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getAgentWorkspaceOverview(agentNames = [], options = {}) {
    const normalizedAgentNames = Array.from(new Set(
      (Array.isArray(agentNames) ? agentNames : [])
        .map((agentName) => (typeof agentName === 'string' ? agentName.trim() : ''))
        .filter(Boolean)
    ));

    if (normalizedAgentNames.length === 0) {
      return {};
    }

    const queueLimit = Math.min(Math.max(parseInt(options.queueLimit, 10) || 4, 1), 12);
    const queueStatuses = ['in_progress', 'ready', 'blocked', 'review', 'backlog'];
    const terminalStatuses = ['completed', 'archived'];
    const baseCounts = {
      total: 0,
      backlog: 0,
      ready: 0,
      in_progress: 0,
      blocked: 0,
      review: 0,
      completed: 0,
      archived: 0,
      overdue: 0
    };
    const overview = Object.fromEntries(normalizedAgentNames.map((agentName) => [
      agentName,
      {
        counts: { ...baseCounts },
        queue: [],
        currentTask: null,
        nextTask: null
      }
    ]));

    const countsResult = await this.pool.query(
      `
        SELECT owner, status, COUNT(*)::int AS count
        FROM tasks
        WHERE owner = ANY($1)
          AND deleted_at IS NULL
          AND archived_at IS NULL
        GROUP BY owner, status
      `,
      [normalizedAgentNames]
    );

    countsResult.rows.forEach((row) => {
      const snapshot = overview[row.owner];
      if (!snapshot) return;
      const statusKey = typeof row.status === 'string' ? row.status : '';
      const count = Number.parseInt(row.count, 10) || 0;
      snapshot.counts.total += count;
      if (Object.prototype.hasOwnProperty.call(snapshot.counts, statusKey)) {
        snapshot.counts[statusKey] += count;
      }
    });

    const overdueResult = await this.pool.query(
      `
        SELECT owner, COUNT(*)::int AS count
        FROM tasks
        WHERE owner = ANY($1)
          AND deleted_at IS NULL
          AND archived_at IS NULL
          AND due_date IS NOT NULL
          AND due_date < NOW()
          AND status <> ALL($2::text[])
        GROUP BY owner
      `,
      [normalizedAgentNames, terminalStatuses]
    );

    overdueResult.rows.forEach((row) => {
      const snapshot = overview[row.owner];
      if (!snapshot) return;
      snapshot.counts.overdue = Number.parseInt(row.count, 10) || 0;
    });

    const queueResult = await this.pool.query(
      `
        WITH ranked AS (
          SELECT
            t.*,
            p.name AS project_name,
            ROW_NUMBER() OVER (
              PARTITION BY t.owner
              ORDER BY
                CASE t.status
                  WHEN 'in_progress' THEN 0
                  WHEN 'ready' THEN 1
                  WHEN 'blocked' THEN 2
                  WHEN 'review' THEN 3
                  WHEN 'backlog' THEN 4
                  ELSE 5
                END,
                CASE t.priority
                  WHEN 'critical' THEN 0
                  WHEN 'high' THEN 1
                  WHEN 'medium' THEN 2
                  WHEN 'low' THEN 3
                  ELSE 4
                END,
                t.due_date ASC NULLS LAST,
                t.created_at ASC
            ) AS row_num
          FROM tasks t
          JOIN projects p ON p.id = t.project_id
          WHERE t.owner = ANY($1)
            AND t.deleted_at IS NULL
            AND t.archived_at IS NULL
            AND t.status = ANY($2::text[])
        )
        SELECT *
        FROM ranked
        WHERE row_num <= $3
        ORDER BY owner, row_num
      `,
      [normalizedAgentNames, queueStatuses, queueLimit]
    );

    queueResult.rows.forEach((row) => {
      const snapshot = overview[row.owner];
      if (!snapshot) return;
      const task = summarizeAgentTaskRow(row);
      snapshot.queue.push(task);
      if (!snapshot.currentTask && task.status === 'in_progress') {
        snapshot.currentTask = task;
      }
    });

    Object.values(overview).forEach((snapshot) => {
      if (!snapshot.currentTask) {
        snapshot.currentTask = snapshot.queue.find((task) => task.status === 'in_progress') || null;
      }
      snapshot.nextTask = snapshot.queue.find((task) => task.status !== 'in_progress') || null;
    });

    return overview;
  }

  // ============================================
  // LOCKING (for agent execution)
  // ============================================

  async claimTask(taskId, agentName, lockTimeoutMinutes = 15) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Get current task with lock
      const result = await client.query(
        'SELECT * FROM tasks WHERE id = $1 FOR UPDATE',
        [taskId]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error(`Task not found: ${taskId}`);
      }

      const task = result.rows[0];
      const now = new Date();
      const lockExpires = task.execution_lock ?
        new Date(task.execution_lock.getTime() + lockTimeoutMinutes * 60 * 1000) : null;

      if (task.execution_lock && lockExpires && now < lockExpires) {
        await client.query('ROLLBACK');
        throw new Error(`Task is locked by ${task.execution_locked_by} until ${lockExpires.toISOString()}`);
      }

      // Claim the task
      await client.query(
        'UPDATE tasks SET execution_lock = NOW(), execution_locked_by = $1, updated_at = NOW() WHERE id = $2',
        [agentName, taskId]
      );

      // Create a task run entry
      const attemptNumber = (task.retry_count || 0) + 1;
      await client.query(
        `INSERT INTO task_runs (task_id, agent_name, attempt_number, status, started_at)
         VALUES ($1, $2, $3, 'running', NOW())`,
        [taskId, agentName, attemptNumber]
      );

      await client.query('COMMIT');
      client.release();

      // Fetch updated task
      const updated = await this.getTask(taskId);
      this.audit(taskId, agentName, 'claim', null, { locked_by: agentName, locked_at: updated.execution_lock });
      return { claimed: true, task: updated };
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
  }

  async releaseTask(taskId) {
    const result = await this.pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [taskId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const task = result.rows[0];
    const oldLock = { locked_by: task.execution_locked_by, locked_at: task.execution_lock };

    await this.pool.query(
      'UPDATE tasks SET execution_lock = NULL, execution_locked_by = NULL, updated_at = NOW() WHERE id = $1',
      [taskId]
    );

    this.audit(taskId, 'system', 'release', oldLock, null);
    return { released: true };
  }

  async retryTask(taskId) {
    // Get task to ensure exists
    const result = await this.pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [taskId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const task = result.rows[0];

    // Reset for retry: clear lock, reset status to ready, increment retry count
    const newRetryCount = (task.retry_count || 0) + 1;
    await this.pool.query(
      `UPDATE tasks
       SET execution_lock = NULL, execution_locked_by = NULL,
           status = 'ready', retry_count = $1, updated_at = NOW()
       WHERE id = $2`,
      [newRetryCount, taskId]
    );

    this.audit(taskId, 'system', 'retry', { retry_count: task.retry_count }, { retry_count: newRetryCount });
    return { retried: true, retry_count: newRetryCount };
  }

  async isTaskLocked(taskId) {
    const result = await this.pool.query(
      'SELECT execution_lock, execution_locked_by FROM tasks WHERE id = $1',
      [taskId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const task = result.rows[0];

    if (!task.execution_lock) return false;

    const lock = new Date(task.execution_lock);
    const now = new Date();
    const lockAgeMinutes = (now - lock) / (60 * 1000);

    // Lock expired if older than 30 minutes
    if (lockAgeMinutes > 30) {
      await this.pool.query(
        'UPDATE tasks SET execution_lock = NULL, execution_locked_by = NULL, updated_at = NOW() WHERE id = $1',
        [taskId]
      );
      return false;
    }

    return {
      locked: true,
      locked_by: task.execution_locked_by,
      locked_at: task.execution_lock
    };
  }

  // ============================================
  // AGENT OBSERVABILITY
  // ============================================

  async recordAgentHeartbeat(agentName, status = 'online', metadata = {}) {
    const query = `
      INSERT INTO agent_heartbeats (agent_name, last_seen_at, status, metadata)
      VALUES ($1, NOW(), $2, $3)
      ON CONFLICT (agent_name) DO UPDATE SET
        last_seen_at = EXCLUDED.last_seen_at,
        status = EXCLUDED.status,
        metadata = EXCLUDED.metadata
    `;
    await this.pool.query(query, [agentName, status, metadata]);
  }

  async getAgentStatus(agentName) {
    const result = await this.pool.query(
      'SELECT * FROM agent_heartbeats WHERE agent_name = $1',
      [agentName]
    );
    return result.rows[0] || null;
  }

  async listAgentStatuses() {
    const result = await this.pool.query(
      'SELECT * FROM agent_heartbeats ORDER BY last_seen_at DESC'
    );
    return result.rows;
  }

  async createTaskRun(taskId, agentName, attemptNumber, status = 'running') {
    const query = `
      INSERT INTO task_runs (task_id, agent_name, attempt_number, status, started_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING *
    `;
    const result = await this.pool.query(query, [taskId, agentName, attemptNumber, status]);
    return result.rows[0];
  }

  async updateTaskRun(runId, updates) {
    const fields = [];
    const values = [];
    let idx = 1;

    if (updates.status !== undefined) {
      fields.push(`status = $${idx}`);
      values.push(updates.status);
      idx++;
      // If status is terminal, set completed_at
      if (updates.status === 'success' || updates.status === 'failure') {
        fields.push(`completed_at = NOW()`);
      }
    }
    if (updates.error_summary !== undefined) {
      fields.push(`error_summary = $${idx}`);
      values.push(updates.error_summary);
      idx++;
    }
    if (updates.output_summary !== undefined) {
      fields.push(`output_summary = $${idx}`);
      values.push(updates.output_summary);
      idx++;
    }

    if (fields.length === 0) {
      throw new Error('No updates provided');
    }

    values.push(runId);
    const query = `UPDATE task_runs SET ${fields.join(', ')} WHERE id = $${values.length}`;
    await this.pool.query(query, values);
  }

  async getTaskRuns(taskId, limit = 10) {
    const result = await this.pool.query(
      `SELECT * FROM task_runs
       WHERE task_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [taskId, limit]
    );
    return result.rows;
  }

  // ============================================
  // AUDIT LOG
  // ============================================

  async audit(taskId, actor, action, oldValue, newValue) {
    const query = `
      INSERT INTO audit_log (task_id, actor, action, old_value, new_value, timestamp)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `;
    await this.pool.query(query, [taskId, actor, action, oldValue, newValue]);
  }

  /**
   * Record an audit entry with flexible details
   * @param {string} taskId
   * @param {string} actor
   * @param {string} action
   * @param {Object} details - Can contain { old, new } or arbitrary data stored in new_value
   */
  async recordAudit(taskId, actor, action, details = {}) {
    const oldValue = details.old !== undefined ? details.old : null;
    const newValue = details.new !== undefined ? details.new : (details.old === undefined && details.new === undefined ? details : null);
    const query = `
      INSERT INTO audit_log (task_id, actor, action, old_value, new_value, timestamp)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `;
    await this.pool.query(query, [taskId, actor, action, oldValue, newValue]);
  }

  async getAuditLog(taskId, limit = 50) {
    const result = await this.pool.query(
      'SELECT * FROM audit_log WHERE task_id = $1 ORDER BY timestamp DESC LIMIT $2',
      [taskId, limit]
    );
    return result.rows;
  }

  /**
   * Query audit log with filters
   * @param {Object} filters - { task_id, actor, action, start_date, end_date, q }
   * @param {number} limit - max results
   * @param {number} offset - pagination offset
   */
  async queryAuditLog(filters = {}, limit = 100, offset = 0) {
    const clauses = [];
    const values = [];
    let idx = 1;

    if (filters.task_id) {
      clauses.push(`task_id = $${idx}`);
      values.push(filters.task_id);
      idx++;
    }
    if (filters.actor) {
      clauses.push(`actor ILIKE $${idx}`);
      values.push(filters.actor);
      idx++;
    }
    if (filters.action) {
      clauses.push(`action ILIKE $${idx}`);
      values.push(filters.action);
      idx++;
    }
    if (filters.start_date) {
      clauses.push(`timestamp >= $${idx}`);
      values.push(filters.start_date);
      idx++;
    }
    if (filters.end_date) {
      clauses.push(`timestamp <= $${idx}`);
      values.push(filters.end_date);
      idx++;
    }
    if (filters.q) {
      clauses.push(`(
        actor ILIKE $${idx}
        OR action ILIKE $${idx}
        OR task_id::text ILIKE $${idx}
        OR COALESCE(old_value::text, '') ILIKE $${idx}
        OR COALESCE(new_value::text, '') ILIKE $${idx}
      )`);
      values.push(`%${filters.q}%`);
      idx++;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const countQuery = `SELECT COUNT(*) AS total FROM audit_log ${where}`;
    const countResult = await this.pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    const limitIndex = values.length + 1;
    const offsetIndex = values.length + 2;
    const dataQuery = `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`;
    const dataValues = [...values, limit, offset];
    const result = await this.pool.query(dataQuery, dataValues);
    return { total, logs: result.rows };
  }

  // ============================================
  // UTILITY
  // ============================================

  async validateIntegrity() {
    const errors = [];

    // Check projects referenced by tasks exist
    const tasksResult = await this.pool.query('SELECT id, project_id FROM tasks');
    for (const task of tasksResult.rows) {
      const projectResult = await this.pool.query(
        'SELECT id FROM projects WHERE id = $1',
        [task.project_id]
      );
      if (projectResult.rows.length === 0) {
        errors.push(`Task ${task.id} references non-existent project ${task.project_id}`);
      }
    }

    // Check parent tasks exist and in same project
    for (const task of tasksResult.rows) {
      if (task.parent_task_id) {
        const parentResult = await this.pool.query(
          'SELECT id, project_id FROM tasks WHERE id = $1',
          [task.parent_task_id]
        );
        if (parentResult.rows.length === 0) {
          errors.push(`Task ${task.id} has non-existent parent ${task.parent_task_id}`);
        } else if (parentResult.rows[0].project_id !== task.project_id) {
          errors.push(`Task ${task.id} parent is in different project`);
        }
      }
    }

    // Check dependency references exist
    for (const task of tasksResult.rows) {
      const deps = task.dependency_ids || [];
      for (const depId of deps) {
        const depResult = await this.pool.query(
          'SELECT id FROM tasks WHERE id = $1',
          [depId]
        );
        if (depResult.rows.length === 0) {
          errors.push(`Task ${task.id} has non-existent dependency ${depId}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async stats() {
    const [projects, tasks, workflows, audit] = await Promise.all([
      this.pool.query('SELECT COUNT(*) FROM projects'),
      this.pool.query('SELECT COUNT(*) FROM tasks'),
      this.pool.query('SELECT COUNT(*) FROM workflows'),
      this.pool.query('SELECT COUNT(*) FROM audit_log')
    ]);

    return {
      projects: parseInt(projects.rows[0].count),
      tasks: parseInt(tasks.rows[0].count),
      workflows: parseInt(workflows.rows[0].count),
      audit_entries: parseInt(audit.rows[0].count),
      last_updated: new Date().toISOString()
    };
  }

  async exportData() {
    const [projects, tasks, workflows, audit] = await Promise.all([
      this.pool.query('SELECT * FROM projects'),
      this.pool.query('SELECT * FROM tasks'),
      this.pool.query('SELECT * FROM workflows'),
      this.pool.query('SELECT * FROM audit_log')
    ]);

    return {
      version: '1.0',
      created_at: new Date().toISOString(),
      projects: projects.rows,
      tasks: tasks.rows,
      workflows: workflows.rows,
      audit_log: audit.rows
    };
  }

  async importData(data) {
    if (!data.version || !data.projects || !data.tasks || !data.workflows) {
      throw new Error('Invalid data format');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Clear existing data
      await client.query('DELETE FROM audit_log');
      await client.query('DELETE FROM tasks');
      await client.query('DELETE FROM projects');
      await client.query('DELETE FROM workflows');

      // Insert workflows
      for (const wf of data.workflows) {
        const { id, ...wfData } = wf;
        await client.query(
          `INSERT INTO workflows (id, name, states, is_default, project_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, wfData.name, wfData.states, wfData.is_default, wfData.project_id, wfData.created_at]
        );
      }

      // Insert projects
      for (const p of data.projects) {
        const { id, ...pData } = p;
        await client.query(
          `INSERT INTO projects (id, name, description, created_at, updated_at, status, tags, default_workflow_id, metadata, qmd_project_namespace)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [id, pData.name, pData.description, pData.created_at, pData.updated_at, pData.status, pData.tags, pData.default_workflow_id, pData.metadata, pData.qmd_project_namespace]
        );
      }

      // Insert tasks
      for (const t of data.tasks) {
        const { id, ...tData } = t;
        await client.query(
          `INSERT INTO tasks (id, project_id, title, description, status, priority, owner, due_date, start_date, estimated_effort, actual_effort, parent_task_id, dependency_ids, labels, created_at, updated_at, completed_at, recurrence_rule, metadata, execution_lock, execution_locked_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
          [id, tData.project_id, tData.title, tData.description, tData.status, tData.priority, tData.owner, tData.due_date, tData.start_date, tData.estimated_effort, tData.actual_effort, tData.parent_task_id, tData.dependency_ids, tData.labels, tData.created_at, tData.updated_at, tData.completed_at, tData.recurrence_rule, tData.metadata, tData.execution_lock, tData.execution_locked_by]
        );
      }

      // Insert audit log
      for (const log of data.audit_log) {
        const { id, ...logData } = log;
        await client.query(
          `INSERT INTO audit_log (id, task_id, actor, action, old_value, new_value, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, logData.task_id, logData.actor, logData.action, logData.old_value, logData.new_value, logData.timestamp]
        );
      }

      await client.query('COMMIT');
      client.release();

      return { success: true, imported: await this.stats() };
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
  }

  // ============================================
  // SAVED VIEWS
  // ============================================

  /**
   * Create a new saved view
   * @param {string} projectId - Project UUID
   * @param {string} name - View name
   * @param {object} filters - Filter criteria (JSON-serializable)
   * @param {string|null} sort - Sort method
   * @param {string} createdBy - User/agent who created the view
   * @returns {object} Created saved view with id and timestamps
   */
  async createSavedView(projectId, name, filters, sort, createdBy) {
    const cleanData = this.sanitizeData(
      { project_id: projectId, name, filters, sort, created_by: createdBy },
      'saved_view.create'
    );

    const query = `
      INSERT INTO saved_views (project_id, name, filters, sort, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *
    `;
    const values = [
      cleanData.project_id,
      cleanData.name,
      typeof cleanData.filters === 'object' ? cleanData.filters : {},
      cleanData.sort || null,
      cleanData.created_by
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get a saved view by ID
   * @param {string} id - View UUID
   * @returns {object|null} Saved view or null if not found
   */
  async getSavedView(id) {
    const result = await this.pool.query(
      'SELECT * FROM saved_views WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * List saved views for a project
   * @param {string} projectId - Project UUID
   * @returns {Array<object>} Array of saved views
   */
  async listSavedViews(projectId) {
    const result = await this.pool.query(
      'SELECT * FROM saved_views WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    return result.rows;
  }

  /**
   * Update a saved view (name, filters, sort)
   * @param {string} id - View UUID
   * @param {object} updates - Fields to update (name, filters, sort)
   * @returns {object} Updated saved view
   */
  async updateSavedView(id, updates) {
    const cleanUpdates = this.sanitizeData(updates, 'saved_view.update');
    const fields = [];
    const values = [];

    if (cleanUpdates.name !== undefined) {
      fields.push(`name = $${values.length + 1}`);
      values.push(cleanUpdates.name);
    }
    if (cleanUpdates.filters !== undefined) {
      fields.push(`filters = $${values.length + 1}`);
      values.push(typeof cleanUpdates.filters === 'object' ? cleanUpdates.filters : {});
    }
    if (cleanUpdates.sort !== undefined) {
      fields.push(`sort = $${values.length + 1}`);
      values.push(cleanUpdates.sort);
    }

    if (fields.length === 0) {
      return this.getSavedView(id); // nothing to update
    }

    values.push(id);
    const query = `UPDATE saved_views SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`;
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Delete a saved view
   * @param {string} id - View UUID
   * @returns {boolean} true if deleted, false if not found
   */
  async deleteSavedView(id) {
    const result = await this.pool.query(
      'DELETE FROM saved_views WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rows.length > 0;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = AsanaStorage;
