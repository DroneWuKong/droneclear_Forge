const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../forge-source/patterns.html'), 'utf8');
const start = source.indexOf('function whatChangedHTML(');
const end = source.indexOf('// ── Watchlist (Tier 2 personalization)', start);
const escStart = source.indexOf('function esc(');
const escEnd = source.indexOf('\n', escStart);
function render(delta, brief = {}) {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-16T15:00:00Z'])); }
  }
  const context = vm.createContext({DELTA:delta, brief, Date:FixedDate});
  vm.runInContext(source.slice(escStart, escEnd) + '\n' + source.slice(start, end), context);
  return vm.runInContext('whatChangedHTML(brief)', context);
}

test('zero new flags still exposes changed claims and absent records from the live delta shape', () => {
  const html = render({date:'2026-10-16', new_count:0, changed_count:26, not_observed_count:1,
    changed_flags:[{id:'motor-1',title:'Motor supply changed'}, {id:'prop-2',title:'Propeller dependency changed'}]},
    {date:'2026-10-16',delta_summary:{new_flags:0,vs_yesterday:'No new flags'}});
  assert.match(html, /26 changed/);
  assert.match(html, /0 new/);
  assert.match(html, /1 not observed/);
  assert.match(html, /Today/);
  assert.match(html, /Changed: Motor supply changed/);
  assert.match(html, /href="#flag=motor-1"/);
  assert.match(html, /resolution requires a review/);
  assert.doesNotMatch(html, /1 resolved/);
});

test('movement categories retain their meaning without counting updates as new flags', () => {
  const html = render({date:'2026-10-16',new_count:2,changed_count:5,escalated_count:1,
    deescalated_count:3,contradicted_count:4,resolved_count:6});
  for (const label of ['+2 new','5 changed','1 escalated','3 de-escalated','4 contradicted','6 resolved']) {
    assert.ok(html.includes(label), label);
  }
  assert.doesNotMatch(html, /\+7 new/);
});

test('title previews are bounded, deduplicated, escaped and linked by exact encoded identity', () => {
  const html = render({date:'2026-10-16',escalated_count:1,new_count:1,changed_count:4,
    escalated_flags:[{id:'same',title:'Escalated record'}],
    new_flags:[{id:'new',title:'New record'}],
    changed_flags:[{id:'same',title:'Duplicate record'},
      {id:'unsafe"/&',title:'<img src=x onerror=alert(1)> & supply'},
      {id:'fourth',title:'Fourth record'}]});
  assert.match(html, /Escalated: Escalated record/);
  assert.match(html, /New: New record/);
  assert.match(html, /Changed: &lt;img src=x onerror=alert\(1\)&gt; &amp; supply/);
  assert.match(html, /href="#flag=unsafe%22%2F%26"/);
  assert.doesNotMatch(html, /<img|Duplicate record|Fourth record/);
  assert.equal((html.match(/href="#flag=/g) || []).length, 3);
});

test('a previous collection is dated instead of presented as today', () => {
  const html = render({date:'2026-10-15',new_count:0,changed_count:26});
  assert.match(html, /Update 2026-10-15/);
  assert.doesNotMatch(html, />Today</);
});

test('legacy brief fallback and baseline remain usable when the delta is unavailable', () => {
  const html = render(null,{date:'2026-10-16',delta_summary:{new_flags:2,resolved_flags:1,
    escalated_flags:3,vs_yesterday:'2 new flags'}});
  assert.match(html, /\+2 new/);
  assert.match(html, /1 resolved/);
  assert.match(html, /3 escalated/);
  assert.equal(render(null), '');
  assert.match(render({date:'2026-10-16',first_run:true}), /Baseline established/);
});
