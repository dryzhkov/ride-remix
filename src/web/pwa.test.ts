import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import { createWorkerSource } from './pwa/worker-source';

type WorkerEvent = { request?: { url: string; method: string; mode?: string }; data?: { type: string }; ports?: { postMessage(value: unknown): void }[]; waitUntil(p: Promise<unknown>): void; respondWith(p: Promise<unknown>): void };
function worker(options: { missing?: string; failInstall?: boolean; active?: boolean; version?: string; waiting?: boolean } = {}) {
  const handlers = new Map<string, (e: WorkerEvent) => void>();
  const cached = new Map<string, unknown>();
  if (options.active) cached.set('/__previous-cache__', new Response(JSON.stringify('ride-remix-shell-old')));
  const deleted: string[] = [];
  let claimed = false; let skipped = false;
  const cache = { async addAll(paths: string[]) { if (options.failInstall) throw new Error('network down'); for (const p of paths) if (p !== options.missing) cached.set(p, { path: p }); }, async match(path: string) { const value = cached.get(path); return value instanceof Response ? value.clone() : value; }, async put(path: string, response: Response) { cached.set(path, response); } };
  const previous = new Map<string, unknown>([['/index.html', { path: '/old/index.html' }], ['/assets/old.js', { path: '/assets/old.js' }]]);
  const oldCache = { ...cache, async match(path: string) { return previous.get(path); } };
  const caches = { async open(name: string) { return name === 'ride-remix-shell-old' ? oldCache : cache; }, async delete(key: string) { deleted.push(key); return true; }, async keys() { return ['other-cache', `ride-remix-shell-${options.version ?? 'one'}`, ...(options.active ? ['ride-remix-shell-old'] : []), ...(options.waiting ? ['ride-remix-shell-new'] : [])]; } };
  const indexedDB = new IDBFactory();
  const context = { URL, Promise, Error, Response, indexedDB, caches, fetch: async () => 'network', self: {
    location: { origin: 'https://ride.test' }, addEventListener(name: string, fn: (e: WorkerEvent) => void) { handlers.set(name, fn); },
    clients: { async claim() { claimed = true; } }, async skipWaiting() { skipped = true; },
  } };
  vm.runInNewContext(createWorkerSource(['/index.html', '/assets/app.js', '/starter-library.v1.json'], options.version ?? 'one'), context);
  async function dispatch(type: string, data: Partial<WorkerEvent> = {}) {
    let pending: Promise<unknown> = Promise.resolve(); let response: Promise<unknown> | undefined;
    handlers.get(type)!({ ...data, waitUntil(p) { pending = p; }, respondWith(p) { response = p; } });
    await pending; return response ? response : undefined;
  }
  async function send(type: string) { let reply: unknown; await dispatch('message', { data: { type }, ports: [{ postMessage(value) { reply = value; } }] }); return reply as { ready?: boolean; applied?: boolean }; }
  async function seed(active: boolean) {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('ride-remix', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'id' });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put({ id: 'session', status: active ? 'active' : 'completed' });
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
  }
  return { dispatch, send, seed, cached, deleted, claimed: () => claimed, skipped: () => skipped };
}

test('worker precaches shell/library atomically and reports readiness only for complete assets', async () => {
  const w = worker(); await w.seed(false); await w.dispatch('install');
  assert.equal((await w.send('STATUS')).ready, true);
  w.cached.delete('/starter-library.v1.json'); assert.equal((await w.send('STATUS')).ready, false);
  const failed = worker({ failInstall: true }); await failed.seed(false); await assert.rejects(failed.dispatch('install'));
  assert.deepEqual(failed.deleted, ['ride-remix-shell-one']);
});

test('API, auth, cross-origin, non-GET and unknown assets bypass worker caches', async () => {
  const w = worker(); await w.seed(false); await w.dispatch('install');
  for (const pathname of ['/api/v1/shared-decks/abc', '/api/v1/auth/session', '/auth/confirm?token=secret', '/healthz']) {
    assert.equal(await w.dispatch('fetch', { request: { url: `https://ride.test${pathname}`, method: 'GET', mode: 'navigate' === pathname ? 'navigate' : 'cors' } }), undefined);
  }
  assert.equal(await w.dispatch('fetch', { request: { url: 'https://ride.test/unlisted.png', method: 'GET' } }), 'network');
  assert.equal(await w.dispatch('fetch', { request: { url: 'https://other.test/index.html', method: 'GET' } }), undefined);
  assert.equal(await w.dispatch('fetch', { request: { url: 'https://ride.test/index.html', method: 'POST' } }), undefined);
  assert.equal(await w.dispatch('fetch', { request: { url: 'https://ride.test/assets/app.js?secret=abc', method: 'GET' } }), undefined);
});

test('direct shared-link navigation receives local shell without caching public snapshot payload', async () => {
  const w = worker(); await w.seed(false); await w.dispatch('install');
  const shell = await w.dispatch('fetch', { request: { url: 'https://ride.test/s/random-id', method: 'GET', mode: 'navigate' } });
  assert.equal((shell as { path: string }).path, '/index.html');
  assert.equal(w.cached.has('/s/random-id'), false);
});

test('updates never activate during active practice and fail closed on unavailable storage', async () => {
  const w = worker(); await w.seed(true);
  await assert.rejects(w.dispatch('install'), /active practice/);
  assert.equal((await w.send('APPLY_UPDATE')).applied, false); assert.equal(w.skipped(), false);
  await w.seed(false); assert.equal((await w.send('APPLY_UPDATE')).applied, true); assert.equal(w.skipped(), true);
  const missing = worker(); assert.equal((await missing.send('APPLY_UPDATE')).applied, false); assert.equal(missing.skipped(), false);
});

test('activation retires only previous app caches and claims clients', async () => {
  const w = worker({ active: true }); await w.seed(false); await w.dispatch('activate');
  assert.deepEqual(w.deleted, ['ride-remix-shell-old']); assert.equal(w.claimed(), true);
  assert.equal(createWorkerSource(['/index.html'], 'one'), createWorkerSource(['/index.html'], 'one'));
  assert.notEqual(createWorkerSource(['/index.html'], 'one'), createWorkerSource(['/index.html'], 'two'));
});

test('automatic activation retains previous shell cache if practice began after install', async () => {
  const w = worker({ active: true }); await w.seed(true); await w.dispatch('activate');
  assert.deepEqual(w.deleted, []); assert.equal(w.claimed(), true);
  const request = { url: 'https://ride.test/s/deck', method: 'GET', mode: 'navigate' };
  assert.equal((await w.dispatch('fetch', { request }) as { path: string }).path, '/old/index.html');
  assert.equal((await w.dispatch('fetch', { request: { url: 'https://ride.test/assets/old.js', method: 'GET' } }) as { path: string }).path, '/assets/old.js');
  w.cached.set('/index.html', { path: '/new/index.html' });
  await w.seed(false);
  assert.equal((await w.dispatch('fetch', { request }) as { path: string }).path, '/new/index.html');
});


test('active old worker keeps its own cache while a newer update waits during practice', async () => {
  const w = worker({ version: 'old', waiting: true });
  await w.seed(true);
  const request = { url: 'https://ride.test/', method: 'GET', mode: 'navigate' };
  assert.equal((await w.dispatch('fetch', { request }) as { path: string }).path, '/old/index.html');
});
