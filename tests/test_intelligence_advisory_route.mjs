import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../workers/forge-data.js';

function artifact() {
  return {
    schema_version: 'forge.intelligence-advisory.v1',
    generated_at: new Date().toISOString(),
    advisory_count: 0,
    publication_controls: {
      human_review_required: true,
      source_evidence_required: true,
      execution_authority_prohibited: true,
      readiness_authority_prohibited: true,
    },
    advisories: [],
  };
}

test('GET serves validated intelligence advisories from PIE_OUTPUTS in the public envelope', async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request('https://uas-forge.com/api/data?type=intelligence_advisories'),
    {
      PIE_OUTPUTS: {
        async get(key) {
          calls.push(key);
          return key === 'intelligence_advisories' ? JSON.stringify(artifact()) : null;
        },
      },
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(calls, ['intelligence_advisories']);
  assert.equal(body.type, 'intelligence_advisories');
  assert.equal(body.data.schema_version, 'forge.intelligence-advisory.v1');
  assert.equal(body.data.authorizes_execution, undefined);
  assert.equal(body.freshness.status, 'fresh');
});

test('GET withholds an advisory artifact that violates publication controls', async () => {
  const value = artifact();
  value.publication_controls.readiness_authority_prohibited = false;
  const response = await worker.fetch(
    new Request('https://uas-forge.com/api/data?type=intelligence_advisories'),
    { PIE_OUTPUTS: { async get() { return JSON.stringify(value); } } },
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /failed publication controls/);
});
