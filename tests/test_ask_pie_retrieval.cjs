const test = require('node:test');
const assert = require('node:assert/strict');
const ask = require('../forge-source/ask-pie-retrieval.js');

test('query parsing removes question words and deduplicates terms', () => {
  assert.deepEqual(
    ask.queryTerms('What is the evidence for Shahed supply supply chains?'),
    ['evidence', 'shahed', 'supply', 'chains']
  );
});

test('term matching uses token boundaries', () => {
  const ai = ask.termPattern('ai');
  assert.equal(ai.test('AI target recognition'), true);
  assert.equal(ai.test('company said this'), false);
  const blue = ask.termPattern('Blue UAS');
  assert.equal(blue.test('Blue-UAS authorization'), true);
});

test('only HTTP(S) URLs can become citations', () => {
  assert.equal(ask.safeHttpUrl('https://example.test/evidence'), 'https://example.test/evidence');
  assert.equal(ask.safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(ask.normalizeCitation({ url: 'data:text/html,bad' }), null);
});

test('article records preserve source URL and reporting caveat', () => {
  const records = ask.articleRecords([{ aid:'A-1', title:'Shahed component report', summary:'Observed components', site:'source-a', pub_date:'2026-07-30', url:'https://example.test/a' }]);
  assert.equal(records.length, 1);
  assert.equal(records[0].citations.length, 1);
  assert.equal(records[0].destination, 'https://example.test/a');
  assert.match(records[0].semantics, /not automatic proof/i);
});

test('flag citations are deduplicated and unsafe links are removed', () => {
  const records = ask.flagRecords([{
    id:'F-1', title:'NDAA supply-chain signal', detail:'Public filing changed',
    sources:[
      { title:'Filing', source:'agency', url:'https://example.test/filing', date:'2026-07-30' },
      { title:'Filing', source:'agency', url:'https://example.test/filing', date:'2026-07-30' },
      { title:'Bad', url:'javascript:alert(1)' }
    ]
  }]);
  assert.equal(records[0].citations.length, 1);
  assert.match(records[0].semantics, /not an allegation/i);
});

test('actor event summaries merge only on exact actor label', () => {
  const actors = { fingerprints:[
    { actor:'Russia / Mil', article_mention_count:20, unique_source_count:4, sample_articles:[{ title:'Evidence', site:'wire', url:'https://example.test/e' }] },
    { actor:'Russia / GRU', article_mention_count:3, unique_source_count:2 }
  ] };
  const events = { actor_summary:[{ actor:'Russia / Mil', reporting_cluster_count:15, candidate_event_count:5, multi_source_candidate_event_count:2 }] };
  const records = ask.actorRecords(actors, events);
  assert.match(records[0].summary, /15 reporting clusters/);
  assert.doesNotMatch(records[1].summary, /candidate-event clusters/);
});

test('TTP records state that missing indexed evidence is not absence of capability', () => {
  const records = ask.ttpRecords({ results:[{ ttp_id:'gps_denied_navigation', description:'GPS denied navigation', counter_signal_count:0, verdict:'weak indexed signal' }] });
  assert.equal(records.length, 1);
  assert.match(records[0].semantics, /does not prove/i);
});

test('direct match requires every meaningful term', () => {
  const records = ask.articleRecords([
    { aid:'A', title:'Shahed supply chain components', summary:'Parts origin', site:'one', url:'https://example.test/a' },
    { aid:'B', title:'Shahed strike update', summary:'Operational report', site:'two', url:'https://example.test/b' }
  ]);
  const ranked = ask.rankEvidence(records, 'Shahed supply chain', { limit:10 });
  assert.equal(ranked[0].record.id, 'A');
  assert.equal(ranked[0].ranking.direct, true);
  assert.equal(ranked[1].ranking.direct, false);
});

test('title matches score above indexed-field-only matches', () => {
  const records = [
    { id:'title', type:'article', title:'Counter UAS jamming', summary:'', titleText:'counter uas jamming', summaryText:'', searchText:'counter uas jamming', citations:[], date:'', source:'', destination:'/', semantics:'' },
    { id:'field', type:'article', title:'Other', summary:'', titleText:'other', summaryText:'', searchText:'other counter uas jamming', citations:[], date:'', source:'', destination:'/', semantics:'' }
  ];
  const ranked = ask.rankEvidence(records, 'counter UAS jamming', { limit:10 });
  assert.equal(ranked[0].record.id, 'title');
  assert.ok(ranked[0].ranking.score > ranked[1].ranking.score);
});

test('evidence packet separates cited and uncited analytic context', () => {
  const cited = { id:'c', type:'article', title:'Shahed report', summary:'', titleText:'shahed report', summaryText:'', searchText:'shahed report', citations:[{ url:'https://example.test/a', title:'A', source:'wire', date:'2026-07-30', kind:'article' }], date:'2026-07-30', source:'wire', destination:'https://example.test/a', semantics:'' };
  const uncited = { id:'u', type:'actor', title:'Shahed actor context', summary:'', titleText:'shahed actor context', summaryText:'', searchText:'shahed actor context', citations:[], date:'', source:'', destination:'/actors/', semantics:'' };
  const packet = ask.evidencePacket(ask.rankEvidence([cited, uncited], 'Shahed', { limit:10 }), 'Shahed');
  assert.equal(packet.direct.length, 1);
  assert.equal(packet.analytic.length, 1);
  assert.equal(packet.conclusionAllowed, false);
  assert.equal(packet.contradictionAssessment, 'not automatically assessed');
});

test('citation list is globally deduplicated across results', () => {
  const citation = { url:'https://example.test/a', title:'A', source:'wire', date:'2026-07-30', kind:'article' };
  const records = ['one','two'].map(id => ({ id, type:'article', title:`Shahed ${id}`, summary:'', titleText:`shahed ${id}`, summaryText:'', searchText:`shahed ${id}`, citations:[citation], date:'', source:'wire', destination:citation.url, semantics:'' }));
  const packet = ask.evidencePacket(ask.rankEvidence(records, 'Shahed', { limit:10 }), 'Shahed');
  assert.equal(packet.citations.length, 1);
  assert.equal(packet.uniqueSourceLabelCount, 1);
});

test('coverage facts retain concentration and metadata gaps', () => {
  const facts = ask.coverageFacts(
    { data:{ meta:{ generated_at:'2026-07-31' } } },
    { data:{ meta:{ analyzed_article_records:10167, observed_source_key_count:25, registered_source_count:72, source_concentration:{ top_source_share:0.2989 }, unparseable_publication_date_count:975, future_dated_record_count:10, explicit_language_metadata_missing_record_count:10000, explicit_geography_metadata_missing_record_count:9000, caveat:'Observed corpus only.' } } },
    ['one dataset unavailable']
  );
  assert.equal(facts.indexedArticleCount, 10167);
  assert.equal(facts.topSourceShare, 0.2989);
  assert.equal(facts.unparseableDateCount, 975);
  assert.deepEqual(facts.unavailableDatasets, ['one dataset unavailable']);
});

test('corpus builder tolerates unavailable datasets', () => {
  const records = ask.buildCorpus({ articles:null, flags:null, actors:null, events:null, ttps:null });
  assert.deepEqual(records, []);
});
