/**
 * Dashboard Integration Module - Optimized for Performance
 * 
 * Connects the HTML UI with the StateManager and OfflineUIManager.
 * Implements:
 * - Virtual scrolling for large datasets (>100 tasks)
 * - Web Worker for filtering/sorting operations
 * - DOM element recycling
 * - Loading skeletons during async operations
 * - Performance monitoring
 * - Debounced search and events
 */

import { 
  init as initState, 
  getState, 
  setState, 
  updateState,
  addTask, 
  toggleTask, 
  updateTask, 
  deleteTask, 
  archiveTask,
  restoreTask,
  clearCompleted,
  subscribe,
  // Saved Views
  setSavedViews,
  setActiveView,
  addSavedView,
  updateSavedView,
  removeSavedView
} from './offline/state-manager.mjs';

import { offlineUI } from './offline/offline-ui.mjs';

// Performance monitoring
import { performanceMonitor } from './performance-monitor.mjs';

// Skeleton loader
import { skeletonLoader } from './skeleton-loader.mjs';

import { AuditView } from './audit-view.mjs';
import { createViewRegistry } from './view-registry.mjs';
import { renderMetricsView as renderMetricsViewModule } from './views/metrics-view.mjs';
import { renderPublishView as renderPublishViewModule } from './views/publish-view.mjs';
import { renderSkillsToolsView as renderSkillsToolsViewModule } from './views/skills-tools-view.mjs';
import { createSupportViews } from './views/support-views.mjs';
import { renderDepartmentsView as renderDepartmentsViewModule } from './views/departments-view.mjs';
import { renderServiceRequestsView as renderServiceRequestsViewModule } from './views/service-requests-view.mjs';
import { renderApprovalsView as renderApprovalsViewModule } from './views/approvals-view.mjs';
import { renderArtifactsView as renderArtifactsViewModule } from './views/artifacts-view.mjs';

// Virtual scroller (only used when needed)
let VirtualScroller = null;

// Timeline view (lazy loading)
let TimelineView = null;

// Board view (lazy loading)
let BoardView = null;

// Cron view (lazy loading)
let cronViewInstance = null;

// Board view instance
let boardViewInstance = null;

// Agent view (lazy loading)
let AgentViewClass = null;

// Agent view instance
let agentViewInstance = null;

// Audit view instance
let auditViewInstance = null;

// Incremental Sync
let incrementalSyncInterval = null;
const INCREMENTAL_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Web Worker for expensive operations
let dashboardWorker = null;
let workerAvailable = false;

