  const $=id=>document.getElementById(id);const api='/api/ecosystem/v1';
  const state={me:null,org:'',records:{PRODUCTS:[],BOMS:[],OFFERS:[]},pollers:new Map()};
  const clean=value=>String(value??'').trim();
  function show(status,value,tone=''){ $('status').textContent=status;$('status').className=`status ${tone}`;$('result').textContent=typeof value==='string'?value:JSON.stringify(value,null,2) }
  async function call(path,options={}){const response=await fetch(`${api}${path}`,{...options,headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});const value=await response.json().catch(()=>({error:'Non-JSON response'}));if(!response.ok)throw Object.assign(new Error(value.error||`HTTP ${response.status}`),{status:response.status,value});return value}
  function org(){if(!state.org)throw new Error('Choose an assigned organization first');return state.org}
  function setBusy(button,busy,label){if(!button.dataset.label)button.dataset.label=button.textContent;button.disabled=busy;button.textContent=busy?label:button.dataset.label}
  function node(tag,className,text){const item=document.createElement(tag);if(className)item.className=className;if(text!==undefined)item.textContent=text;return item}
  function button(text,handler,className='secondary'){const item=node('button',className,text);item.type='button';item.addEventListener('click',handler);return item}
  function formatTime(ms){return ms?new Date(ms).toLocaleString():'—'}
  function parseRecords(){const records=JSON.parse($('records').value);if(!Array.isArray(records))throw new Error('Records must be a JSON array');return records}
  function updateSummary(){try{const records=parseRecords(),bytes=new TextEncoder().encode($('records').value).byteLength;$('record-summary').textContent=`${records.length.toLocaleString()} records · ${(bytes/1024).toFixed(1)} KiB · 2 MB request limit · 10,000 record ceiling`;$('record-summary').style.color=bytes>2_000_000||records.length>10000?'var(--red)':''}catch(error){$('record-summary').textContent=error.message;$('record-summary').style.color='var(--red)'}}
  function editable(record){const copy=structuredClone(record);['schemaVersion','manufacturerId','qualifiedProductId','productDigest','bomDigest','offerDigest','publicationState','publishedAtMs','isCurrent','withdrawnAtMs','withdrawalReason'].forEach(key=>delete copy[key]);return copy}
  function editRecord(resource,record,newRevision=false){const copy=editable(record);if(newRevision){const revision=prompt('New revision identifier',`${copy.revision||'r1'}-next`);if(!revision)return;copy.supersedesRevision=copy.revision;copy.revision=revision} $('resource').value=resource;$('records').value=JSON.stringify([copy],null,2);updateSummary();window.scrollTo({top:$('records').getBoundingClientRect().top+scrollY-100,behavior:'smooth'});show(newRevision?'NEW REVISION READY':'DRAFT LOADED',copy)}
  function transition(resource,record,action){return async()=>{const plural=resource.toLowerCase(),id=resource==='PRODUCTS'?record.productId:resource==='BOMS'?record.bomId:record.offerId;let path=resource==='OFFERS'?`/organizations/${encodeURIComponent(org())}/offers/${encodeURIComponent(id)}/${action}`:`/organizations/${encodeURIComponent(org())}/${plural}/${encodeURIComponent(id)}/${encodeURIComponent(record.revision)}/${action}`;const payload=action==='withdraw'?{reason:prompt('Why is this record being withdrawn?')||''}:null;try{const value=await call(path,{method:'POST',...(payload?{body:JSON.stringify(payload)}:{})});show(action.toUpperCase(),value);await loadCatalog()}catch(error){show('ACTION REJECTED',error.value||{error:error.message},'error')}}}
  function recordCard(resource,record){const id=resource==='PRODUCTS'?record.productId:resource==='BOMS'?record.bomId:record.offerId;const card=node('article','card');const head=node('div','card-head');const title=node('div');title.append(node('span','eyebrow',resource),node('h3','',`${record.name||id}${record.revision?` · ${record.revision}`:''}`),node('div','meta',`${id} · ${record.publicationState||'UNKNOWN'}${record.isCurrent?' · CURRENT':''}${record.partNumber?' · '+record.partNumber:''}`));head.append(title,node('span','state',record.publicationState||'UNKNOWN'));card.append(head);const actions=node('div','actions');if(record.publicationState==='DRAFT'){actions.append(button('Edit draft',()=>editRecord(resource,record)),button('Submit for review',transition(resource,record,'review')))}if(record.publicationState==='REVIEWED'){actions.append(button('Request changes',transition(resource,record,'request-changes')));if(state.me.identityKind==='ACCESS')actions.append(button('Publish',transition(resource,record,'publish')));}if(record.publicationState==='PUBLISHED'){if(resource!=='OFFERS')actions.append(button('Create revision',()=>editRecord(resource,record,true)));if(state.me.identityKind==='ACCESS')actions.append(button('Withdraw',transition(resource,record,'withdraw'),'danger'))}card.append(actions);return card}
  async function loadCatalog(){if(!state.org)return;const target=$('records-list');target.replaceChildren(node('div','empty','Loading catalog…'));try{for(const resource of ['PRODUCTS','BOMS','OFFERS']){const key=resource.toLowerCase(),value=await call(`/organizations/${encodeURIComponent(state.org)}/${key}`);state.records[resource]=value[key]||[]}target.replaceChildren();for(const resource of ['PRODUCTS','BOMS','OFFERS'])state.records[resource].forEach(record=>target.append(recordCard(resource,record)));if(!target.children.length)target.append(node('div','empty','No catalog records yet. Upload a validated JSON or CSV file to create drafts.'))}catch(error){target.replaceChildren(node('div','empty error',error.message))}}
  function importCard(item){const card=node('article','card');const head=node('div','card-head'),title=node('div');title.append(node('span','eyebrow',item.resource),node('h3','',item.importId),node('div','meta',`${item.status} · ${item.acceptedCount}/${item.recordCount} accepted · ${item.rejectedCount} rejected · attempt ${item.attemptCount||0}`));head.append(title,node('span','state',item.status));card.append(head);const pct=item.recordCount?Math.round(((item.acceptedCount+item.rejectedCount)/item.recordCount)*100):(item.status==='QUEUED'?5:0),meter=node('div','meter'),bar=node('span');bar.style.width=`${Math.max(pct,item.status==='PROCESSING'?20:0)}%`;meter.append(bar);card.append(meter);if(item.lastError)card.append(node('div','notice error',item.lastError));card.append(button('View receipt',async()=>{try{const value=await call(`/organizations/${encodeURIComponent(org())}/catalog-imports/${encodeURIComponent(item.importId)}`);show('IMPORT RECEIPT',value)}catch(error){show('READ FAILED',error.value||{error:error.message},'error')}}));return card}
  async function loadImports(){if(!state.org)return;try{const value=await call(`/organizations/${encodeURIComponent(state.org)}/catalog-imports`),target=$('imports-list');target.replaceChildren();(value.imports||[]).forEach(item=>target.append(importCard(item)));if(!target.children.length)target.append(node('div','empty','No imports submitted.'))}catch(error){$('imports-list').replaceChildren(node('div','empty error',error.message))}}
  function pollImport(importId){if(state.pollers.has(importId))return;const tick=async()=>{try{const value=await call(`/organizations/${encodeURIComponent(org())}/catalog-imports/${encodeURIComponent(importId)}`);show('IMPORT '+value.status,value);await loadImports();if(['COMPLETED','PARTIAL','REJECTED'].includes(value.status)){clearInterval(state.pollers.get(importId));state.pollers.delete(importId);await loadCatalog()}}catch(error){show('STATUS CHECK FAILED',error.value||{error:error.message},'error')}};tick();state.pollers.set(importId,setInterval(tick,2500))}
  async function loadTeam(){if(!state.org)return;try{const value=await call(`/organizations/${encodeURIComponent(state.org)}/members`),target=$('members-list');target.replaceChildren();(value.members||[]).forEach(member=>{const card=node('div','card');card.append(node('strong','',member.email||member.access_subject),node('div','meta',`${member.role} · ${member.status}`));target.append(card)});(value.invitations||[]).forEach(invite=>{const card=node('div','card');card.append(node('strong','',invite.email),node('div','meta',`${invite.role} · PENDING`),button('Revoke invitation',async()=>{try{show('INVITATION REVOKED',await call(`/organizations/${encodeURIComponent(org())}/invitations/${encodeURIComponent(invite.invitation_id)}/revoke`,{method:'POST'}));await loadTeam()}catch(error){show('REVOKE FAILED',error.value||{error:error.message},'error')}},'danger'));target.append(card)});if(!target.children.length)target.append(node('div','empty','No members or pending invitations.'))}catch(error){$('members-list').replaceChildren(node('div','empty error',error.message))}}
  async function loadCredentials(){if(!state.org)return;try{const value=await call(`/organizations/${encodeURIComponent(state.org)}/api-credentials`),target=$('credentials-list');target.replaceChildren();(value.credentials||[]).forEach(credential=>{const card=node('div','card');card.append(node('strong','',credential.name),node('div','meta',`${credential.role} · ${credential.status} · ${credential.scopes.join(', ')}`),node('div','meta',`Prefix ${credential.keyPrefix}… · last used ${formatTime(credential.lastUsedAtMs)}`));if(credential.status==='ACTIVE')card.append(button('Revoke credential',async()=>{if(!confirm(`Revoke ${credential.name}? Connected systems will stop authenticating.`))return;try{show('CREDENTIAL REVOKED',await call(`/organizations/${encodeURIComponent(org())}/api-credentials/${encodeURIComponent(credential.credentialId)}/revoke`,{method:'POST'}));await loadCredentials()}catch(error){show('REVOKE FAILED',error.value||{error:error.message},'error')}},'danger'));target.append(card)});if(!target.children.length)target.append(node('div','empty','No service credentials.'))}catch(error){$('credentials-list').replaceChildren(node('div','empty error',error.message))}}
  async function refreshWorkspace(){if(!state.org)return;await Promise.all([loadCatalog(),loadImports(),...(state.me?.identityKind==='ACCESS'?[loadTeam(),loadCredentials()]:[])])}
  let accountMode = 'signup';
  function setAccountMode(mode) {
    accountMode = mode;
    const signup = mode === 'signup';
    $('signup-fields').hidden = !signup;
    $('signup-fields').querySelectorAll('input,select').forEach(input => { input.disabled = !signup; });
    $('account-title').textContent = signup ? 'Create your partner account' : 'Welcome back';
    $('account-submit').textContent = signup ? 'Create account' : 'Log in';
    $('account-submit').dataset.label = $('account-submit').textContent;
    $('account-form').action = `${api}/auth/${mode}`;
    $('account-password').autocomplete = signup ? 'new-password' : 'current-password';
    $('account-password').minLength = signup ? 15 : 1;
    $('password-hint').hidden = !signup;
    $('show-signup').setAttribute('aria-pressed', String(signup));
    $('show-login').setAttribute('aria-pressed', String(!signup));
    $('account-message').textContent = '';
  }
  function clearWorkspace() {
    state.pollers.forEach(timer => clearInterval(timer)); state.pollers.clear();
    state.me = null; state.org = ''; state.records = {PRODUCTS:[],BOMS:[],OFFERS:[]};
    $('partner-workspace').hidden = true; $('account-panel').hidden = false; $('logout').hidden = true;
    $('identity').textContent = 'PARTNER ACCOUNT'; $('records').value = '[]'; $('result').textContent = 'No request sent.';
    ['records-list','imports-list','members-list','credentials-list','org-select'].forEach(id => $(id).replaceChildren());
    $('file').value = ''; updateSummary();
  }
  async function loadIdentity() {
    try {
      const value = await call('/me'); state.me = value;
      $('identity').textContent = value.email || value.subject;
      $('account-panel').hidden = true; $('partner-workspace').hidden = false;
      $('logout').hidden = value.identityKind !== 'PARTNER';
      document.querySelectorAll('[data-access-only]').forEach(item => item.hidden = value.identityKind !== 'ACCESS');
      const select = $('org-select'); select.replaceChildren(new Option('Choose a workspace',''));
      (value.organizations || []).forEach(item => select.append(new Option(`${item.name} · ${item.role}`,item.organizationId)));
      if (value.organizations?.length) {
        state.org = value.organizations[0].organizationId; select.value = state.org; await refreshWorkspace();
      }
      show('SIGNED IN', 'Your drafts are saved in your company workspace. Upload a file or download a template to get started.');
      return true;
    } catch (error) {
      clearWorkspace();
      if (error.status !== 401) $('account-message').textContent = 'Account service is unavailable. Please try again shortly.';
      return false;
    }
  }
  $('show-signup').addEventListener('click', () => setAccountMode('signup'));
  $('show-login').addEventListener('click', () => setAccountMode('login'));
  $('account-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('account-submit'); setBusy(button, true, accountMode === 'signup' ? 'Creating account…' : 'Signing in…');
    $('account-message').textContent = '';
    try {
      await call(`/auth/${accountMode}`, { method:'POST', body:JSON.stringify({
        name:$('account-name').value, organizationName:$('company-name').value, kind:$('company-kind').value,
        email:$('account-email').value, password:$('account-password').value,
      }) });
      $('account-password').value = '';
      if (await loadIdentity()) $('org-select').focus();
    } catch (error) { $('account-message').textContent = error.message; }
    finally { setBusy(button, false); }
  });
  $('logout').addEventListener('click', async () => {
    try { await call('/auth/logout', {method:'POST'}); $('account-email').value=state.me?.email||''; clearWorkspace(); setAccountMode('login'); $('account-email').focus(); }
    catch (error) { show('LOGOUT FAILED', error.message, 'error'); }
  });
  $('save-drafts').addEventListener('click', async () => {
    const button = $('save-drafts'); let saved = 0; setBusy(button, true, 'Saving…');
    try {
      const records = parseRecords();
      if (!records.length || records.length > 100) throw new Error('Save 1–100 drafts at a time. Use a bulk import for larger files.');
      const organization = encodeURIComponent(org()), resource = $('resource').value;
      await call(`/organizations/${organization}/catalog-imports/preflight`, {method:'POST', body:JSON.stringify({resource,records})});
      for (const record of records) {
        await call(`/organizations/${organization}/${resource.toLowerCase()}`, {method:'POST',body:JSON.stringify(record)}); saved++;
      }
      show('DRAFTS SAVED', `${saved} draft${saved === 1 ? '' : 's'} saved. You can return to edit them after logging in.`, 'good');
      await loadCatalog();
    } catch (error) { show('SAVE FAILED', `${saved} drafts saved. ${error.message}`, 'error'); if(saved) await loadCatalog(); }
    finally { setBusy(button, false); }
  });
  function parseCsv(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const char=text[i];if(quoted){if(char==='"'&&text[i+1]==='"'){cell+='"';i++}else if(char==='"')quoted=false;else cell+=char}else if(char==='"')quoted=true;else if(char===','){row.push(cell);cell=''}else if(char==='\n'){row.push(cell);rows.push(row);row=[];cell=''}else if(char!=='\r')cell+=char}row.push(cell);if(row.some(value=>value!==''))rows.push(row);if(rows.length<2)throw new Error('CSV requires a header and at least one row');const headers=rows.shift().map(clean);return rows.map(values=>Object.fromEntries(headers.map((header,index)=>{const raw=clean(values[index]);if(!raw)return[header,''];try{return[header,JSON.parse(raw)]}catch{return[header,raw]}})))}
  const templates={PRODUCTS:[{productId:'motor-1',revision:'r1',manufacturerName:'Example OEM',partNumber:'MOTOR-42',name:'Example Motor',category:'MOTOR',compatibilityTags:['voltage:6s'],lifecycle:'ACTIVE',evidenceRefs:['https://example.com/datasheet.pdf']}],BOMS:[{bomId:'airframe-bom-1',revision:'r1',productId:'airframe-1',productRevision:'r1',lines:[{lineId:'motor-line',slot:'motor-fl',quantity:1,manufacturerId:'example-oem',productId:'motor-1',productRevision:'r1',requiredCompatibilityTags:['voltage:6s'],substitutionsAllowed:true}],evidenceRefs:['https://example.com/drawing.pdf']}],OFFERS:[{offerId:'offer-1',supplierId:'example-supplier',productManufacturerId:'example-oem',productId:'motor-1',productRevision:'r1',currency:'USD',unitPriceMinor:1299,availableQuantity:100,leadTimeDays:4,validAtMs:Date.now(),validUntilMs:Date.now()+2592000000,evidenceRefs:['erp:offer-1'],sponsored:false}]};
  document.querySelectorAll('[data-tab]').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(item=>item.setAttribute('aria-selected',String(item===tab)));document.querySelectorAll('[data-panel]').forEach(panel=>panel.hidden=panel.dataset.panel!==tab.dataset.tab)}));
  $('org-select').addEventListener('change',async event=>{state.org=event.target.value;await refreshWorkspace()});
  $('records').addEventListener('input',updateSummary);$('resource').addEventListener('change',()=>{$('records').value=JSON.stringify(templates[$('resource').value],null,2);updateSummary()});
  $('file').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;const text=await file.text(),records=file.name.toLowerCase().endsWith('.csv')?parseCsv(text):JSON.parse(text);if(!Array.isArray(records))throw new Error('File must contain an array of records');$('records').value=JSON.stringify(records,null,2);updateSummary();show('FILE LOADED',{name:file.name,records:records.length,size:file.size})}catch(error){show('FILE REJECTED',{error:error.message},'error')}});
  $('template').addEventListener('click',()=>{const resource=$('resource').value,blob=new Blob([JSON.stringify(templates[resource],null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`forge-${resource.toLowerCase()}-template.json`;link.click();URL.revokeObjectURL(link.href)});
  $('preflight').addEventListener('click',async()=>{const button=$('preflight');setBusy(button,true,'Validating…');try{const records=parseRecords(),value=await call(`/organizations/${encodeURIComponent(org())}/catalog-imports/preflight`,{method:'POST',body:JSON.stringify({resource:$('resource').value,records})});show('PREFLIGHT PASSED',value,'good')}catch(error){show('PREFLIGHT FAILED',error.value||{error:error.message},'error')}finally{setBusy(button,false)}});
  $('upload').addEventListener('click',async()=>{const button=$('upload');setBusy(button,true,'Validating…');try{const records=parseRecords(),payload={resource:$('resource').value,records};await call(`/organizations/${encodeURIComponent(org())}/catalog-imports/preflight`,{method:'POST',body:JSON.stringify(payload)});setBusy(button,true,'Queueing…');const importId=`import-${crypto.randomUUID()}`,value=await call(`/organizations/${encodeURIComponent(org())}/catalog-imports`,{method:'POST',body:JSON.stringify({...payload,importId})});show('IMPORT QUEUED',value,'good');await loadImports();pollImport(importId)}catch(error){show('IMPORT REJECTED',error.value||{error:error.message},'error')}finally{setBusy(button,false)}});
  $('invite').addEventListener('click',async()=>{try{const value=await call(`/organizations/${encodeURIComponent(org())}/invitations`,{method:'POST',body:JSON.stringify({email:$('invite-email').value,role:$('invite-role').value})});show('INVITATION CREATED',value);await loadTeam()}catch(error){show('INVITATION REJECTED',error.value||{error:error.message},'error')}});
  $('credential-role').addEventListener('change',()=>{const viewer=$('credential-role').value==='VIEWER';document.querySelectorAll('input[name=scope]').forEach(input=>{if(viewer&&input.value!=='catalog:read')input.checked=false;input.disabled=viewer&&input.value!=='catalog:read'})});
  $('credential').addEventListener('click',async()=>{try{const scopes=[...document.querySelectorAll('input[name=scope]:checked')].map(input=>input.value),value=await call(`/organizations/${encodeURIComponent(org())}/api-credentials`,{method:'POST',body:JSON.stringify({name:$('credential-name').value,role:$('credential-role').value,scopes})});show('COPY THIS CREDENTIAL NOW',value,'good');await loadCredentials()}catch(error){show('CREDENTIAL REJECTED',error.value||{error:error.message},'error')}});
  $('refresh-all').addEventListener('click',refreshWorkspace);updateSummary();loadIdentity();
