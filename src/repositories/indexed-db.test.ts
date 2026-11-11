import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPracticeRepository } from './indexed-db';
import { archiveSchema, resultSchema } from '../domain/schemas';
import type { Deck, DrillResult, Session } from '../domain/schemas';

function deck(): Deck {
  const now = new Date().toISOString();
  return { schemaVersion: 1, id: crypto.randomUUID(), title: 'Practice', createdAt: now, updatedAt: now,
    generationInputs: { timeBudgetMinutes: 20, focuses: [], equipment: { cones: 'unspecified', obstacle: 'unavailable', incline: 'available' } },
    entries: [0, 1].map(() => ({ id: crypto.randomUUID(), plannedDurationMinutes: 10,
      drill: { schemaVersion: 1, id: crypto.randomUUID(), revisionId: crypto.randomUUID(), origin: 'custom',
        title: 'Balance', cue: 'Look ahead', instructions: ['Practice'], setupDetails: ['Flat ground'], focusTags: ['balance'],
        requiredEquipment: [], terrainRequirements: [], automaticGeneration: true, suggestedDurationMinutes: 10, createdAt: now } })) };
}
function result(s: Session, index = s.currentEntry): DrillResult {
  return { schemaVersion: 1, id: crypto.randomUUID(), sessionId: s.id, entryId: s.deckSnapshot.entries[index].id,
    status: 'done', completedAt: new Date().toISOString(), questionnaireVersion: 'v1', answers: { feel: 'finding' },
    setupSnapshot: s.deckSnapshot.entries[index].drill.setupDetails };
}
const open = () => openPracticeRepository(crypto.randomUUID());

test('concurrent starts enforce a single active session; snapshots and revisions are immutable', async () => {
  const repo = await open(); const d = deck(); await repo.saveDeck(d);
  const starts = await Promise.allSettled([repo.startSession(d.id), repo.startSession(d.id)]);
  assert.equal(starts.filter(r => r.status === 'fulfilled').length, 1);
  d.title = 'Edited'; await repo.saveDeck(d);
  assert.equal((await repo.listSessions())[0].deckSnapshot.title, 'Practice');
  await assert.rejects(repo.saveRevision({ ...d.entries[0].drill, title: 'Mutation' }), /immutable/);
  assert.equal((await repo.listRevisions())[0].title, 'Balance'); repo.close();
});

test('concurrent duplicate taps advance once; skip and completion persist atomically', async () => {
  const repo = await open(); const d = deck(); await repo.saveDeck(d); const s = await repo.startSession(d.id);
  await Promise.all([repo.recordResult(result(s)), repo.recordResult(result(s))]);
  assert.equal((await repo.listResults()).length, 1);
  const current = (await repo.listSessions())[0]; assert.equal(current.currentEntry, 1);
  const skip = { ...result(current), status: 'skipped' as const, answers: {} };
  await repo.recordResult(skip);
  assert.equal((await repo.listSessions())[0].status, 'completed');
  await repo.recordResult(skip); assert.equal((await repo.listResults()).length, 2); repo.close();
});

test('invalid writes roll back result and session; ending early preserves unattempted entries', async () => {
  const repo = await open(); const d = deck(); await repo.saveDeck(d); const s = await repo.startSession(d.id);
  await assert.rejects(repo.recordResult({ ...result(s), setupSnapshot: ['Wrong setup'] }));
  assert.equal((await repo.listResults()).length, 0); assert.equal((await repo.listSessions())[0].currentEntry, 0);
  await assert.rejects(repo.recordResult(result(s, 1)), /not current/);
  await repo.recordResult(result(s)); await repo.endSession(s.id);
  assert.equal((await repo.listSessions())[0].status, 'ended-early');
  assert.equal((await repo.listResults()).length, 1); repo.close();
});

test('backup roundtrip, deduplication, local wins conflicts, and malformed archive rejection', async () => {
  const source = await open(); const target = await open(); const d = deck();
  await source.saveDeck(d); const s = await source.startSession(d.id); await source.recordResult(result(s));
  const archive = await source.exportArchive();
  const report = await target.importArchive(JSON.parse(JSON.stringify(archive)));
  assert.equal(report.imported.length, 5); // two revisions, deck, session, result
  assert.equal((await target.importArchive(archive)).skipped.length, 5);
  const modified = structuredClone(archive); modified.decks[0].title = 'Conflict';
  assert.deepEqual((await target.importArchive(modified)).conflicting, [`deck:${d.id}`]);
  assert.equal((await target.listDecks())[0].title, 'Practice');
  await assert.rejects(target.importArchive({ ...archive, archiveVersion: 2 }));
  await assert.rejects(target.importArchive({ ...archive, accountEmail: 'private@example.com' }));
  const broken = structuredClone(archive); broken.results = [];
  await assert.rejects(target.importArchive(broken));
  assert.equal((await target.listResults()).length, 1); source.close(); target.close();
});

test('import preserves current active session and reports rejected session/results', async () => {
  const source = await open(); const target = await open(); const d = deck();
  await source.saveDeck(d); const imported = await source.startSession(d.id); await source.recordResult(result(imported));
  const own = deck(); await target.saveDeck(own); const active = await target.startSession(own.id);
  const report = await target.importArchive(await source.exportArchive());
  assert.ok(report.conflicting.includes(`session:${imported.id}`));
  assert.equal(report.conflicting.filter(s => s.startsWith('result:')).length, 1);
  assert.equal((await target.listSessions())[0].id, active.id); assert.equal((await target.listResults()).length, 0);
  source.close(); target.close();
});

test('conflicting historical session and revision imports never rewrite snapshots', async () => {
  const source = await open(); const target = await open(); const d = deck(); await source.saveDeck(d);
  const s = await source.startSession(d.id); const original = await source.exportArchive();
  await target.importArchive(original); await source.recordResult(result(s));
  const report = await target.importArchive(await source.exportArchive());
  assert.ok(report.conflicting.includes(`session:${s.id}`)); assert.equal((await target.listResults()).length, 0);
  const changed = structuredClone(original); changed.revisions[0].cue = 'Different';
  await assert.rejects(target.importArchive(changed), /immutable/);
  source.close(); target.close();
});

test('reopening version 1 preserves all stores and embedded revisions', async () => {
  const name = crypto.randomUUID(); const repo = await openPracticeRepository(name); const d = deck();
  await repo.saveDeck(d); await repo.startSession(d.id); const before = await repo.exportArchive(); repo.close();
  const reopened = await openPracticeRepository(name); const after = await reopened.exportArchive();
  assert.deepEqual({ ...after, exportedAt: before.exportedAt }, before); reopened.close();
});

test('schemas reject duplicate logical drills and unknown questionnaire versions', async () => {
  const repo = await open(); const valid = deck(); await repo.saveDeck(valid);
  const session = await repo.startSession(valid.id);
  assert.equal(resultSchema.safeParse({ ...result(session), questionnaireVersion: 'v2' }).success, false);
  repo.close();
  const d = deck(); d.entries[1].drill = structuredClone(d.entries[0].drill);
  assert.equal(archiveSchema.safeParse({ archiveVersion: 1, exportedAt: new Date().toISOString(), revisions: [], decks: [d], sessions: [], results: [] }).success, false);
});
