import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  adjudicateStored, handlePatternsAutonomy, verifyWebhook,
} from '../workers/patterns-autonomy.mjs';
import { canonicalJson, sha256 } from '../workers/retrieval-policy.mjs';
import forgeData from '../workers/forge-data.js';

function setup() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_autonomous_evidence.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0002_retrieval_shadow.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0003_retrieval_policy_promotion.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0004_retrieval_policy_monitoring.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0005_autonomy_ingress_controls.sql', import.meta.url), 'utf8'));
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
      PATTERNS_MONITOR_TOKEN: 'monitor-token',
      PATTERNS_RATE_LIMIT_SECRET: 'test-rate-limit-secret-with-more-than-32-bytes',
      PATTERNS_POLICY_SIGNING_SECRET: 'test-policy-signing-secret-with-more-than-32-bytes',
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

function retrievalFeedback(overrides = {}) {
  return {
    schema_version: 1,
    feedback_id: '123e4567-e89b-42d3-a456-426614174000',
    query: 'counter UAS procurement evidence',
    policy_id: 'ask-pie-ranking',
    policy_version: 'lexical-subject-v2',
    input_revision: 'revision-abc123',
    label: 'helpful',
    target: {
      record_key: 'article:counter-uas-award',
      position: 1,
      record_type: 'article',
      features: {
        score: 42,
        coverage: 1,
        weighted_coverage: 1,
        direct: true,
        subject_in_title: true,
        citation_count: 2,
      },
    },
    ...overrides,
  };
}

function shadowRegistryBundle(overrides = {}) {
  const candidateVersion = 'candidate-0123456789abcdef';
  return {
    schema_version: 'retrieval-shadow-registry-bundle-v1',
    candidate_version: candidateVersion,
    state: 'registered-shadow-only',
    serving_pointer: null,
    promotion_eligible: false,
    bundle_sha256: 'a'.repeat(64),
    candidate: {
      schema_version: 'retrieval-policy-candidate-v1',
      policy_id: 'ask-pie-ranking',
      candidate_version: candidateVersion,
      incumbent_version: 'lexical-subject-v2',
      compatible_feature_schema: 'ask-pie-feedback-features-v1',
      frozen_corpus_sha256: 'b'.repeat(64),
      candidate_built: true,
      writes_to_serving: false,
      promotion_eligible: false,
      parameters: {
        base_score_weight: 1,
        feature_adjustments: {
          coverage: 12,
          weighted_coverage: 12,
          direct: 12,
          subject_in_title: 12,
          citation_count: 4,
        },
      },
    },
    replay: {
      schema_version: 'retrieval-frozen-replay-v1',
      candidate_version: candidateVersion,
      replay_evidence_sha256: 'c'.repeat(64),
      shadow_eligible: true,
      promotion_eligible: false,
    },
    chronological_evaluation: {
      schema_version: 'retrieval-chronological-evaluation-v1',
      candidate_version: candidateVersion,
      holdout_evidence_sha256: 'd'.repeat(64),
      chronological_holdout_passed: true,
      promotion_eligible: false,
    },
    ...overrides,
  };
}

async function signedPolicyManifest(bundle, shadowEvaluation) {
  const parameters = {
    base_score_weight: 1,
    feature_adjustments: {...bundle.candidate.parameters.feature_adjustments},
    feature_transforms: {booleans:'0-or-1', citation_count:'min(value,4)/4'},
  };
  const approval = {
    schema_version: 'retrieval-promotion-approval-v1',
    approval_id: '723e4567-e89b-42d3-a456-426614174006',
    action: 'approve-promotion',
    reviewer_reference: 'review:ask-pie:2026-10-12',
    rationale_sha256: 'e'.repeat(64),
    approved_at: '2026-10-12T02:00:00Z',
  };
  const core = {
    schema_version: 'policy-bundle-v1',
    policy_id: 'ask-pie-ranking',
    version: bundle.candidate_version,
    incumbent_version: bundle.candidate.incumbent_version,
    compatible_input_schema: 'research-index-v1',
    compatible_feature_schema: 'ask-pie-feedback-features-v1',
    serving_scope: {
      mode: 'rerank-incumbent-page-v1', maximum_records: 100, changes_membership: false,
    },
    parameters,
    parameters_sha256: await sha256(canonicalJson(parameters)),
    candidate_bundle_sha256: bundle.bundle_sha256,
    training_corpus_sha256: bundle.candidate.frozen_corpus_sha256,
    replay_evidence_sha256: bundle.replay.replay_evidence_sha256,
    holdout_evidence_sha256: bundle.chronological_evaluation.holdout_evidence_sha256,
    shadow_evidence_sha256: shadowEvaluation.shadow_evidence_sha256,
    approval,
    approval_record_sha256: await sha256(canonicalJson(approval)),
    rollback_to: bundle.candidate.incumbent_version,
    issued_at: approval.approved_at,
    signing: {algorithm:'hmac-sha256',key_id:'patterns-policy-hmac-v1'},
  };
  const manifestSha256 = await sha256(canonicalJson(core));
  const signedPayload = {...core, manifest_sha256:manifestSha256};
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode('test-policy-signing-secret-with-more-than-32-bytes'),
    {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(canonicalJson(signedPayload)))).toString('hex');
  return {
    ...signedPayload,
    signature,
    state:'approved-not-active',
    activation_eligible:true,
    serving_changes:false,
  };
}

