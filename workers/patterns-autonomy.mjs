/*
 * Autonomous evidence API for UAS Patterns.
 * Models propose evidence packets. Trusted code retrieves and hashes sources,
 * then deterministic policy marks a claim eligible, abstained, or exceptional.
 * Nothing in this module publishes a model conclusion to PIE_OUTPUTS.
 */
const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
const encoder = new TextEncoder();
const TERMINAL_FAILURES = new Map([
  ['response.failed', 'failed'],
  ['response.incomplete', 'incomplete'],
  ['response.cancelled', 'cancelled'],
]);
const CLAIM_POLICIES = {
  observation: { minimumSources: 2, eligible: true },
  analysis: { minimumSources: 2, eligible: false, review: true },
  hypothesis: { minimumSources: 2, eligible: false, review: true },
  forecast: { minimumSources: 1, eligible: false, forecast: true },
  regulatory: { minimumSources: 1, eligible: false, review: true, authority: true },
  procurement: { minimumSources: 1, eligible: false, review: true, authority: true },
  hardware: { minimumSources: 2, eligible: false, review: true, physical: true },
  field: { minimumSources: 2, eligible: false, review: true, physical: true },
  safety: { minimumSources: 2, eligible: false, review: true, physical: true },
};
const CONCLUSIONS = new Set(['supports', 'partially-supports', 'contradicts', 'insufficient']);
const SOURCE_CLASSES = new Set([
  'controlling-authority', 'government-guidance', 'standard', 'manufacturer',
  'peer-reviewed', 'independent-technical', 'field-observation', 'other',
]);
const OFFICIAL_DOMAINS = [
  'acquisition.gov', 'congress.gov', 'defense.gov', 'ecfr.gov', 'faa.gov',
  'fcc.gov', 'federalregister.gov', 'gao.gov', 'govinfo.gov', 'sam.gov',
  'usaspending.gov', 'nist.gov', 'cisa.gov', 'ntia.gov', 'itu.int',
];
const respond = (status, data, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status, headers:{...JSON_HEADERS, ...extraHeaders},
});
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const sha = async value => hex(new Uint8Array(await crypto.subtle.digest(
  'SHA-256', typeof value === 'string' ? encoder.encode(value) : value,
)));
const safeEqual = (left, right) => {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
};

async function reviewer(request, secret) {
  const value = request.headers.get('authorization') || '';
  if (!secret || !value.startsWith('Bearer ')) return false;
  return safeEqual(await sha(value.slice(7)), await sha(secret));
}

async function parseBody(request, limit = 262144) {
  const text = await request.text();
  if (encoder.encode(text).length > limit) throw new Error('Body too large');
  return JSON.parse(text);
}

function decodeSecret(secret) {
  const value = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Uint8Array.from(atob(normalized), character => character.charCodeAt(0));
  } catch {
    return encoder.encode(secret);
  }
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', decodeSecret(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  let raw = '';
  for (const byte of signed) raw += String.fromCharCode(byte);
  return btoa(raw);
}

