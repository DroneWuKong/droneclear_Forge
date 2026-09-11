const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const evidence = require('../forge-source/patterns-flag-evidence.js');
const source = fs.readFileSync(require.resolve('../forge-source/patterns.html'), 'utf8');
const now = Date.parse('2026-09-11T12:00:00Z');
const flag = extra => ({id:'qualcomm-derived', title:'Qualcomm component signal', detail:'Derived component analysis',
  flag_type:'prediction', severity:'warning', confidence:0.9, prediction:'Possible supply expansion',
  sources:[{type:'derived',name:'Indexed reference',url:'https://example.org/source'}], ...extra});
const reviewed = () => flag({change_schema_version:1,evidence_fingerprint_version:2,claim_review_status:'reviewed',
  first_seen:'2026-09-10',claim_sha256:'a'.repeat(64),lifecycle_state:'resolved',
  lifecycle_review:{status:'reviewed',flag_id:'qualcomm-derived',claim_sha256:'a'.repeat(64),evidence_sha256:'b'.repeat(64),
    outcome:'resolved',reviewer:'Analyst',reviewed_at:'2026-09-11T10:00:00Z',
    evidence:[{url:'https://example.org/resolution',published_at:'2026-09-11T09:00:00Z',excerpt:'Specific evidence'}]}});
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fn(name, end) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  return source.slice(start, end ? source.indexOf(end,start) : source.indexOf('\nfunction ', start+1));
}
function harness(rows = [flag()]) {
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, {innerHTML:'',textContent:'',value:'',style:{},classList:{add(){},remove(){}},querySelectorAll:()=>[]});
    return nodes.get(id);
  };
  const context = {PatternsFlagEvidence:evidence, FLAGS:rows,selectedFlag:rows[0],activeTab:'brief',
    location:{hash:'#flag=qualcomm-derived',pathname:'/patterns/',search:''}, history:{pushState(){},replaceState(){}},
    document:{getElementById:element,querySelector:()=>({click(){context.activeTab='flags';context.selectedFlag=null;}})},
    FLAG_META:{prediction:{label:'Unregistered hypothesis',badge:'badge-purple',sev:'prediction',icon:'◎'}},
    hiddenSeverities:new Set(),hiddenTypes:new Set(),hiddenRegions:new Set(),wlFilterOn:false,
    extractRegions:()=>[],getGroupKey:()=> 'comp:Qualcomm',wlStar:()=>'',lcBadge:()=>'',esc,esc_:esc,
    safeUrl_:value=>value,renderDecisionSupportPanel:()=>'<div>Decision support retained</div>',
    flagFollowChips:()=>'',renderRelatedIntel:()=>'<div>Related dossier retained</div>',window:{},
    openDetailModal(title){element('flag-modal-title').textContent=title;},
  };
  vm.createContext(context);
  return {context,element,run(code){vm.runInContext(code,context);}};
}

test('numeric scores and primary metadata never become claim verification', () => {
  for (const confidence of [0,0.5,0.8,0.9,1,NaN,Infinity,'0.99',null]) {
    const row = flag({confidence,sources:[{type:'primary',url:'https://example.gov/'}]});
    assert.equal(evidence.describe(row,now).key,'references_unreviewed');
    assert.doesNotMatch(evidence.badge(row),/primary source|verified|strong inference|\d+%/i);
  }
  assert.equal(evidence.describe(flag({sources:[{url:'javascript:alert(1)'}]}),now).key,'evidence_unavailable');
  assert.equal(evidence.legacyScore(flag({confidence:0})),'Legacy heuristic: 0/1');
  assert.equal(evidence.legacyScore(flag({confidence:'0.9'})),'');
});

test('only explicit exact lifecycle review metadata receives the recorded label', () => {
  assert.equal(evidence.describe(reviewed(),now).key,'review_recorded');
  for (const [key,value] of [['flag_id','other'],['status','revoked'],['claim_sha256','c'.repeat(64)],
    ['reviewed_at','2099-01-01T00:00:00Z'],['reviewed_at','2026-02-30T00:00:00Z'],['reviewer','']]) {
    const row=reviewed();row.lifecycle_review[key]=value;
    assert.equal(evidence.describe(row,now).key,'references_unreviewed',key);
  }
  const changed=reviewed();changed.claim_review_status='unreviewed';
  assert.equal(evidence.describe(changed,now).key,'references_unreviewed');
  const row=reviewed();row.lifecycle_review.reviewer='<img src=x onerror=alert(1)>';
  assert.doesNotMatch(evidence.panel(row),/<img/);
});

