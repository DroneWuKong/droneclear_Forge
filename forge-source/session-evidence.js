(function(root){
  'use strict';
  const LIMIT=256*1024*1024, enc=new TextEncoder(), dec=new TextDecoder('utf-8',{fatal:true});
  // Common MAVLink wire layouts reviewed 2026-10-07; CRC is not authentication.
  const definitions={0:['HEARTBEAT',50,9],1:['SYS_STATUS',124,31],2:['SYSTEM_TIME',137,12],24:['GPS_RAW_INT',24,30],30:['ATTITUDE',39,28],33:['GLOBAL_POSITION_INT',104,28],74:['VFR_HUD',20,20],109:['RADIO_STATUS',185,9],147:['BATTERY_STATUS',154,36],253:['STATUSTEXT',83,51]};
  function x25(bytes,seed=65535){let c=seed;for(const b of bytes){let t=b^(c&255);t^=(t<<4)&255;c=((c>>>8)^(t<<8)^(t<<3)^(t>>>4))&65535;}return c;}
  function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
  function concat(parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;}
  function decode(id,payload){
    const bytes=new Uint8Array(Math.max(definitions[id][2],payload.length));bytes.set(payload);const d=new DataView(bytes.buffer);
    const u8=o=>d.getUint8(o),i8=o=>d.getInt8(o),u16=o=>d.getUint16(o,true),i16=o=>d.getInt16(o,true),u32=o=>d.getUint32(o,true),i32=o=>d.getInt32(o,true),f=o=>{const n=d.getFloat32(o,true);return Number.isFinite(n)?n:null;};
    if(id===0)return {custom_mode:u32(0),vehicle_type:u8(4),autopilot:u8(5),base_mode:u8(6),system_status:u8(7),mavlink_version:u8(8),armed:Boolean(u8(6)&128)};
    if(id===1)return {sensors_present:u32(0),sensors_enabled:u32(4),sensors_health:u32(8),load_percent:u16(12)/10,battery_voltage_v:u16(14)===65535?null:u16(14)/1000,battery_current_a:i16(16)===-1?null:i16(16)/100,battery_remaining_percent:i8(30)===-1?null:i8(30)};
    if(id===2)return {time_unix_usec:d.getBigUint64(0,true).toString(),time_boot_ms:u32(8)};
    if(id===24)return {time_usec:d.getBigUint64(0,true).toString(),latitude_deg:i32(8)/1e7,longitude_deg:i32(12)/1e7,altitude_msl_m:i32(16)/1000,fix_type:u8(28),satellites_visible:u8(29)===255?null:u8(29)};
    if(id===30)return {time_boot_ms:u32(0),roll_rad:f(4),pitch_rad:f(8),yaw_rad:f(12),rollspeed_rad_s:f(16),pitchspeed_rad_s:f(20),yawspeed_rad_s:f(24)};
    if(id===33)return {time_boot_ms:u32(0),latitude_deg:i32(4)/1e7,longitude_deg:i32(8)/1e7,altitude_msl_m:i32(12)/1000,relative_altitude_m:i32(16)/1000,vx_m_s:i16(20)/100,vy_m_s:i16(22)/100,vz_down_m_s:i16(24)/100,heading_deg:u16(26)===65535?null:u16(26)/100};
    if(id===74)return {airspeed_m_s:f(0),groundspeed_m_s:f(4),altitude_msl_m:f(8),climb_m_s:f(12),heading_deg:i16(16),throttle_percent:u16(18)};
    if(id===109)return {rxerrors:u16(0),corrected_packets:u16(2),rssi_device_units:u8(4)===255?null:u8(4),remote_rssi_device_units:u8(5)===255?null:u8(5),tx_buffer_percent:u8(6)};
    if(id===147)return {battery_id:u8(32),temperature_c:i16(8)===32767?null:i16(8)/100,cell_voltages_v:Array.from({length:10},(_,i)=>u16(10+i*2)===65535?null:u16(10+i*2)/1000),current_a:i16(30)===-1?null:i16(30)/100,remaining_percent:i8(35)===-1?null:i8(35)};
    if(id===253){const part=bytes.slice(1,51),end=part.indexOf(0);return {severity:u8(0),text:new TextDecoder().decode(end<0?part:part.slice(0,end)),text_id:bytes.length>=53?u16(51):0,chunk_sequence:bytes.length>=54?u8(53):0};}
    return {};
  }
  class MavlinkParser{
    constructor(){this.buffer=new Uint8Array();this.offset=0;this.frames=[];this.stats={decoded:0,crc_errors:0,unsupported:0,discarded_bytes:0,signed_frames:0};}
    feed(chunk,at_ms){
      if(!(chunk instanceof Uint8Array)||chunk.length>65536||!Number.isFinite(at_ms)||at_ms<0)throw Error('Invalid telemetry chunk or time.');
      this.buffer=concat([this.buffer,chunk]);this.frames=[];const rows=[];
      while(this.buffer.length){
        const v2=this.buffer[0]===253,v1=this.buffer[0]===254;
        if(!v1&&!v2){this.drop(1);this.stats.discarded_bytes++;continue;}
        const header=v2?10:6;if(this.buffer.length<header)break;
        const length=this.buffer[1],signed=v2&&Boolean(this.buffer[2]&1),total=header+length+2+(signed?13:0);
        if(this.buffer.length<total)break;
        const id=v2?(this.buffer[7]|this.buffer[8]<<8|this.buffer[9]<<16):this.buffer[5],def=definitions[id];
        if(v2&&(this.buffer[2]&254)){this.stats.unsupported++;this.drop(total);continue;}
        if(!def){this.stats.unsupported++;this.frames.push({bytes:this.buffer.slice(0,total),at_ms});this.drop(total);continue;}
        const payload=this.buffer.slice(header,header+length),expected=this.buffer[header+length]|this.buffer[header+length+1]<<8;
        const actual=x25(Uint8Array.of(def[1]),x25(this.buffer.slice(1,header+length)));
        if(actual!==expected||(!v2&&length!==def[2])){this.stats.crc_errors++;this.drop(1);continue;}
        const row={at_ms:Math.round(at_ms),offset:this.offset,length:total,message_id:id,message:def[0],system_id:this.buffer[v2?5:3],component_id:this.buffer[v2?6:4],sequence:this.buffer[v2?4:2],wire_version:v2?2:1,crc_checked:true,signature_present:signed,signature_verified:false,fields:decode(id,payload)};
        rows.push(row);this.frames.push({bytes:this.buffer.slice(0,total),at_ms});this.stats.decoded++;if(signed)this.stats.signed_frames++;this.drop(total);
      }
      return rows;
    }
    drop(n){this.buffer=this.buffer.slice(n);this.offset+=n;}
    finish(){return {...this.stats,trailing_bytes:this.buffer.length};}
  }
  function describe(row){
    if(row.kind==='note')return row.text;
    if(row.kind==='source')return row.text;
    const f=row.fields||{},prefix=`System ${row.system_id}, component ${row.component_id}: `;
    if(row.message_id===0)return prefix+(f.vehicle_type===6||f.autopilot===8?'controller heartbeat received.':`reports ${f.armed?'armed':'disarmed'} state.`);
    if(row.message_id===1)return prefix+(f.battery_remaining_percent===null?'battery estimate unavailable.':`reports ${f.battery_remaining_percent}% battery remaining.`);
    if(row.message_id===24)return prefix+`GPS reports fix type ${f.fix_type}, ${f.satellites_visible===null?'unknown':f.satellites_visible} satellites. This is a reported observation.`;
    if(row.message_id===253)return prefix+`status message${f.chunk_sequence?' (continuation)':''}: ${f.text}`;
    if(row.message_id===147)return prefix+`battery ${f.battery_id}: ${f.remaining_percent===null?'remaining charge unavailable':f.remaining_percent+'% remaining'}.`;
    return prefix+`${row.message} received.`;
  }
  async function sha256(bytes){return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');}
  const allowed=new Set(['screen.webm','screen.mp4','camera.webm','camera.mp4','telemetry.mavlink','telemetry.tlog','telemetry-receipts.jsonl','session.json','timeline.json','summary.txt','report.md','report.json']);
  function allowedName(name){return typeof name==='string'&&(allowed.has(name)||/^originals\/[a-z0-9-]{8,80}\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,160}$/.test(name)&&!name.includes('..'));}
  function tlog(frames,started_at){const base=BigInt(Date.parse(started_at))*1000n;return concat(frames.map(frame=>{const timestamp=new Uint8Array(8);const usec=frame.receipt_unix_ns?BigInt(frame.receipt_unix_ns)/1000n:base+BigInt(Math.round(frame.at_ms*1000));if(usec<0n||usec>18446744073709551615n)throw Error('Invalid telemetry receipt time.');new DataView(timestamp.buffer).setBigUint64(0,usec,false);return concat([timestamp,frame.bytes]);}));}
  function zip(entries){
    if(entries.length>96)throw Error('Too many bundle files.');const names=new Set(),local=[],central=[];let offset=0;
    for(const {name,bytes} of entries){
      if(!allowedName(name)||names.has(name)||!(bytes instanceof Uint8Array))throw Error('Invalid bundle entry.');names.add(name);
      const filename=enc.encode(name),crc=crc32(bytes),head=new Uint8Array(30),h=new DataView(head.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,crc,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,filename.length,true);
      local.push(head,filename,bytes);const c=new Uint8Array(46),v=new DataView(c.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint32(16,crc,true);v.setUint32(20,bytes.length,true);v.setUint32(24,bytes.length,true);v.setUint16(28,filename.length,true);v.setUint32(42,offset,true);central.push(c,filename);offset+=head.length+filename.length+bytes.length;
      if(offset>LIMIT)throw Error('Session exceeds the 256 MiB bundle limit.');
    }
    const cd=concat(central),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,cd.length,true);v.setUint32(16,offset,true);
    if(offset+cd.length+22>LIMIT)throw Error('Bundle exceeds 256 MiB.');return concat([...local,cd,end]);
  }
  function unzip(bytes){
    if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>LIMIT)throw Error('Invalid or oversized bundle.');
    const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=bytes.length-22;
    if(d.getUint32(end,true)!==0x06054b50||d.getUint16(end+20,true)!==0||d.getUint16(end+4,true)||d.getUint16(end+6,true))throw Error('Use an unmodified Forge session ZIP.');
    const count=d.getUint16(end+10,true),size=d.getUint32(end+12,true),start=d.getUint32(end+16,true);
    if(!count||count>96||count!==d.getUint16(end+8,true)||start+size!==end)throw Error('Invalid bundle directory.');
    let p=start,expectedOffset=0;const files=new Map();
    for(let i=0;i<count;i++){
      if(p+46>end||d.getUint32(p,true)!==0x02014b50)throw Error('Invalid bundle directory entry.');
      const flags=d.getUint16(p+8,true),method=d.getUint16(p+10,true),compressed=d.getUint32(p+20,true),length=d.getUint32(p+24,true),n=d.getUint16(p+28,true),extra=d.getUint16(p+30,true),comment=d.getUint16(p+32,true),offset=d.getUint32(p+42,true);
      if(flags!==0x800||method||compressed!==length||offset!==expectedOffset||p+46+n+extra+comment>end)throw Error('Unsupported or inconsistent ZIP entry.');
      const name=dec.decode(bytes.slice(p+46,p+46+n));
      if(!allowedName(name)||files.has(name)||offset+30>start||d.getUint32(offset,true)!==0x04034b50||d.getUint16(offset+6,true)!==flags||d.getUint16(offset+8,true)!==method||d.getUint32(offset+18,true)!==length||d.getUint32(offset+22,true)!==length||d.getUint16(offset+26,true)!==n||d.getUint16(offset+28,true))throw Error('Invalid bundle filename or local header.');
      const begin=offset+30+n;if(begin+length>start||dec.decode(bytes.slice(offset+30,begin))!==name)throw Error('Invalid bundle file bounds.');
      const content=bytes.slice(begin,begin+length),crc=crc32(content);if(crc!==d.getUint32(p+16,true)||crc!==d.getUint32(offset+14,true))throw Error('Bundle file checksum differs.');
      files.set(name,content);expectedOffset=begin+length;p+=46+n+extra+comment;
    }
    if(p!==end||expectedOffset!==start)throw Error('Unexpected bundle bytes.');return files;
  }
  function validateSession(s,rows){
    if(!s||s.tool!=='forge-uas-session'||s.schema_version!==1||s.certification!==false||s.program_acceptance!==false||s.clock_basis!=='browser_receipt_monotonic'||!['finished','interrupted'].includes(s.state)||!/^[-a-zA-Z0-9]{8,80}$/.test(s.id||'')||!Number.isFinite(Date.parse(s.started_at))||!Number.isFinite(s.duration_ms)||s.duration_ms<0||s.duration_ms>7200000)throw Error('Invalid session identity, timing or scope.');
    for(const key of ['title','aircraft','firmware','build_reference'])if(typeof s[key]!=='string'||s[key].length>200)throw Error('Invalid session details.');
    for(const key of ['expected','actual','steps','conditions','outcome_reason'])if(s[key]!==undefined&&(typeof s[key]!=='string'||s[key].length>10000))throw Error('Invalid report text.');
    for(const key of ['support_id','app_version'])if(s[key]!==undefined&&(typeof s[key]!=='string'||s[key].length>200))throw Error('Invalid report details.');
    if(!['generic','px4','ardupilot','betaflight'].includes(s.stack)||!['software','sitl','sih_hil','bench','flight'].includes(s.test_mode)||!['not_run','pass','fail','blocked','skipped','inconclusive'].includes(s.test_outcome))throw Error('Invalid test context.');
    if(!Array.isArray(s.files)||s.files.length>80||!Array.isArray(rows)||rows.length>50000)throw Error('Invalid session file list or timeline.');
    if(enc.encode(JSON.stringify(rows)).length>16*1048576)throw Error('Timeline exceeds the 16 MiB import limit.');
    const seen=new Set();for(const f of s.files){if(!f||!allowedName(f.name)||['session.json','timeline.json','summary.txt'].includes(f.name)||seen.has(f.name)||!Number.isInteger(f.size)||f.size<0||f.size>LIMIT||!/^[a-f0-9]{64}$/.test(f.sha256||'')||!Number.isFinite(f.start_ms)||f.start_ms<0||!Number.isFinite(f.duration_ms)||f.duration_ms<0||f.start_ms+f.duration_ms>s.duration_ms+2000||typeof f.original_name!=='string'||f.original_name.length>512||typeof f.mime_type!=='string'||f.mime_type.length>200||!['screen','camera','telemetry','log','configuration','video','test_report','attachment','report'].includes(f.role))throw Error('Invalid evidence file.');if(f.alignment_offset_ms!==undefined&&(!Number.isFinite(f.alignment_offset_ms)||Math.abs(f.alignment_offset_ms)>7200000||!Number.isFinite(f.alignment_scale)||f.alignment_scale<0.5||f.alignment_scale>2||f.alignment_method!=='manual'||f.alignment_uncertainty_ms!==null))throw Error('Invalid manual media alignment.');seen.add(f.name);}
    if(s.test_reports!==undefined&&(!Array.isArray(s.test_reports)||s.test_reports.length>70||s.test_reports.some(r=>!r||!['general','gauntlet','dow'].includes(r.profile)||r.claims_verified!==false||!seen.has(r.file)||typeof r.profile_version!=='string'||r.profile_version.length>80||!/^[a-f0-9]{64}$/.test(r.catalog_sha256||'')||!r.counts||typeof r.counts!=='object'||Array.isArray(r.counts)||Object.entries(r.counts).some(([key,n])=>!['pass','fail','blocked','not_run','review_required','external_required'].includes(key)||!Number.isInteger(n)||n<0||n>1000))))throw Error('Invalid Test Lab attachment summary.');
    let previous=-1;for(const r of rows){if(!r||!Number.isFinite(r.at_ms)||r.at_ms<previous||r.at_ms<0||r.at_ms>s.duration_ms+2000)throw Error('Invalid timeline time.');previous=r.at_ms;
      if(r.kind==='note'||r.kind==='source'){if(typeof r.text!=='string'||r.text.length>2000)throw Error('Invalid session note.');}
      else if(r.kind==='mavlink'){if(!Object.hasOwn(definitions,r.message_id)||r.message!==definitions[r.message_id][0]||!Number.isInteger(r.system_id)||r.system_id<0||r.system_id>255||!Number.isInteger(r.component_id)||r.component_id<0||r.component_id>255||!Number.isInteger(r.sequence)||r.sequence<0||r.sequence>255||![1,2].includes(r.wire_version)||r.crc_checked!==true||r.signature_verified!==false||typeof r.signature_present!=='boolean'||!r.fields||typeof r.fields!=='object'||Array.isArray(r.fields)||JSON.stringify(r.fields).length>2000||!Number.isInteger(r.offset)||r.offset<0||!Number.isInteger(r.length)||r.length<8||r.length>280)throw Error('Invalid telemetry row.');}
      else throw Error('Unknown timeline row.');
    }return s;
  }
  async function verifyBundle(bytes){
    const files=unzip(bytes);if(!files.has('session.json')||!files.has('timeline.json')||files.get('session.json').length>1048576||files.get('timeline.json').length>16*1048576)throw Error('Missing or oversized session metadata.');
    const session=JSON.parse(dec.decode(files.get('session.json'))),timeline=JSON.parse(dec.decode(files.get('timeline.json')));validateSession(session,timeline);
    const expected=new Set(['session.json','timeline.json','summary.txt',...session.files.map(f=>f.name)]);if(files.size!==expected.size||[...files.keys()].some(k=>!expected.has(k)))throw Error('Unexpected or missing bundle files.');
    for(const f of session.files){const b=files.get(f.name);if(!b||b.length!==f.size||await sha256(b)!==f.sha256)throw Error('Evidence bytes differ from the manifest.');}
    const telemetry=files.get('telemetry.mavlink');for(const row of timeline.filter(r=>r.kind==='mavlink')){if(!telemetry||row.offset+row.length>telemetry.length)throw Error('Telemetry row has no captured packet.');const p=new MavlinkParser(),decoded=p.feed(telemetry.slice(row.offset,row.offset+row.length),row.at_ms);if(decoded.length!==1||JSON.stringify(decoded[0].fields)!==JSON.stringify(row.fields)||['message_id','system_id','component_id','sequence','wire_version','signature_present','length'].some(k=>decoded[0][k]!==row[k]))throw Error('Timeline does not match captured telemetry bytes.');}
    return {session,timeline,files};
  }
  function summary(session,rows){
    const packets=rows.filter(r=>r.kind==='mavlink'),notes=rows.filter(r=>r.kind==='note');
    const result=[session.title||'Untitled UAS session',`Aircraft: ${session.aircraft||'not declared'} | Firmware: ${session.firmware||'not declared'}`,`Recorded: ${session.started_at} | Duration: ${(session.duration_ms/1000).toFixed(1)} s | State: ${session.state}`,`${packets.length} supported MAVLink packets decoded; ${notes.length} marked observations.`,...notes.map(r=>`${(r.at_ms/1000).toFixed(1)} s: ${r.text}`),'Timing uses browser receipt and capture-start estimates; sensor/video pipeline delays are not measured.','CRC checks detect corruption. MAVLink signatures are retained but not authenticated.','This record describes captured evidence and provides no airworthiness or standards certification.'];
    return result.join('\n');
  }
  const api={LIMIT,definitions,x25,crc32,concat,MavlinkParser,describe,sha256,zip,unzip,validateSession,verifyBundle,summary,tlog,allowedName};root.ForgeSessionEvidence=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