export async function verifyWebhook(raw, headers, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const id = headers.get('webhook-id') || '';
  const timestamp = headers.get('webhook-timestamp') || '';
  const signatures = headers.get('webhook-signature') || '';
  if (!secret || !id || !/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const expected = await hmac(secret, `${id}.${timestamp}.${raw}`);
  return signatures.split(' ').some(item => {
    const [version, value] = item.split(',', 2);
    return version === 'v1' && Boolean(value) && safeEqual(value, expected);
  });
}

async function recordEvent(env, entityType, entityId, eventType, data) {
  const serialized = JSON.stringify(data);
  const id = (await sha(`${entityType}\x1f${entityId}\x1f${eventType}\x1f${serialized}`)).slice(0, 24);
  const now = new Date().toISOString();
  await env.AUTONOMY_DB.prepare(
    'INSERT OR IGNORE INTO evidence_events(id,entity_type,entity_id,event_type,data,created) VALUES(?1,?2,?3,?4,?5,?6)',
  ).bind(id, entityType, entityId, eventType, serialized, now).run();
  return id;
}

function cleanSpec(input) {
  if (
    input?.schema_version !== 1 || typeof input.id !== 'string' || !/^[0-9a-f]{24}$/.test(input.id)
    || typeof input.claim_id !== 'string' || !input.claim_id || typeof input.release !== 'string'
    || !CLAIM_POLICIES[input.claim_type] || !['low', 'medium', 'high', 'critical'].includes(input.risk)
    || typeof input.statement !== 'string' || !input.statement.trim()
  ) throw new Error('Invalid research spec');
  if (!Array.isArray(input.candidate_sources) || input.candidate_sources.length > 20) {
    throw new Error('Invalid research source candidates');
  }
  if (!Array.isArray(input.allowed_domains) || input.allowed_domains.length > 30) {
    throw new Error('Invalid research domain allowlist');
  }
  if (JSON.stringify(input).length > 60000) throw new Error('Research spec too large');
  return input;
}

function cleanResearchRequest(input, spec, role) {
  if (
    !input || input.background !== true || input.tool_choice !== 'required'
    || input.metadata?.research_spec_id !== spec.id || input.metadata?.claim_id !== spec.claim_id
    || input.metadata?.role !== role || !Number.isInteger(input.max_output_tokens)
    || input.max_output_tokens < 500 || input.max_output_tokens > 5000
  ) throw new Error('Invalid bounded background research request');
  if (
    !Array.isArray(input.tools) || input.tools.length !== 1 || input.tools[0]?.type !== 'web_search'
    || input.text?.format?.type !== 'json_schema' || input.text?.format?.strict !== true
  ) throw new Error('Research request must use web search and strict structured output');
  if (JSON.stringify(input).length > 90000) throw new Error('Research request too large');
  return input;
}

async function startResearchRun(env, spec, requests) {
  const now = new Date().toISOString();
  const jobs = [];
  await env.AUTONOMY_DB.prepare(
    "INSERT INTO research_specs(id,claim_id,release,claim_type,risk,data,state,created,updated) VALUES(?1,?2,?3,?4,?5,?6,'planned',?7,?7) ON CONFLICT(id) DO NOTHING",
  ).bind(spec.id, spec.claim_id, spec.release, spec.claim_type, spec.risk, JSON.stringify(spec), now).run();
  for (const role of ['researcher', 'verifier']) {
    const id = (await sha(`${spec.id}\x1f${role}`)).slice(0, 24);
    const existing = await env.AUTONOMY_DB.prepare(
      'SELECT response_id,state FROM research_jobs WHERE id=?1',
    ).bind(id).first();
    if (existing?.response_id && ['queued', 'in_progress', 'completed'].includes(existing.state)) {
      jobs.push({ id, role, ...existing, replayed: true });
      continue;
    }
    const providerRequest = cleanResearchRequest(requests?.[role], spec, role);
    await env.AUTONOMY_DB.prepare(
      "INSERT OR IGNORE INTO research_jobs(id,spec_id,role,provider,state,created,updated) VALUES(?1,?2,?3,'openai','planned',?4,?4)",
    ).bind(id, spec.id, role, now).run();
    const remote = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(providerRequest),
    });
    if (!remote.ok) {
      await env.AUTONOMY_DB.prepare(
        "UPDATE research_jobs SET state='failed',attempts=attempts+1,last_error=?1,updated=?2 WHERE id=?3",
      ).bind(`Provider HTTP ${remote.status}`, now, id).run();
      throw new Error('Research provider rejected a background request');
    }
    const response = await remote.json();
    if (!response.id || !['queued', 'in_progress', 'completed'].includes(response.status)) {
      throw new Error('Research provider did not acknowledge background work');
    }
    await env.AUTONOMY_DB.prepare(
      'UPDATE research_jobs SET response_id=?1,state=?2,attempts=attempts+1,last_error=NULL,updated=?3 WHERE id=?4',
    ).bind(response.id, response.status, now, id).run();
    await recordEvent(env, 'job', id, 'provider-acknowledged', {
      response_id: response.id, state: response.status, role,
    });
    await env.AUTONOMY_DB.prepare(
      "UPDATE research_specs SET state='researching',updated=?1 WHERE id=?2",
    ).bind(now, spec.id).run();
    jobs.push({ id, role, response_id: response.id, state: response.status });
  }
  if (!jobs.every(job => job.state === 'completed')) {
    await env.AUTONOMY_DB.prepare(
      "UPDATE research_specs SET state='researching',updated=?1 WHERE id=?2",
    ).bind(now, spec.id).run();
  }
  return jobs;
}

