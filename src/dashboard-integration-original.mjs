/**
 * Dashboard Integration Module
 * 
 * Connects the HTML UI with the StateManager and OfflineUIManager.
 * Provides the same API as the original embedded script.
 */

import { 
  init as initState, 
  getState, 
  setState, 
  addTask, 
  toggleTask, 
  updateTask, 
  deleteTask, 
  clearCompleted,
  subscribe,
  syncManager
} from './offline/state-manager.mjs';

import { offlineUI } from './offline/offline-ui.mjs';

// DOM references (same as original)
const dom = {
  themeToggle: document.getElementById('themeToggle'),
  themeIcon: document.getElementById('themeIcon'),
  themeLabel: document.getElementById('themeLabel'),
  taskInput: document.getElementById('taskInput'),
  categoryInput: document.getElementById('categoryInput'),
  addTaskBtn: document.getElementById('addTaskBtn'),
  notice: document.getElementById('notice'),
  totalTasks: document.getElementById('totalTasks'),
  completedTasks: document.getElementById('completedTasks'),
  pendingTasks: document.getElementById('pendingTasks'),
  filterAllCount: document.getElementById('filterAllCount'),
  filterPendingCount: document.getElementById('filterPendingCount'),
  filterCompletedCount: document.getElementById('filterCompletedCount'),
  filterButtons: document.querySelectorAll('.filter-btn'),
  searchInput: document.getElementById('searchInput'),
  categoryFilter: document.getElementById('categoryFilter'),
  sortSelect: document.getElementById('sortSelect'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  clearCompletedBtn: document.getElementById('clearCompletedBtn'),
  taskList: document.getElementById('taskList'),
  emptyState: document.getElementById('emptyState'),
  emptyMessage: document.getElementById('emptyMessage'),
  categoryOptions: document.getElementById('categoryOptions')
};

let editingId = null;
let editingText = '';
let editingCategory = '';
let noticeTimer = null;

(function initDashboard() {
  console.log('[Dashboard] Initializing...');

  // Initialize state manager
  initState().then(state => {
    // Initialize offline UI
    offlineUI.init();

    // Set up event listeners
    setupEventListeners(state);

    // Initial render
    syncUI(state);

    console.log('[Dashboard] Ready');
  }).catch(error => {
    console.error('[Dashboard] Initialization failed:', error);
    showNotice('Failed to initialize dashboard. Please refresh.', 'error');
  });
})();

/**
 * Set up all UI event listeners
 */
function setupEventListeners(initialState) {
  // Theme toggle
  dom.themeToggle?.addEventListener('click', () => {
    getState().then(state => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark';
      updateState({ theme: newTheme }).then(() => {
        updateThemeUI(newTheme);
      });
    });
  });

  // Add task
  dom.addTaskBtn?.addEventListener('click', async () => {
    const text = dom.taskInput.value.trim();
    if (!text) {
      showNotice('Please enter a task description.', 'error');
      dom.taskInput.focus();
      return;
    }
    try {
      await addTask(text, dom.categoryInput.value);
      dom.taskInput.value = '';
      dom.categoryInput.value = '';
      showNotice('Task added successfully.', 'success');
    } catch (error) {
      showNotice('Failed to add task.', 'error');
    }
  });

  dom.taskInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      dom.addTaskBtn?.click();
    }
  });

  // Filter buttons
  dom.filterButtons?.forEach(button => {
    button.addEventListener('click', () => {
      const filter = button.dataset.filter;
      updateState({ filter }).then(() => {
        renderTasks();
        updateFilterButtons();
      });
    });
  });

  // Search
  dom.searchInput?.addEventListener('input', (e) => {
    const search = e.target.value;
    updateState({ search }).then(() => {
      renderTasks();
      updateStats();
    });
  });

  // Category filter
  dom.categoryFilter?.addEventListener('change', (e) => {
    updateState({ categoryFilter: e.target.value }).then(() => {
      renderTasks();
    });
  });

  // Sort
  dom.sortSelect?.addEventListener('change', (e) => {
    updateState({ sort: e.target.value }).then(() => {
      renderTasks();
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
      await clearCompleted();
      showNotice('Completed tasks cleared.', 'success');
    } catch (error) {
      showNotice('Failed to clear completed tasks.', 'error');
    }
  });

  // Subscribe to state changes
  subscribe(async (event, state) => {
    switch (event) {
      case 'load':
      case 'change':
        syncUI(state);
        break;
    }
  });

  // View switcher
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      updateState({ view }).then(() => {
        renderView();
        updateViewButtons();
      });
    });
  });
}

/**
 * Synchronize all UI elements with current state
 */
