import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app';
import { AuthService, defaultAuthLimits } from './auth/service';
import { AuthStore, hashSecret, LOGIN_LIFETIME, SESSION_LIFETIME } from './auth/store';
import { SESSION_COOKIE } from './auth/routes';
import { authFixtures, loginLinkRequestSchema, loginLinkResponseSchema, redeemResponseSchema, sessionResponseSchema } from '../contracts/auth';
import type { LoginEmailSender } from './auth/email';

const origin = 'https://ride.example.com';
class Inbox implements LoginEmailSender {
  messages: { email: string; url: string }[] = [];
  fail = false;
  async sendLoginLink(email: string, url: string) {
    if (this.fail) throw new Error('Provider message contains sensitive data');
    this.messages.push({ email, url });
  }
  token(index = this.messages.length - 1) { return new URLSearchParams(new URL(this.messages[index].url).hash.slice(1)).get('token')!; }
}
async function fixture(limits = defaultAuthLimits) {
  let now = Date.parse('2026-11-10T12:00:00Z');
  const store = new AuthStore(':memory:'); const inbox = new Inbox();
  const service = new AuthService(store, inbox, origin, limits, () => now, { siteKey: 'test', verifier: { async verify() { return true; } } });
  const app = await createApp(undefined, service, false);
  const post = async (path: string, payload: Record<string, unknown> | undefined, headers = {}) => {
    const response = await app.inject({ method: 'POST', url: `/api/v1/auth/${path}`, payload: path === 'login-links' ? { challengeToken: crypto.randomUUID(), ...payload } : payload, headers: { origin, ...headers } });
    await service.waitForDeliveries();
    return response;
  };
  const login = async (email = 'rider@example.com') => {
    store.invite(email, now); await post('login-links', { email });
    const response = await post('redeem', { token: inbox.token() });
    assert.equal(response.statusCode, 200);
    const cookie = String(response.headers['set-cookie']).split(';')[0];
    return { response, cookie, csrf: response.json().csrfToken as string };
  };
  return { store, inbox, app, post, login, service, advance: (ms: number) => { now += ms; } };
}

test('only invited/active emails receive links; normalization and generic unknown/revoked/failure responses', async t => {
  const f = await fixture(); t.after(() => f.app.close());
  f.store.invite('RIDER@example.com'); f.store.invite('revoked@example.com'); f.store.revoke('revoked@example.com');
  const eligible = await f.post('login-links', { email: ' RIDER@EXAMPLE.COM ' });
  for (const email of ['unknown@example.com', 'revoked@example.com']) {
    const response = await f.post('login-links', { email });
    assert.equal(response.statusCode, 202); assert.deepEqual(response.json(), eligible.json());
  }
  assert.equal(f.inbox.messages.length, 1); assert.equal(f.inbox.messages[0].email, 'rider@example.com');
  assert.equal(new URL(f.inbox.messages[0].url).origin, origin);
  assert.equal(new URL(f.inbox.messages[0].url).search, '');
  f.inbox.fail = true;
  const failure = await f.post('login-links', { email: 'rider@example.com' });
  assert.deepEqual(failure.json(), eligible.json());
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM login_tokens').get()?.n, 0);
  assert.equal((await f.post('login-links', { email: 'bad' })).statusCode, 422);
});

test('scanner-safe GET, explicit redemption, hashed records, cookie flags, replay, and no-store', async t => {
  const f = await fixture(); t.after(() => f.app.close()); f.store.invite('rider@example.com');
  await f.post('login-links', { email: 'rider@example.com' }); const token = f.inbox.token();
  await f.app.inject({ method: 'GET', url: '/auth/confirm', headers: { accept: 'text/html' } });
  const [first, second] = await Promise.all([f.post('redeem', { token }), f.post('redeem', { token })]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 400]);
  const success = first.statusCode === 200 ? first : second;
  const cookie = String(success.headers['set-cookie']);
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) assert.ok(cookie.includes(flag));
  assert.ok(cookie.startsWith(`${SESSION_COOKIE}=`)); assert.ok(!cookie.includes('Domain='));
  redeemResponseSchema.parse(success.json());
  assert.equal(success.headers['cache-control'], 'no-store'); assert.equal(success.headers['referrer-policy'], 'no-referrer');
  assert.equal(f.store.account('rider@example.com')?.status, 'active');
  assert.equal(f.store.db.prepare('SELECT token_hash FROM login_tokens').get()?.token_hash, hashSecret(token));
  const sessionSecret = cookie.split(';')[0].split('=')[1];
  assert.equal(f.store.db.prepare('SELECT secret_hash FROM auth_sessions').get()?.secret_hash, hashSecret(sessionSecret));
  const session = await f.app.inject({ url: '/api/v1/auth/session', headers: { cookie: cookie.split(';')[0] } });
  assert.equal(session.statusCode, 200); sessionResponseSchema.parse(session.json());
  assert.equal(session.headers['cache-control'], 'no-store');
  const invalid = await f.post('redeem', { token: 'invalid' });
  const replay = await f.post('redeem', { token }); assert.deepEqual(invalid.json(), replay.json());
});