function packetFromResponse(response) {
  const text = (response.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text || '')
    .join('');
  if (!text) throw new Error('Completed response has no evidence packet');
  return JSON.parse(text);
}

function validatePacket(packet, claimId, role) {
  const strings = ['proposed_statement', 'scope', 'jurisdiction', 'effective_date', 'notes'];
  const arrays = ['sources', 'contradictions', 'calculations', 'alternatives', 'limitations'];
  if (
    !packet || packet.claim_id !== claimId || packet.role !== role || !CONCLUSIONS.has(packet.conclusion)
    || !Number.isFinite(packet.confidence) || packet.confidence < 0 || packet.confidence > 1
    || strings.some(key => typeof packet[key] !== 'string')
    || arrays.some(key => !Array.isArray(packet[key]))
  ) throw new Error('Invalid evidence packet');
  if (
    packet.sources.length > 10 || packet.contradictions.length > 20
    || packet.calculations.length > 20 || packet.alternatives.length > 20
    || packet.limitations.length > 20
  ) throw new Error('Evidence packet exceeds bounded collection limits');
  for (const source of packet.sources) {
    if (
      !source || typeof source !== 'object' || !SOURCE_CLASSES.has(source.source_class)
      || !['url', 'title', 'publisher', 'passage', 'locator', 'supports', 'version']
        .every(key => typeof source[key] === 'string')
      || !/^\d{4}-\d{2}-\d{2}$/.test(source.retrieved_at || '')
    ) throw new Error('Invalid evidence source');
  }
  for (const calculation of packet.calculations) {
    if (
      !calculation || typeof calculation !== 'object'
      || !['method', 'inputs', 'units', 'result', 'code'].every(key => typeof calculation[key] === 'string')
      || typeof calculation.reproduced !== 'boolean'
    ) throw new Error('Invalid evidence calculation');
  }
  return packet;
}

function allowedHost(hostname, domains) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (
    !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':')
  ) return false;
  return domains.some(domain => host === domain || host.endsWith(`.${domain}`));
}

function allowedDomains(spec) {
  const candidates = (spec.candidate_sources || []).map(value => {
    try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
  });
  return [...new Set([...OFFICIAL_DOMAINS, ...(spec.allowed_domains || []), ...candidates]
    .map(value => String(value).toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter(Boolean))];
}

async function verifyPacketSources(packet, spec, env) {
  const domains = allowedDomains(spec);
  for (const source of packet.sources) {
    let url;
    try { url = new URL(source.url); } catch { throw new Error('Invalid evidence source URL'); }
    if (url.protocol !== 'https:' || !allowedHost(url.hostname, domains)) {
      throw new Error('Evidence source outside allowlist');
    }
    let remote;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      remote = await fetch(url, {
        headers: { 'user-agent': 'UAS-Patterns-Evidence/1.0' }, redirect: 'manual',
      });
      if (![301, 302, 303, 307, 308].includes(remote.status)) break;
      const location = remote.headers.get('location');
      if (!location) throw new Error('Evidence source redirect is missing a target');
      url = new URL(location, url);
      if (url.protocol !== 'https:' || !allowedHost(url.hostname, domains)) {
        throw new Error('Evidence source redirect left allowlist');
      }
      if (redirects === 5) throw new Error('Evidence source redirect limit exceeded');
    }
    if (!remote?.ok) throw new Error(`Evidence source retrieval failed: ${remote?.status || 0}`);
    const declared = Number(remote.headers.get('content-length') || 0);
    if (declared > 4 * 1024 * 1024) throw new Error('Evidence source is too large');
    const bytes = new Uint8Array(await remote.arrayBuffer());
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Evidence source is too large');
    const digest = await sha(bytes);
    source.url = url.toString();
    source.content_sha256 = digest;
    source.retrieved_by = 'trusted-worker';
    if (env.RESEARCH_EVIDENCE) {
      await env.RESEARCH_EVIDENCE.put(`sources/${digest}`, bytes, {
        httpMetadata: { contentType: remote.headers.get('content-type') || 'application/octet-stream' },
        customMetadata: { source_url: source.url, sha256: digest },
      });
      source.snapshot_key = `sources/${digest}`;
    } else {
      delete source.snapshot_key;
    }
  }
  return packet;
}

