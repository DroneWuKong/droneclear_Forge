// Read only aggregate page-view counters from the retired analytics backend.
const {getStore} = require('@netlify/blobs');
const token = process.env.NETLIFY_API_TOKEN;
const configuredSite = process.env.ANALYTICS_SITE_ID;
async function main() {
  if (!token) return {error:'Existing Netlify credential is unavailable'};
  const response = await fetch('https://api.netlify.com/api/v1/sites?per_page=100', {
    headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)});
  if (!response.ok) return {http_status:response.status};
  const sites = await response.json();
  const targets = sites.filter(s=>s.id===configuredSite || s.name==='thebluefairy' ||
    ['uas-forge.com','uas-patterns.com','uas-handbook.com','uasdash.com'].some(d=>
      s.custom_domain===d || (s.domain_aliases||[]).includes(d)));
  const reports = [];
  for (const site of targets) {
    const report={site_name:site.name,custom_domain:site.custom_domain,created_at:site.created_at,days:[]};
    reports.push(report);
    try {
      const store=getStore('analytics-events',{siteID:site.id,token});
      const listing=await store.list({prefix:'daily_'});
      const keys=listing.blobs.map(b=>b.key).filter(k=>/^daily_\d{4}-\d{2}-\d{2}$/.test(k));
      report.daily_keys=keys.length;
      for (let i=0;i<keys.length;i+=6) {
        const batch=await Promise.all(keys.slice(i,i+6).map(async key=>{
          try {
            const day=await store.get(key,{type:'json'});
            if(!day) return {date:key.slice(6),read_error:'Missing blob'};
            const out={date:day.date||key.slice(6)};
            for(const surface of ['forge','handbook','pie']) {
              if(day[surface]) out[surface]={views:day[surface].views||0};
            }
            return out;
          } catch(e) {return {date:key.slice(6),read_error:e.name};}
        }));
        report.days.push(...batch);
      }
    } catch(e) {report.error_type=e.name;report.http_status=e.statusCode||e.status||null;}
  }
  return {matched_sites:reports};
}
main().then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>{
  process.stdout.write(JSON.stringify({error_type:e.name}));
});
