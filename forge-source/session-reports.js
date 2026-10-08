(function (root) {
  'use strict';
  const versions = {template:'2026-10-08',adapter:'1.1.0'};
  const destinations = {
    general:{label:'General support report'},
    px4:{label:'PX4 / Dronecode forum',url:'https://discuss.px4.io/new-topic',analyzer:'https://logs.px4.io/'},
    ardupilot:{label:'ArduPilot forum / issue',url:'https://discuss.ardupilot.org/new-topic',analyzer:'https://plot.ardupilot.org/'},
    betaflight:{label:'Betaflight firmware bug form',url:'https://github.com/betaflight/betaflight/issues/new?template=firmware-bug-report.yml',analyzer:'https://app.betaflight.com/'},
    betaflight_support:{label:'Betaflight configuration / community support',url:'https://discord.betaflight.com/invite',analyzer:'https://app.betaflight.com/'},
    clickup:{label:'ClickUp task Markdown',url:'https://app.clickup.com/'},
    jira:{label:'Jira Cloud description (ADF)'}
  };
  const outcomeLabels={not_run:'Not run',pass:'User-recorded pass',fail:'User-recorded failure',blocked:'Blocked',skipped:'Skipped',inconclusive:'Inconclusive'};
  function completeness(s) {
    const missing=[];
    for (const [key,label] of [['aircraft','Aircraft or test setup'],['firmware','Firmware/build identity'],['expected','Expected behavior'],['actual','Actual behavior'],['steps','Steps to reproduce']]) if(!s[key]?.trim())missing.push(label);
    if(s.stack==='betaflight'){if(!s.support_id?.trim())missing.push('Betaflight Support ID');if(!s.flight_controller?.trim())missing.push('Betaflight flight-controller model');}
    if(s.test_mode==='flight'&&s.stack!=='generic'&&!s.files.some(f=>f.role==='log'))missing.push('Original onboard flight log');
    if(s.test_outcome!=='not_run'&&!s.outcome_reason?.trim())missing.push('Test criterion and outcome reason');
    return {status:missing.length?'missing':'ready_for_review',missing};
  }
  function model(s,rows) {
    const quality=completeness(s);
    return {schema_version:1,tool:'forge-session-report',adapter_version:versions.adapter,template_reviewed_on:versions.template,session_id:s.id,title:s.title||'UAS support investigation',stack:s.stack,test_mode:s.test_mode,expected:s.expected||'Unknown',actual:s.actual||'Unknown',steps:s.steps||'Not recorded',conditions:s.conditions||'Not recorded',aircraft:s.aircraft||'Unknown',firmware:s.firmware||'Unknown',app_version:s.app_version||'Unknown',build_reference:s.build_reference||'Not supplied',support_id:s.support_id||'Not supplied',flight_controller:s.flight_controller||'Not supplied',components:s.components||'Not supplied',wiring:s.wiring||'Not supplied',recorded_at:s.started_at,capture_status:s.state,test_outcome:s.test_outcome,outcome_reason:s.outcome_reason||'No criterion/result supplied',evidence_status:quality.status,missing_evidence:quality.missing,observations:rows.filter(r=>r.kind==='note'||r.kind==='source').map(r=>({session_ms:r.at_ms,kind:r.kind,text:r.text})),files:s.files.map(f=>({name:f.name,original_name:f.original_name,role:f.role,source_label:f.source_label||f.original_name,source_id:f.source_id||null,size:f.size,sha256:f.sha256})),test_reports:s.test_reports||[],clock_basis:s.clock_basis,certification:false,program_acceptance:false};
  }
  function sections(report,target) {
    const parts=[['What I am testing',report.conditions],['Expected behavior',report.expected],['Actual behavior',report.actual],['Steps to reproduce',report.steps],['Setup and versions',`Aircraft / controller / components: ${report.aircraft}\nFirmware / build: ${report.firmware}\nGCS / App version: ${report.app_version}\nBuild / related issue: ${report.build_reference}\nTest mode: ${report.test_mode}`]];
    if(target.startsWith('betaflight'))parts.push(['Support ID',report.support_id],['Flight controller',report.flight_controller],['Other components',report.components],['Wiring and ports',report.wiring],['Configuration evidence','Attach original diff all and describe ports/connections. In the GitHub Support ID field, paste the ID without additional backticks.']);
    if(target==='px4')parts.push(['PX4 context','Attach original ULog and ver all output. Add an existing Flight Review link if you choose to upload there.']);
    if(target==='ardupilot')parts.push(['ArduPilot context','State vehicle platform and airframe; attach original DataFlash and parameters. Include any preceding forum discussion.']);
    parts.push(['Marked moments',report.observations.length?report.observations.map(r=>`${(r.session_ms/1000).toFixed(3)} s · ${r.text}`).join('\n'):'No marked moments.'],['Evidence files',report.files.length?report.files.map(f=>`${f.source_label||f.original_name} · ${f.original_name} · ${f.role} · ${f.size} bytes · SHA-256 ${f.sha256}`).join('\n'):'No files attached.'],['Test and capture results',`Capture: ${report.capture_status}\nTest: ${outcomeLabels[report.test_outcome]}\nCriterion / reason: ${report.outcome_reason}\nReport completeness: ${report.evidence_status}\nMissing: ${report.missing_evidence.join('; ')||'No missing fields identified; review the evidence.'}`]);
    if(report.test_reports.length)parts.push(['System Test Lab evidence',report.test_reports.map(r=>`${r.profile} · profile version ${r.profile_version} · catalog SHA-256 ${r.catalog_sha256}\n${Object.entries(r.counts).map(([status,n])=>`${n} ${status}`).join(', ')}\nOriginal report: ${r.file}`).join('\n\n')]);
    parts.push(['Timing and scope','Timeline uses local receipt time and media start estimates. Source clocks and pipeline delays are separate; alignment error is unmeasured unless documented. Test outcomes are user-recorded. Human/external acceptance gates remain open.']);
    return parts;
  }
  const escape=text=>String(text).replace(/[\\`*_{}\[\]<>#|]/g,'\\$&');
  function markdown(report,target='general') {return '# '+escape(report.title)+'\n\n'+sections(report,target).map(([heading,text])=>'## '+heading+'\n\n'+text.split('\n').map(escape).join('  \n')).join('\n\n')+'\n';}
  function adf(report) {
    const paragraph=text=>({type:'paragraph',content:text?[{type:'text',text}]:[]});
    return {type:'doc',version:1,content:[{type:'heading',attrs:{level:1},content:[{type:'text',text:report.title}]},...sections(report,'jira').flatMap(([heading,text])=>[{type:'heading',attrs:{level:2},content:[{type:'text',text:heading}]},...text.split('\n').map(paragraph)])]};
  }
  function plain(report,target='general') {return report.title+'\n\n'+sections(report,target).map(([heading,text])=>heading+'\n'+text).join('\n\n')+'\n';}
  function render(s,rows,target='general') {if(!Object.hasOwn(destinations,target))throw Error('Unknown report destination.');const report=model(s,rows);return target==='jira'?JSON.stringify(adf(report),null,2)+'\n':markdown(report,target);}
  function composer(s,rows,target) {
    const dest=destinations[target];if(!dest?.url)return null;
    if(target==='betaflight'){const url=new URL(dest.url);url.searchParams.set('title',s.title||'UAS support investigation');return url.href;}
    if(!['px4','ardupilot'].includes(target))return dest.url;
    const url=new URL(dest.url);url.searchParams.set('title',s.title||'UAS support investigation');url.searchParams.set('body',render(s,rows,target));
    return url.href.length<=6000?url.href:dest.url;
  }
  function officialFields(s,rows,target){
    if(target!=='betaflight')return [];
    const report=model(s,rows),context=plain(report,target);
    return [['Describe the bug',s.actual||''],['To Reproduce',s.steps||''],['Expected behavior',s.expected||''],['Support ID',s.support_id||''],['Flight controller',s.flight_controller||''],['Other components',s.components||''],['How are the different components wired up (including port information)',s.wiring||''],['Add any other context about the problem that you think might be relevant here',context]];
  }
  const api={versions,destinations,outcomeLabels,completeness,model,markdown,plain,adf,render,composer,officialFields};root.ForgeSessionReports=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
