'use strict';
const CACHE='forge-uas-recorder-1.3.1';
const SHELL=['/session-recorder/','/session-recorder/app.webmanifest','/static/workspace.css','/static/session-recorder.css','/static/session-recorder.js','/static/session-media.js','/static/session-vehicle.js','/static/session-evidence.js','/static/session-reports.js','/static/session-store.js','/static/test-lab.js','/static/session-recorder-icon.svg','/system-tests/profiles.json','/session-recorder/SOP.md','/session-recorder/LIVE_TEAM_GUIDE.txt'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('forge-uas-recorder-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!SHELL.includes(url.pathname)||url.searchParams.has('key'))return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(async()=>{const cache=await caches.open(CACHE);return await cache.match(event.request)||await cache.match(url.pathname)||new Response('Recorder asset unavailable offline.',{status:503});}));
});
