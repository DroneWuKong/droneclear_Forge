const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', 'forge-source');

function html(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

function assertInlineScriptsParse(source) {
  for (const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    Function(match[1]);
  }
}

test('trend page uses dynamic coverage and rolling-fit metadata', () => {
  const source = html('pie-trends.html');
  assert.ok(!source.includes('56 daily snapshots'));
  assert.ok(source.includes('latest 30 calendar days'));
  assert.ok(source.includes('methodology_changes'));
  assert.ok(source.includes('coverage_pct'));
  assertInlineScriptsParse(source);
});

test('forecast page withholds calibration rating behind sample gate', () => {
  const source = html('forecast-accountability.html');
  assert.ok(source.includes('at least 30 graded forecasts'));
  assert.ok(source.includes("calibration.calibration_ready === true"));
  assert.ok(source.includes("'Not rated'"));
  assertInlineScriptsParse(source);
});

test('quality page loads the transparent six-dimension artifact', () => {
  const source = html('miner-health.html');
  assert.ok(source.includes('/api/data?type=data_quality_score'));
  assert.ok(source.includes('doc.dimensions'));
  assert.ok(source.includes("score.className = `grade-${String(doc.grade || '').toLowerCase()}`"));
  assert.ok(source.includes("replaceAll('-', ' ')"));
  assert.ok(source.includes('.rating-main strong.grade-c,.rating-main strong.grade-d{color:var(--amber)}'));
  assert.ok(source.includes('rates data fitness and accountability'));
  assertInlineScriptsParse(source);
});

test('intel health page separates run, evidence, persistence, and publication status', () => {
  const source = html('intel-health.html');
  assert.ok(source.includes('/static/intel-health.js'));
  assert.ok(source.includes('Collector run'));
  assert.ok(source.includes('Evidence'));
  assert.ok(source.includes('Persistence'));
  assert.ok(source.includes('Publication'));
  assert.ok(source.includes('does not prove upstream completeness'));
  assertInlineScriptsParse(source);
});

test('patterns dashboard embeds the shared fail-closed intel health summary', () => {
  const source = html('patterns.html');
  assert.ok(source.includes('/static/intel-health.js'));
  assert.ok(source.includes('id="dashboard-health-status"'));
  assert.ok(source.includes('id="dashboard-health-stages"'));
  assert.ok(source.includes('href="/intel-health/"'));
  assert.ok(source.includes('window.IntelHealth.summarize'));
  assert.ok(source.includes("loadPipelineHealthDocument().then"));
  assert.ok(source.includes("renderPipelineHealth(null, 'unavailable')"));
  assertInlineScriptsParse(source);
});
