import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from './auth/store';
import { SharingStore } from './sharing/store';
import { getStarterLibrary } from '../content/starter-library';
import { backupDatabase, verifyDatabase } from './backup';

test('online backup includes committed WAL data and restores accounts, sessions and publications', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ride-backup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'live.sqlite');
  const snapshot = join(directory, 'backup.sqlite');
  const restored = join(directory, 'restored.sqlite');
  const store = new AuthStore(source);
  t.after(() => store.close());
  const sharing = new SharingStore(store.db);
  const account = store.invite('backup@example.com');
  const login = store.redeem(store.issue(account.email)!)!;
  const now = new Date().toISOString();
  const published = sharing.publish(account.id, { payloadVersion: 1, requestId: crypto.randomUUID(), deck: {
    schemaVersion: 1, id: crypto.randomUUID(), title: 'Backup practice', createdAt: now, updatedAt: now,
    generationInputs: { timeBudgetMinutes: 20, focuses: [], equipment: { cones: 'unspecified', obstacle: 'unspecified', incline: 'unspecified' } },
    entries: getStarterLibrary().drills.slice(0, 1).map(drill => ({ id: crypto.randomUUID(), drill, plannedDurationMinutes: 10 })),
  } });
  await backupDatabase(source, snapshot);
  assert.equal(statSync(snapshot).mode & 0o777, 0o600);
  await assert.rejects(backupDatabase(source, snapshot), /EEXIST/);
  await assert.rejects(backupDatabase(source, source), /differ/);
  await assert.rejects(backupDatabase(join(directory, 'missing'), restored), /does not exist/);
  await backupDatabase(snapshot, restored);
  verifyDatabase(restored);
  const recovered = new AuthStore(restored);
  try {
    assert.equal(recovered.account(account.email)?.status, 'active');
    assert.equal(recovered.session(login.secret).status, 'ok');
    assert.deepEqual(new SharingStore(recovered.db).get(published.id), published);
    recovered.invite('new@example.com');
    assert.equal(store.account('new@example.com'), undefined);
  } finally { recovered.close(); }
});