test('same-origin retrieval feedback is idempotent, anonymous, and never auto-promotes', async () => {
  const { env, sql } = setup();
  const headers = { origin: 'https://uas-patterns.com' };
  const firstResponse = await handlePatternsAutonomy(
    request('feedback', 'POST', retrievalFeedback(), undefined, headers), env,
  );
  assert.equal(firstResponse.status, 202);
  const first = await firstResponse.json();
  const second = await (await handlePatternsAutonomy(
    request('feedback', 'POST', retrievalFeedback(), undefined, headers), env,
  )).json();
  assert.equal(first.event_id, second.event_id);
  assert.equal(first.query_id, second.query_id);
  assert.equal(first.automatic_promotion, false);
  assert.equal(sql.prepare("SELECT count(*) n FROM evidence_events WHERE event_type='retrieval-feedback'").get().n, 1);
  const stored = JSON.parse(sql.prepare("SELECT data FROM evidence_events WHERE event_type='retrieval-feedback'").get().data);
  assert.equal(stored.signal_quality, 'explicit-unreviewed');
  assert.equal(stored.data_policy.anonymized, true);
  assert.equal(stored.session_id, undefined);
  assert.equal(stored.ip, undefined);
  assert.equal(stored.account_id, undefined);

  const conflict = await handlePatternsAutonomy(request(
    'feedback', 'POST', retrievalFeedback({ query: 'different query' }), undefined, headers,
  ), env);
  assert.equal(conflict.status, 409);
  sql.close();
});

test('missing-source feedback can omit a target while malformed or cross-origin signals fail closed', async () => {
  const { env, sql } = setup();
  const allowed = await handlePatternsAutonomy(request('feedback', 'POST', retrievalFeedback({
    feedback_id: '223e4567-e89b-42d3-a456-426614174001',
    label: 'missing_source',
    target: null,
  }), undefined, { origin: 'http://localhost:8788' }), env);
  assert.equal(allowed.status, 202, await allowed.text());
  assert.equal((await handlePatternsAutonomy(request(
    'feedback', 'POST', retrievalFeedback({ feedback_id: '323e4567-e89b-42d3-a456-426614174002' }),
    undefined, { origin: 'https://attacker.example' },
  ), env)).status, 403);
  assert.equal((await handlePatternsAutonomy(request('feedback', 'POST', retrievalFeedback({
    feedback_id: '423e4567-e89b-42d3-a456-426614174003', label: 'model_says_good',
  }), undefined, { origin: 'https://uas-patterns.com' }), env)).status, 400);
  assert.equal((await handlePatternsAutonomy(request('feedback', 'POST', retrievalFeedback({
    feedback_id: '523e4567-e89b-42d3-a456-426614174004', target: null,
  }), undefined, { origin: 'https://uas-patterns.com' }), env)).status, 400);
  sql.close();
});

