(function(){
  'use strict';
  const E=globalThis.ForgeSessionEvidence,R=globalThis.ForgeSessionReports;
  const byId=id=>document.getElementById(id),MAX_CAPTURE=192*1024*1024;
  const detailFields={title:'session-title',aircraft:'session-aircraft',firmware:'session-firmware',build_reference:'session-build',stack:'session-stack',test_mode:'session-test-mode',app_version:'session-app-version',support_id:'session-support-id',flight_controller:'session-flight-controller',components:'session-components',wiring:'session-wiring',expected:'session-expected',actual:'session-actual',steps:'session-steps',conditions:'session-conditions',test_outcome:'test-outcome',outcome_reason:'outcome-reason'};
  const store=new ForgeSessionStore(),recorders=new Map(),indexes=new Map();
  const vehicle=new ForgeSessionVehicle.Client(sendReadRequest,text=>{byId('vehicle-status').textContent=text;});
  const media=new ForgeSessionMedia.CaptureInputs((input,trackKind)=>{
    if(!capturing||stopping)return;
    const source=current.session.sources[input.kind].inputs.find(row=>row.id===input.id);if(!source)return;
    source.status='interrupted';current.session.sources[input.kind].status='interrupted';
    note(input.label+': '+(trackKind==='video'?'video input ended.':'microphone input ended.'));
    const recorder=recorders.get(input.id);if(trackKind==='video'&&recorder?.state==='recording')recorder.stop();persist();
  });
  let ready=false,busy=false,current=null,capturing=false,stopping=false,originTime=0,parser=null,queue=Promise.resolve(),storageFailure=false,totalBytes=0,timelineBytes=0;
  let monitorParser=new E.MavlinkParser(),lastTelemetryAt=null;const liveMessages=new Map();
  let serialPort=null,serialReader=null,serialGeneration=0,helper=null,helperGeneration=0,helperAbort=null,catalog=null,catalogHash=null,replayURLs=[],playbackTimer=null;
  const status=text=>{byId('rec-status').textContent=text;};
  const time=ms=>{const s=Math.floor(ms/1000);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};
  const elapsed=()=>Math.min(7200000,Math.max(0,Math.round(performance.now()-originTime)));
  const fail=error=>status(error.message||String(error));
  function details(){return Object.fromEntries(Object.entries(detailFields).map(([key,id])=>[key,byId(id).value]));}
  function fillDetails(session){for(const[key,id]of Object.entries(detailFields))byId(id).value=session[key]||'';}
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  const replayVideos=()=>[...byId('replay-previews').querySelectorAll('video')];
  function pausePlayback(){clearInterval(playbackTimer);playbackTimer=null;for(const video of replayVideos())video.pause();byId('play-session').textContent='Play together';}
  function controls(){
    document.body.dataset.recording=String(capturing||stopping);
    for(const link of document.querySelectorAll('a[data-stage]'))link.setAttribute('aria-disabled',String(!ready||busy||((capturing||stopping)&&!['record','options'].includes(link.dataset.stage))));
    for(const id of ['choose-screen','choose-monitor','choose-camera','refresh-cameras','connect-serial','connect-helper','open-saved','open-bundle'])byId(id).disabled=!ready||capturing||stopping||busy;
    media.setLocked(!ready||capturing||stopping||busy);
    byId('start-recording').disabled=!ready||capturing||stopping||busy;
    byId('stop-recording').disabled=!capturing||stopping;byId('mark-event').disabled=!capturing||stopping;
    const saved=Boolean(current&&!capturing&&!stopping&&!busy);
    for(const id of ['download-session','copy-summary','copy-report','download-report','delete-session','save-details','save-alignment','attach-log','attach-report'])byId(id).disabled=!saved;
    for(const id of Object.values(detailFields))byId(id).disabled=capturing||stopping||busy;
    byId('send-slack').disabled=!saved||!helper?.slack_enabled||!byId('share-confirm').checked||navigator.onLine===false;
    byId('save-archive').disabled=!saved||!helper?.archive_enabled;
    byId('open-archive').disabled=!ready||capturing||stopping||busy||!helper?.archive_enabled;
    byId('review-session').hidden=!current||capturing||stopping;byId('review-session').disabled=!saved;
    byId('complete-report').disabled=!saved;
    for(const button of byId('official-report-fields').querySelectorAll('button'))button.disabled=!saved;
    let target=null;try{target=vehicle.target(byId('vehicle-target').value);}catch{}
    const available=ready&&!capturing&&!stopping&&!busy&&Boolean(serialPort?.writable||helper?.evidence_reads)&&target;
    byId('collect-params').disabled=!available;byId('list-vehicle-logs').disabled=!available||target?.armed;
    byId('collect-log').disabled=!available||target?.armed||vehicle.logTarget!==byId('vehicle-target').value||!byId('vehicle-log').value;
    byId('vehicle-target').disabled=capturing||stopping||busy;byId('vehicle-log').disabled=capturing||stopping||busy;
    byId('cancel-vehicle').hidden=!vehicle.operation;byId('cancel-vehicle').disabled=!vehicle.operation;
  }
  function networkStatus(){byId('network-status').textContent=navigator.onLine===false?'Browser reports no internet. Local capture, telemetry and saving continue; share after reconnecting.':'Local capture is independent of internet. Use your meeting or upload when a connection is available.';controls();}
  function liveTeam(){
    if(document.body.dataset.layout!=='live')return;
    byId('live-session-title').textContent=current?.session.title||byId('session-title').value||'Field development session';
    byId('live-capture-state').textContent=capturing?'Recording on this device · '+time(elapsed()):stopping?'Finishing local evidence…':'Local recorder standing by.';
    const list=byId('live-team-values');list.replaceChildren();for(const row of [...liveMessages.values()].filter(r=>[0,1,24,147,253].includes(r.message_id))){const card=document.createElement('div');card.className='live-value';const label=document.createElement('strong');label.textContent=document.body.dataset.view==='guided'?({0:'Vehicle state',1:'System status',24:'GPS position',147:'Battery',253:'Vehicle message'}[row.message_id]):row.message;const observation=document.createElement('p');observation.textContent=E.describe(row);const age=document.createElement('small');age.textContent=Math.max(0,Math.floor((performance.now()-row.at_ms)/1000))+' seconds since this observation';card.append(label,observation,age);list.append(card);}if(!list.children.length)list.textContent='Waiting for supported vehicle observations. Screen/camera and notes can still be recorded.';
    const notes=current?.timeline.filter(r=>r.kind==='note'||r.kind==='source').slice(-5)||[];byId('live-team-notes').textContent=notes.length?notes.map(r=>time(r.at_ms)+' · '+r.text).join('\n'):'Marked events appear here during the session.';
  }
  function addRow(row){if(!current||stopping&&row.kind==='mavlink')return;const size=new TextEncoder().encode(JSON.stringify(row)).length+1;if(capturing&&!stopping&&(current.timeline.length>=29999||timelineBytes+size>12*1024*1024)){void stop('Decoded timeline limit reached. Original received telemetry remains in the evidence.');return;}timelineBytes+=size;current.timeline.push(row);current.session.duration_ms=Math.max(current.session.duration_ms,row.at_ms);}
  function note(text,kind='source'){addRow({kind,text:text.slice(0,2000),at_ms:elapsed()});}
  function enqueue(work){queue=queue.then(work).catch(error=>{storageFailure=true;fail(Error('Local saving failed: '+error.message+'. Stop and export any available evidence.'));if(capturing&&!stopping)void stop('Local storage failed.');});return queue;}
  function persist(){if(!current||storageFailure)return;const snapshot=structuredClone(current);delete snapshot.chunks;enqueue(()=>store.save(snapshot));}
  function append(name,blob,metadata={}){
    if(!capturing&&!stopping)return;
    if(totalBytes+blob.size>240*1024*1024){note('An oversized final chunk was omitted: '+name+'. Existing evidence remains available.');if(capturing&&!stopping)void stop('Final media chunk exceeded the session size limit.');return;}
    const session=current.session;let file=session.files.find(f=>f.name===name);
    if(!file){file={name,original_name:name,mime_type:blob.type||'application/octet-stream',role:'telemetry',start_ms:metadata.start_ms||0,duration_ms:0,size:0,sha256:'',...metadata};session.files.push(file);}
    const index=indexes.get(name)||0;indexes.set(name,index+1);file.size+=blob.size;file.duration_ms=Math.max(0,elapsed()-file.start_ms);session.duration_ms=elapsed();totalBytes+=blob.size;
    const snapshot=structuredClone(current);delete snapshot.chunks;
    enqueue(()=>store.save(snapshot,{session_id:session.id,name,index,blob}));
    if(totalBytes>=MAX_CAPTURE&&capturing)void stop('Capture size limit reached.');
  }
  function telemetry(chunk,helperReceipt=null){
    byId('telemetry-status').textContent='Vehicle messages received · live monitor';
    lastTelemetryAt=performance.now();for(const row of monitorParser.feed(chunk,lastTelemetryAt)){vehicle.observe(row);liveMessages.set(row.message,row);if(![22,118,120].includes(row.message_id))byId('live-observation').textContent=E.describe(row);}byId('live-values').textContent=JSON.stringify([...liveMessages.values()].map(r=>({message:r.message,system_id:r.system_id,component_id:r.component_id,fields:r.fields})),null,2);refreshVehicles();controls();
    if(!capturing||stopping)return;
    const at_ms=elapsed(),offset=current.session.files.find(f=>f.name==='telemetry.mavlink')?.size||0;
    const receipt={offset,length:chunk.length,browser_receipt_ms:at_ms,helper_received_unix_ns:helperReceipt};append('telemetry-receipts.jsonl',new Blob([JSON.stringify(receipt)+'\n'],{type:'application/x-ndjson'}),{role:'telemetry'});append('telemetry.mavlink',new Blob([chunk]),{role:'telemetry'});
    for(const row of parser.feed(chunk,at_ms))addRow({...row,kind:'mavlink'});
    if(parser.frames.length)append('telemetry.tlog',new Blob([E.tlog(parser.frames.map(frame=>({...frame,receipt_unix_ns:helperReceipt})),current.session.started_at)]),{role:'telemetry'});
    byId('replay-observation').textContent=current.timeline.length?E.describe(current.timeline.at(-1)):'Receiving telemetry.';
  }
  async function chooseMedia(kind,surface='window'){
    try{const input=await media.add(kind,surface);status('Added '+input.label+'.');}
    catch(error){status('Input was not added: '+error.message+'. Earlier inputs remain selected.');}
  }
  async function disconnectSerial(){serialGeneration++;if(serialReader){await serialReader.cancel().catch(()=>{});serialReader=null;}if(serialPort){await serialPort.close().catch(()=>{});serialPort=null;}byId('connect-serial').textContent='Connect USB telemetry';byId('telemetry-status').textContent='Not connected';}
  async function connectSerial(){
    if(serialPort){await disconnectSerial();return;}
    try{
      if(!navigator.serial)throw Error('USB telemetry is unavailable in this browser. Use the local UDP helper or attach a telemetry log.');
      if(helper)throw Error('Disconnect the helper or reload before selecting a different telemetry source.');
      const port=await navigator.serial.requestPort();await port.open({baudRate:Number(byId('serial-baud').value)});serialPort=port;monitorParser=new E.MavlinkParser();const generation=++serialGeneration;
      byId('connect-serial').textContent='Disconnect USB telemetry';byId('telemetry-status').textContent='USB open · waiting for existing vehicle messages';
      void (async()=>{try{while(serialPort===port&&generation===serialGeneration&&port.readable){const reader=port.readable.getReader();serialReader=reader;try{while(generation===serialGeneration){const {value,done}=await reader.read();if(done)throw Error('Telemetry stream closed.');if(value)telemetry(value);}}finally{reader.releaseLock();serialReader=null;}}}catch(error){if(generation===serialGeneration){byId('telemetry-status').textContent='USB input ended: '+error.message;if(capturing){current.session.sources.telemetry.status='interrupted';note('USB input ended: '+error.message);persist();}}}finally{if(serialPort===port){await port.close().catch(()=>{});serialPort=null;byId('connect-serial').textContent='Connect USB telemetry';}}})();
    }catch(error){byId('telemetry-status').textContent=error.message;}
  }
  function helperBase(){const u=new URL(byId('helper-url').value);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Use a localhost HTTP helper address.');return u.origin;}
  async function helperRequest(path,options={}){const response=await fetch(helper.base+path,{...options,headers:{'X-Forge-Key':helper.key,...options.headers},cache:'no-store'});const result=await response.json();if(!response.ok||result.ok===false)throw Error(result.error||'Local helper request failed.');return result;}
  async function connectHelper(){
    try{
      if(helper){helperGeneration++;helperAbort?.abort();helper=null;byId('field-folder').hidden=true;byId('connect-helper').textContent='Connect local helper';byId('helper-status').textContent='Helper disconnected.';byId('telemetry-status').textContent='Not connected';byId('slack-destination').textContent='Connect a local helper configured for your Slack channel.';controls();return;}
      if(serialPort)throw Error('Disconnect USB before choosing network telemetry.');
      const base=helperBase(),key=byId('helper-key').value.trim();if(!key)throw Error('Copy the connection key printed by the helper.');
      helperAbort?.abort();const generation=++helperGeneration;helper={base,key};helperAbort=new AbortController();const config=await helperRequest('/status',{signal:helperAbort.signal});helper={...helper,...config};
      monitorParser=new E.MavlinkParser();byId('connect-helper').textContent='Disconnect local helper';byId('helper-status').textContent='Connected · UDP receive-only on '+config.udp_address;
      byId('slack-destination').textContent=config.slack_enabled?'Slack destination: '+config.slack_channel:'Slack is not configured in this helper. Reports and sessions can still be exported locally.';
      byId('field-folder').hidden=!config.archive_enabled;
      if(config.archive_enabled){try{await refreshArchives();}catch(error){byId('archive-status').textContent='Could not list disk copies: '+error.message;}}
      controls();let cursor=config.cursor;
      void (async()=>{try{while(generation===helperGeneration){const data=await helperRequest('/telemetry?after='+cursor,{signal:helperAbort.signal});if(data.gap&&capturing){note('Local helper buffer gap: '+data.gap+' datagrams were unavailable.');current.session.sources.telemetry.status='interrupted';}for(const packet of data.packets){cursor=packet.id;const chunk=Uint8Array.from(atob(packet.data),c=>c.charCodeAt(0));telemetry(chunk,/^[0-9]{1,24}$/.test(packet.received_unix_ns||'')?packet.received_unix_ns:null);}if(generation!==helperGeneration)break;await new Promise(resolve=>setTimeout(resolve,250));}}catch(error){if(generation===helperGeneration){byId('helper-status').textContent='Helper disconnected: '+error.message;helper=null;controls();if(capturing){current.session.sources.telemetry.status='interrupted';note('Helper disconnected.');persist();}}}})();
    }catch(error){helper=null;byId('helper-status').textContent=error.message;controls();}
  }
  function refreshVehicles(){
    const select=byId('vehicle-target'),selected=select.value,entries=[...vehicle.vehicles],signature=entries.map(([key])=>key).join('|');
    if(select.dataset.signature!==signature){select.dataset.signature=signature;select.replaceChildren(new Option(entries.length?'Choose connected vehicle':'Waiting for PX4 or ArduPilot',''));for(const[key,target]of entries)select.add(new Option((target.autopilot===12?'PX4':'ArduPilot')+' · system '+target.system_id+', component '+target.component_id,key));if(entries.some(([key])=>key===selected))select.value=selected;else if(entries.length===1)select.value=entries[0][0];}
    let target=null;try{target=vehicle.target(select.value);}catch{}
    byId('vehicle-connection').textContent=target?((serialPort?.writable||helper?.evidence_reads)?'Connected evidence link · ':'Telemetry observed · evidence reads need USB or the current local helper · ')+(target.armed?'vehicle reports armed; log retrieval is disabled.':'vehicle reports disarmed.'):entries.length?'Choose a vehicle with a fresh heartbeat.':'Connect USB telemetry or the local helper to collect evidence.';
  }
  async function sendReadRequest(bytes){
    if(serialPort?.writable){const writer=serialPort.writable.getWriter();try{await writer.write(bytes);}finally{writer.releaseLock();}return;}
    if(helper?.evidence_reads){await helperRequest('/mavlink/read-request',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes});return;}
    throw Error('Evidence downloads need writable USB MAVLink or the current local helper. Attach GCS exports for a receive-only connection.');
  }
  async function prepareEvidenceSession(target){
    if(current)return;
    const values=details();if(values.stack==='generic')values.stack=target.autopilot===12?'px4':'ardupilot';
    const id=crypto.randomUUID();current={id,session:{schema_version:1,tool:'forge-uas-session',tool_version:'1.3.1',id,certification:false,program_acceptance:false,clock_basis:'browser_receipt_monotonic',started_at:new Date().toISOString(),duration_ms:0,state:'finished',evidence_only:true,files:[],sources:{screen:{requested:false,status:'not_selected',inputs:[]},camera:{requested:false,status:'not_selected',inputs:[]},telemetry:{requested:false,status:'not_selected'}},test_reports:[],...values},timeline:[]};
    await store.save(current);await refresh();await showCurrent();
  }
  async function collectVehicle(kind){
    const key=byId('vehicle-target').value,target=vehicle.target(key,kind!=='parameters');
    byId('cancel-vehicle').hidden=false;byId('cancel-vehicle').disabled=false;byId('vehicle-status').textContent='Requesting '+(kind==='parameters'?'vehicle parameters':kind==='list'?'onboard log list':'selected onboard log')+'…';
    if(kind==='list'){const logs=await vehicle.listLogs(key),select=byId('vehicle-log');select.replaceChildren(new Option(logs.length?'Choose onboard log':'No onboard logs reported',''));for(const log of logs)select.add(new Option('Log '+log.id+' · '+(log.size/1048576).toFixed(2)+' MiB · '+(log.time_utc?new Date(log.time_utc*1000).toISOString():'UTC time unavailable'),String(log.id)));byId('vehicle-status').textContent=logs.length+' onboard logs listed. Choose one to collect.';return;}
    const result=kind==='parameters'?await vehicle.parameters(key):await vehicle.log(key,Number(byId('vehicle-log').value));
    await prepareEvidenceSession(target);
    const noteText=(current.session.evidence_only?'Before recording · ':'After recording · ')+result.collected_at+' · collected '+result.name+' from system '+target.system_id+', component '+target.component_id+'.';
    await attach(new File([result.bytes],result.name,{type:result.mime}),result.role,{collected_at:result.collected_at,system_id:target.system_id,component_id:target.component_id,autopilot:target.autopilot,method:kind==='parameters'?'mavlink_parameter_list':'mavlink_log_read'});
    addRow({kind:'source',text:noteText,at_ms:current.session.duration_ms});await store.save(current);reports();
    if(helper?.archive_enabled)try{await saveArchive(false);}catch(error){byId('archive-status').textContent='Disk copy failed: '+error.message+'. Download the session ZIP.';}
    byId('vehicle-status').textContent='Collected and attached '+result.name+(result.count?' · '+result.count+' parameters':'')+'. '+(current.session.evidence_only?'Start recording to keep the reproduction in this same session.':'Review the evidence and support report.');status('Connected vehicle evidence saved locally.');
  }
  async function start(){
    if(!ready||capturing||stopping)return;pausePlayback();const prepared=current?.session.evidence_only?current:null;current={id:prepared?.id||crypto.randomUUID(),session:null,timeline:prepared?.timeline||[]};
    current.session={schema_version:1,tool:'forge-uas-session',tool_version:'1.3.1',id:current.id,certification:false,program_acceptance:false,clock_basis:'browser_receipt_monotonic',started_at:new Date().toISOString(),duration_ms:0,state:'in_progress',evidence_only:false,files:prepared?.session.files||[],sources:{},test_reports:prepared?.session.test_reports||[],...details()};
    originTime=performance.now();parser=new E.MavlinkParser();indexes.clear();totalBytes=current.session.files.reduce((total,file)=>total+file.size,0);timelineBytes=new TextEncoder().encode(JSON.stringify(current.timeline)).length;storageFailure=false;capturing=true;stopping=false;recorders.clear();byId('share-confirm').checked=false;
    const ordinals={screen:0,camera:0};for(const kind of ['screen','camera'])current.session.sources[kind]={requested:media.active.some(input=>input.kind===kind),status:media.active.some(input=>input.kind===kind)?'recording':'not_selected',inputs:[]};
    for(const input of media.active){
      const {kind,stream}=input,number=++ordinals[kind],source={id:input.id,label:input.label,status:'recording',audio:stream.getAudioTracks().length>0};
      current.session.sources[kind].inputs.push(source);input.status.textContent='Recording';
      try{
        if(!globalThis.MediaRecorder)throw Error('Media recording is unavailable; import an existing recording.');
        const mime=['video/webm;codecs=vp8,opus','video/webm;codecs=vp8','video/webm','video/mp4'].find(m=>MediaRecorder.isTypeSupported(m));if(!mime)throw Error('No supported recording format.');
        const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2500000}),name=kind+(number===1?'':'-'+number)+(mime.includes('mp4')?'.mp4':'.webm'),start_ms=elapsed();
        const settings=stream.getVideoTracks()[0].getSettings();source.settings=Object.fromEntries(['width','height','frameRate','displaySurface','resizeMode'].filter(key=>settings[key]!==undefined).map(key=>[key,settings[key]]));source.file_name=name;
        recorder.ondataavailable=event=>{if(event.data.size)append(name,event.data,{role:kind,mime_type:recorder.mimeType,start_ms,source_id:input.id,source_label:input.label,has_audio:source.audio});};
        recorder.onerror=event=>{source.status='interrupted';current.session.sources[kind].status='interrupted';input.status.textContent='Recording error';note(input.label+' recording error: '+(event.error?.message||'Unknown recording error'));persist();};
        recorder.start(1000);recorders.set(input.id,recorder);
      }catch(error){source.status='failed';source.error=error.message;current.session.sources[kind].status='failed';input.status.textContent='Could not record';note(input.label+' could not record: '+error.message);}
    }
    current.session.sources.telemetry={requested:Boolean(serialPort||helper),status:serialPort||helper?'listening':'not_selected',transport:serialPort?'web_serial':helper?'localhost_udp':'none',baud:serialPort?Number(byId('serial-baud').value):null};
    note('Session started. Source clocks and media pipeline delays are unmeasured.');persist();controls();status(recorders.size||serialPort||helper?'Recording locally. Mark important moments, then stop and save.':'Notes-only session started. Mark observations and attach original files after stopping.');
  }
  async function materialize(record,chunks){
    const files=new Map();for(const file of record.session.files){const parts=chunks.filter(c=>c.name===file.name).sort((a,b)=>a.index-b.index).map(c=>c.blob);const blob=new Blob(parts,{type:file.mime_type});if(blob.size!==file.size)throw Error('Saved evidence is incomplete: '+file.original_name);const bytes=new Uint8Array(await blob.arrayBuffer());file.sha256=await E.sha256(bytes);files.set(file.name,bytes);}
    E.validateSession(record.session,record.timeline);return files;
  }
  async function stop(reason=''){
    if(!capturing||stopping)return;stopping=true;controls();status('Finishing media and saving local evidence…');
    try{
      if(reason)note(reason);
      await Promise.all([...recorders.values()].map(recorder=>new Promise(resolve=>{if(recorder.state==='inactive'){resolve();return;}recorder.addEventListener('stop',resolve,{once:true});recorder.stop();})));
      for(const kind of ['screen','camera'])for(const source of current.session.sources[kind].inputs)if(source.status==='recording'&&!current.session.files.some(file=>file.source_id===source.id)){source.status='failed';current.session.sources[kind].status='failed';note(source.label+': no encoded video was returned.');}
      current.session.duration_ms=elapsed();current.session.telemetry_stats=parser.finish();current.session.state=reason||Object.values(current.session.sources).some(s=>s.status==='interrupted'||s.status==='failed')?'interrupted':'finished';
      for(const source of Object.values(current.session.sources))if(['recording','listening'].includes(source.status))source.status='complete';
      for(const kind of ['screen','camera'])for(const input of current.session.sources[kind].inputs)if(input.status==='recording')input.status='complete';
      capturing=false;persist();await queue;const saved=await store.read(current.id);
      if(storageFailure){saved.session.state='interrupted';saved.timeline.push({kind:'source',text:'Recovered the last committed local save after a storage error; later data was unavailable.',at_ms:saved.session.duration_ms});}
      else{saved.session=current.session;saved.timeline=current.timeline;}
      await materialize(saved,saved.chunks);current={id:saved.id,session:saved.session,timeline:saved.timeline};await store.save(current);
      await refresh();await showCurrent();if(helper?.archive_enabled){try{await saveArchive(false);}catch(error){byId('archive-status').textContent='Disk copy failed: '+error.message+'. Evidence is still in this browser; download a ZIP.';}}setLayout('workspace');setStage('evidence',{focus:true,force:true});status(storageFailure?'Saved evidence needs review after a storage error. Export the session now.':'Saved locally. Review the evidence and add your test result.');liveTeam();
    }catch(error){capturing=false;fail(error);}finally{stopping=false;media.stopAll();controls();}
  }
  async function refresh(){const selected=current?.id,list=await store.list(),select=byId('saved-sessions');select.replaceChildren(new Option('Choose a session',''));for(const record of list)select.add(new Option((record.session.title||'Untitled session')+' · '+record.session.started_at.slice(0,19).replace('T',' ')+(record.session.state==='in_progress'?' · interrupted capture':''),record.id));if(selected)select.value=selected;}
  function reportText(target){return target==='jira'&&document.body.dataset.view==='guided'?R.plain(R.model(current.session,current.timeline),'jira'):R.render(current.session,current.timeline,target);}
  function reports(){
    byId('betaflight-details').hidden=byId('session-stack').value!=='betaflight'&&!byId('report-destination').value.startsWith('betaflight');
    if(!current)return;const target=byId('report-destination').value,quality=R.completeness(target.startsWith('betaflight')?{...current.session,stack:'betaflight'}:current.session);
    byId('report-preview').textContent=reportText(target);
    byId('copy-report').textContent=target==='jira'?(document.body.dataset.view==='guided'?'Copy report for Jira editor':'Copy ADF JSON'):'Copy formatted report';
    byId('download-report').textContent=target==='jira'?'Download Jira ADF JSON':'Download report';
    byId('complete-report').hidden=!quality.missing.some(label=>!['Actual behavior','Original onboard flight log','Test criterion and outcome reason'].includes(label));
    byId('report-completeness').textContent=quality.missing.length?'Still needed: '+quality.missing.join('; '):'Report fields are ready for your review. Check the evidence and destination.';
    const url=R.composer(current.session,current.timeline,target),link=byId('open-destination');link.hidden=!url;if(url)link.href=url;
    link.textContent=target==='betaflight'?'Open official Betaflight bug form':target==='betaflight_support'?'Open Betaflight community':target==='px4'?'Open PX4 / Dronecode draft':target==='ardupilot'?'Open ArduPilot draft':'Open destination';
    const fields=byId('official-report-fields');fields.replaceChildren();fields.hidden=target!=='betaflight';
    for(const[label,value]of R.officialFields(current.session,current.timeline,target)){const card=document.createElement('div');card.className='rec-official-field';const title=document.createElement('h3'),preview=document.createElement('pre'),button=document.createElement('button'),drawer=document.createElement('details'),summary=document.createElement('summary');title.textContent=label;preview.textContent=value||'Add this detail before submitting.';summary.textContent='Preview field';drawer.append(summary,preview);button.type='button';button.className='action secondary';button.textContent='Copy '+label;button.disabled=capturing||stopping||busy;button.onclick=run(async()=>{await saveDetails();const fresh=R.officialFields(current.session,current.timeline,target).find(([field])=>field===label)?.[1];if(!fresh)throw Error('Add '+label+' to the report details before copying.');await navigator.clipboard.writeText(fresh);status('Copied '+label+'. Paste it into the matching official form field.');});card.append(title,button,drawer);fields.append(card);}
  }
  async function showCurrent(){
    byId('archive-status').textContent='';
    pausePlayback();for(const url of replayURLs)URL.revokeObjectURL(url);replayURLs=[];byId('replay-previews').replaceChildren();byId('media-alignment-fields').replaceChildren();byId('replay-view').replaceChildren(new Option('All recorded inputs',''));
    const saved=await store.read(current.id),files=await materialize(current,saved.chunks),s=current.session;fillDetails(s);
    byId('session-summary').textContent=E.summary(s,current.timeline)+'\nTest outcome: '+R.outcomeLabels[s.test_outcome];
    byId('timeline-position').max=String(Math.max(s.duration_ms/1000,0.1));byId('timeline-position').disabled=false;byId('timeline-position').value='0';
    const counts={screen:0,camera:0,video:0};for(const file of s.files.filter(f=>['screen','camera','video'].includes(f.role)&&f.mime_type.startsWith('video/'))){
      const card=document.createElement('div'),label=document.createElement('span'),video=document.createElement('video'),number=++counts[file.role],prefix=(file.role==='video'?'video':file.role)+(number===1?'':'-'+number),title=file.source_label||file.original_name;
      card.dataset.fileName=file.name;label.textContent=title;video.id=prefix+'-replay';video.controls=true;video.playsInline=true;video.muted=file.role==='screen';
      const url=URL.createObjectURL(new Blob([files.get(file.name)],{type:file.mime_type}));replayURLs.push(url);video.src=url;video.dataset.startMs=String(file.alignment_offset_ms??file.start_ms);video.dataset.scale=String(file.alignment_scale??1);video.dataset.fileName=file.name;card.append(label,video);byId('replay-previews').append(card);byId('replay-view').add(new Option(title,file.name));
      for(const type of ['offset','scale']){const field=document.createElement('label');if(type==='scale')field.className='developer-only';field.textContent=title+(type==='offset'?' · begins at session seconds':' · clock scale (1 = unchanged)');const value=document.createElement('input');value.id=prefix+'-'+type;value.type='number';value.min=type==='offset'?'-7200':'0.5';value.max=type==='offset'?'7200':'2';value.step=type==='offset'?'0.01':'0.0001';value.value=String(type==='offset'?(file.alignment_offset_ms??file.start_ms)/1000:file.alignment_scale??1);value.dataset.fileName=file.name;value.className='media-'+type;field.append(value);byId('media-alignment-fields').append(field);}
    }
    byId('replay-previews').classList.remove('rec-focused');byId('replay-view').disabled=!replayVideos().length;
    byId('replay-view').closest('.rec-toolbar').hidden=replayVideos().length<2;byId('play-session').disabled=!s.files.some(f=>['screen','camera','video'].includes(f.role));
    const list=byId('session-timeline');list.replaceChildren();let rows=current.timeline.filter(r=>r.kind!=='mavlink'||[0,1,24,147,253].includes(r.message_id));if(rows.length>150)rows=[...current.timeline.filter(r=>r.kind==='note'||r.kind==='source'),...rows.filter(r=>r.kind==='mavlink').slice(-100)].sort((a,b)=>a.at_ms-b.at_ms);
    for(const row of rows){const button=document.createElement('button');button.type='button';button.className='rec-event';const stamp=document.createElement('time');stamp.textContent=time(row.at_ms);const text=document.createElement('span');text.textContent=E.describe(row);button.append(stamp,text);button.onclick=()=>seek(row.at_ms/1000);list.append(button);}
    byId('developer-evidence').textContent=JSON.stringify({sources:s.sources,telemetry_stats:s.telemetry_stats,clock_basis:s.clock_basis,media_alignment:s.files.filter(f=>['screen','camera','video'].includes(f.role)).map(f=>({name:f.name,method:f.alignment_method||'capture_start_estimate',offset_ms:f.alignment_offset_ms??f.start_ms,scale:f.alignment_scale??1,uncertainty:'unmeasured'})),supported_messages:Object.values(E.definitions).map(d=>d[0]),last_packets:current.timeline.filter(r=>r.kind==='mavlink').slice(-8)},null,2);
    const fileList=byId('evidence-files');fileList.replaceChildren();for(const f of s.files){const row=document.createElement('div');row.className='rec-file';const text=document.createElement('span');text.textContent=(f.source_label?f.source_label+' · ':'')+f.original_name+' · '+f.role+' · '+(f.size/1024).toFixed(1)+' KiB';const button=document.createElement('button');button.type='button';button.className='action secondary';button.textContent='Download original';button.onclick=()=>download(new Blob([files.get(f.name)],{type:f.mime_type}),f.original_name);row.append(text,button);fileList.append(row);}
    const analyzer=byId('analyzer-link');analyzer.replaceChildren();const dest=R.destinations[s.stack];if(dest?.analyzer){const link=document.createElement('a');link.href=dest.analyzer;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open '+s.stack+' log viewer (choose files there)';analyzer.append(link);}
    byId('share-confirm').checked=false;seek(0);reports();controls();requestAnimationFrame(()=>ForgeSessionMedia.fitGrid(byId('replay-previews')));
  }
  function seek(seconds){
    if(!current)return;seconds=Math.max(0,Math.min(seconds,current.session.duration_ms/1000));byId('timeline-position').value=String(seconds);byId('replay-clock').textContent=time(seconds*1000);
    for(const video of replayVideos()){const local=Math.max(0,(seconds-Number(video.dataset.startMs||0)/1000)/Number(video.dataset.scale||1));if(Number.isFinite(video.duration))video.currentTime=Math.min(local,video.duration);else video.currentTime=local;}
    const row=current.timeline.findLast(r=>r.at_ms<=seconds*1000);byId('replay-observation').textContent=row?E.describe(row):'Before the first observation.';
  }
  function play(){
    if(playbackTimer){pausePlayback();return;}const start=Number(byId('timeline-position').value),began=performance.now();
    byId('play-session').textContent='Pause together';playbackTimer=setInterval(()=>{const seconds=start+(performance.now()-began)/1000;byId('timeline-position').value=String(seconds);byId('replay-clock').textContent=time(seconds*1000);for(const video of replayVideos()){const scale=Number(video.dataset.scale||1),target=(seconds-Number(video.dataset.startMs||0)/1000)/scale;if(target<0){video.pause();continue;}if(Number.isFinite(video.duration)&&target>=video.duration){video.pause();continue;}video.playbackRate=1/scale;if(Math.abs(video.currentTime-target)>0.25)video.currentTime=target;if(video.paused)void video.play().catch(()=>{});}const row=current.timeline.findLast(r=>r.at_ms<=seconds*1000);byId('replay-observation').textContent=row?E.describe(row):'Before the first observation.';if(seconds>=current.session.duration_ms/1000)pausePlayback();},100);
  }
  async function openSaved(id){if(!id)return;const record=await store.read(id);if(record.session.state==='in_progress'){record.session.state='interrupted';for(const source of Object.values(record.session.sources)){if(['recording','listening'].includes(source.status))source.status='interrupted';for(const input of source.inputs||[])if(input.status==='recording')input.status='interrupted';}record.timeline.push({kind:'source',text:'Recovered after recording ended without a normal stop. Media finalization may be incomplete.',at_ms:record.session.duration_ms});await materialize(record,record.chunks);delete record.chunks;await store.save(record);}current={id:record.id,session:record.session,timeline:record.timeline};await showCurrent();setStage('evidence',{focus:true,force:true});status('Opened local session.');}
  function diskUpdateNeeded(){if(helper?.archive_enabled)byId('archive-status').textContent='This browser session has updates. Select Save updated disk copy to include the current report and evidence.';}
  async function saveDetails(){if(!current||capturing)return;Object.assign(current.session,details());E.validateSession(current.session,current.timeline);await store.save(current);await refresh();reports();diskUpdateNeeded();byId('session-summary').textContent=E.summary(current.session,current.timeline)+'\nTest outcome: '+R.outcomeLabels[current.session.test_outcome];status('Report details saved.');}
  async function bundle({save=true}={}){
    if(save)await saveDetails();const saved=await store.read(current.id),files=await materialize(current,saved.chunks),exportSession=structuredClone(current.session);
    exportSession.files=exportSession.files.filter(f=>!['report.md','report.json'].includes(f.name));
    const report=R.model(exportSession,current.timeline),text=JSON.stringify(report,null,2)+'\n';
    for(const[name,content,mime]of [['report.md',R.markdown(report),'text/markdown'],['report.json',text,'application/json']]){const bytes=new TextEncoder().encode(content);files.set(name,bytes);exportSession.files.push({name,original_name:name,mime_type:mime,role:'report',size:bytes.length,sha256:await E.sha256(bytes),start_ms:0,duration_ms:0});}
    const entries=[...files].map(([name,bytes])=>({name,bytes}));entries.push({name:'session.json',bytes:new TextEncoder().encode(JSON.stringify(exportSession))},{name:'timeline.json',bytes:new TextEncoder().encode(JSON.stringify(current.timeline))},{name:'summary.txt',bytes:new TextEncoder().encode(E.summary(exportSession,current.timeline))});
    E.validateSession(exportSession,current.timeline);return E.zip(entries);
  }
  async function refreshArchives(){if(!helper?.archive_enabled)return;const data=await helperRequest('/archives'),select=byId('archived-sessions');select.replaceChildren(new Option('Choose a disk copy',''));for(const session of data.sessions)select.add(new Option((session.title||'Untitled session')+' · '+session.started_at,session.id));byId('field-folder-path').textContent='Local folder: '+data.directory+(data.truncated?' · Showing the latest 200 copies; more remain in the folder.':'');}
  async function saveArchive(save=true){if(!helper?.archive_enabled||!current||capturing)return;byId('archive-status').textContent='Writing a local disk copy…';const bytes=await bundle({save}),result=await helperRequest('/archive',{method:'POST',headers:{'Content-Type':'application/zip'},body:bytes});byId('archive-status').textContent='Saved on disk: '+result.path;await refreshArchives();}
  async function openArchive(){const id=byId('archived-sessions').value;if(!id)return;const response=await fetch(helper.base+'/archive/'+encodeURIComponent(id),{headers:{'X-Forge-Key':helper.key},cache:'no-store'});if(!response.ok)throw Error('Disk copy unavailable.');await importBundle(new File([await response.blob()],'field-session.zip',{type:'application/zip'}));}
  async function attach(file,role,collection=null){
    if(!current||capturing)return;if(current.session.files.length>=70)throw Error('Evidence file limit reached.');
    if(file.name.length>512||file.type.length>200)throw Error('Evidence name or media type is too long.');
    const total=current.session.files.reduce((n,f)=>n+f.size,0);if(total+file.size>240*1024*1024)throw Error('Evidence exceeds the 240 MiB session limit.');
    const bytes=new Uint8Array(await file.arrayBuffer());const clean=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').replace(/\.{2,}/g,'_').slice(0,150)||'evidence.bin',name='originals/'+crypto.randomUUID()+'/'+(/^[a-zA-Z0-9]/.test(clean)?clean:'file-'+clean);
    let testReport=null;if(role==='test_report'){if(file.size>1048576)throw Error('Test Lab report exceeds 1 MiB.');if(!catalog)throw Error('Test Lab catalog unavailable. Attach as original evidence instead.');const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));testReport=parsed.tool==='forge-test-review'?ForgeTestLab.validateReview(parsed,catalog,catalogHash).runner_report:ForgeTestLab.validateReport(parsed,catalog,catalogHash);if(!testReport)throw Error('This review has no runner report.');}
    const metadata={name,original_name:file.name,mime_type:file.type||'application/octet-stream',role,size:file.size,sha256:await E.sha256(bytes),start_ms:0,duration_ms:0,...(collection?{collection}: {})};
    await saveDetails();
    current.session.files.push(metadata);if(testReport){const counts={};for(const r of testReport.results)counts[r.status]=(counts[r.status]||0)+1;current.session.test_reports.push({file:name,profile:testReport.profile,profile_version:testReport.profile_version,catalog_sha256:testReport.catalog_sha256,counts,claims_verified:false});}
    try{E.validateSession(current.session,current.timeline);await store.save(current,{session_id:current.id,name,index:0,blob:new Blob([bytes],{type:metadata.mime_type})});}catch(error){current.session.files.pop();if(testReport)current.session.test_reports.pop();throw error;}
    await showCurrent();diskUpdateNeeded();byId('attachment-status').textContent='Retained original: '+file.name+(testReport?' · report format/catalog checked; test claims remain self-recorded.':'');
  }
  async function importBundle(file){if(!file)return;if(file.size>E.LIMIT)throw Error('ZIP exceeds 256 MiB.');const parsed=await E.verifyBundle(new Uint8Array(await file.arrayBuffer()));const id=crypto.randomUUID(),record={id,session:{...parsed.session,id,imported_from:parsed.session.id},timeline:parsed.timeline};const files=new Map([...parsed.files].filter(([name])=>record.session.files.some(f=>f.name===name)));await store.replace(record,files);current=record;await refresh();await showCurrent();setStage('evidence',{focus:true,force:true});status('Imported session. Evidence hashes and decoded telemetry rows checked; authorship and test claims remain unverified.');}
  async function sendSlack(){
    if(!helper?.slack_enabled||!byId('share-confirm').checked||navigator.onLine===false)return;byId('send-slack').disabled=true;byId('share-status').textContent='Preparing the reviewed session for Slack…';
    try{const bytes=await bundle();const result=await helperRequest('/slack',{method:'POST',headers:{'Content-Type':'application/zip','X-Forge-Session':current.id},body:bytes});byId('share-status').textContent='Uploaded to '+result.channel+(result.permalink?' · '+result.permalink:'')+'.';byId('share-confirm').checked=false;}catch(error){byId('share-status').textContent='Slack upload incomplete: '+error.message+'. Session is still saved locally.';}finally{controls();}
  }
  const run=work=>async()=>{if(busy)return;busy=true;controls();try{await work();}catch(error){fail(error);}finally{busy=false;controls();}};
  byId('choose-screen').onclick=run(()=>chooseMedia('screen','window'));byId('choose-monitor').onclick=run(()=>chooseMedia('screen','monitor'));byId('choose-camera').onclick=run(()=>chooseMedia('camera'));byId('connect-serial').onclick=run(connectSerial);byId('connect-helper').onclick=run(connectHelper);
  byId('refresh-cameras').onclick=run(async()=>{await media.refreshCameras();status('Camera list refreshed. Camera names are available after permission.');});
  for(const[id,kind]of [['collect-params','parameters'],['list-vehicle-logs','list'],['collect-log','log']])byId(id).onclick=run(async()=>{try{await collectVehicle(kind);}catch(error){byId('vehicle-status').textContent=error.message;throw error;}});
  byId('cancel-vehicle').onclick=()=>{vehicle.cancel();byId('vehicle-status').textContent='Cancelling collection… Complete existing evidence stays saved.';};byId('vehicle-target').onchange=()=>{refreshVehicles();controls();};byId('vehicle-log').onchange=controls;
  byId('fullscreen-workspace').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await byId('main').requestFullscreen();}catch(error){status('Fullscreen is unavailable: '+error.message+'. You can maximize the browser window instead.');}};addEventListener('fullscreenchange',()=>{byId('fullscreen-workspace').textContent=document.fullscreenElement?'Exit fullscreen':'Fullscreen workspace';});
  byId('start-recording').onclick=run(start);byId('stop-recording').onclick=()=>stop();byId('mark-event').onclick=()=>{if(!capturing||stopping)return;const text=byId('marker-note').value.trim()||'Marked moment';note(text,'note');byId('marker-note').value='';persist();status('Marked '+time(elapsed())+': '+text);};
  byId('open-saved').onclick=run(()=>openSaved(byId('saved-sessions').value));byId('open-bundle').onchange=run(()=>importBundle(byId('open-bundle').files[0]));
  byId('attach-log').onchange=run(async()=>{for(const file of byId('attach-log').files)await attach(file,byId('attachment-role').value);byId('attach-log').value='';});byId('attach-report').onchange=run(async()=>{const file=byId('attach-report').files[0];if(file)await attach(file,'test_report');byId('attach-report').value='';});
  byId('save-details').onclick=run(saveDetails);byId('save-archive').onclick=run(()=>saveArchive());byId('open-archive').onclick=run(openArchive);byId('download-session').onclick=run(async()=>{const bytes=await bundle();download(new Blob([bytes],{type:'application/zip'}),'forge-session-'+current.id+'.zip');status('Session ZIP exported with original evidence and reports.');});
  byId('save-alignment').onclick=run(async()=>{pausePlayback();const changes=[],scales=[...byId('media-alignment-fields').querySelectorAll('.media-scale')];for(const field of byId('media-alignment-fields').querySelectorAll('.media-offset')){const file=current.session.files.find(f=>f.name===field.dataset.fileName),offset=Number(field.value)*1000,scale=Number(scales.find(input=>input.dataset.fileName===file.name).value);if(!Number.isFinite(offset)||Math.abs(offset)>7200000||!Number.isFinite(scale)||scale<0.5||scale>2)throw Error('Choose an offset within two hours and a scale from 0.5 to 2.');changes.push({file,offset,scale});}for(const change of changes)Object.assign(change.file,{alignment_offset_ms:change.offset,alignment_scale:change.scale,alignment_method:'manual',alignment_uncertainty_ms:null});await store.save(current);await showCurrent();status('Manual alignment saved. Check a shared event near both ends; uncertainty is still unmeasured.');});
  byId('replay-view').onchange=()=>{const selected=byId('replay-view').value;for(const card of byId('replay-previews').children)card.hidden=Boolean(selected&&card.dataset.fileName!==selected);byId('replay-previews').classList.toggle('rec-focused',Boolean(selected));requestAnimationFrame(()=>ForgeSessionMedia.fitGrid(byId('replay-previews')));};
  byId('copy-summary').onclick=run(async()=>{await saveDetails();await navigator.clipboard.writeText(E.summary(current.session,current.timeline));status('Summary copied.');});
  byId('copy-report').onclick=run(async()=>{await saveDetails();await navigator.clipboard.writeText(reportText(byId('report-destination').value));status('Formatted report copied.');});
  byId('download-report').onclick=run(async()=>{await saveDetails();const target=byId('report-destination').value;download(new Blob([R.render(current.session,current.timeline,target)],{type:target==='jira'?'application/json':'text/markdown'}),'forge-'+target+'-report.'+(target==='jira'?'json':'md'));});
  byId('report-destination').onchange=reports;byId('share-confirm').onchange=controls;byId('send-slack').onclick=run(sendSlack);
  byId('delete-session').onclick=run(async()=>{if(!current||!confirm('Delete this session and its evidence from this browser? Download it first if you want to keep it.'))return;pausePlayback();await store.remove(current.id);current=null;await refresh();location.reload();});
  byId('timeline-position').oninput=()=>{pausePlayback();seek(Number(byId('timeline-position').value));};byId('play-session').onclick=play;
  function setStage(stage,{focus=false,force=false}={}){
    if(!['record','evidence','report','library','options'].includes(stage)||(!force&&(capturing||stopping)&&!['record','options'].includes(stage)))return;
    if(document.body.dataset.layout==='live'&&stage!=='record')setLayout('workspace');
    if(stage!=='evidence')pausePlayback();document.body.dataset.stage=stage;
    for(const panel of document.querySelectorAll('[data-stage-panel]'))panel.hidden=panel.dataset.stagePanel!==stage;
    for(const link of document.querySelectorAll('a[data-stage]')){if(link.dataset.stage===stage)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
    if(focus){const heading=byId({record:'setup-title',evidence:'replay-title',report:'report-title',library:'library-title',options:'options-title'}[stage]);heading.setAttribute('tabindex','-1');if(document.fullscreenElement)byId('main').scrollTop=0;else scrollTo(0,0);heading.focus({preventScroll:true});}
    requestAnimationFrame(()=>{ForgeSessionMedia.fitGrid(byId('capture-previews'));ForgeSessionMedia.fitGrid(byId('replay-previews'));});
  }
  function setLayout(layout){document.body.dataset.layout=layout;document.querySelectorAll('button[data-layout]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layout===layout)));byId('live-team-board').hidden=layout!=='live';byId('recorder-heading').textContent=layout==='live'?'Live field session':'Session Recorder';if(layout==='live')setStage('record',{force:true});liveTeam();}
  for(const link of document.querySelectorAll('a[data-stage]'))link.onclick=event=>{event.preventDefault();if(link.getAttribute('aria-disabled')==='true')return;setStage(link.dataset.stage,{focus:true});history.replaceState(null,'',link.getAttribute('href'));};
  for(const button of document.querySelectorAll('[data-next-stage]'))button.onclick=()=>setStage(button.dataset.nextStage,{focus:true});
  byId('capture-help').onclick=()=>{setStage('options',{focus:true});byId('window-capture-help').open=true;};
  new ResizeObserver(()=>ForgeSessionMedia.fitGrid(byId('replay-previews'))).observe(byId('replay-previews'));
  document.querySelectorAll('button[data-layout]').forEach(button=>button.onclick=()=>setLayout(button.dataset.layout));
  byId('review-session').onclick=()=>{setLayout('workspace');setStage('evidence',{focus:true});};
  byId('complete-report').onclick=()=>{setStage('report');byId('technical-details').open=true;byId('technical-details').scrollIntoView({block:'start'});byId('technical-details').querySelector('summary').focus({preventScroll:true});};
  document.querySelectorAll('button[data-view]').forEach(button=>button.onclick=()=>{document.body.dataset.view=button.dataset.view;document.querySelectorAll('button[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));byId('view-explanation').textContent=button.dataset.view==='guided'?'Everyday language, clear steps and a short session summary.':'Source identifiers, decoded values, timing limits and original evidence.';reports();liveTeam();});
  byId('session-stack').onchange=()=>{const stack=byId('session-stack').value;byId('stack-guidance').textContent=stack==='betaflight'?'Capture the Betaflight App window, attach native Blackbox and diff all, and collect the Support ID. Live MSP is not available in this release.':stack==='px4'?'Keep the original ULog and ver all output. Forward telemetry alongside QGC when possible.':stack==='ardupilot'?'Keep the original DataFlash and parameters. Forward telemetry alongside your GCS when possible.':'Capture the relevant app and retain original evidence. Choose the test environment and expected behavior.';reports();};
  addEventListener('online',networkStatus);addEventListener('offline',networkStatus);
  setInterval(()=>{liveTeam();refreshVehicles();controls();byId('live-age').textContent=lastTelemetryAt===null?'Waiting for incoming messages.':Math.floor((performance.now()-lastTelemetryAt)/1000)+' seconds since the latest received bytes.';if(!capturing)return;byId('recording-clock').textContent=time(elapsed());current.session.duration_ms=elapsed();persist();if(elapsed()>=7200000)void stop('Two-hour capture limit reached.');},1000);
  addEventListener('beforeunload',event=>{if(capturing||stopping){event.preventDefault();event.returnValue='';}});
  let installPrompt;addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;byId('install-app').hidden=false;});byId('install-app').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;byId('install-app').hidden=true;}};
  async function init(){
    await store.open();await refresh();
    try{await media.refreshCameras();}catch{}
    navigator.mediaDevices?.addEventListener('devicechange',()=>{if(!busy&&!capturing&&!stopping)void media.refreshCameras().catch(()=>{});});media.updateCounts();
    try{const response=await fetch('/system-tests/profiles.json',{cache:'no-store'});if(response.ok){const bytes=new Uint8Array(await response.arrayBuffer());catalog=JSON.parse(new TextDecoder().decode(bytes));catalogHash=await E.sha256(bytes);}}catch{}
    let standalone=false;
    if(['127.0.0.1','localhost'].includes(location.hostname)){
      byId('helper-url').value=location.origin;
      try{const response=await fetch('/local-config',{headers:{'X-Forge-Local':'1'},cache:'no-store',signal:AbortSignal.timeout(2000)});if(response.ok){const local=await response.json();if(typeof local.key==='string'&&local.key.length<=80){byId('helper-key').value=local.key;standalone=local.standalone===true;await connectHelper();}}}catch{}
    }
    if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('/session-recorder/sw.js',{scope:'/session-recorder/'});byId('app-status').textContent=standalone?'Standalone field app · ready offline. Sessions stay on this device.':'Free local app · this recorder can reopen offline after its files are cached. Your sessions stay on this device.';}catch{byId('app-status').textContent=standalone?'Standalone field app ready. No internet is required.':'Browser mode ready. Download the standalone app for field use.';}}
    if(standalone){byId('offline-downloads').hidden=true;byId('storage-meta').hidden=true;}
    ready=true;controls();networkStatus();const initial=({ '#replay-title':'evidence','#report-title':'report','#technical-details':'report','#library-title':'library','#options-title':'options'})[location.hash]||'record';setStage(initial);status('Ready. Add inputs or start with notes.');
  }
  controls();if(navigator.locks)navigator.locks.request('forge-uas-recorder',{ifAvailable:true},async lock=>{if(!lock){status('Another recorder tab is open. Close it and reload to protect your local sessions.');return;}await init();await new Promise(()=>{});}).catch(fail);else init().catch(fail);
})();
