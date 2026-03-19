export async function renderSkillsToolsView({
  mountNode,
  fetchImpl = fetch,
  escapeHtml,
  formatTimestamp,
  formatTokenLabel,
  showNotice
}) {
  mountNode.innerHTML = '';

  const container = document.createElement('div');
  container.style.cssText = 'padding:16px;';
  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:16px;">
      <div>
        <h2 style="margin:0 0 6px 0;">Skills and Tools</h2>
        <p style="margin:0; color:var(--muted);">A live catalog of installed skills, agent-enabled tools, and tool access by agent.</p>
      </div>
      <button id="skillsToolsRefreshBtn" class="secondary-btn" type="button">Refresh</button>
    </div>
    <section style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft); margin-bottom:16px;">
      <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:end;">
        <label style="display:grid; gap:6px; min-width:240px; flex:1 1 280px;">
          <span>Search</span>
          <input id="skillsToolsSearch" type="search" placeholder="Search skills, tools, agents, or descriptions">
        </label>
        <label style="display:grid; gap:6px; min-width:180px;">
          <span>Skill Filter</span>
          <select id="skillsToolsSkillFilter">
            <option value="all">All skills</option>
            <option value="ready">Ready skills</option>
            <option value="managed">Managed skills</option>
            <option value="unavailable">Unavailable skills</option>
          </select>
        </label>
      </div>
    </section>
    <div id="skillsToolsContent">Loading...</div>
  `;
  mountNode.appendChild(container);

  const refreshBtn = container.querySelector('#skillsToolsRefreshBtn');
  const searchInput = container.querySelector('#skillsToolsSearch');
  const skillFilterSelect = container.querySelector('#skillsToolsSkillFilter');
  const contentDiv = container.querySelector('#skillsToolsContent');

  let catalog = null;

  function matchesSearch(values, query) {
    if (!query) return true;
    return values.some((value) => String(value || '').toLowerCase().includes(query));
  }

  function renderBadge(text, type) {
    // Use semantic type classes that are styled via CSS
    return `
      <span class="badge badge--${type}" style="display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:999px; font-size:0.78em; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">
        ${escapeHtml(text)}
      </span>
    `;
  }

  function renderSkillStatusBadge(skill) {
    const type = skill.status === 'ready' ? 'success'
      : skill.status === 'blocked' ? 'warning'
        : skill.status === 'disabled' ? 'muted'
          : 'error';
    return renderBadge(skill.status, type);
  }

  function renderToolChip(text, accent = false) {
    return `
      <span class="tool-chip${accent ? ' tool-chip--accent' : ''}" style="display:inline-flex; align-items:center; padding:4px 8px; border-radius:999px; font-size:0.84em; margin:0 6px 6px 0;">
        ${escapeHtml(text)}
      </span>
    `;
  }

  function renderCatalogTable(title, description, columns, rows, emptyMessage) {
    return `
      <section class="card" style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft); margin-bottom:16px;">
        <div style="margin-bottom:12px;">
          <h3 style="margin:0 0 6px 0;">${escapeHtml(title)}</h3>
          <p style="margin:0; color:var(--muted);">${escapeHtml(description)}</p>
        </div>
        ${rows.length ? `
          <div style="overflow:auto;">
            <table class="data-table" style="width:100%; border-collapse:collapse;">
              <thead>
                <tr style="background:var(--bg-2);">
                  ${columns.map((column) => `<th style="text-align:left; padding:8px;">${escapeHtml(column.label)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${rows.map((row) => `
                  <tr style="border-bottom:1px solid var(--border); vertical-align:top;">
                    ${columns.map((column) => `<td style="padding:10px;">${column.render(row)}</td>`).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `<p style="margin:0; color:var(--muted);">${escapeHtml(emptyMessage)}</p>`}
      </section>
    `;
  }

  function renderSummaryCards(summary) {
    const cards = [
      { label: 'Ready Skills', value: summary.readySkills || 0, detail: `${summary.totalSkills || 0} total` },
      { label: 'Managed Skills', value: summary.locallyManagedSkills || 0, detail: 'Local OpenClaw and workspace skills' },
      { label: 'Distinct Tools', value: summary.distinctTools || 0, detail: `${summary.sharedTools || 0} shared across agents` },
      { label: 'Agents With Tools', value: summary.agentsWithToolPolicies || 0, detail: `${summary.exclusiveTools || 0} exclusive tool entries` }
    ];

    return `
      <section class="card" style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft); margin-bottom:16px;">
        <div style="margin-bottom:12px;">
          <h3 style="margin:0 0 6px 0;">Catalog Summary</h3>
          <p style="margin:0; color:var(--muted);">This page is driven by the live skill registry and the current agent tool policies from <code>openclaw.json</code>.</p>
        </div>
        <div style="display:flex; gap:12px; flex-wrap:wrap;">
          ${cards.map((card) => `
            <div class="summary-card" style="background:var(--bg-2); border-radius:10px; padding:12px 14px; min-width:160px;">
              <div style="font-size:1.5em; font-weight:700;">${escapeHtml(card.value)}</div>
              <div style="font-size:0.82em; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted);">${escapeHtml(card.label)}</div>
              <div style="margin-top:4px; color:var(--muted); font-size:0.9em;">${escapeHtml(card.detail)}</div>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderMetaSection(payload) {
    const warningLines = Array.isArray(payload.warnings) ? payload.warnings : [];
    return `
      <section class="card" style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft); margin-bottom:16px;">
        <div style="display:grid; gap:8px;">
          <div><strong>Workspace:</strong> <code>${escapeHtml(payload.workspaceDir || 'Unavailable')}</code></div>
          <div><strong>Managed Skills Dir:</strong> <code>${escapeHtml(payload.managedSkillsDir || 'Unavailable')}</code></div>
          <div><strong>Generated:</strong> ${escapeHtml(formatTimestamp(payload.generatedAt))}</div>
          ${warningLines.length ? `
            <div class="warning-box" style="margin-top:8px; padding:12px; border-radius:10px;">
              <strong>Warnings</strong>
              <ul style="margin:8px 0 0 18px; padding:0;">
                ${warningLines.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      </section>
    `;
  }

  function renderGlobalToolBaseline(globalSubagentTools) {
    const allow = Array.isArray(globalSubagentTools?.allow) ? globalSubagentTools.allow : [];
    const deny = Array.isArray(globalSubagentTools?.deny) ? globalSubagentTools.deny : [];

    return `
      <section class="card" style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:var(--shadow-soft); margin-bottom:16px;">
        <div style="margin-bottom:12px;">
          <h3 style="margin:0 0 6px 0;">Subagent Tool Baseline</h3>
          <p style="margin:0; color:var(--muted);">Global allow and deny defaults from the subagent tool policy.</p>
        </div>
        <div style="display:grid; gap:12px;">
          <div>
            <div style="font-weight:700; margin-bottom:8px;">Allowed by default</div>
            <div>${allow.length ? allow.map((tool) => renderToolChip(formatTokenLabel(tool), true)).join('') : '<span style="color:var(--muted);">No global allowlist configured.</span>'}</div>
          </div>
          <div>
            <div style="font-weight:700; margin-bottom:8px;">Denied by default</div>
            <div>${deny.length ? deny.map((tool) => renderToolChip(formatTokenLabel(tool))).join('') : '<span style="color:var(--muted);">No global denylist configured.</span>'}</div>
          </div>
        </div>
      </section>
    `;
  }

  function renderContent() {
    if (!catalog) return;

    const query = String(searchInput.value || '').trim().toLowerCase();
    const skillFilter = skillFilterSelect.value || 'all';

    const skills = (catalog.skills || []).filter((skill) => {
      if (skillFilter === 'ready' && skill.status !== 'ready') return false;
      if (skillFilter === 'managed' && !skill.locallyManaged) return false;
      if (skillFilter === 'unavailable' && skill.status === 'ready') return false;
      return matchesSearch(
        [skill.name, skill.description, skill.source, skill.status, ...(skill.missingSummary || [])],
        query
      );
    });

    const tools = (catalog.tools || []).filter((tool) => {
      return matchesSearch(
        [tool.name, tool.label, tool.description, ...tool.agents.map((agent) => `${agent.name} ${agent.id}`)],
        query
      );
    });

    const agents = (catalog.agents || []).filter((agent) => {
      return matchesSearch(
        [agent.name, agent.id, agent.defaultModel, ...agent.allowedTools, ...agent.allowedSubagents],
        query
      );
    });

    let html = '';
    html += renderSummaryCards(catalog.summary || {});
    html += renderMetaSection(catalog);
    html += renderGlobalToolBaseline(catalog.globalSubagentTools || {});

    html += renderCatalogTable(
      `Skill Inventory (${skills.length})`,
      'Installed skills from the live OpenClaw registry, including bundled, managed, and workspace skills.',
      [
        {
          label: 'Skill',
          render: (skill) => `
            <div style="font-weight:700; margin-bottom:4px;">${escapeHtml(`${skill.emoji ? `${skill.emoji} ` : ''}${skill.name}`)}</div>
            <div style="color:var(--muted);">${escapeHtml(skill.description || 'No description available.')}</div>
            ${skill.homepage ? `<div style="margin-top:6px;"><a href="${escapeHtml(skill.homepage)}" target="_blank" rel="noopener noreferrer">${escapeHtml(skill.homepage)}</a></div>` : ''}
          `
        },
        {
          label: 'Status',
          render: (skill) => `
            ${renderSkillStatusBadge(skill)}
            ${skill.primaryEnv ? `<div style="margin-top:8px; color:var(--muted); font-size:0.9em;">Primary env: <code>${escapeHtml(skill.primaryEnv)}</code></div>` : ''}
          `
        },
        {
          label: 'Source',
          render: (skill) => `
            <div>${escapeHtml(skill.source)}</div>
            <div style="margin-top:6px;">
              ${skill.locallyManaged ? renderBadge('local', 'info') : ''}
              ${skill.bundled ? renderBadge('bundled', 'muted') : ''}
            </div>
          `
        },
        {
          label: 'Notes',
          render: (skill) => skill.missingSummary.length
            ? `<ul style="margin:0; padding-left:18px;">${skill.missingSummary.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>`
            : '<span style="color:var(--muted);">No missing requirements.</span>'
        }
      ],
      skills,
      'No skills match the current filter.'
    );

    html += renderCatalogTable(
      `Tool Inventory (${tools.length})`,
      'Distinct tools exposed by agent tool policies, with coverage across the configured fleet.',
      [
        {
          label: 'Tool',
          render: (tool) => `
            <div style="font-weight:700; margin-bottom:4px;">${escapeHtml(tool.label)}</div>
            <div style="color:var(--muted); font-size:0.9em;"><code>${escapeHtml(tool.name)}</code></div>
          `
        },
        { label: 'Description', render: (tool) => `<div style="max-width:320px;">${escapeHtml(tool.description)}</div>` },
        {
          label: 'Coverage',
          render: (tool) => `
            <div style="font-weight:700;">${escapeHtml(tool.agentCount)} agents</div>
            <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(tool.defaultAgentCount)} default agents</div>
          `
        },
        {
          label: 'Agents',
          render: (tool) => `<div>${tool.agents.map((agent) => renderToolChip(agent.default ? `${agent.name} (default)` : agent.name, agent.default)).join('')}</div>`
        }
      ],
      tools,
      'No tools match the current search.'
    );

    html += renderCatalogTable(
      `Agent Tool Access (${agents.length})`,
      'Per-agent tool policies from openclaw.json, including default model and subagent reach.',
      [
        {
          label: 'Agent',
          render: (agent) => `
            <div style="font-weight:700; margin-bottom:4px;">${escapeHtml(agent.name)}</div>
            <div style="color:var(--muted); font-size:0.9em;"><code>${escapeHtml(agent.id)}</code></div>
            ${agent.default ? `<div style="margin-top:6px;">${renderBadge('default', 'info')}</div>` : ''}
          `
        },
        {
          label: 'Model / Workspace',
          render: (agent) => `
            <div>${agent.defaultModel ? `<code>${escapeHtml(agent.defaultModel)}</code>` : '<span style="color:var(--muted);">No model configured.</span>'}</div>
            <div style="margin-top:6px; color:var(--muted); font-size:0.9em;"><code>${escapeHtml(agent.workspace || 'No workspace')}</code></div>
          `
        },
        {
          label: 'Allowed Tools',
          render: (agent) => agent.allowedTools.length
            ? agent.allowedTools.map((tool) => renderToolChip(formatTokenLabel(tool))).join('')
            : '<span style="color:var(--muted);">No explicit allowlist.</span>'
        },
        {
          label: 'Subagents',
          render: (agent) => agent.allowedSubagents.length
            ? `<div style="font-weight:700;">${escapeHtml(agent.allowedSubagents.length)} allowed</div><div style="margin-top:6px; color:var(--muted); font-size:0.9em;">${escapeHtml(agent.allowedSubagents.slice(0, 6).join(', '))}${agent.allowedSubagents.length > 6 ? '...' : ''}</div>`
            : '<span style="color:var(--muted);">No explicit subagent allowlist.</span>'
        }
      ],
      agents,
      'No agents match the current search.'
    );

    contentDiv.innerHTML = html;
  }

  async function loadCatalog() {
    contentDiv.innerHTML = '<p style="color:var(--muted);">Loading skills and tools catalog...</p>';
    const response = await fetchImpl('/api/catalog/skills-tools', {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Failed to load catalog: ${response.status}`);
    }

    catalog = await response.json();
    renderContent();
  }

  searchInput.addEventListener('input', () => renderContent());
  skillFilterSelect.addEventListener('change', () => renderContent());
  refreshBtn.addEventListener('click', async () => {
    try {
      await loadCatalog();
      showNotice('Skills & tools catalog refreshed.', 'success');
    } catch (error) {
      console.error('[Skills & Tools]', error);
      showNotice('Failed to refresh skills and tools catalog.', 'error');
    }
  });

  try {
    await loadCatalog();
  } catch (error) {
    console.error('[Skills & Tools]', error);
    contentDiv.innerHTML = '<p style="color:var(--accent-3);">Error loading skills and tools catalog.</p>';
  }

  // Auto-refresh every 60 seconds (skills catalog doesn't change frequently)
  setInterval(async () => {
    try {
      await loadCatalog();
    } catch (error) {
      // Silent fail on auto-refresh - don't spam console
    }
  }, 60000);
}