async function syncUI(state) {
  renderCategoryOptions();
  renderTasks();
  updateStats(state);
  updateFilterButtons(state);
  updateSearchSortUI(state);
  updateThemeUI(state);
  updateViewButtons(state);
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

/**
 * Render task list based on current state
 */
async function renderTasks() {
  const state = await getState();
  const tasks = getFilteredTasks(state);
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
  const fragment = document.createDocumentFragment();

  tasks.forEach(task => {
    const listItem = document.createElement('li');
    listItem.className = `task-item ${task.completed ? 'completed' : ''}`;

    if (editingId === task.id) {
      listItem.appendChild(createEditForm(task));
      fragment.appendChild(listItem);
      return;
    }

    listItem.appendChild(createTaskElement(task));
    fragment.appendChild(listItem);
  });

  dom.taskList.appendChild(fragment);
}

/**
 * Create a task element (read mode)
 */
function createTaskElement(task) {
  const main = document.createElement('div');
  main.className = 'task-main';

  const text = document.createElement('span');
  text.className = 'task-text';
  text.textContent = task.text;

  const meta = document.createElement('span');
  meta.className = 'task-meta';

  const category = document.createElement('span');
  category.className = 'category-badge';
  category.textContent = task.category || 'General';

  const dates = document.createElement('span');
  dates.textContent = `Created ${formatDate(task.createdAt)}${task.updatedAt ? ` • Updated ${formatDate(task.updatedAt)}` : ''}`;

  meta.append(category, dates);
  main.append(text, meta);

  const actions = document.createElement('div');
  actions.className = 'task-actions';

  const completeBtn = createActionButton('Done', 'complete-btn', () => toggleTask(task.id), task.completed);
  const editBtn = createActionButton('Edit', 'edit-btn', () => startEdit(task.id));
  const deleteBtn = createActionButton('Delete', 'delete-btn', () => deleteTaskById(task.id));

  actions.append(completeBtn, editBtn, deleteBtn);

  const container = document.createElement('div');
  container.style.display = 'contents';
  container.append(main, actions);
  return container;
}

/**
 * Create edit form for a task
 */
function createEditForm(task) {
  const wrapper = document.createElement('div');
  wrapper.className = 'task-edit';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = editingText || task.text;
  input.dataset.editInput = task.id;
  input.addEventListener('input', (e) => editingText = e.target.value);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveEdit(task.id);
    if (e.key === 'Escape') cancelEdit();
  });

  const categoryInput = document.createElement('input');
  categoryInput.type = 'text';
  categoryInput.value = editingCategory || task.category || 'General';
  categoryInput.placeholder = 'Category';
  categoryInput.addEventListener('input', (e) => editingCategory = e.target.value);

  const actions = document.createElement('div');
  actions.className = 'task-actions';

  const saveBtn = createActionButton('Save', 'save-btn', () => saveEdit(task.id));
  const cancelBtn = createActionButton('Cancel', 'cancel-btn', cancelEdit);

  actions.append(saveBtn, cancelBtn);
  wrapper.append(input, categoryInput, actions);

  requestAnimationFrame(() => input.focus());
  return wrapper;
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
  btn.dataset.action = className.split('-')[0]; // rough mapping
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Get filtered tasks based on state
 */
function getFilteredTasks(state) {
  let filtered = state.tasks;

  // Filter by status
  if (state.filter === 'pending') {
    filtered = filtered.filter(task => !task.completed);
  } else if (state.filter === 'completed') {
    filtered = filtered.filter(task => task.completed);
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

  // Sort
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
 * Render view (placeholder implementations)
 */
function renderView() {
  // View rendering logic (board, timeline, etc.) can be added later
  renderTasks();
}

function updateViewButtons(state) {
  document.querySelectorAll('.view-btn').forEach(btn => {
    const isActive = btn.dataset.view === (state?.view || 'list');
    btn.setAttribute('aria-pressed', isActive);
  });
}

/**
 * Update stats display
 */
async function updateStats(state) {
  const currentState = state || await getState();
  const total = currentState.tasks.length;
  const completed = currentState.tasks.filter(t => t.completed).length;
  const pending = total - completed;

  dom.totalTasks.textContent = total;
  dom.completedTasks.textContent = completed;
  dom.pendingTasks.textContent = pending;

  dom.filterAllCount.textContent = total;
  dom.filterPendingCount.textContent = pending;
  dom.filterCompletedCount.textContent = completed;
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
  dom.themeIcon.textContent = isDark ? '☀️' : '🌙';
  dom.themeLabel.textContent = isDark ? 'Light mode' : 'Dark mode';
  dom.themeToggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
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

// ==================== Task Operations (wrappers) ====================

async function startEdit(id) {
  const state = await getState();
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  editingId = id;
  editingText = task.text;
  editingCategory = task.category || 'General';
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
  const text = editingText.trim();
  if (!text) {
    showNotice('Task text cannot be empty.', 'error');
    return;
  }
  try {
    await updateTask(id, {
      text,
      category: editingCategory
    });
    editingId = null;
    editingText = '';
    editingCategory = '';
    showNotice('Task updated.', 'success');
  } catch (error) {
    showNotice('Failed to update task.', 'error');
  }
}

function cancelEdit() {
  editingId = null;
  editingText = '';
  editingCategory = '';
  renderTasks();
}

async function deleteTaskById(id) {
  const state = await getState();
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  if (confirm(`Delete "${task.text}"?`)) {
    try {
      await deleteTask(id);
      showNotice('Task deleted.', 'success');
    } catch (error) {
      showNotice('Failed to delete task.', 'error');
    }
  }
}

// ==================== Export/Import ====================

function exportJson() {
  getState().then(state => {
    const data = JSON.stringify(state.tasks, null, 2);
    downloadFile(data, 'tasks.json', 'application/json');
  });
}

function exportCsv() {
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

      for (const task of tasks) {
        if (task.text) {
          await addTask(task.text, task.category);
        }
      }
      showNotice(`Imported ${tasks.length} tasks.`, 'success');
    } catch (error) {
      showNotice('Failed to import tasks. Please check the file format.', 'error');
    } finally {
      event.target.value = ''; // Reset file input
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
function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

// Export for debugging
window.dashboardDebug = {
  getState,
  addTask,
  toggleTask,
  deleteTask,
  syncManager
};
