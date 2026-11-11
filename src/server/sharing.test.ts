import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app';
import { AuthService } from './auth/service';
import { AuthStore } from './auth/store';
import { DisabledEmailSender } from './auth/email';
import { SESSION_COOKIE } from './auth/routes';
import { SharingStore, canonicalJson, defaultPublicationQuotas } from './sharing/store';
import type { SharingOptions } from './sharing/routes';
import { getStarterLibrary } from '../content/starter-library';
import { publicationResponseSchema, publishRequestSchema, sharedDeckResponseSchema, sharingFixtures, sharingLimits } from '../contracts/sharing';
import type { Deck } from '../domain/schemas';

const origin = 'https://ride.example.com';
function deck(): Deck {
  const now = new Date().toISOString();
  return { schemaVersion: 1, id: crypto.randomUUID(), title: 'Share practice', createdAt: now, updatedAt: now,
    generationInputs: { timeBudgetMinutes: 20, focuses: [], equipment: { cones: 'available', incline: 'unspecified', obstacle: 'unavailable' } },
    entries: getStarterLibrary().drills.slice(0, 2).map(drill => ({ id: crypto.randomUUID(), drill, plannedDurationMinutes: 10 })),
  };
}
async function setup(options: SharingOptions = {}) {
  const store = new AuthStore(':memory:');
  const auth = new AuthService(store, new DisabledEmailSender(), origin);
  const app = await createApp(undefined, auth, false, options);
  function login(email = 'rider@example.com') {
    store.invite(email); const redeemed = store.redeem(store.issue(email)!)!;
    return { cookie: `${SESSION_COOKIE}=${redeemed.secret}`, 'x-csrf-token': redeemed.csrfToken, origin };
  }
  const headers = login();
  const post = (payload: Record<string, unknown>, customHeaders = headers) => app.inject({ method: 'POST', url: '/api/v1/shared-decks', headers: customHeaders, payload });
  return { app, store, auth, headers, login, post };
}
const request = () => ({ requestId: crypto.randomUUID(), payloadVersion: 1, deck: deck() });

test('authenticated publish and unauthenticated public GET preserve immutable content and exclude private fields', async t => {
  const f = await setup(); t.after(() => f.app.close()); const input = request();
  const response = await f.post(input); assert.equal(response.statusCode, 201);
  const publication = publicationResponseSchema.parse(response.json());
  assert.equal(publication.url, `${origin}/s/${publication.id}`); assert.equal(publication.id.length, 32);
  input.deck.title = 'Edited locally';
  const publicResponse = await f.app.inject({ url: `/api/v1/shared-decks/${publication.id}` });
  assert.equal(publicResponse.statusCode, 200); assert.equal(publicResponse.headers['cache-control'], 'no-store');
  const snapshot = sharedDeckResponseSchema.parse(publicResponse.json());
  assert.equal(snapshot.deck.title, 'Share practice');
  assert.doesNotMatch(publicResponse.body, /publisher|rider@example|session|csrf|requestId/);
  assert.equal((await f.app.inject({ url: '/api/v1/shared-decks/missing' })).statusCode, 404);
  f.store.db.prepare('DELETE FROM shared_decks WHERE id=?').run(publication.id);
  assert.equal((await f.app.inject({ url: `/api/v1/shared-decks/${publication.id}` })).statusCode, 404);
});

test('account-scoped retry idempotency uses canonical payload hashes; changed payload conflicts', async t => {
  const f = await setup(); t.after(() => f.app.close()); const input = request();
  const [first, second] = await Promise.all([f.post(input), f.post(input)]);
  assert.equal(first.statusCode, 201); assert.deepEqual(first.json(), second.json());
  assert.equal(canonicalJson({ b: 2, a: { z: 1, y: 2 } }), canonicalJson({ a: { y: 2, z: 1 }, b: 2 }));
  assert.equal((await f.post({ ...input, deck: { ...input.deck, title: 'Different' } })).statusCode, 409);
  const other = await f.post(input, f.login('other@example.com'));
  assert.equal(other.statusCode, 201); assert.notEqual(other.json().id, first.json().id);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM shared_decks').get()?.n, 2);
});

test('publishing requires a live session, same origin, CSRF, and rejects client publisher/history metadata', async t => {
  const f = await setup(); t.after(() => f.app.close()); const input = request();
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/shared-decks', payload: input, headers: { origin } })).statusCode, 401);
  assert.equal((await f.post(input, { ...f.headers, origin: 'https://evil.example' })).statusCode, 403);
  assert.equal((await f.post(input, { ...f.headers, 'x-csrf-token': '' })).statusCode, 403);
  assert.equal((await f.post({ ...input, publisherId: crypto.randomUUID() })).statusCode, 422);
  assert.equal((await f.post({ ...input, deck: { ...input.deck, results: [] } })).statusCode, 422);
  const internal = structuredClone(input); Object.assign(internal.deck.entries[0].drill, { sourceNotes: 'internal' });
  assert.equal((await f.post(internal)).statusCode, 422);
  f.store.revoke('rider@example.com'); assert.equal((await f.post(input)).statusCode, 403);
});

