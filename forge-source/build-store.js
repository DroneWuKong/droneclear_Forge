/* Versioned, browser-local component lists. No execution or assembly authority. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.ForgeBuildStore=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const KEY='forge.builds.v1',LEGACY='forge-build';
  const clone=value=>JSON.parse(JSON.stringify(value));
  function items(rows){
    if(!Array.isArray(rows)||rows.length>1000)throw new Error('Build items are invalid or too large.');
    const seen=new Set();return rows.map(row=>{
      if(!row||typeof row.pid!=='string'||!row.pid||row.pid.length>240)throw new Error('A part ID is invalid.');
      const qty=row.qty===undefined?1:row.qty;
      if(!Number.isInteger(qty)||qty<1||qty>999)throw new Error('Quantity must be a whole number from 1 to 999.');
      if(seen.has(row.pid))throw new Error('Duplicate part IDs must use quantities.');seen.add(row.pid);
      return {pid:row.pid,qty,name:typeof row.name==='string'?row.name.slice(0,320):row.pid,cat:typeof row.cat==='string'?row.cat.slice(0,80):''};
    });
  }
  function validate(value){
    if(value?.schema_version!==1)throw new Error('Saved builds use an unsupported version. Existing data was not changed.');
    if(!Array.isArray(value.builds)||!value.builds.length||value.builds.length>50)throw new Error('Saved build collection is invalid.');
    const seen=new Set(),builds=value.builds.map(b=>{
      if(typeof b?.id!=='string'||!b.id||b.id.length>160||seen.has(b.id))throw new Error('Saved build identity is invalid.');seen.add(b.id);
      if(typeof b.name!=='string'||!b.name.trim()||b.name.length>80)throw new Error('Build name must contain 1 to 80 characters.');
      return {id:b.id,name:b.name.trim(),items:items(b.items)};
    });
    if(!seen.has(value.active_id))throw new Error('The selected build is missing.');
    return {schema_version:1,active_id:value.active_id,builds};
  }
  function initial(legacy){
    const rows=legacy===null?[]:JSON.parse(legacy);
    if(!Array.isArray(rows))throw new Error('The previous component list cannot be read. Existing data was not changed.');
    const unique=rows.filter((row,i)=>row&&typeof row.pid==='string'&&rows.findIndex(x=>x?.pid===row.pid)===i);
    return {schema_version:1,active_id:'legacy',builds:[{id:'legacy',name:'My build',items:items(unique)}]};
  }
  function open(storage){
    let token=storage.getItem(KEY),legacy=storage.getItem(LEGACY);
    let document=token===null?initial(legacy):validate(JSON.parse(token));
    return {read:()=>clone(document),save(next){
      if(storage.getItem(KEY)!==token || (token===null && storage.getItem(LEGACY)!==legacy))throw new Error('Builds changed in another tab. Export your edits, then reload before saving.');
      const validated=validate(next),raw=JSON.stringify(validated);
      storage.setItem(KEY,raw); // One write; quota/security errors leave the previous collection intact.
      token=raw;document=validated;return clone(document);
    }};
  }
  const active=document=>document.builds.find(b=>b.id===document.active_id);
  function create(document,name,id){const next=clone(document);next.builds.push({id,name,items:[]});next.active_id=id;return validate(next);}
  function model(build){const relations=Object.create(null);for(const item of build.items)(relations[item.cat||'selected_parts'] ||= []).push({pid:item.pid,quantity:item.qty});return {pid:'saved:'+build.id,name:build.name,relations};}
  return {KEY,LEGACY,items,validate,initial,open,active,create,model};
});
