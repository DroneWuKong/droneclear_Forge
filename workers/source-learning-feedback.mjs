import { sha256, canonicalJson } from './retrieval-policy.mjs';
const HASH = /^[0-9a-f]{64}$/;
const LANES = new Set(['extraction-entity-resolution', 'graphify-projection']);
const BOOLS = ['passage_verified','explicit_identity','extracted','affirmed','scope_known','negation_case','alias_case'];

export async function cleanSourceSnapshot(input) {
  const f = input?.features;
  if (!LANES.has(input?.lane) || input.policy_version !== 'source-bound-quality-v1'
    || !/^[0-9a-f]{24}$/.test(input.id || '')
    || !['fingerprint','claim_sha256','observation_sha256'].every(key => HASH.test(input[key] || ''))
    || !Array.isArray(input.source_keys) || input.source_keys.length < 1 || input.source_keys.length > 32
    || new Set(input.source_keys).size !== input.source_keys.length || !input.source_keys.every(key => HASH.test(key))
    || !f || Object.keys(f).length !== BOOLS.length + 2 || !BOOLS.every(key => typeof f[key] === 'boolean')
    || !['primary_claims','independent_publishers'].every(key => Number.isInteger(f[key]) && f[key] >= 0 && f[key] <= 20)
    || f.independent_publishers > f.primary_claims) throw Error('Invalid source-learning snapshot');
  if ((await sha256(canonicalJson({ lane: input.lane, fingerprint: input.fingerprint }))).slice(0,24) !== input.id)
    throw Error('Source-learning snapshot identity mismatch');
  return Object.fromEntries(['id','lane','fingerprint','policy_version','source_keys','features','claim_sha256','observation_sha256'].map(key => [key,input[key]]));
}

export async function handleSourceLearningFeedback(request, env, helpers) {
  if (!helpers.reviewAuthorized) return helpers.respond(401, {error:'Reviewer authorization required'});
  const db = env.AUTONOMY_DB;
  if (request.method === 'GET') {
    const result = await db.prepare("SELECT e.id,e.entity_id,e.data,e.created FROM evidence_events e WHERE e.entity_type='learning-source-judgment' AND e.rowid=(SELECT d.rowid FROM evidence_events d WHERE d.entity_type=e.entity_type AND d.entity_id=e.entity_id ORDER BY d.created DESC,d.rowid DESC LIMIT 1) ORDER BY e.created DESC,e.id DESC LIMIT 1000").all();
    return helpers.respond(200, {schema_version:'source-learning-feedback-v1',truncated:result.results.length === 1000,limit:1000,
      automatic_promotion:false,feedback:result.results.map(row => {
        const value = JSON.parse(row.data);
        return {id:row.entity_id,data:value.data,created:value.observed_at,
          disposition:{action:value.action,notes:value.notes,human_reviewed:true,reviewed_at:row.created}};
      })});
  }
  if (request.method !== 'POST') return helpers.respond(405,{error:'Method not allowed'});
  const input = await helpers.parseBody(request,16384);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input?.review_id || '')
      || !['supported','not_supported','needs_context'].includes(input.action)
      || typeof input.notes !== 'string' || !input.notes.trim() || input.notes.length > 5000
      || typeof input.observed_at !== 'string' || !Number.isFinite(Date.parse(input.observed_at)) || Date.parse(input.observed_at)>Date.now())
    return helpers.respond(400,{error:'A source judgment, observation time, and reviewer note are required'});
  let data;
  try { data = await cleanSourceSnapshot(input.data); }
  catch { return helpers.respond(400,{error:'Invalid source-learning snapshot'}); }
  const payload = canonicalJson({data,observed_at:input.observed_at,action:input.action,notes:input.notes.trim()});
  const id = (await sha256('source-judgment\x1f'+input.review_id)).slice(0,24);
  const old = await db.prepare('SELECT data FROM evidence_events WHERE id=?1').bind(id).first();
  if (old && old.data !== payload) return helpers.respond(409,{error:'Review identifier already used'});
  await db.prepare('INSERT OR IGNORE INTO evidence_events(id,entity_type,entity_id,event_type,data,created) VALUES(?1,?2,?3,?4,?5,?6)')
    .bind(id,'learning-source-judgment',data.id,'human-source-review',payload,new Date().toISOString()).run();
  const stored = await db.prepare('SELECT data FROM evidence_events WHERE id=?1').bind(id).first();
  if (stored?.data !== payload) return helpers.respond(409,{error:'Review identifier already used'});
  return helpers.respond(200,{received:true,event_id:id,id:data.id,automatic_promotion:false});
}
