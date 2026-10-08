(function(root){
  'use strict';
  class SessionStore {
    async open(){
      this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('forge-uas-sessions',1);r.onupgradeneeded=()=>{r.result.createObjectStore('sessions',{keyPath:'id'});const c=r.result.createObjectStore('chunks',{keyPath:['session_id','name','index']});c.createIndex('session','session_id');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Close another recorder tab, then reload.'));});
      this.db.onversionchange=()=>this.db.close();return this;
    }
    transact(names,mode,work){return new Promise((resolve,reject)=>{const tx=this.db.transaction(names,mode);let result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||Error('Local storage failed.'));tx.onabort=()=>reject(tx.error||Error('Local save was interrupted.'));try{result=work(tx);}catch(error){tx.abort();reject(error);}});}
    async save(record,chunk=null){await this.transact(['sessions','chunks'],'readwrite',tx=>{tx.objectStore('sessions').put(structuredClone(record));if(chunk)tx.objectStore('chunks').put(chunk);});}
    async list(){let r;await this.transact(['sessions'],'readonly',tx=>{r=tx.objectStore('sessions').getAll();});return r.result.sort((a,b)=>b.session.started_at.localeCompare(a.session.started_at));}
    async read(id){let r,c;await this.transact(['sessions','chunks'],'readonly',tx=>{r=tx.objectStore('sessions').get(id);c=tx.objectStore('chunks').index('session').getAll(id);});if(!r.result)throw Error('Session no longer exists on this device.');return {...r.result,chunks:c.result};}
    async remove(id){await this.transact(['sessions','chunks'],'readwrite',tx=>{tx.objectStore('sessions').delete(id);const r=tx.objectStore('chunks').index('session').openCursor(IDBKeyRange.only(id));r.onsuccess=()=>{const cursor=r.result;if(cursor){cursor.delete();cursor.continue();}};});}
    async replace(record,files){await this.transact(['sessions','chunks'],'readwrite',tx=>{tx.objectStore('sessions').put(structuredClone(record));for(const [name,bytes]of files)tx.objectStore('chunks').put({session_id:record.id,name,index:0,blob:new Blob([bytes])});});}
  }
  root.ForgeSessionStore=SessionStore;
})(globalThis);