test('actual flag modal keeps details and dossier joins without manufacturing evidence tiers', () => {
  const page=harness();page.run(fn('renderFlagDetail','\nfunction renderRelatedIntel'));
  page.context.renderFlagDetail();
  const html=page.element('flag-modal-body').innerHTML;
  assert.match(html,/Source references; unreviewed/);
  assert.match(html,/Legacy heuristic: 0\.9\/1/);
  assert.match(html,/Unregistered hypothesis/);
  assert.match(html,/Decision support retained/);assert.match(html,/Related dossier retained/);
  assert.doesNotMatch(html,/PRIMARY SOURCE|Verified from|Multiple corroborating|90%/);
});

test('actual grouped and flat boards use evidence states for high-scoring derived flags', () => {
  const page=harness();
  page.run(fn('getGroupMeta','\n// ── Flag list'));
  page.run(fn('renderFlags','\n// ── Decision support'));
  for (const view of ['grouped','flat']) {
    page.element('flag-view').value=view;page.context.renderFlags();
    const html=page.element('flag-list').innerHTML;
    assert.match(html,/Source references; unreviewed/);
    assert.doesNotMatch(html,/primary source|strong inference|90%/i);
  }
});

test('dashboard and regional flag markup preserve unreviewed status and hypothesis labels', () => {
  const page=harness([flag(),flag({id:'missing',sources:[]})]);
  page.run(source.match(/document.getElementById\("dash-confidence"\).innerHTML = [^;]+;/)[0]);
  const dashboard=page.element('dash-confidence').innerHTML;
  assert.match(dashboard,/References; unreviewed/);assert.match(dashboard,/Evidence unavailable/);
  assert.doesNotMatch(dashboard,/90-100%|primary source|strong inference/i);
  const start=source.indexOf('regionFlags.map(f => {');
  const end=source.indexOf('}).join("")',start)+'}).join("")'.length;
  page.context.regionFlags=page.context.FLAGS;page.context.safeUrl=value=>value;
  page.run('regionalMarkup='+source.slice(start,end));
  assert.match(page.context.regionalMarkup,/Unregistered hypothesis/);
  assert.match(page.context.regionalMarkup,/Source references; unreviewed/);
  assert.doesNotMatch(page.context.regionalMarkup,/primary source|strong inference|90%/i);
});

test('exact flag deep links select the flag board and reject missing or ambiguous identities', () => {
  const page=harness();let opened=null;
  page.context.renderFlagDetail=()=>{opened=page.context.selectedFlag;};
  page.run(fn('openLinkedFlag',"\nwindow.addEventListener('hashchange'"));
  page.context.openLinkedFlag('#flag=qualcomm-derived');
  assert.equal(page.context.activeTab,'flags');assert.equal(opened.id,'qualcomm-derived');
  page.context.FLAGS.push({...page.context.FLAGS[0]});opened=null;
  page.context.openLinkedFlag('#flag=qualcomm-derived');
  assert.equal(opened,null);assert.equal(page.element('flag-modal-title').textContent,'Signal unavailable');
  assert.match(source,/var _savedTab = location.hash.startsWith\('#flag='\) \? 'flags'/);
  assert.match(source,/var saved = location.hash.startsWith\('#flag='\) \? 'flags'/);
});

test('inline scripts parse and exports identify legacy scores and unregistered hypotheses', () => {
  for (const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) Function(match[1]);
  assert.match(source,/\/static\/patterns-flag-evidence.js\?v=1/);
  assert.match(source,/legacy_heuristic_score,title,entity,detail,unregistered_hypothesis/);
  assert.doesNotMatch(source,/confidence number actually means|Higher confidence = stronger evidence chain|Verified from government records/);
});
