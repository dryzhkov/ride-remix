import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { archiveSchema, deckSchema, drillRevisionSchema, resultSchema, sessionSchema } from '../domain/schemas';
import type { Archive, Deck, DrillRevision, DrillResult, Session } from '../domain/schemas';
import type { ImportReport, PracticeRepository } from '../domain/repository';

interface PracticeDB extends DBSchema {
  revisions: { key: string; value: DrillRevision };
  decks: { key: string; value: Deck };
  sessions: { key: string; value: Session };
  results: { key: string; value: DrillResult };
}
const stores = ['revisions', 'decks', 'sessions', 'results'] as const;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function addRevision(state: Archive, revision: DrillRevision) {
  const existing = state.revisions.find(r => r.revisionId === revision.revisionId);
  if (existing && !same(existing, revision)) throw new Error('Drill revisions are immutable');
  if (!existing) state.revisions.push(revision);
}
function collectRevisions(state: Archive) {
  for (const deck of [...state.decks, ...state.sessions.map(s => s.deckSnapshot)]) {
    for (const entry of deck.entries) addRevision(state, entry.drill);
  }
}

/** Version 1 creates the local stores. Future migrations belong in upgrade, never in UI code. */
export async function openPracticeRepository(name = 'ride-remix'): Promise<PracticeRepository> {
  const db = await openDB<PracticeDB>(name, 1, {
    upgrade(db) {
      db.createObjectStore('revisions', { keyPath: 'revisionId' });
      db.createObjectStore('decks', { keyPath: 'id' });
      db.createObjectStore('sessions', { keyPath: 'id' });
      db.createObjectStore('results', { keyPath: 'id' });
    },
    blocking() { db.close(); },
  });
  return new IndexedDBRepository(db);
}
class IndexedDBRepository implements PracticeRepository {
  constructor(private db: IDBPDatabase<PracticeDB>) {}
  close() { this.db.close(); }
  private async read(): Promise<Archive> {
    const tx = this.db.transaction(stores, 'readonly');
    const [revisions, decks, sessions, results] = await Promise.all(stores.map(s => tx.objectStore(s).getAll()));
    await tx.done;
    return archiveSchema.parse({ archiveVersion: 1, exportedAt: new Date().toISOString(), revisions, decks, sessions, results });
  }
  // All local writers share these stores in one transaction, including cross-tab writers.
  private async mutate<T>(change: (state: Archive) => T): Promise<T> {
    const tx = this.db.transaction(stores, 'readwrite');
    try {
      const [revisions, decks, sessions, results] = await Promise.all(stores.map(s => tx.objectStore(s).getAll()));
      const state = archiveSchema.parse({ archiveVersion: 1, exportedAt: new Date().toISOString(), revisions, decks, sessions, results });
      const result = change(state);
      collectRevisions(state);
      archiveSchema.parse(state);
      for (const r of state.revisions) await tx.objectStore('revisions').put(r);
      for (const d of state.decks) await tx.objectStore('decks').put(d);
      for (const s of state.sessions) await tx.objectStore('sessions').put(s);
      for (const r of state.results) await tx.objectStore('results').put(r);
      await tx.done;
      return result;
    } catch (error) {
      try { tx.abort(); } catch { /* Transaction may already have aborted. */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
  }
  async listRevisions() { return (await this.read()).revisions; }
  async listDecks() { return (await this.read()).decks; }
  async listSessions() { return (await this.read()).sessions; }
  async listResults() { return (await this.read()).results; }
  async exportArchive() { return this.read(); }
  async saveRevision(input: DrillRevision) {
    const revision = drillRevisionSchema.parse(input);
    await this.mutate(s => addRevision(s, revision));
  }
  async saveDeck(input: Deck) {
    const deck = deckSchema.parse(input);
    await this.mutate(s => {
      const index = s.decks.findIndex(d => d.id === deck.id);
      if (index < 0) s.decks.push(deck); else s.decks[index] = deck;
    });
  }
  async saveSharedDeck(input: Deck, publicId: string): Promise<Deck> {
    const snapshot = deckSchema.parse(input);
    if (!/^[A-Za-z0-9_-]{32}$/.test(publicId)) throw new Error('Invalid shared deck ID');
    // A stable recipient copy ID deduplicates repeated saves without exporting retry metadata.
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ride-remix:shared-copy:${publicId}`)));
    digest[6] = (digest[6] & 15) | 128; // UUID v8: application-defined content-derived identifier.
    digest[8] = (digest[8] & 63) | 128;
    const hex = [...digest.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const copyId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return this.mutate(state => {
      const previous = state.decks.find(deck => deck.id === copyId);
      if (previous) return previous; // Preserve recipient edits on repeated saves.
      const now = new Date().toISOString();
      const copy = deckSchema.parse({ ...snapshot, id: copyId, createdAt: now, updatedAt: now,
        entries: snapshot.entries.map(entry => {
          let drill = structuredClone(entry.drill);
          const existing = state.revisions.find(r => r.revisionId === drill.revisionId);
          if (existing && !same(existing, drill)) drill = { ...drill, revisionId: crypto.randomUUID() };
          addRevision(state, drill);
          return { ...entry, id: crypto.randomUUID(), drill };
        }),
      });
      state.decks.push(copy);
      return copy;
    });
  }
  async startSession(deckId: string) {
    return this.mutate(s => {
      if (s.sessions.some(s => s.status === 'active')) throw new Error('Resume or end the active session first');
      const deck = s.decks.find(d => d.id === deckId);
      if (!deck) throw new Error('Deck not found');
      const session = sessionSchema.parse({ schemaVersion: 1, id: crypto.randomUUID(), deckId,
        deckSnapshot: structuredClone(deck), startedAt: new Date().toISOString(), status: 'active', currentEntry: 0 });
      s.sessions.push(session);
      return session;
    });
  }
  async recordResult(input: DrillResult) {
    const result = resultSchema.parse(input);
    return this.mutate(s => {
      const session = s.sessions.find(s => s.id === result.sessionId);
      if (!session) throw new Error('Session not found');
      const existing = s.results.find(r => r.sessionId === result.sessionId && r.entryId === result.entryId);
      if (existing) return session; // First tap wins, even if a retry allocated a different result ID.
      if (s.results.some(r => r.id === result.id)) throw new Error('Result ID already exists');
      if (session.status !== 'active' || session.deckSnapshot.entries[session.currentEntry]?.id !== result.entryId) throw new Error('Entry is not current');
      s.results.push(result);
      session.currentEntry++;
      if (session.currentEntry === session.deckSnapshot.entries.length) {
        session.status = 'completed'; session.endedAt = result.completedAt;
      }
      return session;
    });
  }
  async endSession(sessionId: string) {
    return this.mutate(s => {
      const session = s.sessions.find(s => s.id === sessionId);
      if (!session) throw new Error('Session not found');
      if (session.status === 'active') { session.status = 'ended-early'; session.endedAt = new Date().toISOString(); }
      return session;
    });
  }
  async importArchive(input: unknown): Promise<ImportReport> {
    const incoming = archiveSchema.parse(input); // Reject the entire malformed archive before opening a writer.
    collectRevisions(incoming);
    return this.mutate(state => {
      const report: ImportReport = { imported: [], skipped: [], conflicting: [] };
      // Merge sessions and their results as a unit so position/snapshot conflicts cannot corrupt history.
      const rejectedSessions = new Set<string>();
      const merge = <T>(kind: string, target: T[], records: T[], key: (r: T) => string, reject: (r: T) => boolean = () => false) => {
        for (const record of records) {
          const label = `${kind}:${key(record)}`;
          const existing = target.find(r => key(r) === key(record));
          if (existing && same(existing, record)) { report.skipped.push(label); continue; }
          if (existing || reject(record)) { report.conflicting.push(label); continue; }
          target.push(record); report.imported.push(label);
        }
      };
      merge('revision', state.revisions, incoming.revisions, r => r.revisionId);
      const badRevision = (d: Deck) => d.entries.some(e => !same(state.revisions.find(r => r.revisionId === e.drill.revisionId), e.drill));
      merge('deck', state.decks, incoming.decks, d => d.id, badRevision);
      for (const session of incoming.sessions) {
        const existing = state.sessions.find(s => s.id === session.id);
        const theirResults = incoming.results.filter(r => r.sessionId === session.id);
        const ourResults = state.results.filter(r => r.sessionId === session.id);
        const resultConflict = theirResults.some(r => state.results.some(o => o.id === r.id && !same(o, r)));
        if (badRevision(session.deckSnapshot) || resultConflict || (existing && (!same(existing, session) || !same([...ourResults].sort((a,b) => a.id.localeCompare(b.id)), [...theirResults].sort((a,b) => a.id.localeCompare(b.id))))) ||
          (!existing && session.status === 'active' && state.sessions.some(s => s.status === 'active'))) {
          rejectedSessions.add(session.id); report.conflicting.push(`session:${session.id}`);
        } else merge('session', state.sessions, [session], s => s.id);
      }
      merge('result', state.results, incoming.results, r => r.id, r => rejectedSessions.has(r.sessionId));
      return report;
    });
  }
}
