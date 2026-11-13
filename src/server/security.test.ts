import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createApp } from './app';
import { AuthStore } from './auth/store';
import { AuthService } from './auth/service';
import { TurnstileVerifier } from './auth/challenge';
import type { ChallengeVerifier } from './auth/challenge';
import { TrafficLimiter } from './security';
import { SharingStore } from './sharing/store';
import { getStarterLibrary } from '../content/starter-library';

const origin = 'https://ride.example.com';
const now = Date.parse('2026-11-11T12:00:00Z');
async function fixture(verifier: ChallengeVerifier = { async verify() { return true; } }) {
  const store = new AuthStore(':memory:');
  const deliveries: string[] = [];
  const auth = new AuthService(store, { async sendApprovalNotification() {}, async sendLoginLink(email) { deliveries.push(email); } }, origin, undefined, () => now, { siteKey: 'public-key', verifier });
  const app = await createApp(undefined, auth, false);
  const post = (route: string, email: string, challengeToken: string = randomUUID()) => app.inject({ method: 'POST', url: `/api/v1/auth/${route}`, headers: { origin }, payload: { email, challengeToken } });
  return { store, auth, app, post, deliveries };
}

test('access requests are deduplicated pending records, require approval, and preserve revoked/active accounts', async t => {
  const f = await fixture(); t.after(() => f.app.close());
  assert.equal((await f.post('access-requests', ' RIDER@EXAMPLE.COM ')).statusCode, 202);
  await f.post('access-requests', 'rider@example.com');
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM accounts').get()?.n, 1);
  assert.equal(f.store.account('rider@example.com')?.status, 'pending');
  assert.equal(f.store.issue('rider@example.com', now), undefined);
  await f.post('login-links', 'rider@example.com'); await f.auth.waitForDeliveries();
  assert.equal(f.deliveries.length, 0);
  // The documented SQL approval transitions exactly the requested pending account.
  assert.equal(f.store.db.prepare("UPDATE accounts SET status='invited',updated_at=? WHERE email=? AND status='pending'").run(now, 'rider@example.com').changes, 1);
  await f.post('login-links', 'rider@example.com'); await f.auth.waitForDeliveries();
  assert.equal(f.deliveries.length, 1);
  const session = f.store.redeem(f.store.issue('rider@example.com', now)!, now)!;
  assert.equal(f.store.session(session.secret, now).status, 'ok');
  await f.post('access-requests', 'rider@example.com');
  assert.equal(f.store.account('rider@example.com')?.status, 'active');
  f.store.revoke('rider@example.com', now);
  await f.post('access-requests', 'rider@example.com');
  assert.equal(f.store.account('rider@example.com')?.status, 'revoked');
  assert.equal(f.store.issue('rider@example.com', now), undefined);
});

test('pending status denies stale tokens and existing sessions, even after operator status changes', () => {
  const store = new AuthStore(':memory:');
  try {
    store.invite('rider@example.com', now);
    const session = store.redeem(store.issue('rider@example.com', now)!, now)!;
    const token = store.issue('rider@example.com', now)!;
    store.db.prepare("UPDATE accounts SET status='pending'").run();
    assert.equal(store.session(session.secret, now).status, 'revoked');
    assert.equal(store.redeem(token, now), undefined);
  } finally { store.close(); }
});

test('CAPTCHA is required, validated before writes, and atomically single-use across routes', async t => {
  const f = await fixture({ async verify(token) { return token !== 'invalid'; } }); t.after(() => f.app.close());
  assert.equal((await f.post('access-requests', 'rider@example.com', 'invalid')).statusCode, 400);
  assert.equal(f.store.account('rider@example.com'), undefined);
  const token = randomUUID();
  const responses = await Promise.all([f.post('access-requests', 'a@example.com', token), f.post('login-links', 'a@example.com', token)]);
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [202, 400]);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM challenge_uses').get()?.n, 1);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/auth/login-links', headers: { origin }, payload: { email: 'a@example.com' } })).statusCode, 422);
  assert.equal((await f.app.inject({ url: '/api/v1/auth/challenge-config' })).json().siteKey, 'public-key');
});

