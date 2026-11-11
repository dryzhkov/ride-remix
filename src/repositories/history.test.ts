import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getStarterLibrary } from '../content/starter-library';
import { openPracticeRepository } from './indexed-db';
import { deckFromHistory, repeatDeck } from '../domain/history';
import type { DrillResult, Session } from '../domain/schemas';

function result(s: Session, index: number, status: DrillResult['status'], rated = true): DrillResult {
  return { schemaVersion: 1, id: crypto.randomUUID(), sessionId: s.id, entryId: s.deckSnapshot.entries[index].id,
    status, completedAt: s.startedAt, questionnaireVersion: 'v1', answers: rated && status === 'done' ? { feel: 'consistent' } : {},
    setupSnapshot: structuredClone(s.deckSnapshot.entries[index].drill.setupDetails) };
}

test('repeating history persists a fresh deck/session without changing prior attempts or active session', async () => {
  const repo = await openPracticeRepository(crypto.randomUUID());
  try {
    const d = deckFromHistory(getStarterLibrary().drills); await repo.saveDeck(d);
    const initial = await repo.startSession(d.id); await repo.recordResult(result(initial, 0, 'done'));
    await repo.endSession(initial.id);
    const before = await repo.exportArchive();
    const nextDeck = repeatDeck(before.sessions[0].deckSnapshot); await repo.saveDeck(nextDeck);
    const next = await repo.startSession(nextDeck.id);
    assert.notEqual(next.id, initial.id); assert.equal(next.currentEntry, 0);
    assert.deepEqual((await repo.listResults()), before.results);
    assert.deepEqual((await repo.listSessions()).find(s => s.id === initial.id), before.sessions[0]);
    const thirdDeck = repeatDeck(d); await repo.saveDeck(thirdDeck);
    await assert.rejects(repo.startSession(thirdDeck.id), /active session/);
    assert.equal((await repo.listSessions()).find(s => s.status === 'active')?.id, next.id);
  } finally { repo.close(); }
});
