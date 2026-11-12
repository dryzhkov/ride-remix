import { backup, DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, existsSync, openSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function verifyDatabase(path: string): void {
  if (!existsSync(path)) throw new Error('Database does not exist');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') throw new Error('Database integrity check failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database foreign-key check failed');
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 3) throw new Error('Unexpected authentication schema version');
    const sharing = db.prepare('SELECT max(version) AS version FROM sharing_migrations').get()?.version;
    if (sharing !== 1) throw new Error('Unexpected sharing schema version');
  } finally { db.close(); }
}

/** SQLite online backup includes committed WAL content in a consistent snapshot. */
export async function backupDatabase(source: string, destination: string): Promise<void> {
  source = resolve(source); destination = resolve(destination);
  if (!existsSync(source)) throw new Error('Source database does not exist');
  if (source === destination) throw new Error('Backup destination must differ from source');
  closeSync(openSync(destination, 'wx', 0o600));
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(source, { readOnly: true });
    await backup(db, destination);
    chmodSync(destination, 0o600);
    verifyDatabase(destination);
  } catch (error) {
    unlinkSync(destination);
    throw error;
  } finally { db?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, source, destination] = process.argv.slice(2);
  if (command === 'backup' && source && destination) await backupDatabase(source, destination);
  else if (command === 'verify' && source && !destination) verifyDatabase(source);
  else throw new Error('Usage: backup.js backup SOURCE NEW_DESTINATION | verify DATABASE');
  console.info('Database verification passed');
}
