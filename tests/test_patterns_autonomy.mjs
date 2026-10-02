import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  adjudicateStored, handlePatternsAutonomy, verifyWebhook,
} from '../workers/patterns-autonomy.mjs';

function setup() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_autonomous_evidence.sql', import.meta.url), 'utf8'));
  const AUTONOMY_DB = {
    prepare(query) {
      let values = {};
      return {
        bind(...args) { values = Object.fromEntries(args.map((value, index) => [index + 1, value])); return this; },
        async first() { return sql.prepare(query).get(values) || null; },
        async all() { return { results: sql.prepare(query).all(values) }; },
        async run() { return { meta: sql.prepare(query).run(values) }; },
      };
    },
  };
  const objects = new Map();
  const RESEARCH_EVIDENCE = {
    async put(key, value, options) { objects.set(key, { value: new Uint8Array(value), options }); },
  };
  return {
    sql,
    objects,
    env: {
      AUTONOMY_DB,
      RESEARCH_EVIDENCE,
      PATTERNS_REVIEW_TOKEN: 'review-token',
      OPENAI_API_KEY: 'provider-key',
      OPENAI_WEBHOOK_SECRET: 'whsec_ZXhhbXBsZS1zZWNyZXQ=',
    },
  };
}

const request = (path, method = 'GET', payload, token, headers = {}) => new Request(
  `https://uas-patterns.com/api/autonomy/${path}`,
  {
    method,
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.10',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(payload === undefined ? {} : { body: typeof payload === 'string' ? payload : JSON.stringify(payload) }),
  },
);

function spec(claimType = 'observation', suffix = '1') {
  return {
    schema_version: 1,
    id: suffix.repeat(24),
    claim_id: `patterns-claim-${suffix}`,
    release: '2026-10-02',
    claim_type: claimType,
    risk: claimType === 'observation' ? 'low' : 'critical',
    statement: 'Example scoped claim',
    candidate_sources: ['https://evidence.example.test/one', 'https://evidence.example.test/two'],
    allowed_domains: ['example.test'],
    requirements: { minimum_sources: 2 },
    created_at: '2026-10-02T00:00:00Z',
  };
}

const researchRequest = (item, role) => ({
  model: 'gpt-5-mini',
  background: true,
  tool_choice: 'required',
  max_output_tokens: 2400,
  tools: [{ type: 'web_search', filters: { allowed_domains: item.allowed_domains } }],
  text: { format: { type: 'json_schema', name: 'patterns_evidence_packet', strict: true, schema: {} } },
  metadata: { research_spec_id: item.id, claim_id: item.claim_id, role },
  input: `Research ${item.claim_id}`,
});

function evidencePacket(item, role) {
  const source = (path, title) => ({
    url: `https://evidence.example.test/${path}`,
    title,
    publisher: 'Example authority',
    source_class: 'independent-technical',
    passage: 'Exact relevant passage',
    locator: `Section ${path}`,
    retrieved_at: '2026-10-02',
    content_sha256: 'model-supplied-value-must-be-replaced',
    supports: 'Example scoped claim',
    version: '1',
  });
  return {
    claim_id: item.claim_id,
    role,
    conclusion: 'supports',
    proposed_statement: 'Example scoped claim',
    scope: 'Software-observable public record only',
    jurisdiction: '',
    effective_date: '2026-10-02',
    sources: [source('one', 'Source one'), source('two', 'Source two')],
    contradictions: [],
    calculations: [],
    alternatives: [],
    confidence: 0.9,
    limitations: ['No field validation claimed'],
    notes: '',
  };
}

