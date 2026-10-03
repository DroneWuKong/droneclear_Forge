(async function(){
  const input=document.getElementById('tool-search'), area=document.getElementById('tool-area');
  const output=document.getElementById('tool-results'), status=document.getElementById('tool-count');
  const params=new URLSearchParams(location.search);input.value=params.get('q')||'';
  if([...area.options].some(option=>option.value===params.get('area')))area.value=params.get('area');
  document.querySelector('.directory-form').addEventListener('submit',event=>event.preventDefault());
  try{
    const response=await fetch('/static/site-directory.json');if(!response.ok)throw new Error('unavailable');
    const entries=await response.json();
    function render(){
      const terms=input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const matches=entries.filter(row=>(!area.value||row.area===area.value)&&terms.every(term=>[row.title,row.description,row.area,row.url].join(' ').toLowerCase().includes(term)));
      output.replaceChildren();status.textContent=matches.length?matches.length+' tools and pages':'No tools match. Try fewer words or choose all areas.';
      for(const name of ['Research','Build','Learn','Help']){
        const rows=matches.filter(row=>row.area===name);if(!rows.length)continue;
        const section=document.createElement('details');section.open=Boolean(terms.length||area.value);const heading=document.createElement('summary');heading.textContent=name+' · '+rows.length;section.append(heading);
        const list=document.createElement('ul');list.className='tool-list';
        for(const row of rows){const li=document.createElement('li'),link=document.createElement('a');link.href=row.url;link.textContent=row.title;if(row.description){const p=document.createElement('p');p.textContent=row.description;link.append(p);}li.append(link);list.append(li);}section.append(list);output.append(section);
      }
      const url=new URL(location.href);input.value?url.searchParams.set('q',input.value):url.searchParams.delete('q');area.value?url.searchParams.set('area',area.value):url.searchParams.delete('area');history.replaceState(null,'',url);
    }
    input.addEventListener('input',render);area.addEventListener('change',render);render();
  }catch{status.textContent='The directory could not load. Reload to try again, or use the menu to open Research, Build, or Learn.';}
})();