test('missing CAPTCHA configuration fails closed', async t => {
  const store = new AuthStore(':memory:');
  const auth = new AuthService(store, { async sendApprovalNotification() {}, async sendLoginLink() { assert.fail('Must not send'); } }, origin);
  const app = await createApp(undefined, auth, false); t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/access-requests', headers: { origin }, payload: { email: 'a@example.com', challengeToken: 'forged' } });
  assert.equal(response.statusCode, 400);
  assert.equal(store.account('a@example.com'), undefined);
});

test('Turnstile checks success, hostname, action, token age, network failures and upstream errors', async () => {
  const valid = { success: true, hostname: 'ride.example.com', action: 'login', challenge_ts: new Date(now).toISOString() };
  async function verify(body: unknown, status = 200) {
    const verifier = new TurnstileVerifier('private-key', 'ride.example.com', async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.secret, 'private-key'); assert.equal(request.response, 'token');
      return Response.json(body, { status });
    });
    return verifier.verify('token', 'login', '192.0.2.1', now);
  }
  assert.equal(await verify(valid), true);
  for (const invalid of [
    { ...valid, success: false }, { ...valid, hostname: 'attacker.test' }, { ...valid, action: 'access_request' },
    { ...valid, challenge_ts: new Date(now - 300001).toISOString() }, { ...valid, challenge_ts: new Date(now + 30001).toISOString() },
    { success: true },
  ]) assert.equal(await verify(invalid), false);
  assert.equal(await verify(valid, 500), false);
  assert.equal(await new TurnstileVerifier('secret', 'ride.example.com', async () => { throw new Error('secret'); }).verify('token', 'login', '192.0.2.1', now), false);
});

test('pending storage is capped, expires after 30 days and preserves approved accounts', () => {
  const store = new AuthStore(':memory:');
  try {
    store.invite('approved@example.com', now);
    for (let i = 0; i < 1000; i++) assert.equal(store.requestAccess(`rider${i}@example.com`, now), true);
    assert.equal(store.requestAccess('overflow@example.com', now), false);
    assert.equal(store.requestAccess('fresh@example.com', now + 31 * 24 * 60 * 60_000), true);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM accounts WHERE status='pending'").get()?.n, 1);
    assert.equal(store.account('approved@example.com')?.status, 'invited');
  } finally { store.close(); }
});

test('Fly client IP trusts only configured socket peers and ignores spoofed forwarded values', async t => {
  const app = await createApp(undefined, undefined, false, undefined, { proxyMode: 'fly', trustedProxyCidrs: ['172.19.0.1/32'], requestsPerMinute: 1 });
  t.after(() => app.close());
  const request = (remoteAddress: string, ip: string) => app.inject({ url: '/missing', remoteAddress, headers: { 'fly-client-ip': ip, 'x-forwarded-for': randomUUID() } });
  assert.equal((await request('172.19.0.1', '192.0.2.1')).statusCode, 404);
  assert.equal((await request('172.19.0.1', '192.0.2.1')).statusCode, 429);
  assert.equal((await request('172.19.0.1', '192.0.2.2')).statusCode, 404);
  assert.equal((await request('192.0.2.10', '192.0.2.3')).statusCode, 403);
  assert.equal((await request('172.19.0.1', 'invalid')).statusCode, 403);
  assert.equal((await app.inject({ url: '/healthz' })).statusCode, 200);
  await assert.rejects(createApp(undefined, undefined, false, undefined, { proxyMode: 'fly' }), /TRUSTED_PROXY_CIDRS/);
});