// DOM references
const dom = {
  themeToggle: document.getElementById('themeToggle'),
  themeIcon: document.getElementById('themeIcon') || document.querySelector('#themeToggle .theme-toggle-icon'),
  themeLabel: document.getElementById('themeLabel') || document.querySelector('#themeToggle .theme-toggle-label'),
  taskInput: document.getElementById('taskInput'),
  categoryInput: document.getElementById('categoryInput'),
  taskDescriptionInput: document.getElementById('taskDescriptionInput'),
  taskOwnerInput: document.getElementById('taskOwnerInput'),
  taskModelInput: document.getElementById('taskModelInput'),
  taskStatusInput: document.getElementById('taskStatusInput'),
  taskPriorityInput: document.getElementById('taskPriorityInput'),
  taskStartDateInput: document.getElementById('taskStartDateInput'),
  taskDueDateInput: document.getElementById('taskDueDateInput'),
  taskRecurrenceInput: document.getElementById('taskRecurrenceInput'),
  addTaskBtn: document.getElementById('addTaskBtn'),
  notice: document.getElementById('notice'),
  totalTasks: document.getElementById('totalTasks'),
  completedTasks: document.getElementById('completedTasks'),
  pendingTasks: document.getElementById('pendingTasks'),
  archivedTasks: document.getElementById('archivedTasks'),
  filterAllCount: document.getElementById('filterAllCount'),
  filterPendingCount: document.getElementById('filterPendingCount'),
  filterCompletedCount: document.getElementById('filterCompletedCount'),
  filterArchivedCount: document.getElementById('filterArchivedCount'),
  filterButtons: document.querySelectorAll('.filter-btn'),
  searchInput: document.getElementById('searchInput'),
  categoryFilter: document.getElementById('categoryFilter'),
  sortSelect: document.getElementById('sortSelect'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  clearCompletedBtn: document.getElementById('clearCompletedBtn'),
  projectSelect: document.getElementById('projectSelect'),
  projectContext: document.getElementById('projectContext'),
  projectBreadcrumb: document.getElementById('projectBreadcrumb'),
  projectCurrentName: document.getElementById('projectCurrentName'),
  projectKindBadge: document.getElementById('projectKindBadge'),
  projectSummary: document.getElementById('projectSummary'),
  projectMetrics: document.getElementById('projectMetrics'),
  projectNavigatorSummary: document.getElementById('projectNavigatorSummary'),
  projectJumpLinks: document.getElementById('projectJumpLinks'),
  projectAddRootBtn: document.getElementById('projectAddRootBtn'),
  projectAddChildBtn: document.getElementById('projectAddChildBtn'),
  projectEditBtn: document.getElementById('projectEditBtn'),
  projectArchiveBtn: document.getElementById('projectArchiveBtn'),
  projectFormPanel: document.getElementById('projectFormPanel'),
  projectFormTitle: document.getElementById('projectFormTitle'),
  projectFormSubtitle: document.getElementById('projectFormSubtitle'),
  projectFormMode: document.getElementById('projectFormMode'),
  projectFormProjectId: document.getElementById('projectFormProjectId'),
  projectNameInput: document.getElementById('projectNameInput'),
  projectDescriptionInput: document.getElementById('projectDescriptionInput'),
  projectParentSelect: document.getElementById('projectParentSelect'),
  projectStatusInput: document.getElementById('projectStatusInput'),
  projectCancelBtn: document.getElementById('projectCancelBtn'),
  projectSaveBtn: document.getElementById('projectSaveBtn'),
  taskWorkbench: document.getElementById('taskWorkbench'),
  taskList: document.getElementById('taskList'),
  emptyState: document.getElementById('emptyState'),
  emptyMessage: document.getElementById('emptyMessage'),
  categoryOptions: document.getElementById('categoryOptions'),
  agentSelect: null,
  agentStatsContainer: null,
  helpModal: document.getElementById('helpModal'),
  helpClose: document.getElementById('helpClose'),
  perfPanel: document.getElementById('perfPanel'),
  perfMetrics: document.getElementById('perfMetrics'),
  perfClose: document.getElementById('perfClose'),
  savedViewSelect: document.getElementById('savedViewSelect'),
  saveViewBtn: document.getElementById('saveViewBtn'),
  deleteViewBtn: document.getElementById('deleteViewBtn')
};

const supportViews = createSupportViews({
  mountNode: dom.taskList,
  resolveProjectId: (state) => state?.project_id || getStateSync().project_id || '',
  escapeHtml
});

// State
let editingId = null;
let editingText = '';
let editingCategory = '';
let editingStatus = '';
let editingPriority = '';
let editingOwner = '';
let editingDueDate = '';
let editingStartDate = '';
let editingDescription = '';
let editingEstimatedEffort = null;
let editingActualEffort = null;
let editingRecurrence = null;
let editingModel = '';
let noticeTimer = null;
let currentView = 'list';
let virtualScroller = null;
let isVirtualScrolling = false;
let taskPool = []; // DOM element pool for recycling
let searchDebounceTimer = null;
let isInitialized = false;
let currentAgent = null;
let agentTasks = [];
let agentRefreshInterval = null;
let agentPaused = false;
let expandedTaskIds = new Set(); // Set of task IDs with expanded children
let latestStateSnapshot = { tasks: [], categories: [], savedViews: [], project_id: null };
let activeTaskLoadRequest = 0;
let cachedTaskOptions = null;
let taskComposerModelDirty = false;
let projectCatalog = [];
let projectCatalogById = new Map();

// Performance tracking
let renderStartTime = 0;
let perfInterval = null;
// Help modal focus management
let helpPrevFocusElement = null;

const PROJECT_SELECTOR_PAGE_SIZE = 200;
const FALLBACK_DEFAULT_MODEL = 'openrouter1/stepfun/step-3.5-flash:free';

function formatTokenLabel(value) {
  return String(value || '')
    .replace(/[:/_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function getRequestedDashboardView() {
  try {
    const requestUrl = new URL(window.location.href);
    const pathnameView = requestUrl.pathname === '/skills-tools' ? 'skills-tools' : null;
    const queryView = requestUrl.searchParams.get('view');
    const requestedView = pathnameView || queryView;

    if (!requestedView) {
      return null;
    }

    const registry = getViewRegistry();
    return registry.has(requestedView) ? requestedView : null;
  } catch (error) {
    console.warn('[Dashboard] Failed to resolve requested view from location:', error);
    return null;
  }
}

function normalizeProject(project) {
  if (!project || !project.id) return null;
  const metadata = project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
    ? project.metadata
    : {};
  return {
    ...project,
    metadata,
    depth: Number(project.depth || 0),
    child_count: Number(project.child_count || 0),
    descendant_count: Number(project.descendant_count || 0),
    task_count: Number(project.task_count || 0),
    active_task_count: Number(project.active_task_count || 0),
    blocked_count: Number(project.blocked_count || 0),
    overdue_count: Number(project.overdue_count || 0),
    rollup_task_count: Number(project.rollup_task_count ?? project.task_count ?? 0),
    rollup_active_task_count: Number(project.rollup_active_task_count ?? project.active_task_count ?? 0),
    rollup_blocked_count: Number(project.rollup_blocked_count ?? project.blocked_count ?? 0),
    rollup_overdue_count: Number(project.rollup_overdue_count ?? project.overdue_count ?? 0)
  };
}

function setProjectCatalog(projects = []) {
  const normalized = projects.map(normalizeProject).filter(Boolean);
  projectCatalog = normalized;
  projectCatalogById = new Map(normalized.map((project) => [project.id, project]));
}

function mergeProjectIntoCatalog(project) {
  const normalized = normalizeProject(project);
  if (!normalized) return null;

  const existingIndex = projectCatalog.findIndex((item) => item.id === normalized.id);
  if (existingIndex >= 0) {
    projectCatalog.splice(existingIndex, 1, normalized);
  } else {
    projectCatalog = [normalized, ...projectCatalog];
  }
  projectCatalogById.set(normalized.id, normalized);
  return normalized;
}

function getProjectFromCatalog(projectId) {
  if (!projectId) return null;
  return projectCatalogById.get(projectId) || null;
}

function projectHasChildren(project) {
  return Number(project?.child_count || 0) > 0;
}

function getProjectVisibleTaskCount(project) {
  return projectHasChildren(project)
    ? Number(project?.rollup_task_count ?? 0)
    : Number(project?.task_count ?? 0);
}

function getProjectVisibleBlockedCount(project) {
  return projectHasChildren(project)
    ? Number(project?.rollup_blocked_count ?? 0)
    : Number(project?.blocked_count ?? 0);
}

function getProjectVisibleOverdueCount(project) {
  return projectHasChildren(project)
    ? Number(project?.rollup_overdue_count ?? 0)
    : Number(project?.overdue_count ?? 0);
}

function getProjectVisibleActiveCount(project) {
  return projectHasChildren(project)
    ? Number(project?.rollup_active_task_count ?? 0)
    : Number(project?.active_task_count ?? 0);
}

function getProjectDescendantIds(projectId) {
  if (!projectId) return [];
  return projectCatalog
    .filter((project) => Array.isArray(project.project_path_ids) && project.project_path_ids.includes(projectId) && project.id !== projectId)
    .map((project) => project.id);
}

function getProjectContextLinks(project) {
  if (!project) return [];

  if (projectHasChildren(project)) {
    return projectCatalog.filter((item) => item.parent_project_id === project.id);
  }

  if (project.parent_project_id) {
    return projectCatalog.filter((item) => item.parent_project_id === project.parent_project_id);
  }

  return projectCatalog.filter((item) => item.parent_project_id === project.id);
}

function getProjectRoot(project) {
  if (!project) return null;
  const rootId = Array.isArray(project.project_path_ids) && project.project_path_ids.length > 0
    ? project.project_path_ids[0]
    : project.id;
  return getProjectFromCatalog(rootId) || project;
}

function buildProjectChildrenMap() {
  const map = new Map();
  projectCatalog.forEach((project) => {
    const key = project.parent_project_id || '__root__';
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(project);
  });
  return map;
}

function getTaskOpenClawMetadata(task) {
  const metadata = task?.metadata;
  if (metadata && typeof metadata === 'object' && metadata.openclaw && typeof metadata.openclaw === 'object') {
    return metadata.openclaw;
  }
  return metadata && typeof metadata === 'object' ? metadata : {};
}

function getTaskPreferredModel(task) {
  const openclawMeta = getTaskOpenClawMetadata(task);
  if (typeof openclawMeta.preferred_model === 'string' && openclawMeta.preferred_model.trim()) {
    return openclawMeta.preferred_model.trim();
  }
  if (typeof openclawMeta.model === 'string' && openclawMeta.model.trim()) {
    return openclawMeta.model.trim();
  }
  return '';
}

function buildTaskMetadata(existingMetadata = {}, { preferredModel = '' } = {}) {
  const metadata = existingMetadata && typeof existingMetadata === 'object'
    ? { ...existingMetadata }
    : {};
  const openclawMeta = metadata.openclaw && typeof metadata.openclaw === 'object'
    ? { ...metadata.openclaw }
    : {};

  if (preferredModel) {
    openclawMeta.preferred_model = preferredModel;
  } else {
    delete openclawMeta.preferred_model;
  }

  openclawMeta.created_via = 'dashboard';

  if (Object.keys(openclawMeta).length > 0) {
    metadata.openclaw = openclawMeta;
  } else {
    delete metadata.openclaw;
  }

  return metadata;
}

function getAgentCatalog() {
  return Array.isArray(cachedTaskOptions?.agents) ? cachedTaskOptions.agents : [];
}

function getModelCatalog() {
  return Array.isArray(cachedTaskOptions?.models) ? cachedTaskOptions.models : [];
}

function getAgentDisplayName(agentId) {
  if (!agentId) return 'Assign';
  const match = getAgentCatalog().find(agent => agent.id === agentId);
  return match?.name || agentId;
}

function getModelDisplayName(modelId) {
  if (!modelId) return '';
  const match = getModelCatalog().find(model => model.id === modelId);
  const rawDisplay = match?.displayName || match?.name || modelId;
  if (rawDisplay.includes('/')) {
    const provider = match?.provider || modelId.split('/')[0];
    const shortName = formatTokenLabel(rawDisplay.split('/').slice(-1)[0]);
    return provider ? `${shortName} · ${provider}` : shortName;
  }
  return rawDisplay;
}

function getModelChipLabel(modelId) {
  const displayName = getModelDisplayName(modelId);
  if (!displayName) return '';
  return displayName.length > 26 ? `${displayName.slice(0, 23)}...` : displayName;
}

function getTaskRuntimeSnapshot(task) {
  const openclawMeta = getTaskOpenClawMetadata(task);
  const runtime = openclawMeta.runtime && typeof openclawMeta.runtime === 'object'
    ? openclawMeta.runtime
    : {};

  const agent = typeof runtime.agent === 'string' && runtime.agent.trim()
    ? runtime.agent.trim()
    : (typeof task.execution_locked_by === 'string' ? task.execution_locked_by.trim() : '');
  const state = typeof runtime.state === 'string' && runtime.state.trim()
    ? runtime.state.trim()
    : (agent ? 'active' : '');
  const activity = typeof runtime.current_activity === 'string' && runtime.current_activity.trim()
    ? runtime.current_activity.trim()
    : '';
  const lastSeenAt = typeof runtime.last_seen_at === 'string' && runtime.last_seen_at.trim()
    ? runtime.last_seen_at.trim()
    : '';

  return { agent, state, activity, lastSeenAt };
}

function getTaskRuntimeChip(task) {
  const runtime = getTaskRuntimeSnapshot(task);
  if (!runtime.agent && !runtime.activity) return null;

  const actor = runtime.agent || 'OpenClaw';
  const detail = runtime.activity
    ? runtime.activity
    : (runtime.state ? formatTokenLabel(runtime.state) : 'Active');
  const label = `${actor} · ${detail}`;

  return {
    label: label.length > 60 ? `${label.slice(0, 57)}...` : label,
    title: runtime.lastSeenAt
      ? `${label}\nLast update ${formatDate(runtime.lastSeenAt)}`
      : label
  };
}

function replaceSelectOptions(selectEl, options, { placeholderLabel, selectedValue = '', getValue, getLabel }) {
  if (!selectEl) return;

  const currentValue = selectedValue || selectEl.value || '';
  selectEl.innerHTML = '';

  if (placeholderLabel) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = placeholderLabel;
    selectEl.appendChild(placeholder);
  }

  options.forEach((option) => {
    const itemValue = getValue(option);
    if (!itemValue) return;
    const el = document.createElement('option');
    el.value = itemValue;
    el.textContent = getLabel(option);
    if (itemValue === currentValue) {
      el.selected = true;
    }
    selectEl.appendChild(el);
  });

  if (currentValue && !Array.from(selectEl.options).some(option => option.value === currentValue)) {
    const fallback = document.createElement('option');
    fallback.value = currentValue;
    fallback.textContent = currentValue;
    fallback.selected = true;
    selectEl.appendChild(fallback);
  }
}

function populateTaskComposerOptions(taskOptions) {
  if (!taskOptions) return;

  replaceSelectOptions(dom.taskOwnerInput, taskOptions.agents || [], {
    placeholderLabel: 'Unassigned',
    selectedValue: dom.taskOwnerInput?.value || '',
    getValue: (agent) => agent.id,
    getLabel: (agent) => agent.name || agent.id
  });

  replaceSelectOptions(dom.taskModelInput, taskOptions.models || [], {
    placeholderLabel: 'No model preference',
    selectedValue: dom.taskModelInput?.value || taskOptions.defaults?.model || '',
    getValue: (model) => model.id,
    getLabel: (model) => getModelDisplayName(model.id)
  });

  if (!dom.taskModelInput?.value && taskOptions.defaults?.model) {
    dom.taskModelInput.value = taskOptions.defaults.model;
  }
}

async function fetchTaskOptions(force = false) {
  if (cachedTaskOptions && !force) {
    return cachedTaskOptions;
  }

  try {
    const response = await fetch('/api/task-options');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    cachedTaskOptions = {
      agents: Array.isArray(data.agents) ? data.agents : [],
      models: Array.isArray(data.models) ? data.models : [],
      defaults: data.defaults || {}
    };
    cachedAgents = cachedTaskOptions.agents.map(agent => agent.id);
  } catch (error) {
    console.warn('[Dashboard] Could not load task options:', error);
    cachedTaskOptions = {
      agents: [],
      models: [{ id: FALLBACK_DEFAULT_MODEL, displayName: 'Step-3.5 Flash Free' }],
      defaults: { agent: '', model: FALLBACK_DEFAULT_MODEL }
    };
    cachedAgents = [];
  }

  populateTaskComposerOptions(cachedTaskOptions);
  return cachedTaskOptions;
}

function resetTaskComposer() {
  taskComposerModelDirty = false;
  if (dom.taskInput) dom.taskInput.value = '';
  if (dom.categoryInput) dom.categoryInput.value = '';
  if (dom.taskDescriptionInput) dom.taskDescriptionInput.value = '';
  if (dom.taskOwnerInput) dom.taskOwnerInput.value = '';
  if (dom.taskStatusInput) dom.taskStatusInput.value = 'backlog';
  if (dom.taskPriorityInput) dom.taskPriorityInput.value = 'medium';
  if (dom.taskStartDateInput) dom.taskStartDateInput.value = '';
  if (dom.taskDueDateInput) dom.taskDueDateInput.value = '';
  if (dom.taskRecurrenceInput) dom.taskRecurrenceInput.value = 'none';
  if (dom.taskModelInput) {
    dom.taskModelInput.value = cachedTaskOptions?.defaults?.model || FALLBACK_DEFAULT_MODEL;
  }
}

function getTaskStatus(task) {
  if (!task) return 'backlog';
  if (task.archived || task.archived_at) return 'archived';
  if (typeof task.status === 'string' && task.status.trim()) {
    return task.status.trim();
  }
  return task.completed ? 'completed' : 'backlog';
}

function isTaskArchived(task) {
  return getTaskStatus(task) === 'archived' || Boolean(task?.archived) || Boolean(task?.archived_at);
}

function isTaskCompleted(task) {
  return getTaskStatus(task) === 'completed';
}

function isTaskPending(task) {
  return !isTaskArchived(task) && !isTaskCompleted(task);
}

function shouldAutoExpandHierarchy(state) {
  if (!state) return false;
  return Boolean(
    (state.filter && state.filter !== 'all') ||
    (state.search && state.search.trim()) ||
    (state.categoryFilter && state.categoryFilter !== 'all')
  );
}

/**
 * Initialize Dashboard
 */
(function initDashboard() {
  console.log('[Dashboard] Initializing with performance optimizations...');

  // Load performance monitor
  if (window.performanceMonitor) {
    performanceMonitor.setEnabled(true);
  }

  // Initialize Web Worker early (disabled due to unresolved errors; re-enable when properly integrated)
  // initWorker().catch(console.warn);

  // Initialize state manager
  initState().then(async (state) => {
    // Initialize offline UI
    offlineUI.init();

    // Set up event listeners with debouncing where appropriate
    setupEventListeners();

    await fetchTaskOptions();
    resetTaskComposer();

    updateStateSnapshot(state);

    // Load project selector options before task fetch
    await loadProjectOptions({ selectedProjectId: state.project_id });

    // Load tasks for current project (or auto-select if none)
    await loadTasks(false);

    // Load saved views for the current project
    const stateAfterLoad = await getState();
    if (stateAfterLoad.project_id) {
      await loadSavedViews(stateAfterLoad.project_id);
    }

    const requestedView = getRequestedDashboardView();
    if (requestedView && requestedView !== stateAfterLoad.view) {
      await updateState({ view: requestedView });
    }

    // Get fresh state after tasks loaded
    const newState = await getState();
    updateStateSnapshot(newState);
    const initialView = requestedView || newState.view || 'list';

    // Initial render respects deep-link or saved active view.
    renderStartTime = performance.now();
    await renderViewSwitch(initialView, newState);
    const duration = performance.now() - renderStartTime;
    performanceMonitor.record('view-switch-initial', duration, { view: initialView });
    console.log(`[Dashboard] Initial render completed in ${duration.toFixed(2)}ms`);

    // Update other UI
    renderProjectContext(newState);
    updateStats(newState);
    updateFilterButtons(newState);
    updateSearchSortUI(newState);
    updateThemeUI(newState);
    updateViewButtons(newState);

    // Start periodic incremental sync (every 5 minutes)
    startPeriodicIncrementalSync();

    isInitialized = true;
    console.log('[Dashboard] Ready with optimizations');
  }).catch(error => {
    console.error('[Dashboard] Initialization failed:', error);
    showNotice('Failed to initialize dashboard. Please refresh.', 'error');
  });
})();

/**
 * Initialize Web Worker for filtering/sorting
 */
async function initWorker() {
  try {
    dashboardWorker = new Worker('./dashboard-worker.js', { type: 'module' });
    
    dashboardWorker.onmessage = (e) => {
      const { type, result, duration } = e.data;
      
      if (type === 'FILTER_SORT_COMPLETE') {
        renderWorkerResults(result);
        performanceMonitor.record('filter-sort-worker', duration);
      } else if (type === 'SEARCH_COMPLETE') {
        renderWorkerResults(result);
        performanceMonitor.record('search-worker', duration);
      } else if (type === 'INIT_COMPLETE') {
        workerAvailable = true;
        console.log('[Dashboard] Web Worker initialized');
      }
    };

    dashboardWorker.onerror = (error) => {
      console.error('[Dashboard] Worker error event:', error);
      console.error('  isTrusted:', error.isTrusted);
      console.error('  message (may be ""):', error.message);
      console.error('  filename:', error.filename);
      console.error('  lineno:', error.lineno);
      console.error('  colno:', error.colno);
      // The actual exception is in the non-enumerable .error property
      try {
        const actualError = error.error || (error.detail && error.detail.error);
        if (actualError) {
          console.error('  actual error object:', actualError);
          console.error('  actual error message:', actualError.message);
          console.error('  actual error stack:', actualError.stack);
        } else {
          console.error('  no .error property found');
        }
      } catch (e) {
        console.error('  error while inspecting .error:', e);
      }
      workerAvailable = false;
    };

    // Initialize worker with empty data (will update when we have tasks)
    dashboardWorker.postMessage({ type: 'INIT', data: { tasks: [], categories: [] } });
  } catch (error) {
    console.warn('[Dashboard] Web Worker not available, falling back to main thread:', error);
    workerAvailable = false;
  }
}

/**
 * Keyboard shortcuts handler (accessibility feature)
 * Global keydown event listener for help modal and performance panel
 */
function handleGlobalKeydown(e) {
  // Ignore if user is typing in an input/textarea (except for specific keys)
  const tag = e.target.tagName.toLowerCase();
  const isInput = ['input', 'textarea', 'select', '[contenteditable]'].includes(tag);
  const isEditable = e.target.isContentEditable;

  // ? shows help (always available)
  if (e.key === '?' && !isInput) {
    e.preventDefault();
    showHelpModal();
    return;
  }

  // Escape closes any open modal/panel
  if (e.key === 'Escape') {
    if (!dom.helpModal.hidden) {
      e.preventDefault();
      hideHelpModal();
    } else if (!dom.perfPanel.hidden) {
      e.preventDefault();
      togglePerfPanel(false);
    }
    return;
  }

  // Ctrl+Shift+P toggles performance panel (dev/debug)
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    togglePerfPanel();
    return;
  }
}

/**
 * Show the keyboard help modal with focus trapping
 */
function showHelpModal() {
  dom.helpModal.hidden = false;
  // Save the currently focused element to restore later
  helpPrevFocusElement = document.activeElement;
  // Focus the close button for easy dismissal
  setTimeout(() => dom.helpClose?.focus(), 50);
  // Add basic focus trapping (Esc handles close; return focus on hide)
  document.body.style.overflow = 'hidden'; // Prevent background scrolling
}

/**
 * Hide the keyboard help modal and restore focus
 */
function hideHelpModal() {
  dom.helpModal.hidden = true;
  document.body.style.overflow = '';
  // Restore focus to the previously focused element
  if (helpPrevFocusElement) {
    helpPrevFocusElement.focus();
    helpPrevFocusElement = null;
  }
}

/**
 * Toggle performance monitor panel visibility and update metrics
 * @param {boolean} [show] - If provided, force show (true) or hide (false); otherwise toggle
 */
function togglePerfPanel(show) {
  if (show === true) {
    dom.perfPanel.hidden = false;
  } else if (show === false) {
    dom.perfPanel.hidden = true;
    if (perfInterval) {
      clearInterval(perfInterval);
      perfInterval = null;
    }
  } else {
    // Toggle
    dom.perfPanel.hidden = dom.perfPanel.hidden === true ? false : true;
  }

  // If shown, populate metrics and start auto-refresh
  if (!dom.perfPanel.hidden) {
    updatePerfMetrics();
    // Refresh metrics every 2 seconds while panel is open
    if (!perfInterval) {
      perfInterval = setInterval(updatePerfMetrics, 2000);
    }
  }
}

/**
 * Update the performance metrics display with latest data from performanceMonitor
 */
function updatePerfMetrics() {
  if (!dom.perfMetrics) return;

  const report = performanceMonitor.getReport();
  const m = report.metrics;

  // Build metrics table
  const rows = [];
  for (const [key, stats] of Object.entries(m)) {
    if (stats.count > 0) {
      rows.push(`
        <tr>
          <td>${key}</td>
          <td>${stats.count}</td>
          <td>${stats.avg}ms</td>
          <td>${stats.min}ms</td>
          <td>${stats.max}ms</td>
          <td>${stats.median}ms</td>
        </tr>
      `);
    }
  }

  dom.perfMetrics.innerHTML = `
    <table class="perf-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Count</th>
          <th>Avg</th>
          <th>Min</th>
          <th>Max</th>
          <th>Median</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join('')}
      </tbody>
    </table>
    <div class="perf-recommendations">
      <strong>Recommendations:</strong>
      <ul>
        ${report.recommendations.map(r => `<li>${r}</li>`).join('')}
      </ul>
    </div>
  `;
}

/**
 * Set up all UI event listeners with debouncing where appropriate
 */
function setupEventListeners() {
  // Theme toggle
  dom.themeToggle?.addEventListener('click', () => {
    getState().then(state => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark';
      updateState({ theme: newTheme }).then(() => {
        updateThemeUI(newTheme);
      });
    });
  });

  // Add task (no debounce needed)
  dom.addTaskBtn?.addEventListener('click', async () => {
    const text = dom.taskInput.value.trim();
    if (!text) {
      showNotice('Please enter a task description.', 'error');
      dom.taskInput.focus();
      return;
    }

    const state = await getState();
    if (!state.project_id) {
      showNotice('Select a project before creating a task.', 'error');
      return;
    }
    
    // Show loading state
    skeletonLoader.setButtonLoading(dom.addTaskBtn, 'Create Task');
    
    try {
      const preferredModel = dom.taskModelInput?.value || cachedTaskOptions?.defaults?.model || FALLBACK_DEFAULT_MODEL;
      await addTask({
        text,
        title: text,
        category: dom.categoryInput.value,
        description: dom.taskDescriptionInput?.value || '',
        owner: dom.taskOwnerInput?.value || null,
        status: dom.taskStatusInput?.value || 'backlog',
        priority: dom.taskPriorityInput?.value || 'medium',
        start_date: dom.taskStartDateInput?.value || null,
        due_date: dom.taskDueDateInput?.value || null,
        recurrence_rule: dom.taskRecurrenceInput?.value && dom.taskRecurrenceInput.value !== 'none'
          ? dom.taskRecurrenceInput.value
          : null,
        metadata: buildTaskMetadata({}, { preferredModel })
      });
      resetTaskComposer();
      showNotice('Task added successfully.', 'success');
    } catch (error) {
      showNotice('Failed to add task.', 'error');
    } finally {
      skeletonLoader.clearButtonLoading(dom.addTaskBtn);
    }
  });

  dom.taskInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      dom.addTaskBtn?.click();
    }
  });

  dom.taskDescriptionInput?.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      dom.addTaskBtn?.click();
    }
  });

  dom.taskModelInput?.addEventListener('change', () => {
    taskComposerModelDirty = true;
  });

  dom.taskOwnerInput?.addEventListener('change', () => {
    if (taskComposerModelDirty) return;
    const selectedAgent = getAgentCatalog().find(agent => agent.id === dom.taskOwnerInput.value);
    if (selectedAgent?.defaultModel && dom.taskModelInput) {
      dom.taskModelInput.value = selectedAgent.defaultModel;
    } else if (dom.taskModelInput) {
      dom.taskModelInput.value = cachedTaskOptions?.defaults?.model || FALLBACK_DEFAULT_MODEL;
    }
  });

  // Filter buttons (debounced to prevent rapid re-renders)
  dom.filterButtons?.forEach(button => {
    button.addEventListener('click', async () => {
      const filter = button.dataset.filter;
      await updateState({ filter });
      // Load tasks with appropriate inclusion of archived
      const includeArchived = filter === 'archived';
      await loadTasks(includeArchived);
      await renderTasksDebounced();
      updateFilterButtons(getStateSync());
    });
  });

  // Search (debounced - 200ms delay)
  dom.searchInput?.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    const search = e.target.value;
    
    // Show skeleton if large dataset
    const state = getStateSync(); // Fast sync check
    if (state.tasks.length > 50) {
      showTaskSkeletons(Math.min(8, Math.ceil(state.tasks.length / 20)));
    }
    
    searchDebounceTimer = setTimeout(async () => {
      await updateState({ search });
      await renderTasksDebounced();
    }, 200);
  });

  // Category filter (debounced)
  dom.categoryFilter?.addEventListener('change', (e) => {
    updateState({ categoryFilter: e.target.value }).then(() => {
      renderTasksDebounced();
    });
  });

  dom.projectSelect?.addEventListener('change', async (e) => {
    const projectId = e.target.value;
    if (!projectId) return;
    await selectProject(projectId);
  });

  dom.projectAddRootBtn?.addEventListener('click', () => {
    openProjectForm('create-root');
  });

  dom.projectAddChildBtn?.addEventListener('click', () => {
    const project = getProjectFromCatalog(getStateSync().project_id);
    openProjectForm('create-child', project);
  });

  dom.projectEditBtn?.addEventListener('click', () => {
    const project = getProjectFromCatalog(getStateSync().project_id);
    openProjectForm('edit', project);
  });

  dom.projectArchiveBtn?.addEventListener('click', () => {
    const project = getProjectFromCatalog(getStateSync().project_id);
    handleArchiveProject(project);
  });

  dom.projectFormPanel?.addEventListener('submit', handleProjectFormSubmit);
  dom.projectCancelBtn?.addEventListener('click', () => {
    closeProjectForm();
  });

  // Sort (immediate)
  dom.sortSelect?.addEventListener('change', (e) => {
    updateState({ sort: e.target.value }).then(() => {
      renderTasksDebounced();
    });
  });

  // Export buttons
  dom.exportJsonBtn?.addEventListener('click', exportJson);
  dom.exportCsvBtn?.addEventListener('click', exportCsv);

  // Import
  dom.importBtn?.addEventListener('click', () => {
    dom.importFile?.click();
  });
  dom.importFile?.addEventListener('change', handleImport);

  // Clear completed
  dom.clearCompletedBtn?.addEventListener('click', async () => {
    try {
      await handleClearCompleted();
    } catch (error) {
      showNotice('Failed to clear completed tasks.', 'error');
    }
  });

  // Saved Views
  dom.saveViewBtn?.addEventListener('click', handleSaveView);
  dom.savedViewSelect?.addEventListener('change', handleApplyView);
  dom.deleteViewBtn?.addEventListener('click', handleDeleteView);

  // Subscribe to state changes
  subscribe(async (event, state) => {
    updateStateSnapshot(state);
    switch (event) {
      case 'load':
      case 'change':
        await syncUI(state);
        break;
    }
  });

  // View switcher
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      updateState({ view }).then(async () => {
        const state = await getState();
        renderViewSwitch(view, state);
        updateViewButtons(state);
      });
    });
  });

  // Global keyboard shortcuts
  window.addEventListener('keydown', handleGlobalKeydown);
  
  // Show performance panel if URL hash indicates it
  if (window.location.hash === '#perf') {
    togglePerfPanel(true);
  }

  // Close buttons for modals/panels
  dom.helpClose?.addEventListener('click', hideHelpModal);
  dom.perfClose?.addEventListener('click', () => togglePerfPanel(false));
}