test('reviewers can disposition retrieval feedback without promoting a policy', async () => {
  const { env, sql } = setup();
  const submitted = await (await handlePatternsAutonomy(request(
    'feedback', 'POST', retrievalFeedback(), undefined, { origin: 'https://uas-patterns.com' },
  ), env)).json();
  assert.equal((await handlePatternsAutonomy(request('feedback'), env)).status, 401);
  const before = await (await handlePatternsAutonomy(
    request('feedback', 'GET', undefined, 'review-token'), env,
  )).json();
  assert.equal(before.feedback.length, 1);
  assert.equal(before.feedback[0].disposition, null);
  const reviewed = await handlePatternsAutonomy(request(
    `feedback/${submitted.event_id}`, 'POST',
    { action: 'accept-as-judgment', notes: 'Exact result and citation answer the query.' },
    'review-token',
  ), env);
  assert.equal(reviewed.status, 200);
  const reviewedBody = await reviewed.json();
  assert.equal(reviewedBody.automatic_promotion, false);
  assert.match(reviewedBody.disposition.reviewed_at, /^\d{4}-\d{2}-\d{2}T/);
  const after = await (await handlePatternsAutonomy(
    request('feedback', 'GET', undefined, 'review-token'), env,
  )).json();
  assert.equal(after.feedback[0].disposition.action, 'accept-as-judgment');
  assert.equal(after.automatic_promotion, false);
  sql.close();
});