test('expired and superseded links fail; replacement invitations remain usable', async t => {
  const f = await fixture(); t.after(() => f.app.close()); f.store.invite('rider@example.com');
  await f.post('login-links', { email: 'rider@example.com' }); const expired = f.inbox.token();
  f.advance(LOGIN_LIFETIME); assert.equal((await f.post('redeem', { token: expired })).statusCode, 400);
  await f.post('login-links', { email: 'rider@example.com' }); const older = f.inbox.token();
  await f.post('login-links', { email: 'rider@example.com' }); const newest = f.inbox.token();
  assert.equal((await f.post('redeem', { token: older })).statusCode, 400);
  assert.equal((await f.post('redeem', { token: newest })).statusCode, 200);
});

test('same-origin and CSRF enforced; logout revokes and clears only current browser session', async t => {
  const f = await fixture(); t.after(() => f.app.close());
  const first = await f.login(); const second = await f.login();
  for (const headers of [{ cookie: first.cookie }, { cookie: first.cookie, 'x-csrf-token': 'é'.repeat(64) }, { cookie: first.cookie, 'x-csrf-token': first.csrf, origin: 'https://evil.example' }]) {
    assert.equal((await f.post('logout', undefined, headers)).statusCode, 403);
  }
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/auth/redeem', payload: { token: f.inbox.token() } })).statusCode, 403);
  const logout = await f.post('logout', undefined, { cookie: first.cookie, 'x-csrf-token': first.csrf });
  assert.equal(logout.statusCode, 204); assert.ok(String(logout.headers['set-cookie']).includes('Max-Age=0'));
  assert.equal((await f.app.inject({ url: '/api/v1/auth/session', headers: { cookie: first.cookie } })).statusCode, 403);
  assert.equal((await f.app.inject({ url: '/api/v1/auth/session', headers: { cookie: second.cookie } })).statusCode, 200);
  assert.equal((await f.app.inject({ url: '/api/v1/auth/session' })).statusCode, 401);
});

test('operator revocation invalidates every session and pending token; expiry is absolute', async t => {
  const f = await fixture(); t.after(() => f.app.close()); const a = await f.login(); const b = await f.login();
  await f.post('login-links', { email: 'rider@example.com' }); const token = f.inbox.token();
  f.store.revoke('rider@example.com');
  for (const cookie of [a.cookie, b.cookie]) assert.equal((await f.app.inject({ url: '/api/v1/auth/session', headers: { cookie } })).statusCode, 403);
  assert.equal((await f.post('redeem', { token })).statusCode, 400);
  f.advance(LOGIN_LIFETIME); const c = await f.login();
  f.advance(SESSION_LIFETIME);
  assert.equal((await f.app.inject({ url: '/api/v1/auth/session', headers: { cookie: c.cookie } })).statusCode, 401);
});

test('email/IP/redemption rate limits and global delivery cap apply at boundaries', async t => {
  const f = await fixture({ loginIp: 3, loginEmail: 2, redeemIp: 2, emailPerDay: 1 }); t.after(() => f.app.close());
  f.store.invite('rider@example.com');
  assert.equal((await f.post('login-links', { email: 'rider@example.com' })).statusCode, 202);
  assert.equal((await f.post('login-links', { email: 'rider@example.com' })).statusCode, 202);
  assert.equal(f.inbox.messages.length, 1);
  assert.equal((await f.post('login-links', { email: 'rider@example.com' })).statusCode, 429);
  assert.equal((await f.post('login-links', { email: 'other@example.com' })).statusCode, 202);
  assert.equal((await f.post('login-links', { email: 'third@example.com' })).statusCode, 429);
  for (let i = 0; i < 2; i++) assert.equal((await f.post('redeem', { token: 'bad' })).statusCode, 400);
  assert.equal((await f.post('redeem', { token: 'bad' })).statusCode, 429);
  f.advance(LOGIN_LIFETIME);
  assert.equal((await f.post('redeem', { token: 'bad' })).statusCode, 400);
  assert.equal((await f.post('login-links', { email: 'rider@example.com' })).statusCode, 202);
});

test('payload limits, strict schemas, and schema fixtures', async t => {
  const f = await fixture(); t.after(() => f.app.close());
  assert.equal((await f.post('login-links', { email: 'rider@example.com', extra: true })).statusCode, 422);
  assert.equal((await f.post('login-links', { email: 'x'.repeat(5000) })).statusCode, 413);
  loginLinkRequestSchema.parse(authFixtures.loginRequest); loginLinkResponseSchema.parse(authFixtures.loginResponse); sessionResponseSchema.parse(authFixtures.session);
});

