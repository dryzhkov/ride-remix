import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getStarterLibrary } from '../content/starter-library';
import { PracticeController } from '../domain/practice';
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

test('skip rating records done without answers; skip drill records skipped and completes session', async t => {
  const { repository, controller } = await setup(); t.after(() => repository.close());
  controller.openRating(); await controller.rate(); await controller.skip();
  const results = await repository.listResults();
  const entries = controller.getSnapshot().session!.deckSnapshot.entries;
  const orderedResults = entries.map(entry => results.find(result => result.entryId === entry.id)!);
  assert.deepEqual(orderedResults.map(r => [r.status, r.answers]), [['done', {}], ['skipped', {}]]);
  assert.equal(controller.getSnapshot().session?.status, 'completed');
  assert.ok(controller.getSnapshot().session?.endedAt);
  controller.openRating(); await controller.skip(); await controller.endEarly();
  assert.equal((await repository.listResults()).length, 2);
  const reopened = new PracticeController(repository); await reopened.load();
  assert.equal(reopened.getSnapshot().session, undefined);
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
  assert.equal(fresh.getSnapshot().session?.currentEntry, 1);
});