/**
 * Synchronize all UI elements with current state
 */
async function syncUI(state) {
  await renderCategoryOptions();
  const activeView = state?.view || currentView || 'list';
  updateTaskWorkbenchVisibility(activeView);
  if (activeView === 'list') {
    await renderTasks(); // Handles skeleton loading internally
  } else {
    await renderViewSwitch(activeView, state);
  }
  renderProjectContext(state);
  await updateStats(state);
  updateFilterButtons(state);
  updateSearchSortUI(state);
  updateThemeUI(state);
  updateViewButtons(state);
  renderSavedViewOptions();
}

/**
 * Render category options dropdown
 */
async function renderCategoryOptions() {
  const state = await getState();
  dom.categoryOptions.innerHTML = '';
  state.categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    dom.categoryOptions.appendChild(option);
  });

  // Update category filter dropdown
  dom.categoryFilter.innerHTML = '<option value="all">All categories</option>';
  state.categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    dom.categoryFilter.appendChild(option);
  });
  dom.categoryFilter.value = state.categoryFilter;
}

function updateStateSnapshot(state) {
  latestStateSnapshot = {
    tasks: [],
    categories: [],
    savedViews: [],
    ...state
  };
}

function buildProjectOptionLabel(project) {
  const normalizedProject = normalizeProject(project);
  if (!normalizedProject) return '';

  const depth = Math.max(0, Number(normalizedProject.depth || 0));
  const taskCount = getProjectVisibleTaskCount(normalizedProject);
  const blockedCount = getProjectVisibleBlockedCount(normalizedProject);
  const overdueCount = getProjectVisibleOverdueCount(normalizedProject);
  const suffix = [];

  if (taskCount > 0) suffix.push(`${taskCount} tasks`);
  if (blockedCount > 0) suffix.push(`${blockedCount} blocked`);
  if (overdueCount > 0) suffix.push(`${overdueCount} overdue`);

  const indent = depth > 0 ? `${'  '.repeat(depth)}` : '';
  const kindLabel = projectHasChildren(normalizedProject) ? '[Folder] ' : '';
  const label = `${indent}${kindLabel}${normalizedProject.name}`;
  return suffix.length > 0 ? `${label} (${suffix.join(', ')})` : label;
}

async function fetchProjectById(projectId) {
  if (!projectId) return null;
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
  if (!res.ok) return null;
  const project = await res.json();
  return mergeProjectIntoCatalog(project);
}

async function fetchDefaultProject() {
  const res = await fetch('/api/projects/default?status=active');
  if (!res.ok) return null;
  const project = await res.json();
  return mergeProjectIntoCatalog(project);
}

async function loadProjectOptions(options = {}) {
  if (!dom.projectSelect) return [];

  const selectedProjectId = options.selectedProjectId || '';
  dom.projectSelect.disabled = true;
  dom.projectSelect.innerHTML = '<option value="">Loading projects...</option>';

  try {
    const res = await fetch(`/api/projects?status=active&include_meta=true&limit=${PROJECT_SELECTOR_PAGE_SIZE}`);
    if (!res.ok) throw new Error(`Failed to load projects: ${res.status}`);

    const payload = await res.json();
    const projects = Array.isArray(payload) ? payload.map(normalizeProject).filter(Boolean) : Array.isArray(payload?.items) ? payload.items.map(normalizeProject).filter(Boolean) : [];
    const total = Number(payload?.total || projects.length);

    let selectedProject = options.injectProject || null;
    if (selectedProjectId && !projects.some((project) => project.id === selectedProjectId)) {
      selectedProject = selectedProject || await fetchProjectById(selectedProjectId);
      if (selectedProject) {
        projects.unshift(selectedProject);
      }
    }

    setProjectCatalog(projects);

    dom.projectSelect.innerHTML = '';

    if (projects.length === 0) {
      dom.projectSelect.innerHTML = '<option value="">No active projects</option>';
      dom.projectSelect.disabled = true;
      return [];
    }

    projects.forEach((project) => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = buildProjectOptionLabel(project);
      dom.projectSelect.appendChild(option);
    });

    if (total > projects.length) {
      const moreOption = document.createElement('option');
      moreOption.value = '';
      moreOption.textContent = `Showing ${projects.length} of ${total} projects`;
      moreOption.disabled = true;
      dom.projectSelect.appendChild(moreOption);
    }

    const fallbackProjectId = selectedProjectId || projects[0]?.id || '';
    if (fallbackProjectId && projects.some((project) => project.id === fallbackProjectId)) {
      dom.projectSelect.value = fallbackProjectId;
    }

    dom.projectSelect.disabled = false;
    return projects;
  } catch (error) {
    console.error('[Dashboard] Failed to load project options:', error);
    dom.projectSelect.innerHTML = '<option value="">Failed to load projects</option>';
    dom.projectSelect.disabled = true;
    setProjectCatalog([]);
    return [];
  }
}

async function selectProject(projectId) {
  if (!projectId) return;
  closeProjectForm();

  const state = await getState();
  if (state.project_id === projectId) {
    renderProjectContext(state);
    return;
  }

  const nextState = {
    ...state,
    project_id: projectId,
    tasks: [],
    categories: ['General'],
    lastSyncTime: null,
    search: '',
    categoryFilter: 'all',
    filter: 'all',
    savedViews: [],
    activeSavedViewId: null
  };

  await setState(nextState);
  await loadSavedViews(projectId);
  await loadTasks(false);
}

function closeProjectForm() {
  if (!dom.projectFormPanel) return;
  dom.projectFormPanel.hidden = true;
  if (dom.projectFormMode) dom.projectFormMode.value = '';
  if (dom.projectFormProjectId) dom.projectFormProjectId.value = '';
  if (dom.projectNameInput) dom.projectNameInput.value = '';
  if (dom.projectDescriptionInput) dom.projectDescriptionInput.value = '';
  if (dom.projectStatusInput) dom.projectStatusInput.value = 'active';
  if (dom.projectParentSelect) {
    dom.projectParentSelect.innerHTML = '<option value="">No parent (root project)</option>';
    dom.projectParentSelect.value = '';
  }
}

function populateProjectParentOptions(selectedParentId = '', excludedProjectIds = []) {
  if (!dom.projectParentSelect) return;

  const blockedIds = new Set(excludedProjectIds.filter(Boolean));
  dom.projectParentSelect.innerHTML = '<option value="">No parent (root project)</option>';

  projectCatalog
    .filter((project) => !blockedIds.has(project.id))
    .forEach((project) => {
      const option = document.createElement('option');
      option.value = project.id;
      const indent = project.depth > 0 ? `${'  '.repeat(project.depth)}` : '';
      option.textContent = `${indent}${project.name}`;
      dom.projectParentSelect.appendChild(option);
    });

  dom.projectParentSelect.value = selectedParentId || '';
}

function openProjectForm(mode, project = null) {
  if (!dom.projectFormPanel) return;

  const currentProject = project || getProjectFromCatalog(getStateSync().project_id);
  const isEdit = mode === 'edit';
  const isCreateChild = mode === 'create-child';
  const excludedIds = isEdit && currentProject
    ? [currentProject.id, ...getProjectDescendantIds(currentProject.id)]
    : [];
  const selectedParentId = isEdit
    ? (currentProject?.parent_project_id || '')
    : (isCreateChild ? currentProject?.id || '' : '');

  populateProjectParentOptions(selectedParentId, excludedIds);

  dom.projectFormPanel.hidden = false;
  dom.projectFormMode.value = mode;
  dom.projectFormProjectId.value = isEdit && currentProject ? currentProject.id : '';
  dom.projectNameInput.value = isEdit && currentProject ? currentProject.name || '' : '';
  dom.projectDescriptionInput.value = isEdit && currentProject ? currentProject.description || '' : '';
  dom.projectStatusInput.value = isEdit && currentProject ? (currentProject.status || 'active') : 'active';

  if (mode === 'create-root') {
    dom.projectFormTitle.textContent = 'Create root project';
    dom.projectFormSubtitle.textContent = 'Start a new top-level board that can hold its own tasks or become a folder for child projects.';
  } else if (mode === 'create-child') {
    dom.projectFormTitle.textContent = `Add child project${currentProject ? ` to ${currentProject.name}` : ''}`;
    dom.projectFormSubtitle.textContent = 'Create a related board under the current project so work stays grouped in a clean hierarchy.';
  } else {
    dom.projectFormTitle.textContent = `Edit ${currentProject?.name || 'project'}`;
    dom.projectFormSubtitle.textContent = 'Rename the project, change its description, or move it somewhere else in the hierarchy.';
  }

  requestAnimationFrame(() => {
    dom.projectNameInput?.focus();
    dom.projectNameInput?.select();
  });
}

async function handleProjectFormSubmit(event) {
  event.preventDefault();

  const mode = dom.projectFormMode?.value || '';
  const projectId = dom.projectFormProjectId?.value || '';
  const name = dom.projectNameInput?.value.trim() || '';

  if (!name) {
    showNotice('Project name is required.', 'error');
    dom.projectNameInput?.focus();
    return;
  }

  const description = dom.projectDescriptionInput?.value.trim() || '';
  const status = dom.projectStatusInput?.value || 'active';
  const parentId = dom.projectParentSelect?.value || '';
  const selectedProject = getProjectFromCatalog(getStateSync().project_id);
  const currentProject = projectId ? getProjectFromCatalog(projectId) : null;
  const baseMetadata = currentProject?.metadata && typeof currentProject.metadata === 'object'
    ? { ...currentProject.metadata }
    : {};

  if (parentId) {
    baseMetadata.parent_project_id = parentId;
  } else {
    delete baseMetadata.parent_project_id;
  }

  const payload = {
    name,
    description,
    status,
    metadata: baseMetadata
  };

  try {
    let savedProject = null;
    if (mode === 'edit' && projectId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`Failed to update project: ${response.status}`);
      }
      savedProject = normalizeProject(await response.json());
      showNotice('Project updated.', 'success');
    } else {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`Failed to create project: ${response.status}`);
      }
      savedProject = normalizeProject(await response.json());
      showNotice('Project created.', 'success');
    }

    closeProjectForm();
    const targetProjectId = savedProject?.id || selectedProject?.id;
    await loadProjectOptions({ selectedProjectId: targetProjectId, injectProject: savedProject });
    if (targetProjectId) {
      await selectProject(targetProjectId);
    }
  } catch (error) {
    console.error('[Dashboard] Project save failed:', error);
    showNotice('Failed to save project.', 'error');
  }
}