test('direct-mode headers cannot bypass public-read, global or concurrency limits', async t => {
  const app = await createApp(undefined, undefined, false, undefined, { requestsPerMinute: 1 }); t.after(() => app.close());
  assert.equal((await app.inject({ url: '/api/v1/shared-decks/id', headers: { 'fly-client-ip': '192.0.2.1' } })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/v1/shared-decks/id', headers: { 'fly-client-ip': '192.0.2.2' } })).statusCode, 429);
  const limited = new TrafficLimiter({ globalRequestsPerMinute: 1 });
  assert.equal(limited.allow('a', 0), true); assert.equal(limited.allow('b', 0), false); assert.equal(limited.allow('b', 60001), true);
  const busy = await createApp(undefined, undefined, false, undefined, { maxConcurrent: 1 }); t.after(() => busy.close());
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  busy.get('/hold', async () => { entered(); await hold; return {}; });
  const pending = busy.inject({ url: '/hold' });
  void pending.then(() => {});
  await started;
  assert.equal((await busy.inject({ url: '/missing' })).statusCode, 503);
  release(); await pending;
  assert.equal((await busy.inject({ url: '/missing' })).statusCode, 404);
});

test('all application paths get framing/CSP/referrer protection compatible with Turnstile', async t => {
  const f = await fixture(); t.after(() => f.app.close());
  for (const url of ['/deck', '/settings', '/s/public', '/auth/login', '/api/v1/auth/challenge-config']) {
    const response = await f.app.inject({ url, headers: { accept: 'text/html' } });
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.match(String(response.headers['content-security-policy']), /script-src 'self' https:\/\/challenges.cloudflare.com/);
    assert.match(String(response.headers['content-security-policy']), /frame-ancestors 'none'/);
  }
});

test('v2 migration preserves sessions and sharing foreign keys and admits pending accounts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ride-security-')); const path = join(dir, 'db.sqlite');
  try {
    const store = new AuthStore(path); const sharing = new SharingStore(store.db);
    const account = store.invite('rider@example.com', now); const session = store.redeem(store.issue(account.email, now)!, now)!;
    const timestamp = new Date(now).toISOString();
    const published = sharing.publish(account.id, { payloadVersion: 1, requestId: randomUUID(), deck: {
      schemaVersion: 1, id: randomUUID(), title: 'Preserved', createdAt: timestamp, updatedAt: timestamp,
      generationInputs: { timeBudgetMinutes: 20, focuses: [], equipment: { cones: 'unspecified', obstacle: 'unspecified', incline: 'unspecified' } },
      entries: [{ id: randomUUID(), plannedDurationMinutes: 10, drill: getStarterLibrary().drills[0] }],
    } }, now);
    store.db.exec('DROP TABLE challenge_uses; PRAGMA user_version=2;'); store.close();
    const reopened = new AuthStore(path);
    try {
      assert.equal(reopened.session(session.secret, now).status, 'ok');
      assert.equal(new SharingStore(reopened.db).get(published.id)?.deck.title, 'Preserved');
      assert.deepEqual(reopened.db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(reopened.requestAccess('pending@example.com', now), true);
      assert.equal(reopened.account('pending@example.com')?.status, 'pending');
    } finally { reopened.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('aborted uploads release concurrency admission without waiting for process restart', { timeout: 3000 }, async t => {
  const app = await createApp(undefined, undefined, false, undefined, { maxConcurrent: 1 });
  t.after(() => app.close());
  let entered!: () => void; const admitted = new Promise<void>(resolve => { entered = resolve; });
  let released!: () => void; const aborted = new Promise<void>(resolve => { released = resolve; });
  app.addHook('onRequest', async request => { if (request.url === '/upload') entered(); });
  app.addHook('onRequestAbort', async request => { if (request.url === '/upload') released(); });
  app.post('/upload', async () => ({}));
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const request = httpRequest(`${address}/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '1000' } });
  request.on('error', () => {});
  request.write('{');
  try {
    await admitted;
    assert.equal((await app.inject({ url: '/missing' })).statusCode, 503);
    request.destroy();
    await aborted;
    assert.equal((await app.inject({ url: '/missing' })).statusCode, 404);
  } finally { request.destroy(); }
});


test('Fly IPv4 listener policy rejects direct 6PN traffic and requires a valid edge header', async t => {
  const app = await createApp(undefined, undefined, false, undefined, { proxyMode: 'fly', flyIpv4Listener: true, requestsPerMinute: 1 });
  t.after(() => app.close());
  const send = (remoteAddress: string, ip?: string) => app.inject({ url: '/missing', remoteAddress, headers: ip ? { 'fly-client-ip': ip, 'x-forwarded-for': 'spoofed' } : {} });
  assert.equal((await send('172.19.0.1', '192.0.2.1')).statusCode, 404);
  assert.equal((await send('172.19.0.1', '192.0.2.1')).statusCode, 429);
  assert.equal((await send('172.19.0.2', '192.0.2.2')).statusCode, 404);
  assert.equal((await send('fdaa::1', '192.0.2.3')).statusCode, 403);
  assert.equal((await send('172.19.0.1')).statusCode, 403);
});
