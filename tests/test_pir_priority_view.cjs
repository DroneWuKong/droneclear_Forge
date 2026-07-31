const test = require('node:test');
const assert = require('node:assert/strict');
const view = require('../forge-source/pir-priority-view.js');
const config = require('../forge-source/pir_profiles.json');

function profile(id){ return view.profileById(config, id); }

test('unknown profile falls back to configured full view', () => {
  assert.equal(view.normalizeProfileId('missing', config), 'full');
  assert.equal(view.normalizeProfileId('procurement', config), 'procurement');
});

test('term matching uses token boundaries and does not match ai inside said', () => {
  const pattern = view.termPattern('ai');
  assert.equal(pattern.test('AI enabled autonomy'), true);
  assert.equal(pattern.test('the company said nothing'), false);
});

test('FPV profile ranks matching supply-chain record above unmatched record', () => {
  const rows = [
    { title: 'General aviation policy update', severity: 'high' },
    { title: 'FPV motor shortage extends lead time', severity: 'warning' }
  ];
  const ranked = view.rankRecords(rows, profile('fpv_supply'), 'flags');
  assert.equal(ranked[0].record.title, rows[1].title);
  assert.equal(ranked[0].ranking.matched, true);
  assert.ok(ranked[0].ranking.matches.some(match => match.term === 'fpv'));
  assert.equal(ranked[1].ranking.matched, false);
});

test('severity cannot create a match without a declared profile term', () => {
  const result = view.scoreRecord(
    { title: 'Unrelated update', severity: 'critical' },
    profile('procurement'),
    'flags'
  );
  assert.equal(result.matched, false);
  assert.equal(result.score, 0);
});

test('full analyst view preserves source order and treats all records as visible', () => {
  const rows = [{ title: 'B' }, { title: 'A' }];
  const ranked = view.rankRecords(rows, profile('full'), 'flags');
  assert.deepEqual(ranked.map(item => item.record.title), ['B', 'A']);
  assert.ok(ranked.every(item => item.ranking.matched));
});

test('storage helpers normalize values and fail open when persistence is blocked', () => {
  const storage = {
    value: null,
    getItem(){ return this.value; },
    setItem(key, value){ this.value = value; }
  };
  let result = view.writeStoredProfile(storage, config, 'adversary');
  assert.deepEqual(result, { profile_id: 'adversary', persisted: true });
  assert.equal(view.readStoredProfile(storage, config), 'adversary');
  const blocked = { getItem(){ throw new Error('blocked'); }, setItem(){ throw new Error('blocked'); } };
  result = view.writeStoredProfile(blocked, config, 'counter_uas');
  assert.deepEqual(result, { profile_id: 'counter_uas', persisted: false });
  assert.equal(view.readStoredProfile(blocked, config), 'full');
});

test('dataset row extraction handles current API shapes', () => {
  assert.equal(view.rowsFor('flags', { data: [{ id: 1 }] }).length, 1);
  assert.equal(view.rowsFor('actors', { fingerprints: [{ actor: 'A' }] }).length, 1);
  assert.equal(view.rowsFor('ttps', { data: { results: [{ ttp: 'x' }] } }).length, 1);
  assert.equal(view.rowsFor('events', { data: { actor_summaries: [{ actor: 'A' }] } }).length, 1);
});

test('actor event summaries merge only on exact actor label', () => {
  const actors = [{ actor: 'Russia / Mil', article_mention_count: 10 }, { actor: 'Russia / GRU', article_mention_count: 2 }];
  const events = [{ actor: 'Russia / Mil', reporting_cluster_count: 7, candidate_event_count: 5, multi_source_candidate_event_count: 2 }];
  const merged = view.mergeActorEventSummaries(actors, events);
  assert.equal(merged[0].candidate_event_count, 5);
  assert.equal(merged[1].candidate_event_count, undefined);
});

test('evidence URLs allow only HTTP(S)', () => {
  assert.equal(view.safeHttpUrl('https://example.test/evidence'), 'https://example.test/evidence');
  assert.equal(view.safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(view.evidenceUrlFor({ sources: [{ url: 'https://example.test/a' }] }), 'https://example.test/a');
});

test('coverage facts preserve disclosed quality gaps', () => {
  const facts = view.coverageFacts(
    { data: { meta: { generated_at: '2026-07-31', dataset_count: 20 } } },
    { meta: {
      analyzed_article_records: 10167,
      observed_source_key_count: 25,
      registered_source_count: 72,
      source_concentration: { top_source_share: 0.2989 },
      unparseable_publication_date_count: 975,
      future_dated_record_count: 10,
      caveat: 'Observed only.'
    } }
  );
  assert.equal(facts.article_count, 10167);
  assert.equal(facts.top_source_share, 0.2989);
  assert.equal(facts.unparseable_date_count, 975);
  assert.equal(facts.caveat, 'Observed only.');
});
