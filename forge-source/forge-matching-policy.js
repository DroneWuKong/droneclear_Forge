// Ask the bounded display adapter after eligibility and incumbent sorting.
export function matchingFeatures(comp, warningCount) {
  const weight=Number(comp.schema_data?.weight_g),specs=Object.values(comp.schema_data||{});
  return {weight_known:Number.isFinite(weight)&&weight>0,
    weight_g:Number.isFinite(weight)&&weight>0?Math.min(weight,100000):0,
    warning_count:warningCount,
    specification_completeness:specs.length?specs.filter(v=>v!=null&&v!=='').length/specs.length:0};
}

export function verifyMatchingOrder(items, order) {
  if(!Array.isArray(order)||order.length!==items.length||new Set(order).size!==items.length) return false;
  const rows=new Map(items.map(row=>[row.id,row]));
  if(order.some(id=>!rows.has(id)))return false;
  // Each position must retain its fixed eligibility/warning stratum. The
  // incompatible group must retain its exact order too.
  return order.every((id,index)=>{
    const before=items[index],after=rows.get(id);
    return before.group===after.group && before.features.warning_count===after.features.warning_count
      && (before.group!=='incompatible'||before.id===id);
  });
}

export async function applyMatchingPolicy(groups, snapshot) {
  const entries=groups.flatMap(([group,rows])=>rows.map(row=>({group,row})));
  const incumbent='compatibility-weight-v1';
  const fallback={policy_version:incumbent,mode:'incumbent',applied:false};
  entries.forEach((entry,index)=>{entry.row.incumbentPosition=index+1;});
  if(entries.length<1||entries.length>100||!crypto.randomUUID)return fallback;
  const items=entries.map(({group,row},id)=>({id,group,features:matchingFeatures(row.comp,row.warningCount)}));
  try {
    const response=await fetch('/api/autonomy/forge-policy/resolve',{method:'POST',
      headers:{'content-type':'application/json'},signal:AbortSignal.timeout(2000),
      body:JSON.stringify({request_id:crypto.randomUUID(),context_sha256:snapshot.context_sha256,
        catalog_revision:snapshot.catalog_revision,items})});
    if(!response.ok)return fallback;
    const result=await response.json();
    if(result.mode!=='active')return fallback;
    if(!/^candidate-[0-9a-f]{16}$/.test(result.policy_version||'')||result.fallback!==false
      ||!verifyMatchingOrder(items,result.order))return fallback;
    const sorted=result.order.map(id=>entries[id]);
    for(const [group,rows] of groups)rows.splice(0,rows.length,...sorted.filter(entry=>entry.group===group).map(entry=>entry.row));
    return {policy_version:result.policy_version,mode:'active',applied:true};
  } catch {return fallback;}
}