export async function adjudicateStored(env, specRow) {
  const spec = JSON.parse(specRow.data);
  const result = await env.AUTONOMY_DB.prepare(
    'SELECT p.role,p.data FROM evidence_packets p JOIN research_jobs j ON j.id=p.job_id WHERE j.spec_id=?1 ORDER BY p.role',
  ).bind(spec.id).all();
  const packets = result.results.map(row => JSON.parse(row.data));
  const byRole = Object.fromEntries(packets.map(packet => [packet.role, packet]));
  const policy = CLAIM_POLICIES[spec.claim_type];
  const sources = packets.flatMap(packet => packet.sources || []);
  const uniqueDigests = [...new Set(sources.map(source => source.content_sha256).filter(Boolean))];
  const contradictions = packets.flatMap(packet => packet.contradictions || []);
  const now = new Date().toISOString();
  let decision = {
    claim_id: spec.claim_id,
    claim_type: spec.claim_type,
    risk: spec.risk,
    publication_state: 'abstained',
    publish_eligible: false,
    human_intervention: false,
    reasons: [],
    evidence_packet_digests: packets.map(packet => packet.packet_digest).filter(Boolean),
    source_digests: uniqueDigests,
    created_at: now,
  };
  if (!byRole.researcher || !byRole.verifier) {
    decision.reasons = ['independent-role-pair-required'];
  } else if (policy.physical) {
    decision = { ...decision, publication_state: 'exception', human_intervention: true,
      reasons: ['hardware-field-or-safety-evidence-is-not-software-validation'] };
  } else if (policy.forecast) {
    decision = { ...decision, publication_state: 'forecast-evidence',
      reasons: ['forecast-remains-preregistered-and-is-not-a-current-fact'] };
  } else if (!packets.every(packet => packet.conclusion === 'supports' && packet.confidence >= 0.8)) {
    decision.reasons = ['independent-roles-did-not-both-support-at-high-confidence'];
  } else if (contradictions.length) {
    decision = { ...decision, publication_state: 'exception', human_intervention: true,
      reasons: ['unresolved-counterevidence'] };
  } else if (uniqueDigests.length < policy.minimumSources) {
    decision.reasons = ['insufficient-distinct-trusted-source-snapshots'];
  } else if (
    byRole.researcher.proposed_statement.trim() !== byRole.verifier.proposed_statement.trim()
    || byRole.researcher.scope.trim() !== byRole.verifier.scope.trim()
  ) {
    decision.reasons = ['independent-roles-did-not-propose-the-same-scoped-statement'];
  } else if (policy.authority && !sources.some(source => source.source_class === 'controlling-authority')) {
    decision = { ...decision, publication_state: 'exception', human_intervention: true,
      reasons: ['controlling-authority-source-required'] };
  } else if (policy.review) {
    decision = { ...decision, publication_state: 'exception', human_intervention: true,
      reasons: ['policy-requires-human-review'] };
  } else if (!policy.eligible) {
    decision.reasons = ['research-evidence-is-not-publication-eligible-for-this-claim-type'];
  } else {
    decision = {
      ...decision,
      publication_state: 'corroborated',
      publish_eligible: true,
      reasons: ['deterministic-eligibility-policy-passed'],
      statement: byRole.verifier.proposed_statement,
      scope: byRole.verifier.scope,
      source_urls: [...new Set(sources.map(source => source.url))].sort(),
    };
  }
  decision.id = (await sha(`${spec.id}\x1f${JSON.stringify(packets)}`)).slice(0, 24);
  await env.AUTONOMY_DB.prepare(
    'INSERT OR IGNORE INTO evidence_decisions(id,spec_id,claim_id,publication_state,publish_eligible,human_intervention,data,created) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)',
  ).bind(
    decision.id, spec.id, spec.claim_id, decision.publication_state,
    decision.publish_eligible ? 1 : 0, decision.human_intervention ? 1 : 0,
    JSON.stringify(decision), decision.created_at,
  ).run();
  await recordEvent(env, 'decision', decision.id, 'adjudicated', {
    publication_state: decision.publication_state,
    publish_eligible: decision.publish_eligible,
    human_intervention: decision.human_intervention,
    reasons: decision.reasons,
  });
  const state = decision.human_intervention ? 'exception' : decision.publish_eligible ? 'complete' : 'abstained';
  await env.AUTONOMY_DB.prepare(
    'UPDATE research_specs SET state=?1,updated=?2 WHERE id=?3',
  ).bind(state, now, spec.id).run();
  return decision;
}

