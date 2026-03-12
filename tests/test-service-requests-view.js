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
    html.includes('data-view="service-requests"'),
    'dashboard toolbar should expose the service requests view button'
  );
  assert.ok(
    js.includes("view === 'service-requests'"),
    'dashboard integration should route the service-requests view'
  );
  assert.ok(
    js.includes('async function renderServiceRequestsView(state)'),
    'dashboard integration should define the service requests renderer'
  );
  assert.ok(
    js.includes("fetch('/api/services'"),
    'service requests renderer should load service catalog data'
  );
  assert.ok(
    js.includes("fetch('/api/workflow-templates'"),
    'service requests renderer should load workflow template metadata'
  );
  assert.ok(
    js.includes("fetch(`/api/service-requests?limit=200"),
    'service requests renderer should load service requests data'
  );
  assert.ok(
    js.includes('id="serviceRequestDetail"'),
    'service requests renderer should expose a request detail panel'
  );
  assert.ok(
    js.includes("fetch(`/api/service-requests/${requestId}/launch`"),
    'service requests renderer should support launching a request'
  );

  console.log('PASS: service requests view wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: service requests view wiring');
  console.error(error);
  process.exit(1);
}
