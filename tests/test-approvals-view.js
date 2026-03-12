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
    html.includes('data-view="approvals"'),
    'dashboard toolbar should expose the approvals view button'
  );
  assert.ok(
    js.includes("view === 'approvals'"),
    'dashboard integration should route the approvals view'
  );
  assert.ok(
    js.includes('async function renderApprovalsView(state)'),
    'dashboard integration should define the approvals renderer'
  );
  assert.ok(
    js.includes("fetch('/api/approvals/pending'"),
    'approvals renderer should load pending approvals'
  );
  assert.ok(
    js.includes('data-approval-approve'),
    'approvals renderer should expose approve actions'
  );
  assert.ok(
    js.includes('data-approval-reject'),
    'approvals renderer should expose reject actions'
  );
  assert.ok(
    js.includes('Approval Summary'),
    'workflow run detail should show an approval summary panel'
  );

  console.log('PASS: approvals view wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: approvals view wiring');
  console.error(error);
  process.exit(1);
}
