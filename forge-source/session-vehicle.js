(function(root){
  'use strict';
  const requests={20:{crc:214,length:20,target:2},21:{crc:159,length:2,target:0},117:{crc:128,length:6,target:4},119:{crc:116,length:12,target:10},122:{crc:203,length:2,target:0}};
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function readRequest(id,target,{sequence=0,index=0,logId=0,offset=0,count=11520}={}){
    const def=requests[id];if(!def||!Number.isInteger(target.system_id)||target.system_id<1||target.system_id>255||!Number.isInteger(target.component_id)||target.component_id<1||target.component_id>255)throw Error('Choose a valid connected vehicle.');
    const payload=new Uint8Array(def.length),view=new DataView(payload.buffer);
    if(id===20){if(!Number.isInteger(index)||index<0||index>9999)throw Error('Invalid parameter index.');view.setInt16(0,index,true);}
    if(id===117){view.setUint16(0,0,true);view.setUint16(2,65535,true);}
    if(id===119){if(!Number.isInteger(logId)||logId<0||logId>65535||!Number.isInteger(offset)||offset<0||offset>32*1048576||!Number.isInteger(count)||count<1||count>11520||offset+count>32*1048576)throw Error('Invalid log range.');view.setUint32(0,offset,true);view.setUint32(4,count,true);view.setUint16(8,logId,true);}
    payload[def.target]=target.system_id;payload[def.target+1]=target.component_id;
    const frame=Uint8Array.of(254,payload.length,sequence&255,255,190,id,...payload,0,0),crc=root.ForgeSessionEvidence.x25(Uint8Array.of(def.crc),root.ForgeSessionEvidence.x25(frame.slice(1,-2)));frame[frame.length-2]=crc&255;frame[frame.length-1]=crc>>>8;return frame;
  }
  function parameterValue(row,autopilot){
    const type=row.param_type;if(![1,2,3,4,5,6,9].includes(type))throw Error('Unsupported parameter type '+type+' for '+row.param_id+'.');
    const bytes=Uint8Array.from(row.raw_value),view=new DataView(bytes.buffer);
    const value=autopilot===12&&type!==9?({1:()=>view.getUint8(0),2:()=>view.getInt8(0),3:()=>view.getUint16(0,true),4:()=>view.getInt16(0,true),5:()=>view.getUint32(0,true),6:()=>view.getInt32(0,true)}[type])():view.getFloat32(0,true);
    if(!Number.isFinite(value)||type!==9&&!Number.isInteger(value))throw Error('Invalid parameter value for '+row.param_id+'.');return value;
  }
  class Client{
    constructor(send,progress){this.send=send;this.progress=progress;this.vehicles=new Map();this.logs=[];this.sequence=0;this.operation=null;}
    observe(row){
      if(row.message_id===0&&[3,12].includes(row.fields.autopilot)&&row.fields.vehicle_type!==6&&row.system_id>0&&row.component_id>0){const key=row.system_id+':'+row.component_id;this.vehicles.set(key,{system_id:row.system_id,component_id:row.component_id,autopilot:row.fields.autopilot,armed:row.fields.armed,signed:row.signature_present,last_seen:performance.now()});if(this.vehicles.size>8)this.vehicles.delete(this.vehicles.keys().next().value);}
      const op=this.operation;if(!op||row.system_id!==op.target.system_id||row.component_id!==op.target.component_id)return;
      try{op.receive(row);}catch(error){op.error=error;}
    }
    target(key,logs=false){const target=this.vehicles.get(key);if(!target||performance.now()-target.last_seen>10000)throw Error('Wait for a fresh PX4 or ArduPilot vehicle heartbeat.');if(target.signed)throw Error('This signed link needs an authenticated GCS for evidence downloads. Attach its exports instead.');if(logs&&target.armed)throw Error('Collect onboard logs while the vehicle is disarmed.');return {...target};}
    cancel(){if(this.operation)this.operation.cancelled=true;}
    check(op,logs=false){if(op.cancelled)throw Error('Collection cancelled. No incomplete file was attached.');if(op.error)throw op.error;const live=this.target(op.target.system_id+':'+op.target.component_id,logs);if(live.autopilot!==op.target.autopilot)throw Error('The connected vehicle changed. Start collection again.');}
    async request(id,op,options={}){this.check(op,id>=117);await this.send(readRequest(id,op.target,{...options,sequence:this.sequence++}));}
    async run(key,logs,receive,work){if(this.operation)throw Error('Another evidence collection is in progress.');const op={target:this.target(key,logs),receive,cancelled:false,error:null};this.operation=op;try{return await work(op);}finally{if(logs)try{await this.send(readRequest(122,op.target,{sequence:this.sequence++}));}catch{}this.operation=null;}}
    async parameters(key){
      const values=new Map(),names=new Set();let count=null,last=performance.now(),lastRequest=0,rounds=0;
      return this.run(key,false,row=>{if(row.message_id!==22)return;const f=row.fields;if(f.param_index===32767&&f.param_id==='_HASH_CHECK')return;if(f.param_count<1||f.param_count>10000)throw Error('Parameter count is outside the supported limit.');if(f.param_index>=f.param_count)return;if(count!==null&&count!==f.param_count)throw Error('Parameter count changed during collection. Try again when the configuration is stable.');count=f.param_count;if(!/^[A-Za-z0-9_.:-]{1,16}$/.test(f.param_id))throw Error('Parameter name cannot be exported safely.');if(!values.has(f.param_index)&&names.has(f.param_id))throw Error('Duplicate parameter names were received.');const previous=values.get(f.param_index);if(previous&&(previous.param_id!==f.param_id||previous.param_type!==f.param_type||previous.value!==parameterValue(f,this.operation.target.autopilot)))throw Error('A parameter changed during collection. Retry with a stable configuration.');names.add(f.param_id);values.set(f.param_index,{...f,value:parameterValue(f,this.operation.target.autopilot)});last=performance.now();this.progress('Parameters: '+values.size+' / '+count);},async op=>{
        await this.request(21,op);lastRequest=performance.now();const began=lastRequest;
        while(count===null||values.size<count){this.check(op);const now=performance.now();if(now-began>180000)throw Error('Parameter collection timed out. No partial parameter file was attached.');if(now-last>1200&&now-lastRequest>1500){if(++rounds>8)throw Error('Some parameters did not arrive. Check that the connection returns requests, then retry or attach a GCS export.');if(count===null)await this.request(21,op);else{const missing=[];for(let i=0;i<count&&missing.length<20;i++)if(!values.has(i))missing.push(i);for(const index of missing){await this.request(20,op,{index});await delay(60);}}lastRequest=performance.now();}await delay(100);}
        this.check(op);const collected_at=new Date().toISOString(),header='# Forge vehicle parameter snapshot\n# '+collected_at+'; '+(op.target.autopilot===12?'PX4 bytewise':'ArduPilot C-cast')+' MAVLink parameter encoding\n# system component name value type\n',text=header+[...values].sort((a,b)=>a[0]-b[0]).map(([,f])=>[op.target.system_id,op.target.component_id,f.param_id,String(f.value),f.param_type].join('\t')).join('\n')+'\n';return {name:'vehicle-'+op.target.system_id+'-parameters.params',bytes:new TextEncoder().encode(text),mime:'text/plain',role:'configuration',collected_at,target:op.target,count:values.size};
      });
    }
    async listLogs(key){
      const entries=new Map();let count=null,last=performance.now(),lastRequest=0,rounds=0;
      return this.run(key,true,row=>{if(row.message_id!==118)return;const f=row.fields;if(f.num_logs>2000)throw Error('The vehicle has more than 2,000 logs. Use the GCS to choose a subset.');if(count!==null&&count!==f.num_logs)throw Error('The log list changed during collection. Refresh it while disarmed.');count=f.num_logs;if(count===0)return;entries.set(f.id,{...f});last=performance.now();this.progress('Log list: '+entries.size+' / '+count);},async op=>{
        await this.request(117,op);lastRequest=performance.now();const began=lastRequest;
        while(count===null||entries.size<count){this.check(op,true);if(performance.now()-began>30000)throw Error('Log listing timed out. Check bidirectional MAVLink support or use the GCS to export logs.');if(performance.now()-last>1500&&performance.now()-lastRequest>2000){if(++rounds>4)throw Error('The complete log list did not arrive. Try again or attach a GCS export.');await this.request(117,op);lastRequest=performance.now();}await delay(100);}
        this.check(op,true);this.logs=[...entries.values()].sort((a,b)=>b.id-a.id);this.logTarget=key;return this.logs;
      });
    }
    async log(key,id){
      const entry=this.logTarget===key&&this.logs.find(row=>row.id===id);if(!entry)throw Error('Refresh the log list for this vehicle first.');if(!entry.size||entry.size>32*1048576)throw Error('Choose a nonempty log up to 32 MiB, or attach a GCS/SD-card export.');
      const bytes=new Uint8Array(entry.size),seen=new Uint8Array(Math.ceil(entry.size/90));let received=0,last=performance.now();
      return this.run(key,true,row=>{if(row.message_id!==120||row.fields.id!==id)return;const f=row.fields;if(f.ofs%90||f.ofs>=bytes.length||f.count!==Math.min(90,bytes.length-f.ofs))return;const index=f.ofs/90,data=Uint8Array.from(f.data.slice(0,f.count));if(seen[index]){if(data.some((value,i)=>bytes[f.ofs+i]!==value))throw Error('The log changed during collection. Refresh the list and choose a completed log.');return;}bytes.set(data,f.ofs);seen[index]=1;received+=f.count;last=performance.now();this.progress('Log '+id+': '+Math.floor(received/bytes.length*100)+'% · '+received+' / '+bytes.length+' bytes');},async op=>{
        const began=performance.now();let lastRequest=0,requested=-1,windowEnd=0,retries=0;
        while(received<bytes.length){this.check(op,true);const now=performance.now();if(now-began>300000)throw Error('Log collection timed out. No incomplete log was attached.');const missing=seen.indexOf(0)*90;if(requested<0||missing>=windowEnd||now-last>1200&&now-lastRequest>1500){if(missing!==requested)retries=0;else if(++retries>5)throw Error('Log data stopped arriving. Retry on a stronger connection or attach a GCS export.');const count=Math.min(11520,bytes.length-missing);await this.request(119,op,{logId:id,offset:missing,count});requested=missing;windowEnd=missing+count;lastRequest=performance.now();}await delay(100);}
        this.check(op,true);const px4=op.target.autopilot===12;return {name:'vehicle-'+op.target.system_id+'-log-'+id+(px4?'.ulg':'.bin'),bytes,mime:'application/octet-stream',role:'log',collected_at:new Date().toISOString(),target:op.target,log_id:id,log_time_utc:entry.time_utc};
      });
    }
  }
  root.ForgeSessionVehicle={Client,readRequest,parameterValue,requests};if(typeof module==='object'&&module.exports)module.exports=root.ForgeSessionVehicle;
})(globalThis);