test('sharing schemas enforce text, entry, duration and version boundaries; oversized body returns 413', async t => {
  const f = await setup({ accountPerHour: 100 }); t.after(() => f.app.close());
  const input = request();
  input.deck.title = 'x'.repeat(sharingLimits.titleLength); assert.ok(publishRequestSchema.safeParse(input).success);
  input.deck.title += 'x'; assert.equal((await f.post(input)).statusCode, 422);
  input.deck.title = 'Practice'; input.deck.entries[0].drill.cue = 'x'.repeat(sharingLimits.cueLength + 1);
  assert.equal((await f.post(input)).statusCode, 422);
  assert.equal((await f.post({ ...request(), payloadVersion: 2 })).statusCode, 422);
  const duration = request(); duration.deck.entries[0].plannedDurationMinutes = sharingLimits.durationMinutes + 1;
  assert.equal((await f.post(duration)).statusCode, 422);
  const many = request(); const template = many.deck.entries[0];
  many.deck.entries = Array.from({ length: 30 }, () => ({ ...structuredClone(template), id: crypto.randomUUID(), drill: { ...structuredClone(template.drill), id: crypto.randomUUID(), revisionId: crypto.randomUUID() } }));
  assert.ok(publishRequestSchema.safeParse(many).success); assert.equal((await f.post(many)).statusCode, 201);
  many.deck.entries.push({ ...template, id: crypto.randomUUID() }); assert.equal((await f.post(many)).statusCode, 422);
  assert.equal((await f.post({ ...request(), extra: 'x'.repeat(sharingLimits.bodyBytes) })).statusCode, 413);
  publicationResponseSchema.parse(sharingFixtures.publication);
});

test('account/IP rate limits and account/global storage quotas are enforced at boundaries', async t => {
  const f = await setup({ accountPerHour: 1, ipPerHour: 2 }); t.after(() => f.app.close());
  assert.equal((await f.post(request())).statusCode, 201); assert.equal((await f.post(request())).statusCode, 429);
  const second = f.login('second@example.com'); assert.equal((await f.post(request(), second)).statusCode, 201);
  assert.equal((await f.post(request(), f.login('third@example.com'))).statusCode, 429);
  const quota = await setup({ quotas: { ...defaultPublicationQuotas, accountCount: 1, totalCount: 2 } }); t.after(() => quota.app.close());
  const saved = request(); assert.equal((await quota.post(saved)).statusCode, 201);
  assert.equal((await quota.post(saved)).statusCode, 201); // Existing retry does not consume storage.
  assert.equal((await quota.post(request())).statusCode, 429);
  assert.equal((await quota.post(request(), quota.login('second@example.com'))).statusCode, 201);
  assert.equal((await quota.post(request(), quota.login('third@example.com'))).statusCode, 429);
});

test('byte quotas admit exact bounds and reject the next byte without partial publication writes', async t => {
  const input = request(); const bytes = Buffer.byteLength(canonicalJson(input.deck));
  const f = await setup({ quotas: { ...defaultPublicationQuotas, accountBytes: bytes, totalBytes: bytes } }); t.after(() => f.app.close());
  assert.equal((await f.post(input)).statusCode, 201);
  assert.equal((await f.post(request())).statusCode, 429);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM shared_decks').get()?.n, 1);
  const tooSmall = await setup({ quotas: { ...defaultPublicationQuotas, accountBytes: bytes - 1 } }); t.after(() => tooSmall.app.close());
  assert.equal((await tooSmall.post(input)).statusCode, 429);
  assert.equal(tooSmall.store.db.prepare('SELECT count(*) AS n FROM shared_decks').get()?.n, 0);
});

test('sharing migration and immutable snapshots survive database reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ride-sharing-')); const path = join(dir, 'app.sqlite');
  try {
    const auth = new AuthStore(path); const account = auth.invite('rider@example.com'); const sharing = new SharingStore(auth.db);
    const input = publishRequestSchema.parse(request()); const snapshot = sharing.publish(account.id, input); auth.close();
    const reopened = new AuthStore(path); const store = new SharingStore(reopened.db);
    assert.deepEqual(store.get(snapshot.id), snapshot); assert.deepEqual(store.publish(account.id, input), snapshot);
    assert.equal(reopened.db.prepare('SELECT max(version) AS version FROM sharing_migrations').get()?.version, 1);
    reopened.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('generated OpenAPI uses the runtime sharing schemas and implemented operations', () => {
  const contract = JSON.parse(readFileSync('openapi.json', 'utf8'));
  assert.deepEqual(contract.components.schemas.PublishRequest, z.toJSONSchema(publishRequestSchema));
  assert.deepEqual(contract.components.schemas.SharedDeckResponse, z.toJSONSchema(sharedDeckResponseSchema));
  assert.deepEqual(contract.components.schemas.PublicationResponse, z.toJSONSchema(publicationResponseSchema));
  assert.ok(contract.paths['/api/v1/shared-decks'].post.responses['409']);
  assert.ok(contract.paths['/api/v1/shared-decks/{id}'].get.responses['404']);
});
