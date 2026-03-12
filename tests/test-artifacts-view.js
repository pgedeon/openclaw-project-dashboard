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
    html.includes('data-view="artifacts"'),
    'dashboard toolbar should expose the artifacts view button'
  );
  assert.ok(
    js.includes("view === 'artifacts'"),
    'dashboard integration should route the artifacts view'
  );
  assert.ok(
    js.includes('async function renderArtifactsView(state)'),
    'dashboard integration should define the artifacts renderer'
  );
  assert.ok(
    js.includes("fetch('/api/artifacts?limit=250'"),
    'artifacts renderer should load artifact data'
  );
  assert.ok(
    js.includes('Recorded Artifacts'),
    'workflow run detail should show an artifacts panel'
  );

  console.log('PASS: artifacts view wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: artifacts view wiring');
  console.error(error);
  process.exit(1);
}
