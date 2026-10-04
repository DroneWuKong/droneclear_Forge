'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decide, prepare } = require('../tools/production_alert.cjs');

const result = (changes = {}) => ({
  id: 20, workflow_id: 100, run_number: 20, run_attempt: 1,
  name: 'Forge + Patterns Production Smoke', head_branch: 'master',
  event: 'schedule', status: 'completed', conclusion: 'failure',
  html_url: 'https://github.com/DroneWuKong/droneclear_Forge/actions/runs/20',
  head_sha: 'abc', ...changes,
});
const previous = changes => result({ id: 19, run_number: 19, ...changes });

test('a new production failure alerts, including timeout', () => {
  assert.equal(decide(result(), [previous({ conclusion: 'success' })]).kind, 'failure');
  assert.equal(decide(result({ conclusion: 'timed_out' }), []).send, true);
});
test('repeat failure streaks and repeated failed attempts stay quiet', () => {
  assert.equal(decide(result(), [previous()]).send, false);
  assert.equal(decide(result({ run_attempt: 2 }), []).send, false);
});
test('routine success stays quiet and recovery alerts once', () => {
  assert.equal(decide(result({ conclusion: 'success' }), []).send, false);
  assert.equal(decide(result({ conclusion: 'success' }), [previous()]).kind, 'recovery');
  assert.equal(decide(result({ conclusion: 'success' }), [previous({ conclusion: 'success' })]).send, false);
});
test('PR, non-production branch, and unrelated workflow results never alert', () => {
  for (const changes of [{ event: 'pull_request' }, { head_branch: 'feature' }, { name: 'Miner Health Check' }]) {
    assert.equal(decide(result(changes), []).send, false);
  }
});
test('cancelled and skipped runs do not reset an existing incident', () => {
  assert.equal(decide(result(), [previous({ conclusion: 'cancelled' }), previous({ id: 18, run_number: 18 })]).send, false);
  assert.equal(decide(result({ conclusion: 'skipped' }), []).send, false);
});
test('newer completed results suppress stale out-of-order completion alerts', () => {
  assert.equal(decide(result(), [result({ id: 21, run_number: 21, conclusion: 'success' })]).send, false);
});
test('independent workflow histories cannot suppress an incident', () => {
  assert.equal(decide(result(), [previous({ workflow_id: 200 })]).send, true);
});
test('prepare uses the read-only workflow API and emits an actionable run link', async () => {
  const outputs = {};
  const summary = { addHeading() { return this; }, addRaw() { return this; }, async write() {} };
  const core = { setOutput: (key, value) => outputs[key] = value, summary };
  const github = { rest: { actions: { async listWorkflowRuns(args) {
    assert.equal(args.branch, 'master');
    assert.equal(args.workflow_id, 100);
    return { data: { workflow_runs: [previous({ conclusion: 'success' })] } };
  } } } };
  await prepare({ github, context: { repo: { owner: 'DroneWuKong', repo: 'droneclear_Forge' }, payload: { workflow_run: result() } }, core });
  assert.equal(outputs.send, 'true');
  assert.match(outputs.body, /actions\/runs\/20/);
  assert.match(outputs.subject, /production failure/);
});
