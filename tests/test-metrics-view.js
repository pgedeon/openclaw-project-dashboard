#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const htmlPath = path.resolve(__dirname, '../dashboard.html');
  const jsPath = path.resolve(__dirname, '../src/dashboard-integration-optimized.mjs');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');

  assert.ok(
    html.includes('data-view="metrics"'),
    'dashboard toolbar should expose the metrics view button'
  );
  assert.ok(
    js.includes("view === 'metrics'"),
    'dashboard integration should route the metrics view'
  );
  assert.ok(
    js.includes('async function renderMetricsView(state)'),
    'dashboard integration should define the metrics renderer'
  );
  assert.ok(
    js.includes("fetch(`/api/metrics/org?${query}`"),
    'metrics renderer should load the org scorecard endpoint'
  );
  assert.ok(
    js.includes("fetch(`/api/metrics/departments?${query}`"),
    'metrics renderer should load the department scorecards endpoint'
  );
  assert.ok(
    js.includes("fetch(`/api/metrics/departments/${encodeURIComponent(selectedDepartmentId)}?${query}`"),
    'metrics renderer should load the department detail metrics endpoint for trend snapshots'
  );
  assert.ok(
    js.includes("fetch(`/api/metrics/agents?${query}`"),
    'metrics renderer should load the agent scorecards endpoint'
  );
  assert.ok(
    js.includes("fetch(`/api/metrics/services?${query}`"),
    'metrics renderer should load the service scorecards endpoint'
  );
  assert.ok(
    js.includes("fetch(`/api/metrics/sites?${query}`"),
    'metrics renderer should load the site scorecards endpoint'
  );
  assert.ok(
    js.includes('id="metricsDateFrom"') && js.includes('id="metricsDateTo"'),
    'metrics renderer should expose date range controls'
  );
  ['Org Scorecard', 'Department Scorecards', 'Agent Scorecards', 'Site Scorecards', 'Service Scorecards'].forEach((heading) => {
    assert.ok(
      js.includes(heading),
      `metrics renderer should include the "${heading}" section`
    );
  });
  assert.ok(
    js.includes('Department Trend Snapshots') && js.includes('metricsDepartmentSelect'),
    'metrics renderer should include the department trend snapshot section and selector'
  );

  console.log('PASS: metrics view wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: metrics view wiring');
  console.error(error);
  process.exit(1);
}
