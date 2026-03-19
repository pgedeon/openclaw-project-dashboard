import { renderSkillsToolsView } from './views/skills-tools-view.mjs';

const dom = {
  notice: document.getElementById('notice'),
  root: document.getElementById('skillsToolsRoot')
};

let noticeTimer = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTokenLabel(value) {
  return String(value || '')
    .replace(/[:/_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTimestamp(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function showNotice(message, type = 'info') {
  if (!dom.notice) return;
  dom.notice.textContent = message || '';
  dom.notice.className = `notice${message ? ' is-visible' : ''}${type === 'error' ? ' is-error' : ''}${type === 'success' ? ' is-success' : ''}`;
  clearTimeout(noticeTimer);
  if (message) {
    noticeTimer = setTimeout(() => {
      dom.notice.className = 'notice';
      dom.notice.textContent = '';
    }, 4200);
  }
}

async function init() {
  if (!dom.root) {
    throw new Error('Skills & Tools root element is missing');
  }

  await renderSkillsToolsView({
    mountNode: dom.root,
    fetchImpl: fetch,
    escapeHtml,
    formatTimestamp,
    formatTokenLabel,
    showNotice
  });
}

init().catch((error) => {
  console.error('[Skills & Tools Page] Failed to initialize:', error);
  showNotice('Failed to initialize the Skills & Tools page.', 'error');
});