async function archiveProjectTree(project) {
  if (!project) return;

  const branch = projectCatalog
    .filter((item) => Array.isArray(item.project_path_ids) && item.project_path_ids.includes(project.id))
    .sort((left, right) => Number(right.depth || 0) - Number(left.depth || 0));

  for (const item of branch) {
    const response = await fetch(`/api/projects/${encodeURIComponent(item.id)}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error(`Failed to archive project: ${item.name}`);
    }
  }
}

async function handleArchiveProject(project = null) {
  const currentProject = project || getProjectFromCatalog(getStateSync().project_id);
  if (!currentProject) return;

  const descendantCount = getProjectDescendantIds(currentProject.id).length;
  const promptText = descendantCount > 0
    ? `Archive "${currentProject.name}" and its ${descendantCount} child project${descendantCount === 1 ? '' : 's'}?`
    : `Archive "${currentProject.name}"?`;

  if (!window.confirm(promptText)) {
    return;
  }

  try {
    await archiveProjectTree(currentProject);
    closeProjectForm();
    showNotice('Project archived.', 'success');
    await loadProjectOptions();
    const state = await getState();
    const fallbackProjectId = currentProject.parent_project_id || (await fetchDefaultProject())?.id || '';
    if (fallbackProjectId) {
      await selectProject(fallbackProjectId);
    } else if (state.project_id === currentProject.id) {
      await setState({ ...state, project_id: null, tasks: [] });
    }
  } catch (error) {
    console.error('[Dashboard] Project archive failed:', error);
    showNotice('Failed to archive project.', 'error');
  }
}

function renderProjectContext(state) {
  if (!dom.projectContext || !dom.projectBreadcrumb || !dom.projectSummary || !dom.projectJumpLinks) {
    return;
  }

  const project = getProjectFromCatalog(state.project_id);
  if (!project) {
    dom.projectContext.hidden = true;
    dom.projectBreadcrumb.innerHTML = '';
    if (dom.projectCurrentName) dom.projectCurrentName.textContent = '';
    if (dom.projectKindBadge) dom.projectKindBadge.textContent = '';
    dom.projectSummary.textContent = '';
    if (dom.projectMetrics) dom.projectMetrics.innerHTML = '';
    if (dom.projectNavigatorSummary) dom.projectNavigatorSummary.textContent = '';
    dom.projectJumpLinks.innerHTML = '';
    closeProjectForm();
    return;
  }

  dom.projectContext.hidden = false;
  dom.projectBreadcrumb.innerHTML = '';

  const pathIds = Array.isArray(project.project_path_ids) && project.project_path_ids.length > 0
    ? project.project_path_ids
    : [project.id];
  const pathNames = Array.isArray(project.project_path_names) && project.project_path_names.length > 0
    ? project.project_path_names
    : [project.name];

  pathNames.forEach((name, index) => {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'project-breadcrumb-sep';
      separator.textContent = '/';
      dom.projectBreadcrumb.appendChild(separator);
    }

    const segmentProjectId = pathIds[index];
    if (index < pathNames.length - 1 && segmentProjectId) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name;
      button.addEventListener('click', () => {
        selectProject(segmentProjectId);
      });
      dom.projectBreadcrumb.appendChild(button);
      return;
    }

    const current = document.createElement('span');
    current.className = 'project-breadcrumb-current';
    current.textContent = name;
    dom.projectBreadcrumb.appendChild(current);
  });

  if (dom.projectCurrentName) {
    dom.projectCurrentName.textContent = project.name;
  }
  if (dom.projectKindBadge) {
    dom.projectKindBadge.textContent = projectHasChildren(project) ? 'Folder' : 'Project';
  }

  const visibleTaskCount = getProjectVisibleTaskCount(project);
  const activeTaskCount = getProjectVisibleActiveCount(project);
  const overdueCount = getProjectVisibleOverdueCount(project);
  const completedCount = Number(projectHasChildren(project)
    ? project.rollup_completed_count ?? 0
    : project.completed_count ?? 0);
  const childCount = Number(project.child_count || 0);
  const folderSummary = projectHasChildren(project)
    ? `Folder rollup across ${childCount} child board${childCount === 1 ? '' : 's'}.`
    : 'Focused board for direct task execution.';

  dom.projectSummary.textContent = `${folderSummary} ${visibleTaskCount} total tasks, ${activeTaskCount} active, ${completedCount} completed, ${overdueCount} overdue.`;

  if (dom.projectMetrics) {
    const metrics = [
      { label: 'Total tasks', value: visibleTaskCount },
      { label: 'Active work', value: activeTaskCount },
      { label: 'Completed', value: completedCount },
      { label: projectHasChildren(project) ? 'Child boards' : 'Depth', value: projectHasChildren(project) ? childCount : Number(project.depth || 0) }
    ];

    dom.projectMetrics.innerHTML = '';
    metrics.forEach((metric) => {
      const card = document.createElement('div');
      card.className = 'project-metric-card';
      const strong = document.createElement('strong');
      strong.textContent = String(metric.value);
      const label = document.createElement('span');
      label.textContent = metric.label;
      card.append(strong, label);
      dom.projectMetrics.appendChild(card);
    });
  }

  dom.projectJumpLinks.innerHTML = '';
  const rootProject = getProjectRoot(project);
  const childrenMap = buildProjectChildrenMap();

  if (dom.projectNavigatorSummary) {
    dom.projectNavigatorSummary.textContent = `Folder map for ${rootProject?.name || project.name}. Select any board in the tree to navigate the current workspace hierarchy.`;
  }

  const renderTreeNode = (treeProject, depth = 0) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'project-tree-node';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'project-tree-item';
    if (depth === 0) {
      button.classList.add('project-tree-item--root');
    }
    if (treeProject.id === project.id) {
      button.classList.add('project-tree-item--active');
    } else if (pathIds.includes(treeProject.id)) {
      button.classList.add('project-tree-item--branch');
    }
    if (projectHasChildren(treeProject)) {
      button.classList.add('project-tree-item--folder');
    }
    button.addEventListener('click', () => {
      selectProject(treeProject.id);
    });

    const kicker = document.createElement('span');
    kicker.className = 'project-tree-kicker';
    kicker.textContent = depth === 0 ? 'Workspace root' : (projectHasChildren(treeProject) ? 'Folder' : 'Child board');

    const title = document.createElement('div');
    title.className = 'project-tree-title';
    const name = document.createElement('span');
    name.textContent = treeProject.name;
    const badge = document.createElement('span');
    badge.className = 'project-nav-badge';
    badge.textContent = `${getProjectVisibleTaskCount(treeProject)} tasks`;
    title.append(name, badge);

    const meta = document.createElement('div');
    meta.className = 'project-tree-meta';
    meta.textContent = `${getProjectVisibleActiveCount(treeProject)} active, ${getProjectVisibleOverdueCount(treeProject)} overdue${projectHasChildren(treeProject) ? `, ${treeProject.child_count} child boards` : ''}.`;

    button.append(kicker, title, meta);
    wrapper.appendChild(button);

    const childProjects = childrenMap.get(treeProject.id) || [];
    if (childProjects.length > 0) {
      const branch = document.createElement('div');
      branch.className = 'project-tree-children';
      childProjects.forEach((childProject) => {
        branch.appendChild(renderTreeNode(childProject, depth + 1));
      });
      wrapper.appendChild(branch);
    }

    return wrapper;
  };

  if (rootProject) {
    dom.projectJumpLinks.appendChild(renderTreeNode(rootProject, 0));
  }

  if (dom.projectAddChildBtn) {
    dom.projectAddChildBtn.disabled = false;
    dom.projectAddChildBtn.textContent = 'Add child';
  }
  if (dom.projectEditBtn) {
    dom.projectEditBtn.disabled = false;
  }
  if (dom.projectArchiveBtn) {
    dom.projectArchiveBtn.disabled = false;
    dom.projectArchiveBtn.textContent = projectHasChildren(project) ? 'Archive tree' : 'Archive';
  }
}

async function ensureSelectedProject(state) {
  if (state.project_id) {
    const existingProject = await fetchProjectById(state.project_id);
    if (existingProject) {
      await loadProjectOptions({
        selectedProjectId: state.project_id,
        injectProject: existingProject
      });
      return state.project_id;
    }
  }

  const defaultProject = await fetchDefaultProject();
  if (!defaultProject) {
    await loadProjectOptions();
    showNotice('No active projects available.', 'error');
    return null;
  }

  const nextState = {
    ...state,
    project_id: defaultProject.id,
    tasks: [],
    categories: ['General'],
    lastSyncTime: null,
    search: '',
    categoryFilter: 'all',
    filter: 'all',
    savedViews: [],
    activeSavedViewId: null
  };

  await setState(nextState);
  await loadProjectOptions({
    selectedProjectId: defaultProject.id,
    injectProject: defaultProject
  });

  return defaultProject.id;
}

/**
 * Render saved views options in the select dropdown
 */
function renderSavedViewOptions() {
  if (!dom.savedViewSelect) return;
  const state = getStateSync() || {};
  const views = Array.isArray(state.savedViews) ? state.savedViews : [];

  // Remember current selection
  const currentValue = dom.savedViewSelect.value;

  // Clear all except first placeholder
  dom.savedViewSelect.innerHTML = '<option value="">Load view...</option>';

  views.forEach(view => {
    const option = document.createElement('option');
    option.value = view.id;
    option.textContent = view.name;
    if (view.id === currentValue) {
      option.selected = true;
    } else if (view.id === state.activeSavedViewId) {
      option.selected = true;
    }
    dom.savedViewSelect.appendChild(option);
  });

  // If not matching any, reset to placeholder
  if (!views.find(v => v.id === currentValue) && currentValue !== '') {
    dom.savedViewSelect.value = '';
  }
}

/**
 * Load saved views for current project from API
 */
async function loadSavedViews(projectId) {
  if (!projectId) return;
  try {
    const res = await fetch(`/api/views?project_id=${encodeURIComponent(projectId)}`);
    if (!res.ok) {
      if (res.status === 404) {
        await setSavedViews([]);
        return;
      }
      throw new Error(`Failed to fetch saved views: ${res.status}`);
    }
    const views = await res.json();
    await setSavedViews(views);
  } catch (err) {
    console.error('[Dashboard] loadSavedViews error:', err);
  }
}

/**
 * Handle Save View button click
 */
async function handleSaveView() {
  const state = await getState();
  if (!state.project_id) {
    showNotice('Please select a project first.', 'error');
    return;
  }
  const name = prompt('Enter a name for this view:');
  if (!name) return; // cancelled

  const filters = {
    filter: state.filter,
    search: state.search,
    categoryFilter: state.categoryFilter,
    sort: state.sort
  };

  try {
    const res = await fetch('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: state.project_id,
        name,
        filters,
        sort: state.sort,
        created_by: 'main'
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save view');
    }
    const view = await res.json();
    await addSavedView(view);
    showNotice('View saved.', 'success');
    await loadSavedViews(state.project_id); // refresh
    dom.savedViewSelect.value = view.id;
    setActiveView(view.id);
  } catch (err) {
    showNotice(`Save failed: ${err.message}`, 'error');
  }
}

/**
 * Handle Apply View from select
 */
async function handleApplyView() {
  const viewId = dom.savedViewSelect.value;
  if (!viewId) {
    // If placeholder selected, clear active view
    await setActiveView(null);
    return;
  }
  const state = (await getState()) || {};
  const views = Array.isArray(state.savedViews) ? state.savedViews : [];
  const view = views.find(v => v.id === viewId);
  if (!view) {
    showNotice('View not found.', 'error');
    return;
  }

  const updates = {
    filter: view.filters.filter || 'all',
    search: view.filters.search || '',
    categoryFilter: view.filters.categoryFilter || 'all',
    sort: view.filters.sort || 'newest',
    activeSavedViewId: viewId
  };
  await updateState(updates);
  await loadTasks(false);
}

/**
 * Handle Delete View button click
 */
async function handleDeleteView() {
  const viewId = dom.savedViewSelect.value;
  if (!viewId) {
    showNotice('No view selected to delete.', 'error');
    return;
  }
  const confirmed = confirm('Delete this saved view?');
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/views/${viewId}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete view');
    }
    await removeSavedView(viewId);
    showNotice('View deleted.', 'success');
    dom.savedViewSelect.value = '';
    const state = (await getState()) || {};
    await loadSavedViews(state.project_id);
  } catch (err) {
    showNotice(`Delete failed: ${err.message}`, 'error');
  }
}

/**
 * Render tasks with virtual scrolling for large datasets
 * Uses skeleton loading during operation
 */
async function renderTasksWithSkeleton(state) {
  // Show skeleton loading if we have a significant number of tasks
  const filteredTaskCount = computeVisibleHierarchy(
    getFilteredTasksSync(state),
    expandedTaskIds,
    state
  ).length;
  
  if (filteredTaskCount > 0) {
    // For small datasets, render normally
    if (filteredTaskCount <= 100) {
      // Ensure virtual scroller is destroyed if active
      if (virtualScroller) {
        virtualScroller.destroy();
        virtualScroller = null;
        isVirtualScrolling = false;
        dom.taskList.style = '';
      }
      renderTasksNormal(state);
    } else {
      // For large datasets, use virtual scrolling
      if (!virtualScroller) {
        await initVirtualScroller();
      }
      renderTasksVirtual(state);
    }
  } else {
    // No tasks, clear list
    dom.taskList.innerHTML = '';
    dom.emptyState.style.display = 'block';
    dom.emptyMessage.textContent = 'No tasks yet. Add one above!';
  }
}

/**
 * Render tasks using normal DOM (for <=100 tasks)
 */
async function renderTasksNormal(state) {
  const filteredTasks = getFilteredTasksSync(state);
  const tasks = computeVisibleHierarchy(filteredTasks, expandedTaskIds, state);
  
  // Clear task list
  dom.taskList.innerHTML = '';
  
  if (tasks.length === 0) {
    dom.emptyState.style.display = 'block';
    if (state.search) {
      dom.emptyMessage.textContent = 'No tasks match your search.';
    } else if (state.filter === 'all') {
      dom.emptyMessage.textContent = 'No tasks yet. Add one above!';
    } else {
      dom.emptyMessage.textContent = `No ${state.filter} tasks right now.`;
    }
    return;
  }

  dom.emptyState.style.display = 'none';
  
  // Use document fragment for batch DOM insertion
  const fragment = document.createDocumentFragment();
  
  // Limit concurrent DOM operations to prevent jank
  const chunkSize = 25;
  for (let i = 0; i < tasks.length; i += chunkSize) {
    const chunk = tasks.slice(i, i + chunkSize);
    chunk.forEach(task => {
      const listItem = createTaskElement(task);
      fragment.appendChild(listItem);
    });
    
    // Allow browser to render after each chunk if large dataset
    if (tasks.length > 50 && i % (chunkSize * 2) === 0) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  
  dom.taskList.appendChild(fragment);
}

/**
 * Initialize virtual scroller for large datasets
 */
async function initVirtualScroller() {
  // Dynamic import to avoid loading if not needed
  if (!VirtualScroller) {
    const module = await import('./virtual-scroller.mjs');
    VirtualScroller = module.VirtualScroller || module.default;
  }

  // Ensure tasks container can be virtualized
  dom.taskList.style.display = 'flex';
  dom.taskList.style.flexDirection = 'column';
  
  virtualScroller = new VirtualScroller({
    container: dom.taskList,
    itemHeight: 100, // Estimated, will adjust based on measurements
    buffer: 10,
    renderItem: (task, index) => {
      const element = createTaskElement(task);
      element.style.position = 'absolute';
      element.style.top = `${index * 100}px`;
      element.style.width = '100%';
      element.style.boxSizing = 'border-box';
      return element;
    }
  });
  
  isVirtualScrolling = true;
  console.log('[Dashboard] Virtual scroller initialized');
}

/**
 * Render tasks using virtual scrolling
 */
async function renderTasksVirtual(state) {
  const filteredTasks = getFilteredTasksSync(state);
  const tasks = computeVisibleHierarchy(filteredTasks, expandedTaskIds, state);
  
  if (tasks.length === 0) {
    dom.emptyState.style.display = 'block';
    if (state.search) {
      dom.emptyMessage.textContent = 'No tasks match your search.';
    } else if (state.filter === 'all') {
      dom.emptyMessage.textContent = 'No tasks yet. Add one above!';
    } else {
      dom.emptyMessage.textContent = `No ${state.filter} tasks right now.`;
    }
    return;
  }

  dom.emptyState.style.display = 'none';
  
  // Update virtual scroller items
  virtualScroller.setItems(tasks);
}

/**
 * Debounced render tasks (for rapid successive updates)
 */
let renderTasksTimeout = null;
async function renderTasksDebounced() {
  clearTimeout(renderTasksTimeout);
  renderTasksTimeout = setTimeout(async () => {
    const startTime = performance.now();
    const state = await getState();
    await renderTasksWithSkeleton(state);
    const duration = performance.now() - startTime;
    performanceMonitor.record('render-tasks', duration, { 
      taskCount: state.tasks.length,
      view: currentView 
    });
  }, 50);
}

/**
 * Load tasks from the Asana API for the current project.
 * @param {boolean} includeArchived - Whether to include archived tasks.
 */
async function loadTasks(includeArchived = false, options = {}) {
  let state = await getState();
  const projectId = await ensureSelectedProject(state);
  if (!projectId) return;
  const requestId = ++activeTaskLoadRequest;

  if (projectId !== state.project_id) {
    await loadSavedViews(projectId);
    state = await getState();
  }

  try {
    let project = getProjectFromCatalog(projectId);
    if (!project) {
      project = await fetchProjectById(projectId);
    }
    const includeChildProjects = projectHasChildren(project);

    let url = `/api/tasks/all?project_id=${encodeURIComponent(projectId)}&include_archived=${includeArchived}&include_child_projects=${includeChildProjects}`;
    if (options.updated_since) {
      url += `&updated_since=${encodeURIComponent(options.updated_since)}`;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`);
    const tasks = await res.json();
    if (requestId !== activeTaskLoadRequest) return;

    const latestState = await getState();
    if (latestState.project_id && latestState.project_id !== projectId) {
      return;
    }
    if (!options.updated_since && includeArchived !== (latestState.filter === 'archived')) {
      return;
    }

    // If this is an incremental fetch (updated_since provided), merge into existing tasks.
    if (options.updated_since) {
      // Build a map of existing tasks by id
      const existingMap = new Map(latestState.tasks.map(t => [t.id, t]));
      // Update or add incoming tasks
      for (const task of tasks) {
        existingMap.set(task.id, task);
      }
      // Convert back to array, preserving order? Sort by updatedAt descending? Keep existing order for now.
      const mergedTasks = Array.from(existingMap.values());
      await setState({ ...latestState, project_id: projectId, tasks: mergedTasks, lastSyncTime: new Date().toISOString() });
    } else {
      // Full replace
      await setState({ ...latestState, project_id: projectId, tasks, lastSyncTime: new Date().toISOString() });
    }

    // Update project selector UI if present
    if (dom.projectSelect) {
      dom.projectSelect.value = projectId;
    }
  } catch (error) {
    console.error('[Dashboard] loadTasks error:', error);
    showNotice('Failed to load tasks.', 'error');
  }
}

/**
 * Start periodic incremental sync to pull changes from server
 */
function startPeriodicIncrementalSync() {
  if (incrementalSyncInterval) {
    clearInterval(incrementalSyncInterval);
  }
  incrementalSyncInterval = setInterval(async () => {
    const state = await getState();
    if (!state.project_id || !state.lastSyncTime) return;
    try {
      await loadTasks(false, { updated_since: state.lastSyncTime });
      console.log('[Dashboard] Incremental sync completed');
    } catch (err) {
      console.error('[Dashboard] Incremental sync failed:', err);
    }
  }, INCREMENTAL_SYNC_INTERVAL_MS);
}

/**
 * Main render tasks function (called by synUI)
 */
async function renderTasks() {
  const state = await getState();
  await renderTasksWithSkeleton(state);
}

/**
 * Render timeline view with lazy loading
 */
async function renderTimelineView(state) {
  // Dynamic import for timeline view (only when needed)
  if (!TimelineView) {
    try {
      const module = await import('./timeline-view.mjs');
      TimelineView = module.TimelineView || module.default;
    } catch (error) {
      console.error('[Dashboard] Failed to load timeline view:', error);
      showNotice('Timeline view unavailable. Showing list view.', 'error');
      await renderTasksWithSkeleton(state);
      return;
    }
  }

  // Create timeline instance
  try {
    window.timelineViewInstance = new TimelineView(dom.taskList, {
      dateFormat: 'MMM d, yyyy',
      groupByDay: true,
      maxVisibleGroups: 50,
      bufferGroups: 5
    });
    
    // Set and render tasks
    window.timelineViewInstance.setTasks(state.tasks);
    window.timelineViewInstance.updateFiltered(getFilteredTasksSync(state));
    
    // Show skeleton while first rendering
    showTaskSkeletons(Math.min(5, Math.ceil(state.tasks.length / 50)));
    
    // Small delay to show skeleton and allow browser to render
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log('[Dashboard] Timeline view initialized with lazy loading');
  } catch (error) {
    console.error('[Dashboard] Timeline view rendering failed:', error);
    showNotice('Failed to render timeline view. Showing list view.', 'error');
    await renderTasksWithSkeleton(state);
  }
}

/**
 * Render board view (Kanban).
 * @param {Object} state - Current state object.
 * @returns {Promise<void>}
 */
async function renderBoardView(state) {
  // Dynamic import for board view (only when needed)
  if (!BoardView) {
    try {
      const module = await import('./board-view.mjs');
      BoardView = module.BoardView || module.default;
    } catch (error) {
      console.error('[Dashboard] Failed to load board view:', error);
      showNotice('Board view unavailable. Showing list view.', 'error');
      await renderTasksWithSkeleton(state);
      return;
    }
  }

  // Require project ID
  if (!state.project_id) {
    showNotice('No project selected for board view.', 'error');
    await renderTasksWithSkeleton(state);
    return;
  }

  try {
    boardViewInstance = new BoardView(dom.taskList, {
      columnOrder: ['backlog', 'ready', 'in_progress', 'blocked', 'review', 'completed']
    });
    await boardViewInstance.setProjectId(state.project_id);
    console.log('[Dashboard] Board view initialized');
  } catch (error) {
    console.error('[Dashboard] Board view rendering failed:', error);
    showNotice('Failed to render board view. Showing list view.', 'error');
    await renderTasksWithSkeleton(state);
  }
}

