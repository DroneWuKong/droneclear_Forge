/* Read-only saved-list context for tools with independent input models. */
(function(){
  const mount=document.querySelector('[data-build-context]');if(!mount)return;
  try{
    const collection=ForgeBuildStore.open(localStorage).read(),build=ForgeBuildStore.active(collection);
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Build reference: '+build.name+' · '+build.items.length+' part types';details.append(summary);
    const note=document.createElement('p');note.textContent='This tool uses its own inputs. The saved component list below is a reference; it does not fill in or change this tool’s settings.';details.append(note);
    const list=document.createElement('ul');for(const item of build.items){const li=document.createElement('li');li.textContent=(item.name||item.pid)+' × '+item.qty;list.append(li);}details.append(list);
    const link=document.createElement('a');link.href='/builder/?view=build&build='+encodeURIComponent(build.id);link.textContent='Return to this build';details.append(link);mount.append(details);
  }catch{const link=document.createElement('a');link.href='/builder/';link.textContent='Open My builds to check saved data';mount.append(link);}
})();
