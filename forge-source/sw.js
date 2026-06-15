var CACHE_NAME='forge-tiles-v1';
var TILE_HOSTS=['basemaps.cartocdn.com','server.arcgisonline.com','basemap.nationalmap.gov','tile.opentopomap.org'];
var ELEV_HOSTS=['api.open-elevation.com','epqs.nationalmap.gov'];
self.addEventListener('install',function(e){self.skipWaiting();});
self.addEventListener('activate',function(e){e.waitUntil(clients.claim());});
self.addEventListener('fetch',function(e){
    var url=new URL(e.request.url);
    var isTile=TILE_HOSTS.some(function(h){return url.hostname.includes(h);});
    var isElev=ELEV_HOSTS.some(function(h){return url.hostname.includes(h);});
    if(!isTile&&!isElev)return;
    e.respondWith(caches.open(CACHE_NAME).then(function(cache){
        return cache.match(e.request).then(function(cached){
            if(cached)return cached;
            return fetch(e.request).then(function(resp){
                if(resp.ok)cache.put(e.request,resp.clone());
                return resp;
            }).catch(function(){return cached||new Response('',{status:503});});
        });
    }));
});
self.addEventListener('message',function(e){
    if(e.data&&e.data.type==='CACHE_TILES'){
        var urls=e.data.urls||[];
        caches.open(CACHE_NAME).then(function(cache){
            var done=0,fail=0,total=urls.length;
            function next(){
                if(urls.length===0){e.ports[0].postMessage({done:done,fail:fail,total:total});return;}
                var url=urls.shift();
                cache.match(url).then(function(cached){
                    if(cached){done++;next();return;}
                    fetch(url).then(function(r){if(r.ok)cache.put(url,r);done++;next();}).catch(function(){fail++;next();});
                });
            }
            for(var i=0;i<Math.min(4,urls.length);i++)next();
        });
    }
    if(e.data&&e.data.type==='CACHE_STATS'){
        caches.open(CACHE_NAME).then(function(cache){
            cache.keys().then(function(keys){e.ports[0].postMessage({count:keys.length});});
        });
    }
    if(e.data&&e.data.type==='CACHE_CLEAR'){
        caches.delete(CACHE_NAME).then(function(){e.ports[0].postMessage({cleared:true});});
    }
});