test('public feedback is rate limited with an opaque hourly bucket', async () => {
  const {env, sql} = setup();
  const headers = {origin:'https://uas-patterns.com'};
  for (let index = 0; index < 60; index += 1) {
    const feedbackId = `123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
    const response = await handlePatternsAutonomy(request(
      'feedback', 'POST', retrievalFeedback({feedback_id:feedbackId}), undefined, headers,
    ), env);
    assert.equal(response.status, 202, `feedback ${index + 1}: ${await response.text()}`);
  }
  const limited = await handlePatternsAutonomy(request(
    'feedback', 'POST', retrievalFeedback({
      feedback_id:'123e4567-e89b-42d3-a456-ffffffffffff',
    }), undefined, headers), env);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(sql.prepare('SELECT count FROM autonomy_ingress_rate_buckets').get().count, 61);
  const storedBucket = sql.prepare('SELECT * FROM autonomy_ingress_rate_buckets').get();
  assert.doesNotMatch(JSON.stringify(storedBucket), /203\.0\.113\.10/);
  delete env.PATTERNS_RATE_LIMIT_SECRET;
  const unconfigured = await handlePatternsAutonomy(request(
    'feedback', 'POST', retrievalFeedback(), undefined,
    {origin:'https://uas-patterns.com','cf-connecting-ip':'203.0.113.11'}), env);
  assert.equal(unconfigured.status, 503);
  sql.close();
});

test('retention maintenance purges bounded operational data but preserves registries', async () => {
  const {env, sql} = setup();
  const old = '2025-01-01T00:00:00.000Z';
  sql.prepare(
    "INSERT INTO evidence_events(id,entity_type,entity_id,event_type,data,created) VALUES(?1,'retrieval',?2,'retrieval-feedback','{}',?3)",
  ).run('e'.repeat(24), 'q'.repeat(24), old);
  sql.prepare(
    "INSERT INTO evidence_events(id,entity_type,entity_id,event_type,data,created) VALUES(?1,'feedback',?2,'reviewer-disposition','{}',?3)",
  ).run('d'.repeat(24), 'e'.repeat(24), old);
  sql.prepare(
    "INSERT INTO retrieval_serving_receipts(id,policy_id,served_version,configured_version,generation,query_id,input_revision,outcome,fallback_reason,latency_ms,created) VALUES(?1,'ask-pie-ranking','lexical-subject-v2',NULL,0,?2,'old-revision','served',NULL,1,?3)",
  ).run('c'.repeat(24), 'b'.repeat(24), old);
  sql.prepare(
    "INSERT INTO retrieval_policy_monitor_evaluations(id,policy_id,evaluated_version,generation,evidence_digest,rollback_recommended,requested_action,data,created) VALUES(?1,'ask-pie-ranking','lexical-subject-v2',0,?2,0,'evaluate','{}',?3)",
  ).run('a'.repeat(24), 'f'.repeat(64), old);
  sql.prepare(
    "INSERT INTO autonomy_ingress_rate_buckets(id,route,count,expires_at,created,updated) VALUES(?1,'feedback',1,?2,?3,?3)",
  ).run('9'.repeat(32), old, old);

  assert.equal((await handlePatternsAutonomy(request(
    'maintenance/retention', 'POST', {action:'purge-expired'}), env)).status, 401);
  const response = await handlePatternsAutonomy(request(
    'maintenance/retention', 'POST', {action:'purge-expired'}, 'monitor-token'), env);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.deleted.retrieval_feedback, 1);
  assert.equal(body.deleted.feedback_dispositions, 1);
  assert.equal(body.deleted.serving_receipts, 1);
  assert.equal(body.deleted.policy_monitor_evaluations, 1);
  assert.equal(body.deleted.rate_buckets, 1);
  assert.equal(body.candidate_registry_deleted, false);
  assert.equal(body.policy_transition_history_deleted, false);
  assert.equal(sql.prepare('SELECT count(*) count FROM evidence_events').get().count, 0);
  sql.close();
});

test('registered candidates execute only in shadow and persist raw-query-free receipts', async () => {
  const { env, sql } = setup();
  const bundle = shadowRegistryBundle();
  assert.equal((await handlePatternsAutonomy(
    request('candidates', 'POST', bundle), env,
  )).status, 401);
  const registeredResponse = await handlePatternsAutonomy(
    request('candidates', 'POST', bundle, 'review-token'), env,
  );
  assert.equal(registeredResponse.status, 201, await registeredResponse.clone().text());
  const registered = await registeredResponse.json();
  assert.equal(registered.state, 'registered-shadow-only');
  assert.equal(registered.serving_changes, false);
  assert.equal(registered.promotion_eligible, false);
  const replayed = await (await handlePatternsAutonomy(
    request('candidates', 'POST', bundle, 'review-token'), env,
  )).json();
  assert.equal(replayed.replayed, true);
  assert.equal(sql.prepare('SELECT count(*) n FROM retrieval_candidates').get().n, 1);

  const before = await (await handlePatternsAutonomy(request('shadow/status'), env)).json();
  assert.equal(before.enabled, false);
  const enabled = await (await handlePatternsAutonomy(request(
    `candidates/${bundle.candidate_version}/shadow`, 'POST',
    { action: 'enable-shadow', notes: 'Begin invisible production comparison only.' },
    'review-token',
  ), env)).json();
  assert.equal(enabled.shadow_enabled, true);
  assert.equal(enabled.visible_effect, false);
  assert.equal(enabled.serving_changes, false);

  const observation = {
    schema_version: 1,
    observation_id: '523e4567-e89b-42d3-a456-426614174004',
    query: 'counter UAS procurement evidence',
    policy_id: 'ask-pie-ranking',
    policy_version: 'lexical-subject-v2',
    input_revision: 'revision-live-1',
    results: [
      {
        record_key: 'article:wrong', position: 1,
        features: { score: 42, coverage: .2, weighted_coverage: .2,
          direct: false, subject_in_title: false, citation_count: 0 },
      },
      {
        record_key: 'article:helpful', position: 2,
        features: { score: 40, coverage: 1, weighted_coverage: 1,
          direct: true, subject_in_title: true, citation_count: 2 },
      },
    ],
  };
  const shadowResponse = await handlePatternsAutonomy(
    request('shadow', 'POST', observation, undefined, { origin: 'https://uas-patterns.com' }), env,
  );
  assert.equal(shadowResponse.status, 202, await shadowResponse.clone().text());
  const shadow = await shadowResponse.json();
  assert.equal(shadow.receipt.top_result_changed, true);
  assert.equal(shadow.receipt.changed_positions, 2);
  assert.equal(shadow.receipt.visible_effect, false);
  assert.equal(shadow.receipt.serving_changes, false);
  assert.equal(shadow.receipt.promotion_eligible, false);
  assert.equal(shadow.receipt.query, undefined);
  const stored = sql.prepare('SELECT data FROM retrieval_shadow_receipts').get().data;
  assert.doesNotMatch(stored, /counter UAS procurement evidence/);
  assert.equal(JSON.parse(stored).data_policy.raw_query_stored, false);

  const duplicate = await (await handlePatternsAutonomy(
    request('shadow', 'POST', observation, undefined, { origin: 'https://uas-patterns.com' }), env,
  )).json();
  assert.equal(duplicate.receipt_id, shadow.receipt_id);
  assert.equal(sql.prepare('SELECT count(*) n FROM retrieval_shadow_receipts').get().n, 1);
  const conflict = await handlePatternsAutonomy(
    request('shadow', 'POST', { ...observation, query: 'different query' }, undefined,
      { origin: 'https://uas-patterns.com' }), env,
  );
  assert.equal(conflict.status, 409);
  assert.equal((await handlePatternsAutonomy(request('shadow/receipts'), env)).status, 401);
  const listed = await (await handlePatternsAutonomy(
    request('shadow/receipts', 'GET', undefined, 'review-token'), env,
  )).json();
  assert.equal(listed.receipts.length, 1);
  assert.equal(listed.serving_changes, false);
  sql.close();
});

test('shadow gates, signed approval, atomic activation, fail-closed serving, and rollback form one chain', async () => {
  const { env, sql } = setup();
  const bundle = shadowRegistryBundle();
  const registered = await handlePatternsAutonomy(
    request('candidates', 'POST', bundle, 'review-token'), env,
  );
  assert.equal(registered.status, 201, await registered.clone().text());

  const start = Date.parse('2026-09-22T00:00:00Z');
  for (let index = 0; index < 100; index += 1) {
    const created = new Date(start + index * 2 * 60 * 60 * 1000).toISOString();
    const queryId = (index % 30).toString(16).padStart(24, '0');
    const receipt = {
      bundle_sha256: bundle.bundle_sha256,
      top_result_changed: index % 4 === 0,
      changed_positions: index % 2 === 0 ? 2 : 0,
    };
    sql.prepare('INSERT INTO retrieval_shadow_attempts(id,candidate_version,state,latency_ms,error_code,created) VALUES(?1,?2,?3,?4,NULL,?5)')
      .run((2000 + index).toString(16).padStart(24, '0'), bundle.candidate_version,
        'succeeded', 10 + index % 3, created);
    sql.prepare('INSERT INTO retrieval_shadow_receipts(id,candidate_version,query_id,input_revision,data,created) VALUES(?1,?2,?3,?4,?5,?6)')
      .run((3000 + index).toString(16).padStart(24, '0'), bundle.candidate_version,
        queryId, 'revision-shadow-window', JSON.stringify(receipt), created);
  }
  const evaluationResponse = await handlePatternsAutonomy(request(
    `candidates/${bundle.candidate_version}/shadow/evaluate`, 'POST', {}, 'review-token',
  ), env);
  assert.equal(evaluationResponse.status, 201, await evaluationResponse.clone().text());
  const evaluation = (await evaluationResponse.json()).evaluation;
  assert.equal(evaluation.shadow_passed, true);
  assert.equal(evaluation.approval_eligible, true);
  assert.equal(evaluation.promotion_eligible, false);
  assert.equal(evaluation.metrics.receipts, 100);
  assert.equal(evaluation.metrics.unique_queries, 30);
  assert.ok(evaluation.metrics.duration_seconds >= 604800);

  const manifest = await signedPolicyManifest(bundle, evaluation);
  const tampered = structuredClone(manifest);
  tampered.parameters.feature_adjustments.coverage = -12;
  assert.equal((await handlePatternsAutonomy(
    request('promotions', 'POST', tampered, 'review-token'), env,
  )).status, 400);
  const approvedResponse = await handlePatternsAutonomy(
    request('promotions', 'POST', manifest, 'review-token'), env,
  );
  assert.equal(approvedResponse.status, 201, await approvedResponse.clone().text());
  const approved = await approvedResponse.json();
  assert.equal(approved.state, 'approved');
  assert.equal(approved.activation_eligible, true);
  assert.equal(approved.serving_changes, false);

  const stale = await handlePatternsAutonomy(request(
    `promotions/${approved.id}/activate`, 'POST', {
      action:'activate', expected_active_version:'wrong-version', expected_generation:0,
      notes:'This compare-and-swap must fail.',
    }, 'review-token'), env);
  assert.equal(stale.status, 409);
  const activatedResponse = await handlePatternsAutonomy(request(
    `promotions/${approved.id}/activate`, 'POST', {
      action:'activate', expected_active_version:'lexical-subject-v2', expected_generation:0,
      notes:'Activate the signed candidate with the incumbent as rollback.',
    }, 'review-token'), env);
  assert.equal(activatedResponse.status, 200, await activatedResponse.clone().text());
  const activated = await activatedResponse.json();
  assert.equal(activated.active_version, bundle.candidate_version);
  assert.equal(activated.rollback_version, 'lexical-subject-v2');
  assert.equal(activated.generation, 1);
  assert.equal(sql.prepare('SELECT state FROM retrieval_policy_manifests').get().state, 'active');
  assert.equal(sql.prepare('SELECT count(*) n FROM retrieval_policy_transitions').get().n, 1);

  const activeStatus = await (await handlePatternsAutonomy(request('policy/status'), env)).json();
  assert.equal(activeStatus.version, bundle.candidate_version);
  assert.equal(activeStatus.fallback, false);
  assert.equal(activeStatus.parameters_exposed, false);
  const oldPolicyFeedback = await handlePatternsAutonomy(request(
    'feedback', 'POST', retrievalFeedback({
      feedback_id:'823e4567-e89b-42d3-a456-426614174007',
    }), undefined, {origin:'https://uas-patterns.com'}), env);
  assert.equal(oldPolicyFeedback.status, 409);
  const currentPolicyFeedback = await handlePatternsAutonomy(request(
    'feedback', 'POST', retrievalFeedback({
      feedback_id:'923e4567-e89b-42d3-a456-426614174008',
      policy_version:bundle.candidate_version,
    }), undefined, {origin:'https://uas-patterns.com'}), env);
  assert.equal(currentPolicyFeedback.status, 202, await currentPolicyFeedback.clone().text());

  const researchIndex = {
    schema_version:1,
    meta:{generated_at:new Date().toISOString(),input_revision:'revision-active-serving'},
    counts:{article:2},
    records:[
      {
        id:'alpha',type:'article',title:'Counter UAS alpha',summary:'Program evidence',
        titleText:'counter uas alpha',summaryText:'program evidence',
        searchText:'counter uas alpha program evidence',date:'2026-10-01',source:'agency',
        destination:'https://example.test/alpha',semantics:'Indexed evidence.',citations:[],
      },
      {
        id:'beta',type:'article',title:'Counter UAS beta',summary:'Program evidence',
        titleText:'counter uas beta',summaryText:'program evidence',
        searchText:'counter uas beta program evidence',date:'2026-10-01',source:'agency',
        destination:'https://example.test/beta',semantics:'Indexed evidence.',
        citations:[1,2,3,4].map(index => ({
          url:`https://example.test/source-${index}`,title:`Source ${index}`,
          source:'agency',date:'2026-10-01',kind:'article',
        })),
      },
    ],
  };
  env.PIE_OUTPUTS = {async get(key) {
    return key === 'research_index' ? JSON.stringify(researchIndex) : null;
  }};
  const servingTasks = [];
  const servingResponse = await forgeData.fetch(new Request(
    'https://uas-patterns.com/api/data?type=research_index&q=counter+uas&limit=2',
  ), env, {waitUntil(task) { servingTasks.push(task); }});
  assert.equal(servingResponse.status, 200, await servingResponse.clone().text());
  const servingBody = await servingResponse.json();
  assert.equal(servingBody.data.policy_receipt.applied, true);
  await Promise.all(servingTasks);
  const servedReceipt = sql.prepare(
    'SELECT outcome,served_version,query_id,input_revision FROM retrieval_serving_receipts',
  ).get();
  assert.equal(servedReceipt.outcome, 'served');
  assert.equal(servedReceipt.served_version, bundle.candidate_version);
  assert.equal(servedReceipt.input_revision, 'revision-active-serving');
  assert.doesNotMatch(JSON.stringify(servedReceipt), /counter uas/i);

  const manifestRow = sql.prepare('SELECT id,data FROM retrieval_policy_manifests').get();
  const brokenManifest = JSON.parse(manifestRow.data);
  brokenManifest.signature = '0'.repeat(64);
  sql.prepare('UPDATE retrieval_policy_manifests SET data=?1 WHERE id=?2')
    .run(JSON.stringify(brokenManifest), manifestRow.id);
  const fallback = await (await handlePatternsAutonomy(request('policy/status'), env)).json();
  assert.equal(fallback.version, 'lexical-subject-v2');
  assert.equal(fallback.configured_version, bundle.candidate_version);
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.fallback_reason, 'manifest-signature-invalid');
  const fallbackTasks = [];
  const fallbackServingResponse = await forgeData.fetch(new Request(
    'https://uas-patterns.com/api/data?type=research_index&q=counter+uas&limit=2',
  ), env, {waitUntil(task) { fallbackTasks.push(task); }});
  assert.equal(fallbackServingResponse.status, 200);
  assert.equal((await fallbackServingResponse.json()).data.policy_receipt.applied, false);
  await Promise.all(fallbackTasks);
  const fallbackReceipt = sql.prepare(
    "SELECT outcome,fallback_reason FROM retrieval_serving_receipts WHERE outcome='fallback'",
  ).get();
  assert.equal(fallbackReceipt.fallback_reason, 'manifest-signature-invalid');
  const monitorResponse = await handlePatternsAutonomy(request(
    'policy/monitor', 'POST', {
      action:'evaluate', notes:'Evaluate active-serving integrity without changing state.',
    }, 'review-token'), env);
  assert.equal(monitorResponse.status, 200, await monitorResponse.clone().text());
  const monitored = await monitorResponse.json();
  assert.equal(monitored.evaluation.rollback_recommended, true);
  assert.equal(monitored.evaluation.metrics.hard_integrity_fallbacks, 1);
  assert.equal(monitored.rollback.applied, false);
  assert.equal(monitored.automatic_promotion, false);
  sql.prepare('UPDATE retrieval_policy_manifests SET data=?1 WHERE id=?2')
    .run(manifestRow.data, manifestRow.id);

  const rollbackResponse = await handlePatternsAutonomy(request(
    'policy/rollback', 'POST', {
      action:'rollback', expected_active_version:bundle.candidate_version, expected_generation:1,
      notes:'Rollback drill to the deterministic incumbent.',
    }, 'review-token'), env);
  assert.equal(rollbackResponse.status, 200, await rollbackResponse.clone().text());
  const rolledBack = await rollbackResponse.json();
  assert.equal(rolledBack.active_version, 'lexical-subject-v2');
  assert.equal(rolledBack.generation, 2);
  assert.equal(sql.prepare('SELECT state FROM retrieval_policy_manifests').get().state, 'rolled-back');
  assert.equal(sql.prepare('SELECT count(*) n FROM retrieval_policy_transitions').get().n, 2);
  const transitions = await (await handlePatternsAutonomy(
    request('policy/transitions', 'GET', undefined, 'review-token'), env,
  )).json();
  assert.deepEqual(transitions.transitions.map(item => item.action), ['rollback', 'activate']);
  sql.close();
});