/**
 * Get filtered tasks synchronously (for rendering)
 */
/**
 * Render cron jobs view
 * @param {Object} state - Current state (unused but kept for signature)
 */
async function renderCronView(state) {
  // Dynamic import for cron view (only when needed)
  if (!cronViewInstance) {
    try {
      const module = await import('./cron-view.mjs');
      const CronViewClass = module.CronView || module.default;
      cronViewInstance = new CronViewClass(dom.taskList, {
        // Options if any
      });
    } catch (error) {
      console.error('[Dashboard] Failed to load cron view:', error);
      showNotice('Cron view unavailable. Showing list view.', 'error');
      await renderTasksWithSkeleton(state);
      return;
    }
  }

  try {
    // Load and render cron jobs
    await cronViewInstance.load();
    console.log('[Dashboard] Cron view initialized');
  } catch (error) {
    console.error('[Dashboard] Cron view rendering failed:', error);
    showNotice('Failed to load cron jobs. Showing list view.', 'error');
    await renderTasksWithSkeleton(state);
  }
}

function getFilteredTasksSync(state) {
  let filtered = state.tasks;

  // Filter by status
  if (state.filter === 'pending') {
    filtered = filtered.filter(task => isTaskPending(task));
  } else if (state.filter === 'completed') {
    filtered = filtered.filter(task => isTaskCompleted(task));
  } else if (state.filter === 'archived') {
    filtered = filtered.filter(task => isTaskArchived(task));
  } else if (state.filter === 'my_tasks') {
    if (currentAgent) {
      filtered = filtered.filter(task => task.owner === currentAgent && !isTaskArchived(task));
    } else {
      filtered = [];
    }
  } else if (state.filter === 'overdue') {
    const now = new Date();
    filtered = filtered.filter(task => {
      if (!isTaskPending(task)) return false;
      if (!task.due_date) return false;
      try {
        return new Date(task.due_date) < now;
      } catch (e) {
        return false;
      }
    });
  } else if (state.filter === 'blocked') {
    const taskById = new Map(state.tasks.map(t => [t.id, t]));
    filtered = filtered.filter(task => {
      if (isTaskArchived(task) || isTaskCompleted(task)) return false;
      if (task.status === 'blocked') return true;
      if (task.dependency_ids && task.dependency_ids.length > 0) {
        for (const depId of task.dependency_ids) {
          const dep = taskById.get(depId);
          if (dep) {
            if (isTaskPending(dep)) return true;
          }
        }
      }
      return false;
    });
  } else if (state.filter === 'no_due_date') {
    filtered = filtered.filter(task => !task.due_date && !isTaskArchived(task));
  }

  // Filter by category
  if (state.categoryFilter !== 'all') {
    filtered = filtered.filter(task => task.category === state.categoryFilter);
  }

  // Filter by search
  if (state.search) {
    const query = state.search.toLowerCase();
    filtered = filtered.filter(task =>
      task.text.toLowerCase().includes(query) ||
      (task.category || '').toLowerCase().includes(query)
    );
  }

  // Sort (simple sync version)
  const sorted = [...filtered];
  switch (state.sort) {
    case 'oldest':
      sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      break;
    case 'updated':
      sorted.sort((a, b) => {
        const dateA = a.updatedAt || a.createdAt;
        const dateB = b.updatedAt || b.createdAt;
        return new Date(dateB) - new Date(dateA);
      });
      break;
    case 'alpha':
      sorted.sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }));
      break;
    case 'newest':
    default:
      sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  return sorted;
}

/**
 * Compute visible hierarchy from filtered tasks based on expansion state.
 * @param {Object[]} tasks - Filtered task list.
 * @param {Set<string|number>} expandedIds - Set of expanded task IDs.
 * @param {Object} state - Current dashboard state.
 * @returns {Object[]} Visible task array with __depth, __hasChildren, __isExpanded, __childStats.
 */
function computeVisibleHierarchy(tasks, expandedIds, state = null) {
  const taskMap = new Map();
  const childrenMap = new Map();
  const autoExpand = shouldAutoExpandHierarchy(state);

  tasks.forEach(task => {
    taskMap.set(task.id, task);
    const parentId = task.parent_task_id;
    if (parentId) {
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
      childrenMap.get(parentId).push(task);
    }
  });

  // Precompute child stats for each parent
  const childStatsMap = new Map();
  childrenMap.forEach((children, parentId) => {
    const completed = children.filter(c => isTaskCompleted(c) || isTaskArchived(c)).length;
    childStatsMap.set(parentId, { total: children.length, completed });
  });

  const visible = [];

  function traverse(taskId, depth) {
    const task = taskMap.get(taskId);
    if (!task) return;
    const isExpanded = autoExpand || expandedIds.has(taskId);

    const visibleTask = { ...task };
    visibleTask.__depth = depth;
    visibleTask.__hasChildren = childrenMap.has(taskId);
    visibleTask.__isExpanded = isExpanded;
    visibleTask.__childStats = childStatsMap.get(taskId) || null;

    visible.push(visibleTask);

    if (isExpanded && visibleTask.__hasChildren) {
      const children = childrenMap.get(taskId);
      children.forEach(child => traverse(child.id, depth + 1));
    }
  }

  // Find roots: tasks with no parent or parent not in current task set
  tasks.forEach(task => {
    if (!task.parent_task_id || !taskMap.has(task.parent_task_id)) {
      traverse(task.id, 0);
    }
  });

  return visible;
}

/**
 * Render worker results (async filtering done in worker)
 */
async function renderWorkerResults(result) {
  dom.taskList.innerHTML = '';
  
  if (result.length === 0) {
    dom.emptyState.style.display = 'block';
    return;
  }

  dom.emptyState.style.display = 'none';
  
  const fragment = document.createDocumentFragment();
  result.forEach(task => {
    const element = createTaskElement(task);
    fragment.appendChild(element);
  });
  
  dom.taskList.appendChild(fragment);
}

/**
 * Show task skeletons during loading
 */
function showTaskSkeletons(count = 8) {
  dom.emptyState.style.display = 'none';
  dom.taskList.innerHTML = '';
  const skeletons = skeletonLoader.createTaskSkeletons(count);
  dom.taskList.appendChild(skeletons);
}

/**
 * Create a task element (read mode) with memoization
 * If editing this task, returns an edit form element instead.
 */
function createTaskElement(task) {
  // If this task is being edited, return edit form
  if (editingId === task.id) {
    return createEditElement(task);
  }

  // Check if we have a recycled element
  let element = taskPool.pop();
  
  if (!element) {
    // Create new element
    const main = document.createElement('div');
    main.className = 'task-main';

    // Chevron for hierarchy toggle (hidden by default, shown if has children)
    const chevronBtn = document.createElement('button');
    chevronBtn.className = 'chevron-btn';
    chevronBtn.type = 'button';
    chevronBtn.textContent = '▶';
    chevronBtn.style.cssText = 'margin-right: 6px; background:none; border:none; cursor:pointer; padding:0; font-size:0.8em; color:var(--muted);';
    chevronBtn.aria_label = 'Toggle subtasks';
    // We'll attach click handler later after element is constructed

    const text = document.createElement('span');
    text.className = 'task-text';
    
    const meta = document.createElement('span');
    meta.className = 'task-meta';

    const category = document.createElement('span');
    category.className = 'category-badge';

    const projectBadge = document.createElement('span');
    projectBadge.className = 'project-chip';
    
    const dates = document.createElement('span');

    meta.append(category, projectBadge, dates);
    // Prepend chevron to main before text
    main.append(chevronBtn, text, meta);

    const description = document.createElement('div');
    description.className = 'task-description';

    const recurrenceBadge = document.createElement('span');
    recurrenceBadge.className = 'recurrence-badge';

    const modelBadge = document.createElement('span');
    modelBadge.className = 'model-chip';

    const runtimeBadge = document.createElement('span');
    runtimeBadge.className = 'runtime-chip';

    const sessionBadge = document.createElement('span');
    sessionBadge.className = 'session-badge';
    sessionBadge.style.cssText = 'margin-left:8px; font-size:0.85em; padding:2px 6px; border-radius:4px; background:var(--accent-3); color:var(--bg); cursor:pointer;';



    // Dependency badge (shows count of dependencies)
    const dependencyBadge = document.createElement('span');
    dependencyBadge.className = 'dependency-badge';
    dependencyBadge.style.cssText = 'margin-left:8px; font-size:0.85em; color:var(--accent-3);';

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    const completeBtn = createActionButton('Done', 'complete-btn', null);
    const editBtn = createActionButton('Edit', 'edit-btn', null);
    const manageBtn = createActionButton('Archive', 'manage-btn', null); // Will toggle Archive/Restore
    const deleteBtn = createActionButton('Delete', 'delete-btn', null);

    const runOpenClawBtn = createActionButton('Run with OpenClaw', 'run-openclaw-btn', null);
    actions.append(completeBtn, editBtn, manageBtn, deleteBtn, runOpenClawBtn);

    const container = document.createElement('div');
    container.style.display = 'contents';
    container.append(main, actions);
    
    element = {
      container,
      main,
      chevronBtn,
      text,
      meta,
      category,
      projectBadge,
      dates,
      description,
      recurrenceBadge,
      modelBadge,
      runtimeBadge,
      sessionBadge,
      dependencyBadge,

      actions,
      completeBtn,
      editBtn,
      manageBtn,
      deleteBtn
    };
  }

  // Populate with task data
  element.text.textContent = task.text;
  element.category.textContent = task.category || 'General';
  element.dates.textContent = `Created ${formatDate(task.createdAt)}${task.updatedAt ? ` • Updated ${formatDate(task.updatedAt)}` : ''}`;

  // Reset meta content and re-add category and dates
  element.meta.innerHTML = '';
  element.meta.append(element.category);

  const activeProject = getProjectFromCatalog(latestStateSnapshot.project_id);
  if (task.project_name && (task.project_rollup || projectHasChildren(activeProject) || task.project_id !== latestStateSnapshot.project_id)) {
    element.projectBadge.textContent = task.project_name;
    element.projectBadge.title = task.project_path || task.project_name;
    element.meta.append(element.projectBadge);
  }

  element.meta.append(element.dates);

  if (task.description) {
    const trimmed = task.description.trim();
    if (trimmed) {
      const truncated = trimmed.length > 100 ? `${trimmed.slice(0, 100)}...` : trimmed;
      element.description.textContent = truncated;
      if (!element.description.isConnected) {
        element.main.appendChild(element.description);
      }
    } else if (element.description.isConnected) {
      element.description.remove();
    }
  } else if (element.description.isConnected) {
    element.description.remove();
  }

  const completed = isTaskCompleted(task);
  const archived = isTaskArchived(task);

  if (completed) {
    element.container.classList.add('completed');
    element.text.style.textDecoration = 'line-through';
    element.text.style.color = 'var(--muted)';
    element.completeBtn.setAttribute('aria-pressed', 'true');
  } else {
    element.container.classList.remove('completed');
    element.text.style.textDecoration = '';
    element.text.style.color = '';
    element.completeBtn.setAttribute('aria-pressed', 'false');
  }

  // Clear any previous priority/overdue classes
  element.container.classList.remove('priority-low','priority-medium','priority-high','priority-critical','overdue');

  // Apply priority class
  const priority = task.priority || 'medium';
  element.container.classList.add(`priority-${priority}`);

  // Apply overdue class if applicable (pending task with due date in the past)
  if (task.due_date && isTaskPending(task)) {
    const due = new Date(task.due_date);
    const now = new Date();
    if (due < now) {
      element.container.classList.add('overdue');
    }
  }

  // Add owner chip if task has an owner
  if (task.owner) {
    const ownerChip = createOwnerChip(task);
    element.meta.appendChild(ownerChip);
  }

  const preferredModel = getTaskPreferredModel(task);
  if (preferredModel) {
    element.modelBadge.textContent = `Model ${getModelChipLabel(preferredModel)}`;
    element.modelBadge.title = preferredModel;
    element.meta.appendChild(element.modelBadge);
  }

  const runtimeChip = getTaskRuntimeChip(task);
  if (runtimeChip) {
    element.runtimeBadge.textContent = runtimeChip.label;
    element.runtimeBadge.title = runtimeChip.title;
    element.meta.appendChild(element.runtimeBadge);
  }

  if (task.recurrence_rule && !completed && !archived) {
    element.recurrenceBadge.textContent = `🔄 ${task.recurrence_rule}`;
    element.meta.appendChild(element.recurrenceBadge);
  }

  // Hierarchical display: indentation, chevron, child progress
  const depth = task.__depth || 0;
  element.main.style.paddingLeft = `${depth * 20}px`; // 20px per level

  if (task.__hasChildren) {
    element.chevronBtn.style.display = 'inline-block';
    element.chevronBtn.textContent = task.__isExpanded ? '▼' : '▶';
    element.chevronBtn.onclick = (e) => {
      e.stopPropagation();
      toggleExpansion(task.id);
    };
  } else {
    element.chevronBtn.style.display = 'none';
  }

  // Child progress indicator (e.g., "2/5")
  if (task.__childStats) {
    const { total, completed } = task.__childStats;
    const progressSpan = document.createElement('span');
    progressSpan.className = 'child-progress';
    progressSpan.style.cssText = 'margin-left:8px; font-size:0.85em; color:var(--muted);';
    progressSpan.textContent = `${completed}/${total}`;
    element.meta.appendChild(progressSpan);
  }

  // Dependency badge (shows count of dependencies)
  if (task.dependency_ids && task.dependency_ids.length > 0) {
    element.dependencyBadge.textContent = `📎 ${task.dependency_ids.length}`;
    element.dependencyBadge.title = `${task.dependency_ids.length} dependency${task.dependency_ids.length>1?'s':''}`;
    element.meta.appendChild(element.dependencyBadge);
  }

  // Session badge (shows active workflow run with session binding)
  if (task.active_workflow_run_id && !completed && !archived) {
    fetchAndDisplaySession(task.active_workflow_run_id, element.sessionBadge);
  } else {
    // Clear badge if no active run
    element.sessionBadge.textContent = '';
  }

  // Update button event handlers
  element.completeBtn.onclick = () => handleToggleTask(task.id);
  element.editBtn.onclick = () => startEdit(task.id);
  element.deleteBtn.onclick = () => deleteTaskById(task.id);

  // Run with OpenClaw button
  element.runOpenClawBtn.onclick = (e) => {
    e.stopPropagation();
    openWorkflowLauncher(task);
  };

  // Configure manage button (archive/restore) based on task state
  if (archived) {
    element.manageBtn.textContent = 'Restore';
    element.manageBtn.onclick = () => restoreTaskById(task.id);
  } else {
    element.manageBtn.textContent = 'Archive';
    element.manageBtn.onclick = () => archiveTaskById(task.id);
  }

  // Return the container element (not the wrapper object)
  return element.container;
}

/**
 * Return a task element to the pool for recycling
 */
function recycleTaskElement(element) {
  if (element && element.parentNode) {
    element.remove();
  }
  // We could pool the element objects, but simpler to just re-create for now
  // For max performance, implement a proper element pool
}

/**
 * Fetch and display session information for active workflow run
 */
async function fetchAndDisplaySession(workflowRunId, badgeElement) {
  try {
    const response = await fetch(`/api/workflow-runs/${workflowRunId}`);
    if (!response.ok) {
      badgeElement.textContent = '';
      return;
    }

    const run = await response.json();

    // Map status to icon and label
    const statusMap = {
      'queued': { icon: '⏳', label: 'Queued' },
      'running': { icon: '▶️', label: 'Running' },
      'waiting_for_approval': { icon: '⛱️', label: 'Awaiting Approval' },
      'blocked': { icon: '⛔', label: 'Blocked' },
      'retrying': { icon: '🔄', label: 'Retrying' },
      'completed': { icon: '✅', label: 'Completed' },
      'failed': { icon: '❌', label: 'Failed' },
      'cancelled': { icon: '🚫', label: 'Cancelled' }
    };
    const statusInfo = statusMap[run.status] || { icon: '❓', label: run.status };
    const artifactCount = Number(run.actualArtifactCount ?? run.actual_artifact_count) || 0;

    // Build badge content
    let badgeText = '';
    let title = `Workflow: ${run.workflow_type}\nStatus: ${run.status}`;
    if (artifactCount > 0) {
      title += `\nArtifacts: ${artifactCount}`;
    }

    if (run.gateway_session_id && run.gateway_session_active) {
      // Active session bound
      const sessionIcon = '🤖';
      const stepInfo = run.current_step ? ` • ${run.current_step.replace(/_/g, ' ')}` : '';
      const artifactInfo = artifactCount > 0 ? ` • 📦 ${artifactCount}` : '';
      badgeText = `${sessionIcon} ${statusInfo.icon} ${statusInfo.label}${stepInfo}${artifactInfo}`;
      title += `\nSession: ${run.gateway_session_id} (active)`;
      // Pulse animation
      badgeElement.style.animation = 'pulse 2s infinite';
      badgeElement.style.cursor = 'pointer';
    } else if (run.status === 'running' || run.status === 'queued') {
      // Active but no session yet
      badgeText = `${statusInfo.icon} ${statusInfo.label}${artifactCount > 0 ? ` • 📦 ${artifactCount}` : ''}`;
      title += '\nNo active session';
      badgeElement.style.background = 'var(--muted)';
    } else {
      // Terminal states (completed, failed, cancelled) - show status without pulse
      badgeText = `${statusInfo.icon} ${statusInfo.label}${artifactCount > 0 ? ` • 📦 ${artifactCount}` : ''}`;
      badgeElement.style.background = '';
      badgeElement.style.animation = 'none';
    }

    badgeElement.textContent = badgeText;
    badgeElement.title = title;

    // Attach click handler to show details for any non-terminal state or if run has steps
    if (run.status !== 'completed' && run.status !== 'failed' && run.status !== 'cancelled') {
      badgeElement.onclick = () => showSessionDetails(workflowRunId);
    } else {
      badgeElement.onclick = null;
    }

  } catch (error) {
    console.error('[Session Badge] Failed to fetch workflow run:', error);
    badgeElement.textContent = '';
  }
}

