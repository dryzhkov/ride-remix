import { z } from 'zod';
import type { PracticeRepository } from '../../domain/repository';
import type { AuthSessionResponse } from '../../contracts/auth';
import { publicationResponseSchema, publishRequestSchema } from '../../contracts/sharing';
import type { Publication, PublishRequest } from '../../contracts/sharing';
import { SharingApiError } from '../api/sharing';

export const publicationRetrySchema = z.strictObject({
  version: z.literal(1), publisherAccountId: z.uuid(), request: publishRequestSchema,
  publication: publicationResponseSchema.optional(),
});
export type PublicationRetry = z.infer<typeof publicationRetrySchema>;
export interface RetryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
interface PublishingClient {
  session(): Promise<AuthSessionResponse>;
  publish(request: PublishRequest, csrfToken: string): Promise<Publication>;
}
export interface PublisherState {
  publishing: boolean; pending?: PublicationRetry; error?: string; needsLogin: boolean; accountChanged: boolean;
}
export const retryStorageKey = (deckId: string) => `ride-remix:publication:${deckId}`;

/** Retry/account metadata deliberately lives outside the exportable practice database. */
export class DeckPublisher {
  private state: PublisherState = { publishing: false, needsLogin: false, accountChanged: false };
  private listeners = new Set<() => void>();
  constructor(private repository: PracticeRepository, private deckId: string, private storage: RetryStorage, private client: PublishingClient) {
    try {
      const raw = storage.getItem(retryStorageKey(deckId));
      if (raw) this.state.pending = publicationRetrySchema.parse(JSON.parse(raw));
    } catch { this.state.error = 'Saved publication state could not be read. Start a new publication to continue.'; }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<PublisherState>) {
    this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener();
  }
  private save(pending: PublicationRetry) {
    this.storage.setItem(retryStorageKey(this.deckId), JSON.stringify(pending));
    this.update({ pending });
  }
  async publish() {
    if (this.state.publishing || this.state.pending?.publication) return;
    this.update({ publishing: true, error: undefined, needsLogin: false, accountChanged: false });
    try {
      let session: AuthSessionResponse;
      try { session = await this.client.session(); }
      catch {
        this.update({ needsLogin: true, error: 'Sign in to publish this deck. Your local deck and any pending publication are saved.' });
        return;
      }
      let pending = this.state.pending;
      if (pending && pending.publisherAccountId !== session.account.id) {
        this.update({ accountChanged: true, error: 'This pending publication belongs to a different account. Start a new publication to use the account signed in now.' });
        return;
      }
      if (!pending) {
        const deck = (await this.repository.listDecks()).find(d => d.id === this.deckId);
        if (!deck) throw new Error('This local deck could not be found.');
        const request = publishRequestSchema.parse({ requestId: crypto.randomUUID(), payloadVersion: 1, deck });
        pending = { version: 1, publisherAccountId: session.account.id, request };
      }
      // Persist BEFORE sending; retries after an ambiguous network failure retain account, ID, and immutable payload.
      this.save(pending);
      const publication = await this.client.publish(pending.request, session.csrfToken);
      const finished = { ...pending, publication };
      try { this.save(finished); }
      catch { this.update({ pending: finished }); } // The already-durable request still recovers the same link.
    } catch (error) {
      if (error instanceof SharingApiError && error.status === 401) this.update({ needsLogin: true });
      this.update({ error: error instanceof z.ZodError ? 'This deck exceeds sharing limits. Use at most 30 drills and shorter card text.' : error instanceof Error ? error.message : 'This deck could not be published. Retry when connected.' });
    } finally { this.update({ publishing: false }); }
  }
  /** A separate explicit rider action is required before changing snapshot/account/request ID. */
  async startNewPublication() {
    if (this.state.publishing) return;
    try { this.storage.removeItem(retryStorageKey(this.deckId)); }
    catch { this.update({ error: 'Publication retry state could not be updated. Check browser storage and retry.' }); return; }
    this.update({ pending: undefined, error: undefined, accountChanged: false });
    await this.publish();
  }
}
