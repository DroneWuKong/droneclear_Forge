(function(root){
  'use strict';
  const MAX_INPUTS=8;
  function fitGrid(container){
    if(!container.getClientRects().length)return;
    const count=[...container.children].filter(card=>!card.hidden).length;if(!count)return;
    const columns=getComputedStyle(container).gridTemplateColumns.split(' ').length,rows=Math.ceil(count/columns),available=Math.max(280,innerHeight-container.getBoundingClientRect().top-24);
    container.style.setProperty('--preview-height',Math.max(96,Math.min(480,available/rows-96)).toFixed(0)+'px');
  }
  class CaptureInputs{
    constructor(onEnded){this.inputs=new Map();this.onEnded=onEnded;this.locked=true;this.focus='';this.container=document.getElementById('capture-previews');this.select=document.getElementById('preview-view');this.cameraSelect=document.getElementById('camera-device');new ResizeObserver(()=>fitGrid(this.container)).observe(this.container);this.select.onchange=()=>{this.focus=this.select.value;this.applyFocus();};}
    get active(){return [...this.inputs.values()].filter(input=>input.stream.getVideoTracks().some(track=>track.readyState==='live'));}
    setLocked(locked){this.locked=locked;for(const input of this.inputs.values()){input.nameInput.disabled=locked;input.remove.disabled=locked;}this.cameraSelect.disabled=locked;document.getElementById('include-mic').disabled=locked;}
    async refreshCameras(){
      if(!navigator.mediaDevices?.enumerateDevices)return;
      const devices=(await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==='videoinput'),selected=this.cameraSelect.value;
      this.cameraSelect.replaceChildren(new Option('Default camera',''));
      for(const [index,device]of devices.entries())if(device.deviceId)this.cameraSelect.add(new Option(device.label||'Camera '+(index+1)+' (name available after permission)',device.deviceId));
      if([...this.cameraSelect.options].some(option=>option.value===selected))this.cameraSelect.value=selected;
      return devices;
    }
    async add(kind,surface='window'){
      if(this.inputs.size>=MAX_INPUTS)throw Error('Eight video inputs are already selected. Remove one before adding another.');
      if(!isSecureContext)throw Error('Capture requires HTTPS or localhost. Use the downloaded local app.');
      if(!navigator.mediaDevices)throw Error('Media capture is unavailable in this browser.');
      const selected=this.cameraSelect.value;
      if(kind==='camera'&&selected&&this.active.some(input=>input.kind==='camera'&&input.deviceId===selected))throw Error('That camera is already selected. Choose another camera.');
      const narration=kind==='camera'&&document.getElementById('include-mic').checked&&!this.active.some(input=>input.stream.getAudioTracks().some(track=>track.readyState==='live'));
      // Call the display picker directly from the user's click, once per source.
      const stream=kind==='screen'?await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:surface,frameRate:{ideal:15}},audio:false}):await navigator.mediaDevices.getUserMedia({video:selected?{deviceId:{exact:selected}}:true,audio:narration});
      let retained=false;
      try{
        const track=stream.getVideoTracks()[0];if(!track||track.readyState!=='live')throw Error('No live video input was returned.');
        const deviceId=track.getSettings().deviceId||selected;
        if(kind==='camera'&&deviceId&&this.active.some(input=>input.kind==='camera'&&input.deviceId===deviceId))throw Error('That camera is already selected. Choose another camera.');
        const input={id:kind+'-'+crypto.randomUUID(),kind,stream,deviceId,label:(track.label||(kind==='screen'?'Screen or window':'Camera')).slice(0,200),state:'Ready'};
        this.inputs.set(input.id,input);retained=true;this.mount(input);
        for(const mediaTrack of stream.getTracks())mediaTrack.addEventListener('ended',()=>{input.state=mediaTrack.kind==='video'?'Video input ended':'Microphone input ended';input.status.textContent=input.state;this.updateCounts();this.onEnded(input,mediaTrack.kind);});
        this.updateCounts();this.setLocked(this.locked);
        if(kind==='camera'){try{const devices=await this.refreshCameras();const next=devices?.find(device=>device.deviceId&&!this.active.some(row=>row.kind==='camera'&&row.deviceId===device.deviceId));if(next)this.cameraSelect.value=next.deviceId;}catch{}}
        return input;
      }finally{if(!retained)for(const track of stream.getTracks())track.stop();}
    }
    mount(input){
      const card=document.createElement('div');card.className='rec-input-card';card.dataset.inputId=input.id;
      const name=document.createElement('label');name.className='rec-input-name';name.append(document.createTextNode('Input name'));
      const field=document.createElement('input');field.value=input.label;field.maxLength=200;field.oninput=()=>{input.label=(field.value.trim()||'Unnamed input').slice(0,200);this.updateViews();};name.append(field);
      const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.srcObject=input.stream;
      if(!this.container.querySelector('#'+input.kind+'-preview'))video.id=input.kind+'-preview';
      const bottom=document.createElement('div');bottom.className='rec-input-actions';const state=document.createElement('p');state.className='rec-meta';state.textContent=input.state;
      const focus=document.createElement('button');focus.type='button';focus.className='action secondary';focus.textContent='Focus';focus.onclick=()=>{this.focus=this.focus===input.id?'':input.id;this.updateViews();};
      const remove=document.createElement('button');remove.type='button';remove.className='action secondary';remove.textContent='Remove';remove.onclick=()=>{if(this.locked)return;for(const track of input.stream.getTracks())track.stop();card.remove();this.inputs.delete(input.id);if(this.focus===input.id)this.focus='';this.updateCounts();};
      bottom.append(state,focus,remove);card.append(name,video,bottom);this.container.append(card);Object.assign(input,{card,video,nameInput:field,remove,status:state});
    }
    updateViews(){
      if(this.focus&&!this.inputs.has(this.focus))this.focus='';this.select.replaceChildren(new Option('All selected inputs',''));for(const input of this.inputs.values())this.select.add(new Option(input.label,input.id));this.select.value=this.focus;this.select.disabled=!this.inputs.size;this.applyFocus();
    }
    applyFocus(){for(const input of this.inputs.values())input.card.hidden=Boolean(this.focus&&input.id!==this.focus);this.container.classList.toggle('rec-focused',Boolean(this.focus));requestAnimationFrame(()=>fitGrid(this.container));}
    updateCounts(){
      for(const kind of ['screen','camera']){const count=this.active.filter(input=>input.kind===kind).length;document.getElementById(kind+'-status').textContent=count?count+' '+(kind==='screen'?'screen / window':'camera')+(count===1?'':'s')+' selected':'Not selected';}
      this.select.closest('.rec-preview-controls').hidden=this.inputs.size<2;document.getElementById('capture-empty').hidden=Boolean(this.inputs.size);document.getElementById('input-count').textContent=this.active.length+' / '+MAX_INPUTS+' video inputs selected';this.updateViews();
    }
    stopAll(){for(const input of this.inputs.values())for(const track of input.stream.getTracks())track.stop();this.inputs.clear();this.container.replaceChildren();this.focus='';this.updateCounts();}
  }
  root.ForgeSessionMedia={CaptureInputs,MAX_INPUTS,fitGrid};
})(globalThis);