async function processCompletedResponse(env, event) {
  const now = new Date().toISOString();
  const responseId = event.data.id;
  const job = await env.AUTONOMY_DB.prepare(
    'SELECT id,spec_id,role FROM research_jobs WHERE response_id=?1',
  ).bind(responseId).first();
  if (!job) {
    await env.AUTONOMY_DB.prepare(
      "UPDATE webhook_events SET state='ignored',updated=?1 WHERE id=?2",
    ).bind(now, event.id).run();
    return;
  }
  const remote = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
  });
  if (!remote.ok) throw new Error(`Response retrieval failed: ${remote.status}`);
  const declared = Number(remote.headers.get('content-length') || 0);
  if (declared > 2 * 1024 * 1024) throw new Error('Completed response is too large');
  const bytes = new Uint8Array(await remote.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Completed response is too large');
  const response = JSON.parse(new TextDecoder().decode(bytes));
  const specRow = await env.AUTONOMY_DB.prepare(
    'SELECT claim_id,data FROM research_specs WHERE id=?1',
  ).bind(job.spec_id).first();
  if (!specRow) throw new Error('Research spec is missing');
  let packet = validatePacket(packetFromResponse(response), specRow.claim_id, job.role);
  packet = await verifyPacketSources(packet, JSON.parse(specRow.data), env);
  const packetData = JSON.stringify(packet);
  const digest = await sha(packetData);
  packet.packet_digest = digest;
  const packetId = (await sha(`${job.id}|${digest}`)).slice(0, 24);
  await env.AUTONOMY_DB.prepare(
    'INSERT OR IGNORE INTO evidence_packets(id,job_id,claim_id,role,data,digest,created) VALUES(?1,?2,?3,?4,?5,?6,?7)',
  ).bind(packetId, job.id, packet.claim_id, packet.role, JSON.stringify(packet), digest, now).run();
  await recordEvent(env, 'job', job.id, 'packet-stored', { packet_id: packetId, digest, role: packet.role });
  await env.AUTONOMY_DB.prepare(
    "UPDATE research_jobs SET state='completed',last_error=NULL,updated=?1 WHERE id=?2",
  ).bind(now, job.id).run();
  const pending = await env.AUTONOMY_DB.prepare(
    "SELECT count(*) count FROM research_jobs WHERE spec_id=?1 AND state!='completed'",
  ).bind(job.spec_id).first();
  await env.AUTONOMY_DB.prepare(
    'UPDATE research_specs SET state=?1,updated=?2 WHERE id=?3',
  ).bind(Number(pending.count) === 0 ? 'adjudicating' : 'researching', now, job.spec_id).run();
  if (Number(pending.count) === 0) await adjudicateStored(env, specRow);
  await env.AUTONOMY_DB.prepare(
    "UPDATE webhook_events SET state='processed',updated=?1 WHERE id=?2",
  ).bind(now, event.id).run();
}

