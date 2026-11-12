import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Operator-only stdin tool, shipped in the container. Never exposed over HTTP.
const path = resolve(process.env.DATABASE_PATH ?? 'data/ride-remix.sqlite');
if (!existsSync(path)) throw new Error('Database does not exist. Check DATABASE_PATH and the mounted volume.');
const sql = readFileSync(0, 'utf8').trim();
if (!sql) throw new Error('Provide one SQL statement on stdin');
const db = new DatabaseSync(path);
try {
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const statement = db.prepare(sql);
  if (statement.columns().length) console.table(statement.all());
  else console.info({ changes: Number(statement.run().changes) });
} finally { db.close(); }
