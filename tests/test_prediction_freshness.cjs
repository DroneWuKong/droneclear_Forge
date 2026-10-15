const test = require('node:test');
const assert = require('node:assert/strict');
const freshness = require('../forge-source/prediction-freshness.js');

test('one live forecast takes precedence over a larger archive', () => {
  const current = [{id:'new'}];
  assert.deepEqual(freshness.select(current, Array(50).fill({id:'old'})), {records:current, archived:false});
  assert.equal(freshness.select(null, [{id:'old'}]).archived, true);
  assert.deepEqual(freshness.select({error:'unavailable'}, null).records, []);
});
test('recently published data does not renew an old issuance', () => {
  const records = [{issued_at:'2026-09-12T11:00:00Z', last_updated:'2026-10-15'},
    {issued_at:'2026-10-02T11:00:00Z'}, {last_updated:'2026-10-15'}, {issued_at:'invalid'}];
  const result = freshness.summary(records, Date.parse('2026-10-15T12:00:00Z'));
  assert.equal(result.daysSinceIssue, 13);
  assert.equal(result.dated, 2);
  assert.equal(freshness.ordered(records)[0], records[1]);
  assert.deepEqual(records.map(row => row.issued_at), ['2026-09-12T11:00:00Z', '2026-10-02T11:00:00Z', undefined, 'invalid']);
  assert.equal(freshness.summary([{issued_at:'2027-01-01'}], Date.parse('2026-10-15')).newest, null);
});
test('an elapsed window requests review without inventing an outcome', () => {
  const row = {target_date:'2026-10-14', resolved:false};
  assert.equal(freshness.lifecycle(row, Date.parse('2026-10-14T22:00:00Z')), 'Awaiting outcome');
  assert.match(freshness.lifecycle(row, Date.parse('2026-10-15')), /Window ended/);
  assert.equal(row.resolved, false);
  assert.equal(freshness.lifecycle({target_date:'invalid'}), 'Awaiting outcome');
});

test('actual forecast cards show issuance, fixed deadline and event probability', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const html = fs.readFileSync(require('node:path').join(__dirname, '../forge-source/patterns.html'), 'utf8');
  const source = html.slice(html.indexOf('function renderPredictions()'), html.indexOf('// ── Dashboard Visualizations'));
  const target = {innerHTML:'', querySelectorAll:()=>[]};
  const rows = [{event:'Retained forecast', probability:0.9, issued_at:'2026-09-12T12:00:00Z', target_date:'2026-10-01', impact:'An assessment longer than a severity label', drivers:[]}];
  const context = vm.createContext({document:{getElementById:()=>target}, isSubscriber:()=>true,
    esc:value=>String(value ?? ''), PREDICTIONS:rows, PatternsPredictionFreshness:freshness});
  vm.runInContext(source+';renderPredictions();', context);
  assert.match(target.innerHTML, /Issued /);
  assert.match(target.innerHTML, /Outcome window ends 2026-10-01/);
  assert.match(target.innerHTML, /event probability/);
  assert.match(target.innerHTML, /Impact and probability basis/);
  assert.equal(rows[0].probability,0.9);
  context.PREDICTIONS=[];
  vm.runInContext('renderPredictions()',context);
  assert.match(target.innerHTML,/No forecast records/);
});