/**
 * Show session details in a modal or panel
 */
async function showSessionDetails(workflowRunId) {
  try {
    const response = await fetch(`/api/workflow-runs/${workflowRunId}`);
    if (!response.ok) return;

    const run = await response.json();

    // Build timeline events
    const events = [];

    // Task creation (if available via task_id)
    if (run.task_id) {
      // Ideally we'd fetch task creation date, but for now we can estimate from run.created_at
      // We'll include run creation as the first event
      events.push({
        time: run.created_at,
        icon: '📝',
        label: 'Workflow run created',
        detail: `Type: ${run.workflow_type}`
      });
    }

    // Run started
    if (run.started_at) {
      events.push({
        time: run.started_at,
        icon: '▶️',
        label: 'Workflow started',
        detail: `Agent: ${run.owner_agent_id}`
      });
    }

    // Add step events
    if (run.steps && run.steps.length > 0) {
      run.steps.forEach(step => {
        if (step.started_at) {
          events.push({
            time: step.started_at,
            icon: step.status === 'completed' ? '✅' : step.status === 'failed' ? '❌' : '⏳',
            label: step.step_name.replace(/_/g, ' '),
            detail: `Status: ${step.status}${step.finished_at ? ', completed: ${formatDate(step.finished_at)}' : ''}`
          });
        }
      });
    }

    // Run completion or failure
    if (run.finished_at) {
      const icon = run.status === 'completed' ? '🏁' : run.status === 'failed' ? '💥' : '⏹️';
      events.push({
        time: run.finished_at,
        icon: icon,
        label: `Workflow ${run.status}`,
        detail: run.last_error ? `Error: ${run.last_error}` : ''
      });
    }

    const approvals = Array.isArray(run.approvals) ? run.approvals : [];
    approvals.forEach((approval) => {
      if (approval.requestedAt) {
        events.push({
          time: approval.requestedAt,
          icon: '🛂',
          label: `Approval requested: ${approval.stepName || approval.approvalType || 'review'}`,
          detail: `Approver: ${approval.approverId || 'unassigned'}${approval.dueAt ? `, due: ${formatTimestamp(approval.dueAt)}` : ''}`
        });
      }

      if (approval.escalatedAt) {
        events.push({
          time: approval.escalatedAt,
          icon: '📣',
          label: `Approval escalated: ${approval.stepName || approval.approvalType || 'review'}`,
          detail: `Escalated to: ${approval.escalatedTo || 'unassigned'}${approval.escalationReason ? `, reason: ${approval.escalationReason}` : ''}`
        });
      }

      if (approval.decidedAt) {
        const decisionIcon = approval.status === 'approved'
          ? '✅'
          : approval.status === 'rejected'
            ? '⛔'
            : '🚫';
        events.push({
          time: approval.decidedAt,
          icon: decisionIcon,
          label: `Approval ${approval.status || 'updated'}`,
          detail: `${approval.decidedBy || approval.approverId || 'system'}${approval.decision ? `, note: ${approval.decision}` : ''}`
        });
      }
    });

    // Sort events by time
    events.sort((a, b) => new Date(a.time) - new Date(b.time));

    const approvalSummary = run.approvalSummary || {};
    const approvalSummaryCards = [
      { label: 'Pending', value: approvalSummary.pending || 0 },
      { label: 'Overdue', value: approvalSummary.overdue || 0 },
      { label: 'Escalated', value: approvalSummary.escalated || 0 },
      { label: 'Artifact-linked', value: approvalSummary.artifactLinked || 0 }
    ];
    const approvalsHtml = approvals.length > 0
      ? `
        <div style="margin-bottom: 20px; padding: 12px; background: var(--bg-2); border-radius: 8px;">
          <h4 style="margin: 0 0 8px 0;">Approval Summary</h4>
          <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
            ${approvalSummaryCards.map((card) => `
              <div style="background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:10px 12px; min-width:120px;">
                <div style="font-size:1.2em; font-weight:700;">${card.value}</div>
                <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(card.label)}</div>
              </div>
            `).join('')}
          </div>
          <div style="display:grid; gap:8px;">
            ${approvals.map((approval) => `
              <div style="display:grid; gap:6px; padding:10px; border-radius:8px; background:var(--surface); border:1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; gap:8px; align-items:center; flex-wrap:wrap;">
                  <strong>${escapeHtml(approval.stepName || approval.approvalType || 'Approval')}</strong>
                  <span style="color:var(--muted); font-size:0.85em;">${escapeHtml(approval.statusInfo?.icon || '🛂')} ${escapeHtml(approval.statusInfo?.label || approval.status || 'Pending')}</span>
                </div>
                <div style="color:var(--muted); font-size:0.9em;">Type: ${escapeHtml((approval.approvalType || 'step_gate').replace(/_/g, ' '))} • Approver: ${escapeHtml(approval.approverId || 'unassigned')}</div>
                <div style="color:var(--muted); font-size:0.9em;">Requested by ${escapeHtml(approval.requestedBy || 'system')} • ${escapeHtml(formatTimestamp(approval.requestedAt))}${approval.dueAt ? ` • Due ${escapeHtml(formatTimestamp(approval.dueAt))}` : ''}</div>
                ${approval.artifact ? `
                  <div style="font-size:0.9em; word-break:break-word;">
                    Artifact: <a href="${escapeHtml(approval.artifact.uri || '#')}" target="_blank" rel="noreferrer">${escapeHtml(approval.artifact.label || approval.artifact.uri || 'Open artifact')}</a>
                  </div>
                ` : ''}
                ${approval.decision ? `<div style="font-size:0.9em;">Decision note: ${escapeHtml(approval.decision)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `
      : '';

    const artifacts = Array.isArray(run.artifacts) ? run.artifacts : [];
    const artifactsHtml = artifacts.length > 0
      ? `
        <div style="margin-bottom: 20px; padding: 12px; background: var(--bg-2); border-radius: 8px;">
          <h4 style="margin: 0 0 8px 0;">Recorded Artifacts</h4>
          <div style="display:grid; gap:8px;">
            ${artifacts.map((artifact) => `
              <div style="display:grid; gap:2px; padding:10px; border-radius:8px; background:var(--surface); border:1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; gap:8px; align-items:center; flex-wrap:wrap;">
                  <strong>${escapeHtml(artifact.label || artifact.artifact_type || 'Artifact')}</strong>
                  <span style="color:var(--muted); font-size:0.85em;">${escapeHtml((artifact.status || 'generated').replace(/_/g, ' '))}</span>
                </div>
                <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(artifact.artifact_type || 'output')} ${artifact.created_by ? `• ${escapeHtml(artifact.created_by)}` : ''}</div>
                <div style="font-size:0.9em; word-break:break-word;">
                  <a href="${escapeHtml(artifact.uri || '#')}" target="_blank" rel="noreferrer">${escapeHtml(artifact.uri || 'Open artifact')}</a>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `
      : '';

    const governancePolicies = Array.isArray(run.governance?.actionPolicy) ? run.governance.actionPolicy : [];
    const governanceHtml = `
      <div style="margin-bottom: 20px; padding: 12px; background: var(--bg-2); border-radius: 8px;">
        <h4 style="margin: 0 0 8px 0;">Governance & Runbook</h4>
        <div style="color: var(--muted); font-size: 0.92em; margin-bottom: 10px;">
          Runbook: ${run.governance?.runbookRef ? `<a href="/api/runbook/${encodeURIComponent(run.governance.runbookRef)}" target="_blank" rel="noreferrer">${escapeHtml(run.governance.runbookRef)}</a>` : 'No runbook linked'}
        </div>
        ${governancePolicies.length ? `
          <div style="display:grid; gap:8px;">
            ${governancePolicies.map((policy) => `
              <div style="padding:10px; border-radius:8px; background:var(--surface); border:1px solid var(--border);">
                <div style="font-weight:700;">${escapeHtml(policy.label)}</div>
                <div style="color:var(--muted); font-size:0.9em;">Roles: ${escapeHtml((policy.roles || []).join(', ') || 'operator')}</div>
                ${policy.capabilities?.length ? `<div style="color:var(--muted); font-size:0.9em;">Capabilities: ${escapeHtml(policy.capabilities.join(', '))}</div>` : ''}
              </div>
            `).join('')}
          </div>
        ` : `<div style="color:var(--muted); font-size:0.92em;">No governance policy metadata is attached to this run yet.</div>`}
      </div>
    `;

    // Build timeline HTML
    const timelineHtml = events.map((ev, idx) => `
      <div class="timeline-event" style="display: flex; gap: 12px; margin-bottom: 12px; position: relative;">
        <div style="flex-shrink: 0; width: 24px; text-align: center; font-size: 1.1em;">${ev.icon}</div>
        <div style="flex-grow: 1;">
          <div style="font-weight: 600; margin-bottom: 2px;">${ev.label}</div>
          <div style="color: var(--muted); font-size: 0.9em;">
            ${formatDate(ev.time)}${ev.detail ? ` • ${ev.detail}` : ''}
          </div>
        </div>
      </div>
    `).join('');

    // Modal container
    const modal = document.createElement('div');
    modal.className = 'session-modal';
    modal.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      max-width: 640px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: var(--shadow);
      z-index: 10000;
    `;

    modal.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0;">Workflow Timeline</h3>
        <button onclick="this.closest('.session-modal').remove()" style="background:none;border:none;font-size:1.5em;cursor:pointer;color:var(--muted);">&times;</button>
      </div>
      <div style="margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border);">
        <p style="margin: 4px 0;"><strong>Workflow:</strong> ${run.workflow_type}</p>
        <p style="margin: 4px 0;"><strong>Status:</strong> ${run.status}</p>
        <p style="margin: 4px 0;"><strong>Session:</strong> ${run.gateway_session_id || 'None'} ${run.gateway_session_active ? '(active)' : ''}</p>
        <p style="margin: 4px 0;"><strong>Owner:</strong> ${run.owner_agent_id}</p>
        <p style="margin: 4px 0;"><strong>Artifacts:</strong> ${Number(run.actualArtifactCount ?? run.actual_artifact_count) || 0} / ${Number(run.expectedArtifactCount ?? run.expected_artifact_count) || 0}</p>
        ${run.current_step ? `<p style="margin: 4px 0;"><strong>Current Step:</strong> ${run.current_step.replace(/_/g, ' ')}</p>` : ''}
      </div>

      ${run.output_summary && Object.keys(run.output_summary).length > 0 ? `
        <div style="margin-bottom: 20px; padding: 12px; background: var(--bg-2); border-radius: 8px;">
          <h4 style="margin: 0 0 8px 0;">Artifacts & Outputs</h4>
          <dl style="margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 12px;">
            ${Object.entries(run.output_summary).map(([key, value]) => `
              <dt style="font-weight: 600; color: var(--text);">${key.replace(/_/g, ' ')}</dt>
              <dd style="margin: 0; color: var(--muted); word-break: break-word;">${typeof value === 'object' ? JSON.stringify(value) : value}</dd>
            `).join('')}
          </dl>
        </div>
      ` : ''}

      ${approvalsHtml}

      ${artifactsHtml}

      ${governanceHtml}

      <h4 style="margin-top:0;">Execution History</h4>
      ${events.length > 0 ? timelineHtml : '<p style="color: var(--muted);">No events recorded</p>'}
    `;

    // Close on background click
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };

    document.body.appendChild(modal);
  } catch (error) {
    console.error('[Session Modal] Failed to show timeline:', error);
  }
}


/**
 * Launch workflow launcher modal for a task
 */
async function openWorkflowLauncher(task) {
  // Fetch available workflow templates
  try {
    const response = await fetch('/api/workflow-templates');
    if (!response.ok) throw new Error('Failed to fetch workflow templates');

    const data = await response.json();
    const templates = data.templates || [];

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'workflow-launcher-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 20px;
    `;

    const panel = document.createElement('div');
    panel.className = 'workflow-launcher-panel';
    panel.style.cssText = `
      background: var(--surface);
      border-radius: 12px;
      max-width: 600px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: var(--shadow);
    `;

    const title = document.createElement('h2');
    title.textContent = 'Run with OpenClaw';
    title.style.cssText = 'margin: 0 0 8px 0; padding: 24px 24px 0 24px;';

    const subtitle = document.createElement('p');
    subtitle.textContent = `Task: ${task.text}`;
    subtitle.style.cssText = 'color: var(--muted); margin: 0 0 20px 0; padding: 0 24px;';

    const templateList = document.createElement('div');
    templateList.style.cssText = 'padding: 0 24px 24px;';

    if (templates.length === 0) {
      templateList.innerHTML = '<p style="color: var(--muted);">No workflow templates available.</p>';
    } else {
      templateList.innerHTML = templates.map(t => `
        <div class="workflow-template-item" data-template="${t.name}" style="
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 12px;
          cursor: pointer;
          transition: all 0.2s;
        " onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
          <div style="font-weight: 600; margin-bottom: 8px;">${t.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</div>
          <div style="color: var(--muted); font-size: 0.9em; margin-bottom: 8px;">${t.description || 'No description'}</div>
          <div style="display: flex; gap: 12px; font-size: 0.85em; color: var(--muted);">
            <span>Category: ${t.category}</span>
            <span>Steps: ${t.steps ? t.steps.length : 0}</span>
            ${t.estimated_duration ? `<span>Est: ${t.estimated_duration}</span>` : ''}
          </div>
          <div style="margin-top:8px; font-size:0.85em; color:var(--muted);">
            Runbook: ${t.runbookRef ? escapeHtml(t.runbookRef) : 'Not linked'}${Array.isArray(t.governance?.actionPolicy) && t.governance.actionPolicy.length ? ` • Policy: ${escapeHtml(t.governance.actionPolicy.map((policy) => policy.label).slice(0, 3).join(', '))}` : ''}
          </div>
        </div>
      `).join('');

      // Add click handlers for template selection
      templateList.querySelectorAll('.workflow-template-item').forEach(item => {
        item.onclick = () => {
          const templateName = item.dataset.template;
          modal.remove();
          launchWorkflow(task, templateName);
        };
      });
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.type = 'button';
    cancelBtn.style.cssText = 'position: absolute; top: 24px; right: 24px; background: none; border: none; font-size: 1.5em; cursor: pointer; color: var(--muted);';
    cancelBtn.onclick = () => modal.remove();

    panel.appendChild(title);
    panel.appendChild(subtitle);
    panel.appendChild(templateList);
    panel.appendChild(cancelBtn);
    modal.appendChild(panel);

    // Close on background click
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };

    document.body.appendChild(modal);

    // Focus first template item
    setTimeout(() => {
      const first = templateList.querySelector('.workflow-template-item');
      if (first) first.focus();
    }, 100);

  } catch (error) {
    console.error('[Workflow Launcher] Failed:', error);
    alert('Failed to load workflow templates. Please try again.');
  }
}

/**
 * Launch a workflow for a task with selected template
 */
