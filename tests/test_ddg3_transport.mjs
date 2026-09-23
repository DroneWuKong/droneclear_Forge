import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/forge-data.js';

test('ddg3 is served from PIE outputs without rewriting evidence status', async () => {
  const dataset = {
    schema_version: 1,
    generated: new Date().toISOString(),
    program_status: {state: 'awaiting_final_rfs', final_rfs_published: false},
    planning_baseline: {
      budget: {value: '$300 million', evidence_status: 'planning', source_ids: ['phase1_rfs']},
    },
    readiness_dimensions: [{id: 'supply_chain'}],
    candidate_cohort: [{company: 'ORQA US LLC', readiness: {supply_chain: 'not_assessed'}}],
  };
  const reads = [];
  const response = await worker.fetch(
    new Request('https://uas-patterns.com/api/data?type=ddg3'),
    {PIE_OUTPUTS: {get: async key => { reads.push(key); return JSON.stringify(dataset); }}},
  );
  assert.equal(response.status, 200);
  assert.deepEqual(reads, ['ddg3']);
  const payload = await response.json();
  assert.equal(payload.source, 'kv');
  assert.equal(payload.data.planning_baseline.budget.evidence_status, 'planning');
  assert.equal(payload.data.program_status.final_rfs_published, false);
  assert.equal(payload.data.candidate_cohort[0].readiness.supply_chain, 'not_assessed');
});

test('unknown future dataset names remain closed', async () => {
  const response = await worker.fetch(new Request('https://uas-patterns.com/api/data?type=ddg4'));
  assert.equal(response.status, 404);
});
