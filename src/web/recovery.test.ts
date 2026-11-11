import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getStarterLibrary } from '../content/starter-library';
import { openPracticeRepository } from '../repositories/indexed-db';
import { exportBackup, restoreBackup } from './recovery/archive';

async function seed() {
  const repo = await openPracticeRepository(crypto.randomUUID());
  await repo.saveDeck({ schemaVersion: 1, id: crypto.randomUUID(), title: 'Backup practice',
    generationInputs: { timeBudgetMinutes: 20, focuses: [], equipment: { cones: 'unspecified', incline: 'unspecified', obstacle: 'unspecified' } },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    entries: getStarterLibrary().drills.map(drill => ({ id: crypto.randomUUID(), drill, plannedDurationMinutes: 10 })) });
  return repo;
}
test('JSON export roundtrips through recovery with an explicit dedup/conflict report', async () => {
  const source = await seed(); const target = await openPracticeRepository(crypto.randomUUID());
  const backup = await exportBackup(source);
  const first = await restoreBackup(target, backup); assert.equal(first.imported.length, 4);
  const second = await restoreBackup(target, backup); assert.equal(second.skipped.length, 4);
  const changed = JSON.parse(backup); changed.decks[0].title = 'Conflicting title';
  const report = await restoreBackup(target, JSON.stringify(changed)); assert.equal(report.conflicting.length, 1);
  assert.equal((await target.listDecks())[0].title, 'Backup practice');
  source.close(); target.close();
});
test('recovery rejects malformed/unsupported/private fields before writing and preserves data', async () => {
  const repo = await seed(); const backup = await exportBackup(repo); const value = JSON.parse(backup);
  await assert.rejects(restoreBackup(repo, '{bad'), /not valid JSON/);
  await assert.rejects(restoreBackup(repo, JSON.stringify({ ...value, archiveVersion: 2 })), /unsupported version/);
  await assert.rejects(restoreBackup(repo, JSON.stringify({ ...value, accountEmail: 'secret@example.com' })), /Nothing was imported/);
  assert.equal((await repo.listDecks()).length, 1);
  assert.doesNotMatch(backup, /accountEmail|csrfToken|sessionSecret|loginToken|requestId/);
  repo.close();
});
test('recovery surfaces write failures instead of returning false success', async () => {
  const repo = await seed(); const backup = await exportBackup(repo); repo.close();
  await assert.rejects(restoreBackup(repo, backup));
});
