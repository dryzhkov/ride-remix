import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getStarterLibrary } from '../content/starter-library';
import { PracticeController } from '../domain/practice';
import { archiveSchema, sessionEntries } from '../domain/schemas';
import type { Deck } from '../domain/schemas';
import { openPracticeRepository } from './indexed-db';

function makeDeck(): Deck {
  const now = new Date().toISOString();
  return { schemaVersion: 1, id: crypto.randomUUID(), title: 'Practice flow',
    createdAt: now, updatedAt: now,
    generationInputs: { timeBudgetMinutes: 20, focuses: [], equipment: { cones: 'available', incline: 'unspecified', obstacle: 'unspecified' } },
    entries: getStarterLibrary().drills.slice(0, 2).map(drill => ({ id: crypto.randomUUID(), drill, plannedDurationMinutes: 10 })),
  };
}
async function setup() {
  const repository = await openPracticeRepository(crypto.randomUUID());
  const deck = makeDeck(); await repository.saveDeck(deck);
  const session = await repository.startSession(deck.id);
  const controller = new PracticeController(repository); await controller.load();
  return { repository, deck, session, controller };
}

test('Practice resumes the snapshot and Done opens an optional question without writing', async t => {
  const { repository, deck, session, controller } = await setup(); t.after(() => repository.close());
  deck.title = 'Changed deck'; await repository.saveDeck(deck);
  assert.equal(controller.getSnapshot().session?.id, session.id);
  assert.equal(controller.getSnapshot().session?.deckSnapshot.title, 'Practice flow');
  controller.openRating(); assert.equal(controller.getSnapshot().rating, true);
  assert.equal((await repository.listResults()).length, 0);
  controller.cancelRating(); assert.equal(controller.getSnapshot().rating, false);
  assert.equal(controller.getSnapshot().session?.currentEntry, 0);
});

test('one rating tap saves v1 answer/setup and advances; rapid duplicate taps do not affect next drill', async t => {
  const { repository, controller } = await setup(); t.after(() => repository.close());
  controller.openRating();
  await Promise.all([controller.rate('consistent'), controller.rate('repeatable'), controller.skip()]);
  const results = await repository.listResults();
  assert.equal(results.length, 1); assert.deepEqual(results[0].answers, { feel: 'consistent' });
  assert.equal(results[0].questionnaireVersion, 'v1');
  assert.deepEqual(results[0].setupSnapshot, controller.getSnapshot().session?.deckSnapshot.entries[0].drill.setupDetails);
  assert.equal(controller.getSnapshot().session?.currentEntry, 1);
  assert.equal(controller.getSnapshot().rating, false);
  await controller.rate('repeatable'); // A late click from the previous question has no effect.
  assert.equal((await repository.listResults()).length, 1);
});

test('skip for now rotates the remaining queue without recording a result; the last drill stays available', async t => {
  const { repository, controller, deck } = await setup(); t.after(() => repository.close());
  await Promise.all([controller.skip(), controller.skip()]);
  const deferred = controller.getSnapshot().session!;
  assert.equal(deferred.currentEntry, 0);
  assert.deepEqual(sessionEntries(deferred).map(e => e.id), deck.entries.map(e => e.id).reverse());
  assert.deepEqual(deferred.deckSnapshot.entries, deck.entries);
  assert.deepEqual((await repository.listDecks())[0].entries, deck.entries);
  assert.equal((await repository.listResults()).length, 0);
  controller.openRating(); await controller.rate();
  assert.equal(controller.getSnapshot().session?.currentEntry, 1);
  await controller.skip();
  assert.equal(controller.getSnapshot().session?.status, 'active');
  assert.equal(controller.getSnapshot().session?.currentEntry, 1);
  controller.openRating(); await controller.rate('consistent');
  assert.equal(controller.getSnapshot().session?.status, 'completed');
  assert.ok(controller.getSnapshot().session?.endedAt);
  assert.deepEqual((await repository.listResults()).map(r => r.status), ['done', 'done']);
  const reopened = new PracticeController(repository); await reopened.load();
  assert.equal(reopened.getSnapshot().session, undefined);
});

test('deferred queue survives backup, restore and reload, with completed entries kept in order', async t => {
  const { repository, controller } = await setup(); t.after(() => repository.close());
  await controller.skip();
  controller.openRating(); await controller.rate('consistent');
  const before = controller.getSnapshot().session!;
  const archive = await repository.exportArchive();
  const restored = await openPracticeRepository(crypto.randomUUID()); t.after(() => restored.close());
  await restored.importArchive(archive);
  const fresh = new PracticeController(restored); await fresh.load();
  assert.deepEqual(fresh.getSnapshot().session, before);
  assert.equal((await restored.listResults()).length, 1);
});