async function webhookHeaders(raw, secret = 'whsec_ZXhhbXBsZS1zZWNyZXQ=') {
  const id = `wh_${crypto.randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    'raw', Buffer.from('example-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signed = Buffer.from(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`),
  )).toString('base64');
  return { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signed}` };
}

test('status is public but private routes reject missing reviewer authorization', async () => {
  const { env, sql } = setup();
  const status = await (await handlePatternsAutonomy(request('status'), env)).json();
  assert.equal(status.enabled, true);
  assert.equal(status.live_research, true);
  assert.equal(status.source_snapshots, true);
  assert.equal(status.automatic_publication, false);
  assert.equal((await handlePatternsAutonomy(request('exceptions'), env)).status, 401);
  assert.equal((await handlePatternsAutonomy(request('eligible'), env)).status, 401);
  assert.equal((await handlePatternsAutonomy(request('runs', 'POST', {}), env)).status, 401);
  sql.close();
});
test('webhook signatures reject altered and stale bodies', async () => {
  const secret = 'whsec_ZXhhbXBsZS1zZWNyZXQ=';
  const id = 'wh_test';
  const timestamp = '1790942400';
  const raw = '{"ok":true}';
  const key = await crypto.subtle.importKey(
    'raw', Buffer.from('example-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = Buffer.from(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`),
  )).toString('base64');
  const headers = new Headers({
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`,
  });
  assert.equal(await verifyWebhook(raw, headers, secret, 1790942400), true);
  assert.equal(await verifyWebhook(`${raw}x`, headers, secret, 1790942400), false);
  assert.equal(await verifyWebhook(raw, headers, secret, 1790943001), false);
});

test('two roles, trusted source hashes, private snapshots, and deterministic eligibility complete', async () => {
  const { env, sql, objects } = setup();
  const item = spec();
  const originalFetch = globalThis.fetch;
  let starts = 0;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value === 'https://api.openai.com/v1/responses') {
      starts += 1;
      return new Response(JSON.stringify({ id: `resp_job_${starts}`, status: 'queued' }), { status: 200 });
    }
    if (value.startsWith('https://api.openai.com/v1/responses/')) {
      const role = value.endsWith('resp_job_1') ? 'researcher' : 'verifier';
      return new Response(JSON.stringify({
        id: value.split('/').at(-1),
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(evidencePacket(item, role)) }] }],
      }), { status: 200 });
    }
    if (value === 'https://evidence.example.test/one') return new Response('trusted exact source one');
    if (value === 'https://evidence.example.test/two') return new Response('trusted exact source two');
    throw new Error(`Unexpected fetch: ${value}`);
  };
  try {
    const started = await handlePatternsAutonomy(request('runs', 'POST', {
      spec: item,
      requests: {
        researcher: researchRequest(item, 'researcher'),
        verifier: researchRequest(item, 'verifier'),
      },
    }, 'review-token'), env);
    assert.equal(started.status, 202, await started.text());
    assert.equal(starts, 2);
    for (const responseId of ['resp_job_1', 'resp_job_2']) {
      const raw = JSON.stringify({
        object: 'event', id: `evt_${responseId}`, type: 'response.completed',
        created_at: Date.now() / 1000, data: { id: responseId },
      });
      const headers = await webhookHeaders(raw);
      assert.equal((await handlePatternsAutonomy(
        request('webhooks/openai', 'POST', raw, undefined, headers), env,
      )).status, 202);
    }
    assert.equal(sql.prepare('SELECT count(*) n FROM evidence_packets').get().n, 2);
    const decision = sql.prepare(
      'SELECT publication_state,publish_eligible,human_intervention,data FROM evidence_decisions',
    ).get();
    assert.equal(decision.publication_state, 'corroborated');
    assert.equal(decision.publish_eligible, 1);
    assert.equal(decision.human_intervention, 0);
    assert.equal(JSON.parse(decision.data).source_digests.length, 2);
    assert.equal(objects.size, 2);
    assert.equal([...objects.keys()].every(key => /^sources\/[0-9a-f]{64}$/.test(key)), true);
    assert.equal(sql.prepare('SELECT state FROM research_specs').get().state, 'complete');
    const eligible = await (await handlePatternsAutonomy(
      request('eligible', 'GET', undefined, 'review-token'), env,
    )).json();
    assert.equal(eligible.automatic_publication, false);
    assert.equal(eligible.eligible.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    sql.close();
  }
});

test('hardware evidence remains an exception even when both software research roles agree', async () => {
  const { env, sql } = setup();
  const item = spec('hardware', '2');
  const now = '2026-10-02T00:00:00Z';
  sql.prepare("INSERT INTO research_specs(id,claim_id,release,claim_type,risk,data,state,created,updated) VALUES(?1,?2,?3,?4,?5,?6,'researching',?7,?7)")
    .run(item.id, item.claim_id, item.release, item.claim_type, item.risk, JSON.stringify(item), now);
  for (const [index, role] of ['researcher', 'verifier'].entries()) {
    const jobId = `${index + 1}`.repeat(24);
    const packet = evidencePacket(item, role);
    packet.sources.forEach((source, sourceIndex) => { source.content_sha256 = `${sourceIndex + 3}`.repeat(64); });
    sql.prepare("INSERT INTO research_jobs(id,spec_id,role,provider,response_id,state,created,updated) VALUES(?1,?2,?3,'openai',?4,'completed',?5,?5)")
      .run(jobId, item.id, role, `resp_hardware_${index}`, now);
    sql.prepare('INSERT INTO evidence_packets(id,job_id,claim_id,role,data,digest,created) VALUES(?1,?2,?3,?4,?5,?6,?7)')
      .run(`${index + 5}`.repeat(24), jobId, item.claim_id, role, JSON.stringify(packet), `${index + 7}`.repeat(64), now);
  }
  const decision = await adjudicateStored(env, { data: JSON.stringify(item) });
  assert.equal(decision.publication_state, 'exception');
  assert.equal(decision.publish_eligible, false);
  assert.equal(decision.human_intervention, true);
  assert.match(decision.reasons[0], /hardware-field-or-safety/);
  const listed = await (await handlePatternsAutonomy(
    request('exceptions', 'GET', undefined, 'review-token'), env,
  )).json();
  assert.equal(listed.exceptions.length, 1);
  sql.close();
});

test('terminal provider events fail the paired spec instead of leaving it stuck', async () => {
  const { env, sql } = setup();
  const item = spec('observation', '3');
  const now = new Date().toISOString();
  sql.prepare("INSERT INTO research_specs(id,claim_id,release,claim_type,risk,data,state,created,updated) VALUES(?1,?2,?3,?4,?5,?6,'researching',?7,?7)")
    .run(item.id, item.claim_id, item.release, item.claim_type, item.risk, JSON.stringify(item), now);
  sql.prepare("INSERT INTO research_jobs(id,spec_id,role,provider,response_id,state,created,updated) VALUES(?1,?2,'researcher','openai','resp_failed','in_progress',?3,?3)")
    .run('4'.repeat(24), item.id, now);
  const raw = JSON.stringify({
    object: 'event', id: 'evt_failed', type: 'response.failed',
    created_at: Date.now() / 1000, data: { id: 'resp_failed' },
  });
  const headers = await webhookHeaders(raw);
  assert.equal((await handlePatternsAutonomy(
    request('webhooks/openai', 'POST', raw, undefined, headers), env,
  )).status, 202);
  assert.equal(sql.prepare('SELECT state FROM research_jobs').get().state, 'failed');
  assert.equal(sql.prepare('SELECT state FROM research_specs').get().state, 'failed');
  assert.equal(sql.prepare('SELECT state FROM webhook_events').get().state, 'processed');
  sql.close();
});
