/**
 * DOM Translation Mappings
 * Maps CSS selectors to i18n keys.
 * Uses selector-based approach to avoid requiring HTML changes.
 */

export const translationConfig = {
  // Map of selector -> { property: key } where property is 'text', 'placeholder', 'aria-label', 'title', etc.
  selectors: {
    // Header / Title (static)
    '.title-block h1': { text: 'title' },
    '.title-block p': { text: 'tagline' },

    // Theme toggle
    '#themeLabel': { text: 'theme.dark' },

    // Task input section
    '.task-input-container h2': { text: 'task.add' },
    '#taskInput': { placeholder: 'task.placeholder' },
    'label[for="taskInput"]': { text: 'task.descriptionLabel' },
    '#categoryInput': { placeholder: 'task.categoryPlaceholder' },
    'label[for="categoryInput"]': { text: 'task.categoryLabel' },
    '#addTaskBtn': { text: 'task.addBtn' },
    '#taskHint': { text: 'task.hint' },

    // Stats
    '#totalTasks': { text: 'stats.totalTasks' },
    '#completedTasks': { text: 'stats.completed' },
    '#pendingTasks': { text: 'stats.pending' },
    '#archivedTasks': { text: 'stats.archived' },

    // Filter buttons (prefix translation; count handled separately)
    'button[data-filter="all"]': { textPrefix: 'filters.all' },
    'button[data-filter="pending"]': { textPrefix: 'filters.pending' },
    'button[data-filter="completed"]': { textPrefix: 'filters.completed' },
    'button[data-filter="archived"]': { textPrefix: 'filters.archived' },
    'button[data-filter="my_tasks"]': { textPrefix: 'filters.myTasks' },
    'button[data-filter="overdue"]': { textPrefix: 'filters.overdue' },
    'button[data-filter="blocked"]': { textPrefix: 'filters.blocked' },
    'button[data-filter="no_due_date"]': { textPrefix: 'filters.noDueDate' },

    // Search
    'label[for="searchInput"]': { text: 'toolbar.searchPlaceholder' }, // actually label not present, but placeholder is on input
    '#searchInput': { placeholder: 'toolbar.searchPlaceholder' },

    // Sort
    'label[for="sortSelect"]': { text: 'toolbar.sortLabel' },
    '#sortSelect option[value="newest"]': { text: 'toolbar.sortOptions.newest' },
    '#sortSelect option[value="oldest"]': { text: 'toolbar.sortOptions.oldest' },
    '#sortSelect option[value="updated"]': { text: 'toolbar.sortOptions.updated' },
    '#sortSelect option[value="alpha"]': { text: 'toolbar.sortOptions.alpha' },

    // Category filter
    '#categoryFilter option[value="all"]': { text: 'toolbar.categoryFilter' },

    // Export / Import / Actions
    '#exportJsonBtn': { text: 'toolbar.exportJson' },
    '#exportCsvBtn': { text: 'toolbar.exportCsv' },
    '#importBtn': { text: 'toolbar.import' },
    '#clearCompletedBtn': { text: 'toolbar.archiveCompleted' },

    // Saved Views
    '#saveViewBtn': { title: 'toolbar.saveView' },
    '#deleteViewBtn': { title: 'toolbar.deleteView' },

    // View Switcher buttons (aria-label)
    '.view-btn[data-view="list"]': { 'aria-label': 'views.list' },
    '.view-btn[data-view="board"]': { 'aria-label': 'views.board' },
    '.view-btn[data-view="timeline"]': { 'aria-label': 'views.timeline' },
    '.view-btn[data-view="agent"]': { 'aria-label': 'views.agent' },
    '.view-btn[data-view="audit"]': { 'aria-label': 'views.audit' },
    '.view-btn[data-view="cron"]': { 'aria-label': 'views.cron' },

    // Empty state
    '#emptyMessage': { text: 'task.empty' },

    // Error banner
    '#errorRetryBtn': { text: 'error.retry' },
    '#errorDismissBtn': { text: 'error.dismiss' },

    // Help Modal
    '#helpModalTitle': { text: 'help.title' },
    '#helpClose': { text: 'help.close' },

    // Performance Panel
    '#perfPanel strong': { text: 'performance.title' },
    '#perfClose': { text: 'performance.close' },
    '#perfMetrics p': { text: 'performance.noMetrics' },

    // Snackbar
    '#snackbarUndo': { text: 'snackbar.undo' },

    // Project selector
    'label[for="projectSelect"]': { text: 'project.label' },
    '#projectSelect option[value=""]': { text: 'project.loading' }
  },

  // Help modal shortcuts table mapping
  helpShortcuts: [
    { key: '?', desc: 'help.shortcuts.showHelp' },
    { key: 'Esc', desc: 'help.shortcuts.closeModal' },
    { key: '1', desc: 'help.shortcuts.view1' },
    { key: '2', desc: 'help.shortcuts.view2' },
    { key: '3', desc: 'help.shortcuts.view3' },
    { key: '4', desc: 'help.shortcuts.view4' },
    { key: '5', desc: 'help.shortcuts.view5' },
    { key: '6', desc: 'help.shortcuts.view6' },
    { key: 'a', desc: 'help.shortcuts.filterAll' },
    { key: 'p', desc: 'help.shortcuts.filterPending' },
    { key: 'c', desc: 'help.shortcuts.filterCompleted' },
    { key: 'm', desc: 'help.shortcuts.filterMyTasks' },
    { key: 'o', desc: 'help.shortcuts.filterOverdue' },
    { key: 'b', desc: 'help.shortcuts.filterBlocked' },
    { key: 'n', desc: 'help.shortcuts.filterNoDueDate' },
    { key: 'Ctrl+Shift+P', desc: 'help.shortcuts.perfPanel' },
    { key: 'Enter', desc: 'help.shortcuts.addTask' }
  ]
};