test('deferral preserves completed prefix and concurrent retries cannot rotate the queue twice', async t => {
  const repository = await openPracticeRepository(crypto.randomUUID()); t.after(() => repository.close());
  const deck = makeDeck();
  deck.entries = getStarterLibrary().drills.slice(0, 4).map(drill => ({ id: crypto.randomUUID(), drill, plannedDurationMinutes: 10 }));
  await repository.saveDeck(deck);
  const session = await repository.startSession(deck.id);
  const controller = new PracticeController(repository); await controller.load();
  controller.openRating(); await controller.rate('consistent');
  const entryId = deck.entries[1].id;
  await Promise.all([repository.deferEntry(session.id, entryId, 0), repository.deferEntry(session.id, entryId, 0)]);
  const queued = (await repository.listSessions())[0];
  assert.equal(queued.currentEntry, 1);
  assert.equal(queued.queueVersion, 1);
  assert.deepEqual(sessionEntries(queued).map(e => e.id), [deck.entries[0].id, deck.entries[2].id, deck.entries[3].id, entryId]);
  const archive = await repository.exportArchive();
  assert.ok(archiveSchema.safeParse(archive).success);
  const bad = structuredClone(archive);
  bad.sessions[0].entryOrder = [deck.entries[0].id, deck.entries[0].id];
  assert.equal(archiveSchema.safeParse(bad).success, false);
  bad.sessions[0].entryOrder = [crypto.randomUUID(), ...deck.entries.slice(1).map(e => e.id)];
  assert.equal(archiveSchema.safeParse(bad).success, false);
  await controller.load();
  controller.openRating(); await controller.rate('finding');
  assert.equal((await repository.listResults()).find(result => result.entryId === deck.entries[2].id)?.answers.feel, 'finding');
  await controller.endEarly();
  assert.equal((await repository.listResults()).length, 2);
  assert.equal(controller.getSnapshot().session?.status, 'ended-early');
});

test('defer retry after a committed write does not rotate twice', async t => {
  const { repository, controller } = await setup(); t.after(() => repository.close());
  const original = repository.deferEntry.bind(repository);
  repository.deferEntry = async (...args) => { await original(...args); throw new Error('Lost acknowledgement'); };
  await controller.skip();
  assert.equal(controller.getSnapshot().failedSave, true);
  const persisted = (await repository.listSessions())[0];
  repository.deferEntry = original;
  await controller.retrySave();
  assert.deepEqual(controller.getSnapshot().session, persisted);
  assert.equal((await repository.listResults()).length, 0);
});

test('write failure preserves current question, blocks other actions, and retries exact result intent', async t => {
  const { repository, controller } = await setup(); t.after(() => repository.close());
  const original = repository.recordResult.bind(repository);
  const attempts: string[] = [];
  repository.recordResult = async result => { attempts.push(result.id); throw new Error('Storage full'); };
  controller.openRating(); await controller.rate('finding');
  assert.equal(controller.getSnapshot().failedSave, true); assert.ok(controller.getSnapshot().error);
  assert.equal(controller.getSnapshot().session?.currentEntry, 0); assert.equal(controller.getSnapshot().rating, true);
  await controller.skip(); await controller.endEarly(); await controller.rate('repeatable');
  assert.equal(attempts.length, 1); assert.equal((await repository.listResults()).length, 0);
  repository.recordResult = async result => { attempts.push(result.id); return original(result); };
  await controller.retrySave();
  assert.equal(attempts[0], attempts[1]); assert.equal(controller.getSnapshot().failedSave, false);
  assert.equal(controller.getSnapshot().session?.currentEntry, 1);
  assert.deepEqual((await repository.listResults())[0].answers, { feel: 'finding' });
});

test('ambiguous acknowledgement failure retries safely after a commit without recording another result', async t => {
  const { repository, controller } = await setup(); t.after(() => repository.close());
  const original = repository.recordResult.bind(repository);
  repository.recordResult = async result => { await original(result); throw new Error('Acknowledgement failed'); };
  controller.openRating(); await controller.rate('repeatable');
  assert.equal(controller.getSnapshot().session?.currentEntry, 0);
  assert.equal((await repository.listResults()).length, 1);
  repository.recordResult = original; await controller.retrySave();
  assert.equal(controller.getSnapshot().session?.currentEntry, 1);
  assert.equal((await repository.listResults()).length, 1);
});

test('end early keeps prior results and leaves current unanswered drill unattempted; end failure is retryable', async t => {
  const { repository, controller } = await setup(); t.after(() => repository.close());
  controller.openRating(); await controller.rate('consistent'); controller.openRating();
  const original = repository.endSession.bind(repository);
  repository.endSession = async () => { throw new Error('Write failed'); };
  await controller.endEarly(); assert.equal(controller.getSnapshot().failedSave, true);
  assert.equal(controller.getSnapshot().session?.status, 'active');
  repository.endSession = original; await controller.retrySave();
  assert.equal(controller.getSnapshot().session?.status, 'ended-early');
  assert.equal((await repository.listResults()).length, 1);
  assert.equal(controller.getSnapshot().session?.currentEntry, 1);
});

test('fresh controller resumes persisted position; load errors stay visible and can be retried', async t => {
  const { repository, controller } = await setup(); t.after(() => repository.close());
  await controller.skip();
  const original = repository.listSessions.bind(repository);
  repository.listSessions = async () => { throw new Error('Read failed'); };
  const fresh = new PracticeController(repository); await fresh.load();
  assert.equal(fresh.getSnapshot().loading, false); assert.ok(fresh.getSnapshot().error);
  assert.equal(fresh.getSnapshot().session, undefined);
  repository.listSessions = original; await fresh.load();
  assert.equal(fresh.getSnapshot().error, undefined);
  assert.equal(fresh.getSnapshot().session?.currentEntry, 0);
  assert.equal(fresh.getSnapshot().session?.queueVersion, 1);
});