async function launchWorkflow(task, workflowType) {
  try {
    // Create workflow run with session binding
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const createResponse = await fetch('/api/workflow-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow_type: workflowType,
        owner_agent_id: getTaskOwnerAgent(task), // Determine appropriate agent
        actor: 'dashboard-operator',
        board_id: task.project_id || null,
        task_id: task.id,
        initiator: 'user',
        input_payload: {
          task_id: task.id,
          task_text: task.text,
          task_description: task.description,
          task_category: task.category,
          ...task.metadata || {}
        },
        gateway_session_id: sessionId
      })
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to create workflow run: ${createResponse.status}`);
    }

    const run = await createResponse.json();

    // Bind session to run
    await fetch(`/api/workflow-runs/${run.id}/bind-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    });

    // Start the workflow
    await fetch(`/api/workflow-runs/${run.id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    // Show success notification
    showSnackbar(`Started ${workflowType} workflow for task`, 5000);

    // Refresh task list to show session badge
    fetchLatestState();

  } catch (error) {
    console.error('[Workflow Launch] Failed:', error);
    alert(`Failed to launch workflow: ${error.message}`);
  }
}

/**
 * Get appropriate agent ID for a task based on category or task properties
 */
function getTaskOwnerAgent(task) {
  // Simple routing logic - can be enhanced
  const category = task.category ? task.category.toLowerCase() : 'general';

  if (category.includes('affiliate') || category.includes('content') || category.includes('blog')) {
    return 'affiliate-editorial';
  }
  if (category.includes('image') || category.includes(' graphic')) {
    return 'image-generator';
  }
  if (category.includes('publish') || category.includes('wordpress') || category.includes('wp')) {
    return 'wordpress-publisher';
  }
  if (category.includes('site') || category.includes('fix') || category.includes('bug')) {
    return 'site-fixer';
  }
  if (category.includes('incident') || category.includes('investigation')) {
    return 'incident-investigator';
  }
  if (category.includes('code') || category.includes('development') || category.includes('programming')) {
    return 'coder';
  }
  if (category.includes('review') || category.includes('quality') || category.includes('qa')) {
    return 'qa-reviewer';
  }

  // Default agent (could be configured)
  return 'main-agent';
}

/**
 * Show a snackbar notification
 */
function showSnackbar(message, duration = 3000) {
  const snackbar = document.getElementById('snackbar');
  const messageEl = document.getElementById('snackbarMessage');

  if (snackbar && messageEl) {
    messageEl.textContent = message;
    snackbar.style.display = 'flex';
    snackbar.style.animation = 'slideIn 0.3s ease-out';

    setTimeout(() => {
      snackbar.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => snackbar.style.display = 'none', 300);
    }, duration);
  } else {
    // Fallback to alert if snackbar not available
    console.log('[Snackbar]', message);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


/**
 * Create an action button
 */
function createActionButton(text, className, onClick, ariaPressed = false) {
  const btn = document.createElement('button');
  btn.className = `action-btn ${className}`;
  btn.type = 'button';
  btn.textContent = text;
  btn.setAttribute('aria-pressed', ariaPressed);
  btn.dataset.action = className.split('-')[0];
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Render view with skeleton loading
 */
async function renderAgentSurface(state) {
  if (!AgentViewClass) {
    try {
      const module = await import('./agent-view.mjs');
      AgentViewClass = module.AgentView || module.default;
    } catch (error) {
      console.error('[Dashboard] Failed to load agent view:', error);
      showNotice('Agent view unavailable. Showing list view.', 'error');
      await renderTasksWithSkeleton(state);
      return;
    }
  }

  try {
    agentViewInstance = new AgentViewClass(dom.taskList, {
      showNotice: showNotice,
      onAgentChange: (agent) => {
        currentAgent = agent;
        if (currentView === 'list') {
          renderTasksDebounced();
        }
      }
    });
    await agentViewInstance.load();
    console.log('[Dashboard] Agent view initialized');
  } catch (error) {
    console.error('[Dashboard] Agent view rendering failed:', error);
    showNotice('Failed to render agent view. Showing list view.', 'error');
    await renderTasksWithSkeleton(state);
  }
}

async function renderAuditSurface(state) {
  try {
    if (!auditViewInstance) {
      auditViewInstance = new AuditView(dom.taskList, { limit: 50 });
    }
    await auditViewInstance.load();
    console.log('[Dashboard] Audit view initialized');
  } catch (error) {
    console.error('[Dashboard] Audit view rendering failed:', error);
    showNotice('Failed to render audit view. Showing list view.', 'error');
    await renderTasksWithSkeleton(state);
  }
}

let viewRegistry = null;

function getViewRegistry() {
  if (!viewRegistry) {
    viewRegistry = createViewRegistry({
      list: { render: renderTasksWithSkeleton },
      timeline: { render: renderTimelineView },
      cron: { render: renderCronView },
      board: { render: renderBoardView },
      agent: { render: renderAgentSurface },
      departments: { render: renderDepartmentOpsView },
      'service-requests': { render: renderServiceRequestsView },
      approvals: { render: renderApprovalsView },
      artifacts: { render: renderArtifactsView },
      dependencies: { render: supportViews.renderCrossBoardDepsView },
      health: { render: supportViews.renderHealthView },
      metrics: { render: renderMetricsView },
      'skills-tools': { render: renderSkillsToolsView },
      runbooks: { render: supportViews.renderRunbooksView },
      publish: { render: renderPublishView },
      memory: { render: supportViews.renderMemorySummaryView },
      handoffs: { render: supportViews.renderLeadHandoffsView },
      audit: { render: renderAuditSurface }
    });
  }

  return viewRegistry;
}

async function renderViewSwitch(view, state) {
  currentView = view;
  updateTaskWorkbenchVisibility(view);
  
  // Clean up any existing specialized views
  if (virtualScroller) {
    virtualScroller.destroy();
    virtualScroller = null;
    isVirtualScrolling = false;
  }
  if (window.timelineViewInstance) {
    window.timelineViewInstance.destroy();
    window.timelineViewInstance = null;
  }
  if (cronViewInstance) {
    clearInterval(cronViewInstance.refreshTimer);
    if (cronViewInstance.container) cronViewInstance.container.innerHTML = '';
    cronViewInstance = null;
  }
  if (boardViewInstance) {
    boardViewInstance.destroy?.();
    boardViewInstance = null;
  }
  if (agentViewInstance) {
    agentViewInstance.destroy();
    agentViewInstance = null;
  }
  if (auditViewInstance) {
    auditViewInstance.destroy();
    auditViewInstance = null;
  }
  supportViews.cleanup();
  
  // Reset task list styles
  dom.taskList.style = '';
  dom.taskList.innerHTML = '';

  const registry = getViewRegistry();
  const rendered = await registry.render(view, state);

  if (!rendered) {
    console.log(`[Dashboard] View '${view}' not fully implemented, showing list view`);
    showNotice(`View "${view}" is unavailable. Showing list view.`, 'error');
    await renderTasksWithSkeleton(state);
  }
  
  updateViewButtons({ ...state, view });
}

/**
 * Update stats display (optimized to batch DOM updates)
 */
async function updateStats(state) {
  const total = state.tasks.length;
  const completed = state.tasks.filter(t => isTaskCompleted(t)).length;
  const pending = state.tasks.filter(t => isTaskPending(t)).length;
  const archived = state.tasks.filter(t => isTaskArchived(t)).length;

  // Batch update
  dom.totalTasks.textContent = total;
  dom.completedTasks.textContent = completed;
  dom.pendingTasks.textContent = pending;
  dom.archivedTasks.textContent = archived;

  dom.filterAllCount.textContent = total;
  dom.filterPendingCount.textContent = pending;
  dom.filterCompletedCount.textContent = completed;
  dom.filterArchivedCount.textContent = archived;
}

/**
 * Update filter buttons state
 */
function updateFilterButtons(state) {
  dom.filterButtons.forEach(button => {
    const isActive = button.dataset.filter === state.filter;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

/**
 * Update search and sort UI to match state
 */
function updateSearchSortUI(state) {
  dom.searchInput.value = state.search || '';
  dom.sortSelect.value = state.sort || 'newest';
}

/**
 * Update theme UI
 */
function updateThemeUI(state) {
  document.documentElement.setAttribute('data-theme', state.theme);
  const isDark = state.theme === 'dark';
  if (dom.themeIcon) {
    dom.themeIcon.textContent = isDark ? '☀️' : '🌙';
  }
  if (dom.themeLabel) {
    dom.themeLabel.textContent = isDark ? 'Light mode' : 'Dark mode';
  }
  dom.themeToggle?.setAttribute('aria-pressed', isDark ? 'true' : 'false');
}

function updateTaskWorkbenchVisibility(view) {
  const shouldShow = (view || currentView || 'list') === 'list';
  if (dom.taskWorkbench) {
    dom.taskWorkbench.hidden = !shouldShow;
  }
  if (!shouldShow && dom.emptyState) {
    dom.emptyState.style.display = 'none';
  }
}

/**
 * Update view buttons state
 */
async function renderDepartmentOpsView(state) {
  await renderDepartmentsViewModule({
    state,
    mountNode: dom.taskList,
    fetchImpl: fetch,
    escapeHtml,
    showNotice,
    showSessionDetails,
    renderViewSwitch,
    getStateSync,
    formatTimestamp
  });
}
async function renderServiceRequestsView(state) {
  await renderServiceRequestsViewModule({
    state,
    mountNode: dom.taskList,
    fetchImpl: fetch,
    escapeHtml,
    showNotice,
    getStateSync,
    formatTimestamp
  });
}
async function renderApprovalsView(state) {
  await renderApprovalsViewModule({
    state,
    mountNode: dom.taskList,
    fetchImpl: fetch,
    escapeHtml,
    showNotice,
    showSessionDetails,
    formatTimestamp
  });
}
async function renderArtifactsView(state) {
  await renderArtifactsViewModule({
    state,
    mountNode: dom.taskList,
    fetchImpl: fetch,
    escapeHtml,
    showNotice,
    showSessionDetails,
    formatTimestamp
  });
}
async function renderPublishView(state) {
  return renderPublishViewModule({
    state,
    mountNode: dom.taskList,
    fetchImpl: fetch,
    escapeHtml,
    showSessionDetails,
    openVerificationModal,
    navigateToView
  });
}

/**
 * Render Metrics Dashboard view
 */
async function renderMetricsView(state) {
  return renderMetricsViewModule({
    state,
    mountNode: dom.taskList,
    fetchImpl: fetch,
    escapeHtml,
    showNotice
  });
}

/**
 * Render Skills & Tools catalog view
 */
async function renderSkillsToolsView(state) {
  return renderSkillsToolsViewModule({
    state,
    mountNode: dom.taskList,
    fetchImpl: fetch,
    escapeHtml,
    formatTimestamp,
    formatTokenLabel,
    showNotice
  });
}

function updateViewButtons(state) {
  document.querySelectorAll('.view-btn').forEach(btn => {
    const isActive = btn.dataset.view === (state?.view || currentView || 'list');
    btn.setAttribute('aria-pressed', isActive);
  });
}

/**
 * Show a notice message
 */
function showNotice(message, type = 'info') {
  if (!message) return;
  dom.notice.textContent = message;
  dom.notice.className = `notice is-visible${type === 'error' ? ' is-error' : ''}${type === 'success' ? ' is-success' : ''}`;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    dom.notice.className = 'notice';
    dom.notice.textContent = '';
  }, 4200);
}

// ==================== Task Operations ====================

async function handleToggleTask(id) {
  const startTime = performance.now();
  try {
    await toggleTask(id);
    const duration = performance.now() - startTime;
    performanceMonitor.record('toggle-task', duration);
  } catch (error) {
    showNotice('Failed to update task.', 'error');
  }
}

async function startEdit(id) {
  const state = await getState();
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  await fetchTaskOptions();
  editingId = id;
  editingText = task.text;
  editingCategory = task.category || 'General';
  editingStatus = task.status || 'backlog';
  editingPriority = task.priority || 'medium';
  editingOwner = task.owner || '';
  editingDueDate = task.due_date ? task.due_date.split('T')[0] : '';
  editingStartDate = task.start_date ? task.start_date.split('T')[0] : '';
  editingDescription = task.description || '';
  editingEstimatedEffort = task.estimated_effort || '';
  editingActualEffort = task.actual_effort || '';
  editingRecurrence = task.recurrence_rule || null;
  editingModel = getTaskPreferredModel(task) || '';
  renderTasks();
  requestAnimationFrame(() => {
    const input = document.querySelector(`[data-edit-input="${id}"]`);
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}

async function saveEdit(id) {
  const state = await getState();
  const currentTask = state.tasks.find(task => task.id === id);
  const text = editingText.trim();
  if (!text) {
    showNotice('Task text cannot be empty.', 'error');
    return;
  }

  skeletonLoader.setButtonLoading(document.querySelector('[data-action="save"]'), 'Save');

  const startTime = performance.now();
  try {
    await updateTask(id, {
      text,
      category: editingCategory,
      status: editingStatus,
      priority: editingPriority,
      owner: editingOwner || null,
      due_date: editingDueDate || null,
      start_date: editingStartDate || null,
      description: editingDescription,
      estimated_effort: editingEstimatedEffort ? Number(editingEstimatedEffort) : null,
      actual_effort: editingActualEffort ? Number(editingActualEffort) : null,
      recurrence_rule: editingRecurrence,
      metadata: buildTaskMetadata(currentTask?.metadata || {}, { preferredModel: editingModel })
    });
    editingId = null;
    editingText = '';
    editingCategory = '';
    editingStatus = '';
    editingPriority = '';
    editingOwner = '';
    editingDueDate = '';
    editingStartDate = '';
    editingDescription = '';
    editingEstimatedEffort = null;
    editingActualEffort = null;
    editingRecurrence = null;
    editingModel = '';
    showNotice('Task updated.', 'success');
    const duration = performance.now() - startTime;
    performanceMonitor.record('update-task', duration);
  } catch (error) {
    showNotice('Failed to update task.', 'error');
  } finally {
    skeletonLoader.clearButtonLoading(document.querySelector('[data-action="save"]'));
  }
}

function cancelEdit() {
  editingId = null;
  editingText = '';
  editingCategory = '';
  editingStatus = '';
  editingPriority = '';
  editingOwner = '';
  editingDueDate = '';
  editingStartDate = '';
  editingDescription = '';
  editingEstimatedEffort = null;
  editingActualEffort = null;
  editingRecurrence = null;
  editingModel = '';
  renderTasks();
}

/**
 * Toggle expansion of a task's subtasks
 * @param {string|number} taskId - Task ID to toggle
 */
function toggleExpansion(taskId) {
  if (expandedTaskIds.has(taskId)) {
    expandedTaskIds.delete(taskId);
  } else {
    expandedTaskIds.add(taskId);
  }
  // Re-render to update view
  renderTasks();
}

// ==================== UX ENHANCEMENTS ====================

// Undo snackbar
let undoAction = null;
let snackbarTimer = null;

/**
 * Show an undo snackbar with a callback to execute if undo is clicked.
 */
function showUndoSnackbar(message, onUndo) {
  const snackbar = document.getElementById('snackbar');
  const msgEl = document.getElementById('snackbarMessage');
  const undoBtn = document.getElementById('snackbarUndo');
  if (!snackbar || !msgEl || !undoBtn) {
    console.warn('Snackbar elements not found');
    if (onUndo) onUndo();
    return;
  }

  undoAction = onUndo;
  msgEl.textContent = message;
  snackbar.classList.add('visible');

  clearTimeout(snackbarTimer);
  snackbarTimer = setTimeout(() => {
    snackbar.classList.remove('visible');
    undoAction = null;
  }, 6000);

  // Replace undo button to avoid duplicate handlers
  const newUndoBtn = undoBtn.cloneNode(true);
  undoBtn.parentNode.replaceChild(newUndoBtn, undoBtn);
  newUndoBtn.onclick = () => {
    if (undoAction) {
      undoAction();
      undoAction = null;
    }
    snackbar.classList.remove('visible');
    clearTimeout(snackbarTimer);
  };
}

// Agent fetching and owner assignment
let cachedAgents = null;

/**
 * Fetch available agents from the server and cache the result.
 * Returns an array of agent names (or IDs if name missing).
 */
async function fetchAgents() {
  if (getAgentCatalog().length > 0) {
    return getAgentCatalog().map(agent => agent.id);
  }
  if (cachedAgents !== null) {
    return cachedAgents;
  }
  try {
    const res = await fetch('/api/agents');
    if (res.ok) {
      const data = await res.json();
      const agents = data.agents || [];
      cachedAgents = agents.map(a => a.agent_name || a.agent_id || a.name || a.id || a).filter(Boolean);
    } else {
      cachedAgents = [];
    }
  } catch (e) {
    console.warn('[Dashboard] Could not fetch agents:', e);
    cachedAgents = [];
  }
  return cachedAgents;
}

/**
 * Create an owner chip element for a task.
 */
function createOwnerChip(task) {
  const chip = document.createElement('span');
  chip.className = 'owner-chip';
  chip.title = task.owner ? 'Change assignment' : 'Assign to agent';
  chip.dataset.taskId = task.id;

  const name = document.createElement('span');
  name.textContent = getAgentDisplayName(task.owner);
  chip.appendChild(name);

  if (task.owner) {
    const remove = document.createElement('span');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.title = 'Clear assignment';
    remove.onclick = (e) => {
      e.stopPropagation();
      updateTask(task.id, { owner: null });
    };
    chip.appendChild(remove);
  }

  chip.onclick = (e) => {
    if (e.target.classList.contains('remove')) return;
    showOwnerDropdown(chip, task);
  };

  return chip;
}

/**
 * Show a dropdown menu to select an agent for assignment.
 */
async function showOwnerDropdown(anchorChip, task) {
  // Remove any existing dropdowns
  document.querySelectorAll('.owner-dropdown').forEach(el => el.remove());

  // Fetch agents if not cached
  const agents = await fetchAgents();

  const dropdown = document.createElement('div');
  dropdown.className = 'owner-dropdown';
  dropdown.style.position = 'fixed';
  const rect = anchorChip.getBoundingClientRect();
  dropdown.style.left = rect.left + 'px';
  dropdown.style.top = (rect.bottom + 4) + 'px';
  dropdown.style.zIndex = '1000';

  if (agents.length === 0) {
    const empty = document.createElement('button');
    empty.textContent = 'No agents';
    empty.disabled = true;
    dropdown.appendChild(empty);
  } else {
    agents.forEach(agent => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = getAgentDisplayName(agent);
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:6px 10px;background:none;border:none;color:var(--text);cursor:pointer;border-radius:4px;';
      btn.onclick = () => {
        updateTask(task.id, { owner: agent });
        dropdown.remove();
      };
      dropdown.appendChild(btn);
    });
  }

  // Close on click outside
  const close = (e) => {
    if (!dropdown.contains(e.target)) {
      dropdown.remove();
      document.removeEventListener('click', close);
    }
  };
  document.addEventListener('click', close);
  document.body.appendChild(dropdown);
}

// ==================== TASK OPERATIONS ====================

async function deleteTaskById(id) {
  const state = await getState();
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  if (confirm(`Delete "${task.text}"?`)) {
    try {
      // Snapshot for undo
      const snapshot = await getState();
      await deleteTask(id);
      showNotice('Task deleted.', 'success');
      // Show undo snackbar
      showUndoSnackbar('Task deleted.', async () => {
        // Restore state to snapshot
        await setState(snapshot);
        renderTasks();
      });
    } catch (error) {
      showNotice('Failed to delete task.', 'error');
    }
  }
}

async function archiveTaskById(id) {
  try {
    await archiveTask(id);
    showNotice('Task archived.', 'success');
    // Refresh tasks to reflect archive status (task disappears from non-archive views)
    renderTasksDebounced();
  } catch (error) {
    showNotice('Failed to archive task.', 'error');
  }
}

async function restoreTaskById(id) {
  try {
    await restoreTask(id);
    showNotice('Task restored.', 'success');
    renderTasksDebounced();
  } catch (error) {
    showNotice('Failed to restore task.', 'error');
  }
}

async function handleClearCompleted() {
  try {
    const snapshot = await getState();
    await clearCompleted();
    showNotice('Completed tasks cleared.', 'success');
    showUndoSnackbar('Completed tasks archived.', async () => {
      await setState(snapshot);
      renderTasks();
    });
  } catch (error) {
    showNotice('Failed to clear completed tasks.', 'error');
  }
}

/**
 * Create an edit form element for a task.
 */
function createEditElement(task) {
  const container = document.createElement('div');
  container.className = `task-item task-edit priority-${editingPriority || task.priority || 'medium'}`;
  container.dataset.taskId = task.id;

  const formatTokenLabel = (value) => String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());

  const createField = (labelText, control, options = {}) => {
    const field = document.createElement('label');
    field.className = 'task-edit-field';
    if (options.full) {
      field.classList.add('task-edit-field--full');
    }

    const label = document.createElement('span');
    label.className = 'task-edit-label';
    label.textContent = labelText;

    field.append(label, control);
    return field;
  };

  const createChip = (text) => {
    const chip = document.createElement('span');
    chip.className = 'task-edit-chip';
    chip.textContent = text;
    return chip;
  };

  const createPanelHeading = (title, copy) => {
    const heading = document.createElement('div');
    heading.className = 'task-edit-panel-heading';

    const titleEl = document.createElement('h4');
    titleEl.textContent = title;
    heading.appendChild(titleEl);

    if (copy) {
      const copyEl = document.createElement('p');
      copyEl.className = 'task-edit-panel-copy';
      copyEl.textContent = copy;
      heading.appendChild(copyEl);
    }

    return heading;
  };

  container.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  });

  const createdAt = task.createdAt || task.created_at;
  const updatedAt = task.updatedAt || task.updated_at;

  const header = document.createElement('div');
  header.className = 'task-edit-header';

  const heading = document.createElement('div');
  heading.className = 'task-edit-heading';

  const kicker = document.createElement('span');
  kicker.className = 'task-edit-kicker';
  kicker.textContent = 'Task editor';

  const title = document.createElement('h3');
  title.className = 'task-edit-title';
  title.textContent = editingText || task.text || 'Untitled task';

  const summary = document.createElement('div');
  summary.className = 'task-edit-summary';

  const timelineBits = [];
  if (createdAt) timelineBits.push(`Created ${formatDate(createdAt)}`);
  if (updatedAt) timelineBits.push(`Updated ${formatDate(updatedAt)}`);
  if (timelineBits.length) {
    const timeline = document.createElement('span');
    timeline.textContent = timelineBits.join(' • ');
    summary.appendChild(timeline);
  }

  const statusChip = createChip('');
  summary.appendChild(statusChip);

  if (task.parent_task_id) summary.appendChild(createChip('Subtask'));
  if (task.__childStats?.total) summary.appendChild(createChip(`${task.__childStats.total} subtasks`));

  const recurrenceChip = createChip('');
  summary.appendChild(recurrenceChip);

  const modelChip = createChip('');
  summary.appendChild(modelChip);

  const overdueChip = createChip('Overdue');
  summary.appendChild(overdueChip);

  heading.append(kicker, title, summary);
  header.appendChild(heading);

  const updatePriorityClass = () => {
    container.classList.remove('priority-low', 'priority-medium', 'priority-high', 'priority-critical');
    container.classList.add(`priority-${editingPriority || task.priority || 'medium'}`);
  };

  const refreshSummary = () => {
    statusChip.textContent = `Status: ${formatTokenLabel(editingStatus || getTaskStatus(task))}`;

    if (editingRecurrence) {
      recurrenceChip.hidden = false;
      recurrenceChip.textContent = `Repeats ${formatTokenLabel(editingRecurrence)}`;
    } else {
      recurrenceChip.hidden = true;
    }

    if (editingModel) {
      modelChip.hidden = false;
      modelChip.textContent = `Model: ${getModelChipLabel(editingModel)}`;
      modelChip.title = editingModel;
    } else {
      modelChip.hidden = true;
      modelChip.title = '';
    }

    const overdue = Boolean(
      editingDueDate &&
      editingStatus !== 'completed' &&
      editingStatus !== 'archived' &&
      new Date(`${editingDueDate}T23:59:59`).getTime() < Date.now()
    );
    overdueChip.hidden = !overdue;
  };

  // Text input
  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.value = editingText;
  textInput.dataset.editInput = task.id;
  textInput.placeholder = 'Task text';
  textInput.setAttribute('aria-label', 'Task name');
  textInput.addEventListener('input', (e) => {
    editingText = e.target.value;
    title.textContent = editingText.trim() || task.text || 'Untitled task';
  });
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit(task.id);
    }
  });

  // Category input
  const categoryInput = document.createElement('input');
  categoryInput.type = 'text';
  categoryInput.value = editingCategory;
  categoryInput.placeholder = 'Category';
  categoryInput.setAttribute('aria-label', 'Category');
  categoryInput.addEventListener('input', (e) => { editingCategory = e.target.value; });

  const titleRow = document.createElement('div');
  titleRow.className = 'task-edit-title-row';

  const descriptionInput = document.createElement('textarea');
  descriptionInput.rows = 8;
  descriptionInput.value = editingDescription;
  descriptionInput.placeholder = 'Description';
  descriptionInput.setAttribute('aria-label', 'Description');
  descriptionInput.addEventListener('input', (e) => { editingDescription = e.target.value; });
  descriptionInput.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      saveEdit(task.id);
    }
  });

  // Status select
  const statusSelect = document.createElement('select');
  ['backlog','ready','in_progress','blocked','review','completed','archived'].forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = formatTokenLabel(s);
    if (s === editingStatus) opt.selected = true;
    statusSelect.appendChild(opt);
  });
  statusSelect.setAttribute('aria-label', 'Status');
  statusSelect.addEventListener('change', () => {
    editingStatus = statusSelect.value;
    refreshSummary();
  });

  // Priority select
  const prioritySelect = document.createElement('select');
  ['low','medium','high','critical'].forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = formatTokenLabel(p);
    if (p === editingPriority) opt.selected = true;
    prioritySelect.appendChild(opt);
  });
  prioritySelect.setAttribute('aria-label', 'Priority');
  prioritySelect.addEventListener('change', () => {
    editingPriority = prioritySelect.value;
    updatePriorityClass();
  });

  // Owner input (text for now)
  const ownerInput = document.createElement('input');
  ownerInput.type = 'text';
  ownerInput.value = editingOwner;
  ownerInput.placeholder = 'Owner';
  ownerInput.setAttribute('aria-label', 'Owner');
  ownerInput.addEventListener('input', (e) => { editingOwner = e.target.value; });

  // Start date
  const startDateInput = document.createElement('input');
  startDateInput.type = 'date';
  startDateInput.value = editingStartDate;
  startDateInput.setAttribute('aria-label', 'Start date');
  startDateInput.addEventListener('input', (e) => { editingStartDate = e.target.value; });

  // Due date
  const dueDateInput = document.createElement('input');
  dueDateInput.type = 'date';
  dueDateInput.value = editingDueDate;
  dueDateInput.setAttribute('aria-label', 'Due date');
  dueDateInput.addEventListener('input', (e) => {
    editingDueDate = e.target.value;
    refreshSummary();
  });

  const estimatedEffortInput = document.createElement('input');
  estimatedEffortInput.type = 'number';
  estimatedEffortInput.step = '0.5';
  estimatedEffortInput.min = '0';
  estimatedEffortInput.placeholder = 'Est hrs';
  estimatedEffortInput.value = editingEstimatedEffort;
  estimatedEffortInput.setAttribute('aria-label', 'Estimated hours');
  estimatedEffortInput.addEventListener('input', (e) => { editingEstimatedEffort = e.target.value; });

  const actualEffortInput = document.createElement('input');
  actualEffortInput.type = 'number';
  actualEffortInput.step = '0.5';
  actualEffortInput.min = '0';
  actualEffortInput.placeholder = 'Actual hrs';
  actualEffortInput.value = editingActualEffort;
  actualEffortInput.setAttribute('aria-label', 'Actual hours');
  actualEffortInput.addEventListener('input', (e) => { editingActualEffort = e.target.value; });

  const recurrenceSelect = document.createElement('select');
  ['none', 'daily', 'weekly', 'monthly', 'yearly'].forEach(rule => {
    const opt = document.createElement('option');
    opt.value = rule;
    opt.textContent = formatTokenLabel(rule);
    recurrenceSelect.appendChild(opt);
  });
  recurrenceSelect.value = editingRecurrence || 'none';
  recurrenceSelect.setAttribute('aria-label', 'Recurrence');
  recurrenceSelect.addEventListener('change', () => {
    editingRecurrence = recurrenceSelect.value === 'none' ? null : recurrenceSelect.value;
    refreshSummary();
  });

  const modelSelect = document.createElement('select');
  const blankModelOption = document.createElement('option');
  blankModelOption.value = '';
  blankModelOption.textContent = 'No model preference';
  modelSelect.appendChild(blankModelOption);
  getModelCatalog().forEach((model) => {
    const opt = document.createElement('option');
    opt.value = model.id;
    opt.textContent = getModelDisplayName(model.id);
    modelSelect.appendChild(opt);
  });
  if (editingModel && !Array.from(modelSelect.options).some(option => option.value === editingModel)) {
    const customModelOption = document.createElement('option');
    customModelOption.value = editingModel;
    customModelOption.textContent = editingModel;
    modelSelect.appendChild(customModelOption);
  }
  modelSelect.value = editingModel || '';
  modelSelect.setAttribute('aria-label', 'Preferred model');
  modelSelect.addEventListener('change', () => {
    editingModel = modelSelect.value;
    refreshSummary();
  });

  const descriptionPanel = document.createElement('section');
  descriptionPanel.className = 'task-edit-panel';
  descriptionPanel.append(
    createPanelHeading('Task brief', 'Capture the goal, edge cases, and any notes the next person needs.'),
    createField('Description', descriptionInput, { full: true })
  );

  const detailPanel = document.createElement('section');
  detailPanel.className = 'task-edit-panel';

  const detailFields = document.createElement('div');
  detailFields.className = 'task-edit-fields';
  detailFields.append(
    createField('Status', statusSelect),
    createField('Priority', prioritySelect),
    createField('Owner', ownerInput, { full: true }),
    createField('Start date', startDateInput),
    createField('Due date', dueDateInput),
    createField('Estimated hours', estimatedEffortInput),
    createField('Actual hours', actualEffortInput),
    createField('Preferred model', modelSelect, { full: true }),
    createField('Recurrence', recurrenceSelect, { full: true })
  );

  detailPanel.append(
    createPanelHeading('Execution settings', 'Set workflow state, ownership, timing, and repeat cadence.'),
    detailFields
  );

  const body = document.createElement('div');
  body.className = 'task-edit-body';
  body.append(descriptionPanel, detailPanel);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'task-actions task-edit-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'action-btn save-btn';
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  saveBtn.dataset.action = 'save'; // for skeletonLoader
  saveBtn.addEventListener('click', () => saveEdit(task.id));

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'action-btn cancel-btn';
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', cancelEdit);

  actions.append(saveBtn, cancelBtn);

  const footer = document.createElement('div');
  footer.className = 'task-edit-footer';

  const hint = document.createElement('div');
  hint.className = 'task-edit-hint';
  hint.textContent = 'Press Ctrl+Enter inside the description to save quickly, or Esc anywhere in the editor to cancel.';

  footer.append(hint, actions);

  // Assemble
  titleRow.append(
    createField('Task name', textInput),
    createField('Category', categoryInput)
  );

  updatePriorityClass();
  refreshSummary();
  container.append(header, titleRow, body, footer);
  return container;
}

// ==================== Export/Import ====================

function exportJson() {
  skeletonLoader.setButtonLoading(dom.exportJsonBtn, 'Export JSON');
  getState().then(state => {
    const data = JSON.stringify(state.tasks, null, 2);
    downloadFile(data, 'tasks.json', 'application/json');
    skeletonLoader.clearButtonLoading(dom.exportJsonBtn);
  }).catch(() => {
    skeletonLoader.clearButtonLoading(dom.exportJsonBtn);
    showNotice('Failed to export tasks.', 'error');
  });
}

function exportCsv() {
  skeletonLoader.setButtonLoading(dom.exportCsvBtn, 'Export CSV');
  getState().then(state => {
    const headers = ['ID', 'Text', 'Category', 'Completed', 'Created At', 'Updated At'];
    const rows = state.tasks.map(t => [
      t.id,
      `"${t.text.replace(/"/g, '""')}"`,
      t.category,
      t.completed,
      t.createdAt,
      t.updatedAt || ''
    ]);
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    downloadFile(csv, 'tasks.csv', 'text/csv');
    skeletonLoader.clearButtonLoading(dom.exportCsvBtn);
  }).catch(() => {
    skeletonLoader.clearButtonLoading(dom.exportCsvBtn);
    showNotice('Failed to export tasks.', 'error');
  });
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Show loading state
  skeletonLoader.setButtonLoading(dom.importBtn, 'Importing...');

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const content = e.target.result;
      let tasks;
      if (file.name.endsWith('.json')) {
        tasks = JSON.parse(content);
      } else if (file.name.endsWith('.csv')) {
        tasks = parseCsv(content);
      } else {
        throw new Error('Unsupported file format');
      }

      if (!Array.isArray(tasks)) throw new Error('Invalid format');

      let importCount = 0;
      for (const task of tasks) {
        if (task.text || task.title) {
          await addTask(task);
          importCount++;
        }
      }
      showNotice(`Imported ${importCount} tasks.`, 'success');
    } catch (error) {
      showNotice('Failed to import tasks. Please check the file format.', 'error');
    } finally {
      skeletonLoader.clearButtonLoading(dom.importBtn);
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

function parseCsv(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const tasks = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
    const task = {};
    headers.forEach((header, index) => {
      const key = header.toLowerCase();
      if (key === 'text') task.text = values[index];
      if (key === 'category') task.category = values[index];
      if (key === 'completed') task.completed = values[index] === 'true';
    });
    if (task.text) tasks.push(task);
  }
  return tasks;
}

/**
 * Format date for display
 */
function formatTimestamp(isoString) {
  if (!isoString) {
    return 'Unknown';
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return String(isoString);
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Get current state synchronously (quick check without async)
 * Used for making fast decisions before async state load
 */
function getStateSync() {
  return latestStateSnapshot || { tasks: [], categories: [], savedViews: [] };
}

// Export for debugging
window.dashboardDebug = {
  getState,
  addTask,
  toggleTask,
  deleteTask,
  performanceMonitor,
  virtualScroller: () => virtualScroller,
  isVirtualScrolling: () => isVirtualScrolling,
  taskPool,
  workerAvailable: () => workerAvailable
};

console.log('[Dashboard] Optimized module loaded');