/**
 * Apply translations to the DOM.
 * @param {function} t - Translation function
 */
export function applyTranslations(t) {
  const cfg = translationConfig;

  // Handle static properties
  for (const [selector, props] of Object.entries(cfg.selectors)) {
    const el = document.querySelector(selector);
    if (!el) continue;

    for (const [prop, key] of Object.entries(props)) {
      if (prop === 'text') {
        el.textContent = t(key);
      } else if (prop === 'textPrefix') {
        // Preserve count: text is like "All 5"
        const countSpan = el.querySelector('.count');
        const countText = countSpan ? ` ${countSpan.textContent}` : '';
        el.childNodes[0].textContent = t(key) + countText;
      } else if (prop === 'placeholder') {
        el.placeholder = t(key);
      } else if (prop === 'aria-label') {
        el.setAttribute('aria-label', t(key));
      } else if (prop === 'title') {
        el.title = t(key);
      } else if (prop === 'label' && el.labels) {
        el.labels[0].textContent = t(key);
      }
    }
  }

  // Update filter button counts while preserving prefix translation
  // This needs to be called after counts are updated as well; we can hook into updateFilterButtons
  // We'll create a separate function for that

  // Help shortcuts table
  updateHelpShortcuts(t);
}

/**
 * Update filter button text (prefix translation + count).
 * Should be called whenever filter counts change.
 * @param {function} t - Translation function
 */
export function updateFilterButtonTexts(t) {
  const filterButtons = document.querySelectorAll('.filter-btn');
  filterButtons.forEach(btn => {
    const filter = btn.dataset.filter;
    const countSpan = btn.querySelector('.count');
    const count = countSpan ? countSpan.textContent : '';
    const prefixKeyMap = {
      all: 'filters.all',
      pending: 'filters.pending',
      completed: 'filters.completed',
      archived: 'filters.archived',
      my_tasks: 'filters.myTasks',
      overdue: 'filters.overdue',
      blocked: 'filters.blocked',
      no_due_date: 'filters.noDueDate'
    };
    const key = prefixKeyMap[filter];
    if (key) {
      // Set text node before count span
      const textNode = btn.childNodes[0];
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        textNode.textContent = t(key) + (count ? ' ' : '');
      }
    }
  });
}

/**
 * Update help modal shortcuts table.
 * @param {function} t - Translation function
 */
export function updateHelpShortcuts(t) {
  const tbody = document.querySelector('#helpModal tbody');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('tr');
  rows.forEach((row, index) => {
    if (index < translationConfig.helpShortcuts.length) {
      const descKey = translationConfig.helpShortcuts[index].desc;
      const descCell = row.cells[1];
      if (descCell) {
        descCell.textContent = t(descKey);
      }
    }
  });
}

/**
 * Refresh all dynamic translations (call after state updates).
 * @param {function} t - Translation function
 */
export function refreshAll(t) {
  updateFilterButtonTexts(t);
  // Add more dynamic updates as needed
}
