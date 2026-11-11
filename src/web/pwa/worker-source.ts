/** Generated worker deliberately has no runtime/API cache. Only build-listed public assets are cached. */
export function createWorkerSource(assets: string[], version: string): string {
  return `
const CACHE = ${JSON.stringify(`ride-remix-shell-${version}`)};
const ASSETS = ${JSON.stringify(assets)};
const NETWORK_ONLY = /^\\/(?:api(?:\\/|$)|auth(?:\\/|$)|healthz(?:\\/|$))/;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (await hasActiveSession()) throw new Error('Update postponed during active practice');
    try {
      const predecessor = (await caches.keys()).filter(key => key.startsWith('ride-remix-shell-') && key !== CACHE).at(-1);
      const cache = await caches.open(CACHE);
      await cache.put('/__previous-cache__', new Response(JSON.stringify(predecessor ?? null)));
      await cache.addAll(ASSETS);
      await cache.put('/__offline-assets__', new Response(JSON.stringify(ASSETS)));
      if (await hasActiveSession()) throw new Error('Practice started during installation');
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const selected = await servingCache();
    if (selected === CACHE) for (const key of await caches.keys()) if (key.startsWith('ride-remix-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || NETWORK_ONLY.test(url.pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(servingCache().then(name => caches.open(name)).then(cache => cache.match('/index.html')).then(shell => shell || fetch(event.request)));
    return;
  }
  if (url.search) return;
  event.respondWith(servingCache().then(name => caches.open(name)).then(cache => cache.match(url.pathname)).then(asset => asset || fetch(event.request)));
});
function hasActiveSession() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ride-remix');
    request.onupgradeneeded = () => request.transaction.abort();
    request.onerror = () => reject(new Error('Cannot inspect practice storage'));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('sessions')) { db.close(); reject(new Error('Missing practice storage')); return; }
      const tx = db.transaction('sessions');
      const sessions = tx.objectStore('sessions').getAll();
      sessions.onerror = () => { db.close(); reject(sessions.error); };
      tx.oncomplete = () => { db.close(); resolve(sessions.result.some(s => s.status === 'active')); };
    };
  });
}
async function servingCache() {
  const own = await caches.open(CACHE);
  const marker = await own.match('/__previous-cache__');
  const previous = marker ? await marker.json() : null;
  if (previous) {
    try { if (await hasActiveSession()) return previous; } catch { return previous; }
  }
  return CACHE;
}
self.addEventListener('message', event => {
  if (!event.ports[0]) return;
  const port = event.ports[0];
  if (event.data?.type === 'STATUS') event.waitUntil((async () => {
    const name = await servingCache();
    const cache = await caches.open(name);
    const manifest = await cache.match('/__offline-assets__');
    const assets = manifest ? await manifest.json() : [];
    const ready = assets.length > 0 && (await Promise.all(assets.map(path => cache.match(path)))).every(Boolean);
    port.postMessage({ ready, version: name });
  })());
  if (event.data?.type === 'APPLY_UPDATE') event.waitUntil((async () => {
    try {
      if (await hasActiveSession()) { port.postMessage({ applied: false, reason: 'End the active practice session before updating.' }); return; }
      await self.skipWaiting(); port.postMessage({ applied: true });
    } catch { port.postMessage({ applied: false, reason: 'Could not check local practice storage. Update postponed.' }); }
  })());
});
`;
}
