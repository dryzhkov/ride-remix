import type { Archive, Deck, DrillResult, DrillRevision, Session } from './schemas';

export interface ImportReport {
  imported: string[];
  skipped: string[];
  conflicting: string[];
}
export interface PracticeRepository {
  saveRevision(revision: DrillRevision): Promise<void>;
  saveDeck(deck: Deck): Promise<void>;
  saveSharedDeck(deck: Deck, publicId: string): Promise<Deck>;
  listRevisions(): Promise<DrillRevision[]>;
  listDecks(): Promise<Deck[]>;
  listSessions(): Promise<Session[]>;
  listResults(): Promise<DrillResult[]>;
  startSession(deckId: string): Promise<Session>;
  recordResult(result: DrillResult): Promise<Session>;
  endSession(sessionId: string): Promise<Session>;
  exportArchive(): Promise<Archive>;
  importArchive(archive: unknown): Promise<ImportReport>;
  close(): void;
}
