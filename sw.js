const CACHE='sokoads-v1';
const APP_SHELL=['/','/index.html','/manifest.json','/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET') return;
 const u=new URL(e.request.url);
 if(u.origin!==location.origin) return;
 e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(res=>{
   if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}
   return res;
 }).catch(()=>cached)));
});