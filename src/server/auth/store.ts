import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { emailSchema } from '../../contracts/auth';

export const LOGIN_LIFETIME = 15 * 60_000;
export const SESSION_LIFETIME = 30 * 24 * 60 * 60_000;
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');
export const csrfFor = (secret: string) => hashSecret(`ride-remix-csrf:${secret}`);
const secret = () => randomBytes(32).toString('base64url');
export interface Account { id: string; email: string; status: 'pending' | 'invited' | 'active' | 'revoked' }
interface SessionRow { account_id: string; email: string; status: string; expires_at: number; revoked_at: number | null }
export type SessionLookup = { status: 'ok'; account: { id: string; email: string }; expiresAt: string; csrfToken: string } | { status: 'missing' | 'revoked' };

export class AuthStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
    if (version === 0) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('invited','active','revoked')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE login_tokens (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL, consumed_at INTEGER);
      CREATE INDEX login_tokens_account ON login_tokens(account_id);
      CREATE TABLE auth_sessions (secret_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);
      CREATE INDEX auth_sessions_account ON auth_sessions(account_id);
      CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
    else if (version !== 1 && version !== 2 && version !== 3) { this.db.close(); throw new Error('Unsupported server database version'); }
    if (version === 0 || version === 1) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE login_deliveries (id INTEGER PRIMARY KEY, email TEXT NOT NULL, requested_at INTEGER NOT NULL);
      PRAGMA user_version=2; COMMIT;`);
    if (version !== 3) {
      // Rebuild the CHECK constraint while keeping child foreign keys named accounts.
      this.db.exec('PRAGMA foreign_keys=OFF;');
      try {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE accounts_new (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('pending','invited','active','revoked')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
          INSERT INTO accounts_new SELECT * FROM accounts;
          DROP TABLE accounts;
          ALTER TABLE accounts_new RENAME TO accounts;
          CREATE INDEX accounts_status_created ON accounts(status,created_at);
          CREATE TABLE IF NOT EXISTS challenge_uses (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
          PRAGMA user_version=3; COMMIT;`);
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch { /* Transaction may have failed before beginning. */ }
        this.db.close(); throw error;
      }
      this.db.exec('PRAGMA foreign_keys=ON;');
      if (this.db.prepare('PRAGMA foreign_key_check').all().length) { this.db.close(); throw new Error('Invalid migrated database references'); }
    }
  }
  requestAccess(email: string, now = Date.now()): boolean {
    email = emailSchema.parse(email);
    return this.transaction(() => {
      this.db.prepare("DELETE FROM accounts WHERE status='pending' AND created_at<=?").run(now - 30 * 24 * 60 * 60_000);
      if (this.account(email)) return true;
      if (Number(this.db.prepare("SELECT count(*) AS n FROM accounts WHERE status='pending'").get()?.n) >= 1000) return false;
      this.db.prepare("INSERT INTO accounts VALUES (?,?,'pending',?,?)").run(randomUUID(), email, now, now);
      return true;
    });
  }
  consumeChallenge(token: string, now = Date.now()): boolean {
    return this.transaction(() => {
      this.db.prepare('DELETE FROM challenge_uses WHERE expires_at<=?').run(now);
      if (Number(this.db.prepare('SELECT count(*) AS n FROM challenge_uses').get()?.n) >= 10000) return false;
      return this.db.prepare('INSERT OR IGNORE INTO challenge_uses VALUES (?,?)').run(hashSecret(token), now + 330_000).changes === 1;
    });
  }
  enqueueDelivery(email: string, now = Date.now()): boolean {
    return this.transaction(() => {
      this.db.prepare('DELETE FROM login_deliveries WHERE requested_at<=?').run(now - LOGIN_LIFETIME);
      if (Number(this.db.prepare('SELECT count(*) AS n FROM login_deliveries').get()?.n) >= 1000) return false;
      this.db.prepare('INSERT INTO login_deliveries (email,requested_at) VALUES (?,?)').run(emailSchema.parse(email), now);
      return true;
    });
  }
  nextDelivery() {
    return this.db.prepare('SELECT id,email,requested_at FROM login_deliveries ORDER BY id LIMIT 1').get() as { id: number; email: string; requested_at: number } | undefined;
  }
  completeDelivery(id: number) { this.db.prepare('DELETE FROM login_deliveries WHERE id=?').run(id); }
  close() { this.db.close(); }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = run(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  account(email: string): Account | undefined {
    return this.db.prepare('SELECT id,email,status FROM accounts WHERE email=?').get(emailSchema.parse(email)) as unknown as Account | undefined;
  }
  invite(email: string, now = Date.now()): Account {
    email = emailSchema.parse(email);
    return this.transaction(() => {
      const existing = this.account(email);
      if (existing) {
        this.db.prepare("UPDATE accounts SET status=CASE WHEN status IN ('pending','revoked') THEN 'invited' ELSE status END, updated_at=? WHERE id=?").run(now, existing.id);
      } else this.db.prepare("INSERT INTO accounts VALUES (?,?,'invited',?,?)").run(randomUUID(), email, now, now);
      return this.account(email)!;
    });
  }
  revoke(email: string, now = Date.now()): boolean {
    return this.transaction(() => {
      const account = this.account(email);
      if (!account) return false;
      this.db.prepare("UPDATE accounts SET status='revoked',updated_at=? WHERE id=?").run(now, account.id);
      this.db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE account_id=?').run(now, account.id);
      this.db.prepare('UPDATE login_tokens SET consumed_at=? WHERE account_id=?').run(now, account.id);
      return true;
    });
  }
  /** Persistent buckets are shared by HTTP and operator CLI. Keys contain hashes, never email/IP. */
  allow(buckets: { key: string; limit: number; window: number }[], now = Date.now()): boolean {
    return this.transaction(() => {
      this.db.prepare('DELETE FROM rate_limits WHERE reset_at<=?').run(now);
      const rows = buckets.map(b => ({ ...b, key: hashSecret(b.key) }));
      for (const b of rows) {
        const row = this.db.prepare('SELECT count FROM rate_limits WHERE key=?').get(b.key);
        if (row && Number(row.count) >= b.limit) return false;
      }
      for (const b of rows) this.db.prepare('INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(b.key, now + b.window);
      return true;
    });
  }
  issue(email: string, now = Date.now()): string | undefined {
    return this.transaction(() => {
      const account = this.account(email);
      if (!account || !['invited', 'active'].includes(account.status)) return undefined;
      this.db.prepare('DELETE FROM login_tokens WHERE expires_at<=? OR consumed_at IS NOT NULL').run(now);
      // A replacement link supersedes older links, bounding outstanding token storage.
      this.db.prepare('DELETE FROM login_tokens WHERE account_id=?').run(account.id);
      const token = secret();
      this.db.prepare('INSERT INTO login_tokens VALUES (?,?,?,NULL)').run(hashSecret(token), account.id, now + LOGIN_LIFETIME);
      return token;
    });
  }
  discardToken(token: string) { this.db.prepare('DELETE FROM login_tokens WHERE token_hash=?').run(hashSecret(token)); }
  redeem(token: string, now = Date.now()) {
    return this.transaction(() => {
      const row = this.db.prepare(`SELECT a.id,a.email FROM login_tokens t JOIN accounts a ON a.id=t.account_id
        WHERE t.token_hash=? AND t.expires_at>? AND t.consumed_at IS NULL AND a.status IN ('invited','active')`).get(hashSecret(token), now);
      if (!row) return undefined;
      this.db.prepare('UPDATE login_tokens SET consumed_at=? WHERE token_hash=?').run(now, hashSecret(token));
      this.db.prepare("UPDATE accounts SET status='active',updated_at=? WHERE id=?").run(now, row.id!);
      this.db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(now);
      const sessionSecret = secret();
      this.db.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?,NULL)').run(hashSecret(sessionSecret), row.id!, now, now + SESSION_LIFETIME);
      return { secret: sessionSecret, account: { id: String(row.id), email: String(row.email) }, csrfToken: csrfFor(sessionSecret) };
    });
  }
  session(sessionSecret: string | undefined, now = Date.now()): SessionLookup {
    if (!sessionSecret || !/^[A-Za-z0-9_-]{43}$/.test(sessionSecret)) return { status: 'missing' };
    const row = this.db.prepare(`SELECT s.account_id,a.email,a.status,s.expires_at,s.revoked_at
      FROM auth_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.secret_hash=?`).get(hashSecret(sessionSecret)) as unknown as SessionRow | undefined;
    if (!row || row.expires_at <= now) return { status: 'missing' };
    if (row.revoked_at !== null || !['invited', 'active'].includes(row.status)) return { status: 'revoked' };
    return { status: 'ok', account: { id: row.account_id, email: row.email }, expiresAt: new Date(row.expires_at).toISOString(), csrfToken: csrfFor(sessionSecret) };
  }
  logout(sessionSecret: string, now = Date.now()) {
    this.db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE secret_hash=?').run(now, hashSecret(sessionSecret));
  }
}