test('monitor token automatically rolls back a cryptographically invalid active candidate', async () => {
  const {env, sql} = setup();
  const candidateVersion = 'candidate-aaaaaaaaaaaaaaaa';
  const now = new Date().toISOString();
  sql.prepare(
    "INSERT INTO retrieval_policy_state(policy_id,active_version,rollback_version,manifest_id,generation,last_action,last_notes,updated) VALUES(?1,?2,?3,NULL,3,'activate',?4,?5)",
  ).run('ask-pie-ranking', candidateVersion, 'lexical-subject-v2', 'test fixture', now);
  sql.prepare(
    "INSERT INTO retrieval_serving_receipts(id,policy_id,served_version,configured_version,generation,query_id,input_revision,outcome,fallback_reason,latency_ms,created) VALUES(?1,?2,?3,?4,3,?5,?6,'fallback',?7,8,?8)",
  ).run('a'.repeat(24), 'ask-pie-ranking', 'lexical-subject-v2', candidateVersion,
    'b'.repeat(24), 'revision-monitor', 'manifest-signature-invalid', now);

  assert.equal((await handlePatternsAutonomy(request(
    'policy/monitor', 'POST', {action:'evaluate-and-rollback',notes:'unauthorized'},
  ), env)).status, 401);
  const response = await handlePatternsAutonomy(request(
    'policy/monitor', 'POST', {
      action:'evaluate-and-rollback',
      notes:'Cryptographic integrity failure requires deterministic fallback.',
    }, 'monitor-token'), env);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.evaluation.rollback_recommended, true);
  assert.equal(body.rollback.applied, true);
  assert.equal(body.rollback.from_version, candidateVersion);
  assert.equal(body.rollback.to_version, 'lexical-subject-v2');
  assert.equal(body.rollback.generation, 4);
  assert.equal(body.automatic_promotion, false);
  assert.equal(body.evaluation.data_policy.raw_query_stored, false);
  const state = sql.prepare(
    'SELECT active_version,generation,last_action,last_notes FROM retrieval_policy_state',
  ).get();
  assert.equal(state.active_version, 'lexical-subject-v2');
  assert.equal(state.generation, 4);
  assert.equal(state.last_action, 'rollback');
  assert.match(state.last_notes, /^Automatic hard-gate rollback:/);
  assert.equal(sql.prepare(
    'SELECT count(*) count FROM retrieval_policy_monitor_evaluations',
  ).get().count, 1);
  assert.equal(sql.prepare(
    "SELECT count(*) count FROM retrieval_policy_transitions WHERE action='rollback'",
  ).get().count, 1);
  sql.close();
});