test('SQLite migrations/reopen preserve accounts, token state, sessions, and rate limits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ride-auth-')); const path = join(dir, 'auth.sqlite');
  try {
    const first = new AuthStore(path); first.invite('rider@example.com'); const token = first.issue('rider@example.com')!;
    const login = first.redeem(token)!; first.allow([{ key: 'bucket', limit: 1, window: 60_000 }]); first.close();
    const reopened = new AuthStore(path);
    assert.equal(reopened.db.prepare('PRAGMA user_version').get()?.user_version, 3);
    assert.equal(reopened.session(login.secret).status, 'ok'); assert.equal(reopened.redeem(token), undefined);
    assert.equal(reopened.allow([{ key: 'bucket', limit: 1, window: 60_000 }]), false);
    reopened.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unknown and revoked addresses do not spend delivery quota or block invited delivery', async t => {
  const f = await fixture({ ...defaultAuthLimits, emailPerDay: 1 }); t.after(() => f.app.close());
  f.store.invite('revoked@example.com'); f.store.revoke('revoked@example.com');
  for (const email of ['unknown@example.com', 'another@example.com', 'revoked@example.com']) {
    assert.equal((await f.post('login-links', { email })).statusCode, 202);
  }
  f.store.invite('rider@example.com');
  assert.equal((await f.post('login-links', { email: 'rider@example.com' })).statusCode, 202);
  assert.equal(f.inbox.messages.length, 1);
  assert.equal(f.inbox.messages[0].email, 'rider@example.com');
  // HTTP and CLI use the same global delivery quota.
  assert.equal(await f.service.sendLink('rider@example.com'), 'limited');
});

test('public login responses complete independently of provider latency and eligibility', { timeout: 2000 }, async t => {
  const store = new AuthStore(':memory:'); store.invite('rider@example.com');
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const sending = new Promise<void>(resolve => { started = resolve; });
  const service = new AuthService(store, { async sendLoginLink() { started(); await blocked; } }, origin, undefined, undefined, { siteKey: 'test', verifier: { async verify() { return true; } } });
  const app = await createApp(undefined, service, false);
  t.after(async () => { release(); await app.close(); });
  const request = (email: string) => app.inject({ method: 'POST', url: '/api/v1/auth/login-links', headers: { origin }, payload: { email, challengeToken: crypto.randomUUID() } });
  const eligible = await request('rider@example.com');
  assert.equal(eligible.statusCode, 202);
  await sending;
  const unknown = await request('unknown@example.com');
  assert.equal(unknown.statusCode, 202);
  assert.deepEqual(unknown.json(), eligible.json());
  // Both requests responded while the provider was still blocked.
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM login_deliveries').get()?.n, 2);
  release(); await service.waitForDeliveries();
  assert.equal(store.nextDelivery(), undefined);
});

test('delivery queue is bounded, survives reopen, drops stale requests, and handles provider failure', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ride-delivery-')); const path = join(dir, 'auth.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const now = Date.now();
  const first = new AuthStore(path); first.invite('rider@example.com', now);
  for (let i = 0; i < 1000; i++) assert.equal(first.enqueueDelivery('unknown@example.com', now - LOGIN_LIFETIME), true);
  assert.equal(first.enqueueDelivery('unknown@example.com', now - LOGIN_LIFETIME), false);
  // Expired jobs are cleaned at enqueue, keeping capacity available.
  assert.equal(first.enqueueDelivery('rider@example.com', now), true);
  first.close();
  const store = new AuthStore(path); const inbox = new Inbox(); inbox.fail = true;
  let failures = 0;
  const service = new AuthService(store, inbox, origin, defaultAuthLimits, () => now);
  service.startDeliveries(() => { failures++; });
  await service.waitForDeliveries();
  assert.equal(failures, 1); assert.equal(store.nextDelivery(), undefined);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM login_tokens').get()?.n, 0);
  await service.close();
});

test('shutdown finishes in-flight delivery and preserves queued jobs for restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ride-shutdown-')); const path = join(dir, 'auth.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new AuthStore(path); store.invite('rider@example.com'); store.invite('next@example.com');
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void; const sending = new Promise<void>(resolve => { started = resolve; });
  const service = new AuthService(store, { async sendLoginLink() { started(); await blocked; } }, origin);
  service.queueLink('rider@example.com'); service.queueLink('next@example.com');
  await sending;
  const closing = service.close(); release(); await closing;
  const reopened = new AuthStore(path); const inbox = new Inbox();
  const resumed = new AuthService(reopened, inbox, origin);
  resumed.startDeliveries(() => assert.fail('unexpected delivery failure'));
  await resumed.waitForDeliveries();
  assert.deepEqual(inbox.messages.map(message => message.email), ['next@example.com']);
  await resumed.close();
});


test('version 1 database migrates to the delivery queue without losing auth records', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ride-auth-migrate-')); const path = join(dir, 'auth.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = new AuthStore(path); first.invite('rider@example.com');
  const token = first.issue('rider@example.com')!;
  const session = first.redeem(token)!;
  first.db.exec('DROP TABLE login_deliveries; PRAGMA user_version=1;');
  first.close();
  const migrated = new AuthStore(path);
  assert.equal(migrated.db.prepare('PRAGMA user_version').get()?.user_version, 3);
  assert.equal(migrated.session(session.secret).status, 'ok');
  assert.equal(migrated.redeem(token), undefined);
  assert.equal(migrated.enqueueDelivery('rider@example.com'), true);
  migrated.close();
});