async function processTerminalFailure(env, event, state) {
  const now = new Date().toISOString();
  const job = await env.AUTONOMY_DB.prepare(
    'SELECT id,spec_id FROM research_jobs WHERE response_id=?1',
  ).bind(event.data.id).first();
  if (!job) {
    await env.AUTONOMY_DB.prepare(
      "UPDATE webhook_events SET state='ignored',updated=?1 WHERE id=?2",
    ).bind(now, event.id).run();
    return;
  }
  await env.AUTONOMY_DB.prepare(
    'UPDATE research_jobs SET state=?1,last_error=?2,updated=?3 WHERE id=?4',
  ).bind(state, `OpenAI terminal event: ${event.type}`, now, job.id).run();
  await env.AUTONOMY_DB.prepare(
    "UPDATE research_specs SET state='failed',updated=?1 WHERE id=?2",
  ).bind(now, job.spec_id).run();
  await recordEvent(env, 'job', job.id, 'provider-terminal-failure', { state, event_type: event.type });
  await env.AUTONOMY_DB.prepare(
    "UPDATE webhook_events SET state='processed',updated=?1 WHERE id=?2",
  ).bind(now, event.id).run();
}

async function handleWebhook(request, env, context) {
  const raw = await request.text();
  if (encoder.encode(raw).length > 262144) return respond(413, { error: 'Webhook body too large' });
  if (!await verifyWebhook(raw, request.headers, env.OPENAI_WEBHOOK_SECRET)) {
    return respond(400, { error: 'Invalid webhook signature' });
  }
  const event = JSON.parse(raw);
  if (!event.id || !event.type || !event.data?.id) throw new Error('Invalid webhook event');
  const now = new Date().toISOString();
  const saved = await env.AUTONOMY_DB.prepare(
    "INSERT OR IGNORE INTO webhook_events(id,event_type,response_id,state,created,updated) VALUES(?1,?2,?3,'received',?4,?4)",
  ).bind(event.id, event.type, event.data.id, now).run();
  if (saved.meta.changes === 0) return respond(200, { received: true, replayed: true });
  let work;
  if (event.type === 'response.completed') work = processCompletedResponse(env, event);
  else if (TERMINAL_FAILURES.has(event.type)) work = processTerminalFailure(env, event, TERMINAL_FAILURES.get(event.type));
  else {
    await env.AUTONOMY_DB.prepare(
      "UPDATE webhook_events SET state='ignored',updated=?1 WHERE id=?2",
    ).bind(now, event.id).run();
    return respond(202, { received: true, ignored: true });
  }
  const guarded = work.catch(async error => {
    await env.AUTONOMY_DB.prepare(
      "UPDATE webhook_events SET state='failed',updated=?1 WHERE id=?2",
    ).bind(new Date().toISOString(), event.id).run();
    const job = await env.AUTONOMY_DB.prepare(
      'SELECT id,spec_id FROM research_jobs WHERE response_id=?1',
    ).bind(event.data.id).first();
    if (job) {
      await env.AUTONOMY_DB.prepare(
        "UPDATE research_jobs SET state='failed',last_error=?1,updated=?2 WHERE id=?3",
      ).bind(error?.message?.slice(0, 500) || 'Evidence processing failed', new Date().toISOString(), job.id).run();
      await env.AUTONOMY_DB.prepare(
        "UPDATE research_specs SET state='failed',updated=?1 WHERE id=?2",
      ).bind(new Date().toISOString(), job.spec_id).run();
    }
  });
  if (context?.waitUntil) context.waitUntil(guarded); else await guarded;
  return respond(202, { received: true });
}

