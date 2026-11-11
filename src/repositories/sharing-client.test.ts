import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getStarterLibrary } from '../content/starter-library';
import type { Deck } from '../domain/schemas';
import type { AuthSessionResponse } from '../contracts/auth';
import { publicationResponseSchema, sharingFixtures } from '../contracts/sharing';
import type { PublishRequest } from '../contracts/sharing';
import { DeckPublisher } from '../web/sharing/publisher';
import { openPracticeRepository } from './indexed-db';

function deck(): Deck {
  const now = new Date().toISOString();
  return { schemaVersion: 1, id: crypto.randomUUID(), title: 'Shared practice', createdAt: now, updatedAt: now,
    generationInputs: { timeBudgetMinutes: 20, focuses: [], equipment: { cones: 'available', incline: 'unspecified', obstacle: 'unspecified' } },
    entries: getStarterLibrary().drills.slice(0, 2).map(drill => ({ id: crypto.randomUUID(), drill, plannedDurationMinutes: 10 })),
  };
}
const publication = () => publicationResponseSchema.parse(sharingFixtures.publication);
function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function session(id = crypto.randomUUID()): AuthSessionResponse {
  return { account: { id, email: 'rider@example.com' }, csrfToken: 'a'.repeat(64), expiresAt: '2026-12-10T00:00:00.000Z' };
}
const open = () => openPracticeRepository(crypto.randomUUID());

test('shared save is atomic, creates a new deck/entries, and repeated saves preserve local edits without duplicate revisions', async t => {
  const repository = await open(); t.after(() => repository.close()); const snapshot = deck();
  const [first, second] = await Promise.all([repository.saveSharedDeck(snapshot, 'a'.repeat(32)), repository.saveSharedDeck(snapshot, 'a'.repeat(32))]);
  assert.equal(first.id, second.id); assert.notEqual(first.id, snapshot.id);
  assert.notEqual(first.entries[0].id, snapshot.entries[0].id);
  assert.equal((await repository.listDecks()).length, 1); assert.equal((await repository.listRevisions()).length, 2);
  first.title = 'My local edit'; await repository.saveDeck(first);
  assert.equal((await repository.saveSharedDeck(snapshot, 'a'.repeat(32))).title, 'My local edit');
  assert.equal(snapshot.title, 'Shared practice');
  const otherLink = await repository.saveSharedDeck(snapshot, 'b'.repeat(32));
  assert.notEqual(otherLink.id, first.id); assert.equal((await repository.listRevisions()).length, 2);
});

test('conflicting incoming revision IDs are remapped without overwriting local content', async t => {
  const repository = await open(); t.after(() => repository.close());
  const incoming = deck(); const existing = structuredClone(incoming);
  existing.entries[0].drill.title = 'My conflicting local revision'; await repository.saveDeck(existing);
  const copy = await repository.saveSharedDeck(incoming, 'a'.repeat(32));
  assert.notEqual(copy.entries[0].drill.revisionId, incoming.entries[0].drill.revisionId);
  assert.equal(copy.entries[0].drill.title, incoming.entries[0].drill.title);
  assert.equal((await repository.listDecks()).find(d => d.id === existing.id)?.entries[0].drill.title, 'My conflicting local revision');
  assert.equal((await repository.listRevisions()).length, 3);
});

test('failed local save rolls back deck and all newly embedded revisions', async t => {
  const repository = await open(); t.after(() => repository.close());
  const original = IDBObjectStore.prototype.put;
  const mock = t.mock.method(IDBObjectStore.prototype, 'put', function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (this.name === 'decks') throw new DOMException('Storage full', 'QuotaExceededError');
    return original.call(this, value, key);
  });
  await assert.rejects(repository.saveSharedDeck(deck(), 'a'.repeat(32)));
  mock.mock.restore();
  assert.equal((await repository.listDecks()).length, 0); assert.equal((await repository.listRevisions()).length, 0);
});

test('publication retries retain the same request/account/snapshot after network failure and reload; backup excludes retry state', async t => {
  const repository = await open(); t.after(() => repository.close()); const source = deck(); await repository.saveDeck(source);
  const storage = memoryStorage(); const account = session(); const requests: PublishRequest[] = [];
  const failed = new DeckPublisher(repository, source.id, storage, { session: async () => account,
    publish: async request => { requests.push(request); throw new Error('Offline'); } });
  await failed.publish(); assert.ok(failed.getSnapshot().error); assert.equal(storage.values.size, 1);
  source.title = 'Changed since attempt'; await repository.saveDeck(source);
  const retry = new DeckPublisher(repository, source.id, storage, { session: async () => account,
    publish: async request => { requests.push(request); return publication(); } });
  await retry.publish();
  assert.deepEqual(requests[0], requests[1]); assert.equal(requests[1].deck.title, 'Shared practice');
  assert.ok(retry.getSnapshot().pending?.publication);
  const archive = JSON.stringify(await repository.exportArchive());
  assert.doesNotMatch(archive, /publisherAccountId|requestId|csrfToken|rider@example/);
});

test('switching accounts requires an explicit new-publication action before sending', async t => {
  const repository = await open(); t.after(() => repository.close()); const source = deck(); await repository.saveDeck(source);
  const storage = memoryStorage(); const firstAccount = session(); const nextAccount = session(); let sends = 0;
  const failed = new DeckPublisher(repository, source.id, storage, { session: async () => firstAccount, publish: async () => { throw new Error('Offline'); } });
  await failed.publish(); const previousId = failed.getSnapshot().pending!.request.requestId;
  const switched = new DeckPublisher(repository, source.id, storage, { session: async () => nextAccount, publish: async () => { sends++; return publication(); } });
  await switched.publish(); assert.equal(sends, 0); assert.equal(switched.getSnapshot().accountChanged, true);
  await switched.startNewPublication(); assert.equal(sends, 1);
  assert.notEqual(switched.getSnapshot().pending!.request.requestId, previousId);
  assert.equal(switched.getSnapshot().pending!.publisherAccountId, nextAccount.account.id);
});

test('unauthenticated or unavailable retry storage never publishes; rapid duplicate clicks send once', async t => {
  const repository = await open(); t.after(() => repository.close()); const source = deck(); await repository.saveDeck(source); let sends = 0;
  const client = { session: async () => session(), publish: async () => { sends++; return publication(); } };
  const unavailable = new DeckPublisher(repository, source.id, { ...memoryStorage(), setItem: () => { throw new Error('Storage unavailable'); } }, client);
  await unavailable.publish(); assert.equal(sends, 0); assert.ok(unavailable.getSnapshot().error);
  const loggedOut = new DeckPublisher(repository, source.id, memoryStorage(), { ...client, session: async () => { throw new Error('401'); } });
  await loggedOut.publish(); assert.equal(sends, 0); assert.equal(loggedOut.getSnapshot().needsLogin, true);
  const ready = new DeckPublisher(repository, source.id, memoryStorage(), client);
  await Promise.all([ready.publish(), ready.publish()]); assert.equal(sends, 1);
});
