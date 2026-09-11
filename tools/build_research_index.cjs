const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ask = require('../forge-source/ask-pie-retrieval.js');
const normal = require('../forge-source/intel-normalization.js');

function buildResearchIndex(inputDir, options = {}) {
  const inputs = {};
  function read(name, alternatives = []) {
    const candidates = [name + '.json', 'static/' + name + '.json', ...alternatives];
    const relative = candidates.find(candidate => fs.existsSync(path.join(inputDir, candidate)));
    if (!relative) { inputs[name] = {status:'unavailable'}; return null; }
    const bytes = fs.readFileSync(path.join(inputDir, relative));
    try {
      let value = JSON.parse(bytes);
      if (value && value.data !== undefined) value = value.data;
      inputs[name] = {status:'available', path:relative, sha256:crypto.createHash('sha256').update(bytes).digest('hex'), bytes:bytes.length, generated_at:value?.meta?.generated_at || value?.meta?.last_updated || value?.generated_at || (Array.isArray(value) && value.length && value.every(row => row.last_verified_at && row.last_verified_at===value[0].last_verified_at) ? value[0].last_verified_at : null)};
      return value;
    } catch { inputs[name] = {status:'invalid', path:relative}; return null; }
  }
  const articles = read('intel_articles');
  const flags = read('flags') || read('pie_flags');
  const actors = read('actor_fingerprints');
  const ttps = read('ttp_counter_gap');
  const events = read('article_event_clusters');
  const entities = read('entity_graph');
  const predictions = read('predictions') || read('pie_predictions');
  const references = read('forge_intel');
  let records = [
    ...ask.buildCorpus({articles, flags, actors, ttps, events}),
    ...ask.genericRecords(entities, 'entity', 'entities'),
    ...ask.genericRecords(predictions, 'prediction', 'predictions'),
    ...ask.genericRecords(normal.defenseRecords(references).concat(normal.commercialRecords(references)), 'reference', 'records')
  ].map(ask.compactRecord);
  const rawRecordCount=records.length;
  const exactRows=new Set();
  records=records.filter(record=>{const key=JSON.stringify(record);if(exactRows.has(key))return false;exactRows.add(key);return true;});
  const counts = {};
  const seen = new Set(), duplicateIds = new Set();
  for (const row of records) {
    counts[row.type] = (counts[row.type] || 0) + 1;
    const key = ask.recordKey(row);
    if (seen.has(key)) duplicateIds.add(key);
    seen.add(key);
  }
  const datasetByType={article:'intel_articles',flag:inputs.flags?.status==='available'?'flags':'pie_flags',actor:'actor_fingerprints',ttp:'ttp_counter_gap',entity:'entity_graph',prediction:inputs.predictions?.status==='available'?'predictions':'pie_predictions',reference:'forge_intel'};
  const semantics={};
  for (const [name,input] of Object.entries(inputs)) {
    const age=Date.parse(options.generatedAt || new Date().toISOString())-Date.parse(input.generated_at || '');
    input.evidence_status=!Number.isFinite(age)?'unversioned':age>72*3600000?'historical snapshot':age < -24*3600000?'invalid future source date':'recent artifact';
  }
  for (const record of records) {
    semantics[record.type]=record.semantics;
    // Repeated type/source metadata belongs in the manifest, not every index row.
    delete record.titleText; delete record.summaryText; delete record.semantics;
  }
  const inputRevision = crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(inputs).map(([key,{evidence_status,...input}])=>[key,input])))).digest('hex');
  return {schema_version:1, meta:{generated_at:options.generatedAt || new Date().toISOString(), generator:'tools/build_research_index.cjs', raw_record_count:rawRecordCount, exact_duplicate_rows_removed:rawRecordCount-records.length, input_revision:inputRevision, publication_revision:options.revision || null, inputs, dataset_by_type:datasetByType, record_semantics:semantics, availability:Object.values(inputs).some(input => input.status !== 'available') ? 'partial' : 'available', duplicate_record_ids:[...duplicateIds], caveat:'Bounded search of this publication snapshot. Generated time is not evidence recency. Source labels are not independent corroboration; missing records are not absence.'}, counts, records};
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const value = key => args[args.indexOf(key) + 1];
  if (!args.includes('--input') || !args.includes('--output')) throw new Error('Usage: node tools/build_research_index.cjs --input build --output build/research_index.json [--revision revision]');
  const output = value('--output');
  const index = buildResearchIndex(value('--input'), {revision:args.includes('--revision') ? value('--revision') : null});
  fs.mkdirSync(path.dirname(output), {recursive:true});
  fs.writeFileSync(output, JSON.stringify(index));
  console.log(JSON.stringify({output, count:index.records.length, bytes:fs.statSync(output).size, revision:index.meta.input_revision, availability:index.meta.availability}));
}
module.exports = {buildResearchIndex};