export async function handlePatternsAutonomy(request, env, context) {
  const path = new URL(request.url).pathname.replace(/^\/api\/autonomy\/?/, '');
  const db = env.AUTONOMY_DB;
  if (path === 'status' && request.method === 'GET') {
    if (!db) return respond(200, { enabled: false, schema_version: 1 });
    const specs = await db.prepare('SELECT state,count(*) count FROM research_specs GROUP BY state').all();
    const decisions = await db.prepare(
      'SELECT publication_state,count(*) count FROM evidence_decisions GROUP BY publication_state',
    ).all();
    return respond(200, {
      enabled: true,
      live_research: Boolean(env.OPENAI_API_KEY && env.OPENAI_WEBHOOK_SECRET),
      source_snapshots: Boolean(env.RESEARCH_EVIDENCE),
      automatic_publication: false,
      specs: specs.results,
      decisions: decisions.results,
      schema_version: 1,
    });
  }
  if (!db) return respond(503, { error: 'Autonomous evidence storage is not configured' });
  try {
    if (path === 'runs' && request.method === 'POST') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      if (!env.OPENAI_API_KEY) return respond(503, { error: 'Live research provider is not configured' });
      const input = await parseBody(request, 220000);
      const spec = cleanSpec(input.spec);
      const jobs = await startResearchRun(env, spec, input.requests);
      return respond(202, { id: spec.id, state: 'researching', jobs });
    }
    if (path === 'webhooks/openai' && request.method === 'POST') {
      return handleWebhook(request, env, context);
    }
    if (path === 'exceptions' && request.method === 'GET') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const result = await db.prepare(
        "SELECT d.id,d.claim_id,d.publication_state,d.data,d.created,s.data spec_data,(SELECT e.data FROM evidence_events e WHERE e.entity_type='decision' AND e.entity_id=d.id AND e.event_type='reviewer-disposition' ORDER BY e.created DESC LIMIT 1) disposition FROM evidence_decisions d JOIN research_specs s ON s.id=d.spec_id WHERE d.human_intervention=1 ORDER BY d.created DESC LIMIT 100",
      ).all();
      return respond(200, { exceptions: result.results.map(row => ({
        id: row.id,
        claim_id: row.claim_id,
        publication_state: row.publication_state,
        created: row.created,
        data: JSON.parse(row.data),
        spec: JSON.parse(row.spec_data),
        disposition: row.disposition ? JSON.parse(row.disposition) : null,
      })) });
    }
    const exceptionMatch = path.match(/^exceptions\/([0-9a-f]{24})$/);
    if (exceptionMatch && request.method === 'POST') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const input = await parseBody(request, 32768);
      const allowed = new Set(['accept-proposal', 'reject-proposal', 'needs-field-evidence', 'defer']);
      const notes = String(input?.notes || '').trim();
      if (!allowed.has(input?.action) || !notes || notes.length > 5000) {
        return respond(400, { error: 'A valid disposition and concise reviewer note are required' });
      }
      const decision = await db.prepare(
        'SELECT id FROM evidence_decisions WHERE id=?1 AND human_intervention=1',
      ).bind(exceptionMatch[1]).first();
      if (!decision) return respond(404, { error: 'Evidence exception not found' });
      const disposition = { action: input.action, notes };
      const eventId = await recordEvent(env, 'decision', decision.id, 'reviewer-disposition', disposition);
      return respond(200, { id: decision.id, event_id: eventId, disposition });
    }
    if (path === 'eligible' && request.method === 'GET') {
      if (!await reviewer(request, env.PATTERNS_REVIEW_TOKEN)) {
        return respond(401, { error: 'Reviewer authorization required' });
      }
      const result = await db.prepare(
        'SELECT d.id,d.claim_id,d.data,d.created,s.data spec_data FROM evidence_decisions d JOIN research_specs s ON s.id=d.spec_id WHERE d.publish_eligible=1 ORDER BY d.created DESC LIMIT 100',
      ).all();
      return respond(200, { automatic_publication: false, eligible: result.results.map(row => ({
        id: row.id, claim_id: row.claim_id, created: row.created,
        decision: JSON.parse(row.data), spec: JSON.parse(row.spec_data),
      })) });
    }
    return respond(404, { error: 'Autonomy route unavailable' });
  } catch (error) {
    const message = error?.message || '';
    if (/Invalid|too large|JSON/i.test(message)) return respond(400, { error: message });
    return respond(503, { error: 'Autonomous evidence operation failed closed' });
  }
}

export default { fetch: handlePatternsAutonomy };
