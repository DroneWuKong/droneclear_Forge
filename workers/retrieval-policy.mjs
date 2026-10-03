const encoder = new TextEncoder();
const FEATURES = [
  'citation_count', 'coverage', 'direct', 'subject_in_title', 'weighted_coverage',
];
const MANIFEST_KEYS = [
  'activation_eligible', 'approval', 'approval_record_sha256',
  'candidate_bundle_sha256', 'compatible_feature_schema', 'compatible_input_schema',
  'holdout_evidence_sha256', 'incumbent_version', 'issued_at', 'manifest_sha256',
  'parameters', 'parameters_sha256', 'policy_id', 'replay_evidence_sha256',
  'rollback_to', 'schema_version', 'serving_changes', 'serving_scope', 'shadow_evidence_sha256',
  'signature', 'signing', 'state', 'training_corpus_sha256', 'version',
].sort();

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export async function sha256(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function digest(value) {
  return sha256(canonicalJson(value));
}

function manifestCore(manifest) {
  return Object.fromEntries(Object.entries(manifest).filter(([key]) => ![
    'manifest_sha256', 'signature', 'state', 'activation_eligible', 'serving_changes',
  ].includes(key)));
}

export async function verifyPolicyManifest(input, secret) {
  try {
    if (!secret || encoder.encode(secret).length < 32 || !exactKeys(input, MANIFEST_KEYS)) {
      return {valid:false, reason:'manifest-contract-invalid'};
    }
    const adjustments = input.parameters?.feature_adjustments;
    const digests = [
      input.candidate_bundle_sha256, input.training_corpus_sha256,
      input.replay_evidence_sha256, input.holdout_evidence_sha256,
      input.shadow_evidence_sha256, input.parameters_sha256,
      input.approval_record_sha256, input.manifest_sha256, input.signature,
      input.approval?.rationale_sha256,
    ];
    if (
      input.schema_version !== 'policy-bundle-v1'
      || input.policy_id !== 'ask-pie-ranking'
      || !/^candidate-[0-9a-f]{16}$/.test(input.version || '')
      || typeof input.incumbent_version !== 'string' || !input.incumbent_version
      || input.rollback_to !== input.incumbent_version
      || input.compatible_input_schema !== 'research-index-v1'
      || input.compatible_feature_schema !== 'ask-pie-feedback-features-v1'
      || input.serving_scope?.mode !== 'rerank-incumbent-page-v1'
      || input.serving_scope?.maximum_records !== 100
      || input.serving_scope?.changes_membership !== false
      || input.parameters?.base_score_weight !== 1
      || !exactKeys(adjustments, FEATURES)
      || !FEATURES.every(name => Number.isInteger(adjustments[name])
        && adjustments[name] >= -12 && adjustments[name] <= 12
        && adjustments[name] % 4 === 0)
      || input.parameters?.feature_transforms?.citation_count !== 'min(value,4)/4'
      || input.parameters?.feature_transforms?.booleans !== '0-or-1'
      || input.approval?.schema_version !== 'retrieval-promotion-approval-v1'
      || !/^[0-9a-f-]{36}$/.test(input.approval?.approval_id || '')
      || input.approval?.action !== 'approve-promotion'
      || typeof input.approval?.reviewer_reference !== 'string'
      || input.approval.reviewer_reference.length < 3
      || input.approval.reviewer_reference.length > 128
      || !Number.isFinite(Date.parse(input.approval?.approved_at || ''))
      || input.issued_at !== input.approval.approved_at
      || input.signing?.algorithm !== 'hmac-sha256'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/.test(input.signing?.key_id || '')
      || input.state !== 'approved-not-active'
      || input.activation_eligible !== true
      || input.serving_changes !== false
      || !digests.every(value => /^[0-9a-f]{64}$/.test(String(value || '')))
    ) return {valid:false, reason:'manifest-contract-invalid'};
    if (await digest(input.parameters) !== input.parameters_sha256) {
      return {valid:false, reason:'parameters-digest-invalid'};
    }
    if (await digest(input.approval) !== input.approval_record_sha256) {
      return {valid:false, reason:'approval-digest-invalid'};
    }
    const core = manifestCore(input);
    if (await digest(core) !== input.manifest_sha256) {
      return {valid:false, reason:'manifest-digest-invalid'};
    }
    const signedPayload = {...core, manifest_sha256:input.manifest_sha256};
    const expected = await hmacSha256(secret, canonicalJson(signedPayload));
    if (!safeEqual(expected, input.signature)) {
      return {valid:false, reason:'manifest-signature-invalid'};
    }
    return {valid:true, reason:null, manifest:input};
  } catch {
    return {valid:false, reason:'manifest-verification-failed'};
  }
}

function fallbackReceipt(reason, configuredVersion = null, generation = 0) {
  return {
    policy_id: 'ask-pie-ranking',
    version: 'lexical-subject-v2',
    configured_version: configuredVersion,
    generation,
    fallback: Boolean(reason),
    fallback_reason: reason,
    manifest_sha256: null,
    rollback_to: null,
  };
}

export async function loadActiveRetrievalPolicy(env, inputSchema = 'research-index-v1') {
  if (!env?.AUTONOMY_DB) {
    return {runtime:null, receipt:fallbackReceipt('policy-storage-unavailable')};
  }
  let state;
  try {
    state = await env.AUTONOMY_DB.prepare(
      'SELECT policy_id,active_version,rollback_version,manifest_id,generation FROM retrieval_policy_state WHERE policy_id=?1',
    ).bind('ask-pie-ranking').first();
  } catch {
    return {runtime:null, receipt:fallbackReceipt('policy-schema-unavailable')};
  }
  if (!state) return {runtime:null, receipt:fallbackReceipt(null)};
  if (state.active_version === 'lexical-subject-v2' && !state.manifest_id) {
    return {runtime:null, receipt:fallbackReceipt(null, null, state.generation)};
  }
  const fallback = reason => ({
    runtime:null,
    receipt:fallbackReceipt(reason, state.active_version, state.generation),
  });
  if (!env.PATTERNS_POLICY_SIGNING_SECRET) return fallback('signing-secret-unavailable');
  let row;
  try {
    row = await env.AUTONOMY_DB.prepare(
      'SELECT m.state manifest_state,m.data manifest_data,c.data runtime_data,c.bundle_sha256 '
      + 'FROM retrieval_policy_manifests m JOIN retrieval_candidates c '
      + 'ON c.candidate_version=m.candidate_version WHERE m.id=?1 AND m.candidate_version=?2',
    ).bind(state.manifest_id, state.active_version).first();
  } catch {
    return fallback('active-policy-read-failed');
  }
  if (!row || row.manifest_state !== 'active') return fallback('active-manifest-unavailable');
  let manifest;
  let runtime;
  try {
    manifest = JSON.parse(row.manifest_data);
    runtime = JSON.parse(row.runtime_data);
  } catch {
    return fallback('active-policy-json-invalid');
  }
  const verified = await verifyPolicyManifest(manifest, env.PATTERNS_POLICY_SIGNING_SECRET);
  if (!verified.valid) return fallback(verified.reason);
  if (
    manifest.compatible_input_schema !== inputSchema
    || manifest.version !== runtime.candidate_version
    || manifest.candidate_bundle_sha256 !== runtime.bundle_sha256
    || manifest.parameters_sha256 !== await digest(runtime.parameters)
  ) return fallback('active-policy-incompatible');
  return {
    runtime,
    receipt: {
      policy_id: manifest.policy_id,
      version: manifest.version,
      configured_version: manifest.version,
      incumbent_version: manifest.incumbent_version,
      generation: state.generation,
      fallback: false,
      fallback_reason: null,
      manifest_sha256: manifest.manifest_sha256,
      rollback_to: state.rollback_version,
    },
  };
}

function boundedText(value, fallback, maximum = 256) {
  const text = String(value || '').trim();
  return (text || fallback).slice(0, maximum);
}

export async function recordRetrievalServingReceipt(env, observation) {
  if (!env?.AUTONOMY_DB) return null;
  const policy = observation?.policyReceipt;
  if (!policy || policy.policy_id !== 'ask-pie-ranking') return null;
  const created = new Date().toISOString();
  const requestNonce = crypto.randomUUID();
  const queryId = (await sha256(
    String(observation.query || '').trim().toLocaleLowerCase('en-US'),
  )).slice(0, 24);
  const id = (await sha256(`${policy.policy_id}\x1f${policy.generation || 0}\x1f${requestNonce}`))
    .slice(0, 24);
  const fallback = Boolean(policy.fallback);
  await env.AUTONOMY_DB.prepare(
    'INSERT INTO retrieval_serving_receipts('
    + 'id,policy_id,served_version,configured_version,generation,query_id,input_revision,'
    + 'outcome,fallback_reason,latency_ms,created) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)',
  ).bind(
    id,
    policy.policy_id,
    boundedText(policy.version, 'lexical-subject-v2', 128),
    policy.configured_version ? boundedText(policy.configured_version, '', 128) : null,
    Number.isInteger(policy.generation) && policy.generation >= 0 ? policy.generation : 0,
    queryId,
    boundedText(observation.inputRevision, 'unknown', 256),
    fallback ? 'fallback' : 'served',
    fallback ? boundedText(policy.fallback_reason, 'unspecified-fallback', 128) : null,
    Math.max(0, Math.round(Number(observation.latencyMs) || 0)),
    created,
  ).run();
  return {id, query_id:queryId, created};
}

export const RETRIEVAL_POLICY_FEATURES = Object.freeze([...FEATURES]);
