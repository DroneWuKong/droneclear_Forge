const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const forecast = require('../forge-source/forecast-accountability-model.js');

function issued() {
  return {record_type:'forecast',cohort:'prospective-v1',prediction_id:'forecast-one',issuance_id:'forecast-one',
    issuance_sha256:'a'.repeat(64),event:'Acme opens one factory',issued_at:'2026-09-01T00:00:00Z',evidence_cutoff:'2026-09-01T00:00:00Z',probability:0,
    resolution_criteria:{event:'Acme opens one factory',entities:['Acme'],direction:'occurs',threshold:'At least one operating factory',
      ambiguity_policy:'Unresolved if evidence insufficient',resolution_sources:['https://example.com/announcements'],
      window_start:'2026-09-02T00:00:00Z',window_end:'2026-09-08T00:00:00Z'}};
}
function graded() {
  const row=issued();
  return {...row,predicted_probability:0,resolution_method:'reviewed-evidence-v2',calibration_eligible:true,
    was_correct:false,resolution_outcome:'refuted',evidence_review:{prediction_id:row.prediction_id,issuance_sha256:row.issuance_sha256,
      criteria_sha256:'b'.repeat(64),prediction_sha256:'c'.repeat(64),evidence_sha256:'d'.repeat(64),verdict:'refuted',reviewed_by:'analyst',reviewed_at:'2026-09-10T00:00:00Z',evidence:[{url:'https://example.com/announcements/factory',published_at:'2026-09-09T00:00:00Z',event_date:'2026-09-08T00:00:00Z',excerpt:'Review evidence'}]}};
}

test('only complete prospective v2 published grades count; legacy and revoked reviews stay unrated',()=>{
  const row=graded();assert.equal(forecast.eligible(row),true);
  for(const mutation of [{resolution_method:'reviewed-evidence-v1'},{calibration_eligible:false},{review_status:'needs_review'},
    {review_status:'revoked'},{record_type:'observation'},{cohort:'legacy-unregistered'},{issuance_id:'wrong'},
    {issuance_sha256:'invalid'},{predicted_probability:null},{predicted_probability:'0'},{predicted_probability:NaN},
    {predicted_probability:1.1},{was_correct:true},{evidence_review:{}},{resolution_criteria:{}}]){
    assert.equal(forecast.eligible({...row,...mutation}),false,JSON.stringify(mutation));
  }
});

test('queue preserves zero probability, exact UTC window, threshold and source hierarchy',()=>{
  const row={...issued(),state:'pending',reason:'Window remains open',deadline:'2026-09-08T00:00:00Z'};
  const html=forecast.queueCard(row);
  assert.match(html,/Issued probability 0%/);
  assert.match(html,/2026-09-02 00:00:00 UTC/);
  assert.match(html,/At least one operating factory/);
  assert.match(html,/https:\/\/example.com\/announcements/);
  assert.match(html,/Evidence cutoff/);
});

test('queue filters retain legacy records and search only narrows the requested view',()=>{
  const doc={schema_version:'forecast-review-queue-v1',generated_at:'2026-09-11T00:00:00Z',records:[
    {...issued(),state:'due'}, {prediction_id:'legacy',event:'Acme historical signal',state:'legacy_unregistered'}]};
  assert.equal(forecast.queueDocument({data:doc}),doc);
  assert.equal(forecast.queueRows(doc).length,1);
  assert.equal(forecast.queueRows(doc,'legacy_unregistered','Acme').length,1);
  assert.equal(forecast.queueRows(doc,'all').length,2);
  assert.equal(forecast.queueRows(doc,'all','absent').length,0);
  assert.equal(doc.records.length,2);
  assert.equal(forecast.queueDocument({schema_version:'old',records:[]}),null);
  assert.equal(forecast.queueDocument({...doc,records:[{prediction_id:'x',state:'auto_approved'}]}),null);
});

