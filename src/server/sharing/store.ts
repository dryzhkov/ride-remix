import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { sharedDeckResponseSchema } from '../../contracts/sharing';
import type { PublishRequest, SharedDeck } from '../../contracts/sharing';

export interface PublicationQuotas {
  accountCount: number; totalCount: number; accountBytes: number; totalBytes: number;
}
export const defaultPublicationQuotas: PublicationQuotas = {
  accountCount: 1000, totalCount: 10000, accountBytes: 20 * 1024 * 1024, totalBytes: 200 * 1024 * 1024,
};
export class PublicationConflict extends Error {}
export class PublicationQuotaExceeded extends Error {}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
interface PublicationRow {
  id: string; publisher_id: string; request_id: string; payload_hash: string;
  payload: string; created_at: string;
}
/** Sharing owns an independent migration ledger on the same persistent auth database. */
export class SharingStore {
  constructor(private db: DatabaseSync, readonly quotas: PublicationQuotas = defaultPublicationQuotas) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS sharing_migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS shared_decks (
        id TEXT PRIMARY KEY, publisher_id TEXT NOT NULL REFERENCES accounts(id), request_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL, payload TEXT NOT NULL, payload_bytes INTEGER NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(publisher_id,request_id));
      CREATE INDEX IF NOT EXISTS shared_decks_publisher ON shared_decks(publisher_id);
      INSERT OR IGNORE INTO sharing_migrations VALUES (1);
      COMMIT;`);
    const version = db.prepare('SELECT max(version) AS version FROM sharing_migrations').get()?.version;
    if (version !== 1) throw new Error('Unsupported sharing database version');
  }
  get(id: string): SharedDeck | undefined {
    const row = this.db.prepare('SELECT id,payload,created_at FROM shared_decks WHERE id=?').get(id) as unknown as PublicationRow | undefined;
    if (!row) return undefined;
    return sharedDeckResponseSchema.parse({ id: row.id, createdAt: row.created_at, payloadVersion: 1, deck: JSON.parse(row.payload) });
  }
  publish(accountId: string, request: PublishRequest, now = Date.now()): SharedDeck {
    const payload = canonicalJson(request.deck);
    const hash = createHash('sha256').update(payload).digest('hex');
    const bytes = Buffer.byteLength(payload);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT * FROM shared_decks WHERE publisher_id=? AND request_id=?').get(accountId, request.requestId) as unknown as PublicationRow | undefined;
      if (previous) {
        if (previous.payload_hash !== hash) throw new PublicationConflict('Request ID already has a different snapshot');
        const result = this.get(previous.id)!;
        this.db.exec('COMMIT'); return result;
      }
      const total = this.db.prepare('SELECT count(*) AS count,coalesce(sum(payload_bytes),0) AS bytes FROM shared_decks').get()!;
      const account = this.db.prepare('SELECT count(*) AS count,coalesce(sum(payload_bytes),0) AS bytes FROM shared_decks WHERE publisher_id=?').get(accountId)!;
      if (Number(total.count) >= this.quotas.totalCount || Number(account.count) >= this.quotas.accountCount ||
        Number(total.bytes) + bytes > this.quotas.totalBytes || Number(account.bytes) + bytes > this.quotas.accountBytes) throw new PublicationQuotaExceeded('Publication storage quota reached');
      const id = randomBytes(24).toString('base64url');
      const createdAt = new Date(now).toISOString();
      this.db.prepare('INSERT INTO shared_decks VALUES (?,?,?,?,?,?,?)').run(id, accountId, request.requestId, hash, payload, bytes, createdAt);
      this.db.exec('COMMIT');
      return { id, createdAt, payloadVersion: 1, deck: request.deck };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