test('fetched strings and URLs cannot create executable content in forecast details',()=>{
  const row={...issued(),state:'due',event:'<img src=x onerror=alert(1)>',reason:'<script>bad()</script>',owner:'" onclick="bad()',
    resolution_criteria:{...issued().resolution_criteria,resolution_sources:['javascript:alert(1)','https://user:pass@example.com/']},
    review_candidates:[{url:'data:text/html,bad',title:'<img onerror=bad()>',published_at:'<script>bad()</script>'}]};
  const html=forecast.queueCard(row);
  assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));assert.ok(!html.includes('href="data:'));
  assert.equal(forecast.safeURL('https://user:pass@example.com/'),null);
  assert.match(html,/&lt;img/);
});

test('legacy details explicitly preserve ungraded historical values and do not imply registration',()=>{
  const html=forecast.queueCard({prediction_id:'old',event:'Old forecast',probability:0.9,state:'legacy_unregistered',reason:'Historical label: confirmed. Not eligible.'});
  assert.match(html,/Legacy · unregistered/);assert.match(html,/Historical value 90% · ungraded/);
  assert.match(html,/cannot be retroactively graded/);
});

test('cohort and baseline views keep unknown values unavailable and compare explicit same-question samples',()=>{
  const report={schema_version:'forecast-evaluation-v1',sample_unit:'earliest issued version',registered_questions:3,reviewed_questions:1,
    cohorts:{'prospective-v1':{total:3,reviewed:1,unreviewed:2,resolution_coverage:1/3},'legacy-unregistered':{total:128,reviewed:0,unreviewed:128,resolution_coverage:0}},
    metrics:{n:1,brier_score:0,log_score:0,confirmed:1,refuted:0},neutral_baseline:{n:1,brier_score:0.25,log_score:0.693},
    no_change_baseline:{coverage:0},temporal_holdout:{training_n:0,training_base_rate:null,note:'No learned-weight promotion'},
    weight_policy:'uniform',uncertainty_note:'Small sample'};
  assert.match(forecast.cohortHTML(report),/128/);assert.match(forecast.cohortHTML(report),/33%/);
  const html=forecast.evaluationHTML(report);
  assert.match(html,/0\.000/);assert.match(html,/Neutral 0.5 baseline/);assert.match(html,/Unavailable/);
  assert.match(html,/No-change baseline coverage: 0 questions/);assert.match(html,/No learned-weight promotion/);
  assert.match(forecast.evaluationHTML(null),/not rated/);
});

test('page loads queue and evaluation independently, preserves empty outcomes, and performs no review writes',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../forge-source/forecast-accountability.html'),'utf8');
  const script=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',hidden:false,value:'',addEventListener(){}});return elements.get(id);};
  const requests=[];
  const queue={schema_version:'forecast-review-queue-v1',generated_at:'2026-09-11T00:00:00Z',records:[]};
  const context=vm.createContext({ForecastAccountability:forecast,console,document:{getElementById:element,querySelector:element,querySelectorAll:()=>[]},
    fetch:async(url,options)=>{requests.push([url,options]);const type=new URL(url,'https://local.invalid').searchParams.get('type');
      return {ok:true,json:async()=>({data:type==='forecast_review_queue'?queue:type==='prediction_outcomes'?[]:{methodology:'reviewed-evidence-v2',evaluation:{schema_version:'forecast-evaluation-v1',cohorts:{},metrics:{},temporal_holdout:{}}}})};}});
  vm.runInContext(script,context);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,3);assert.ok(requests.every(([,options])=>!options || !options.method || options.method==='GET'));
  assert.equal(element('content').hidden,false);assert.equal(element('k-total').textContent,0);
  assert.match(element('queue-status').textContent,/showing 0 of 0/);
  assert.match(element('legacy-history').innerHTML,/No retained ungraded outcomes/);
  assert.ok(source.includes('FORECAST_REGISTRATION.md'));assert.ok(source.includes('aria-pressed'));
});
