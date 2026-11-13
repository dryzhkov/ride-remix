import type { PracticeRepository } from './repository';
import { resultSchema, sessionEntries } from './schemas';
import type { DrillResult, Session } from './schemas';

export const feelOptions = [
  { value: 'finding', label: 'Still finding it' },
  { value: 'consistent', label: 'Getting consistent' },
  { value: 'repeatable', label: 'Repeatable today' },
] as const;
export type FeelAnswer = (typeof feelOptions)[number]['value'];
export interface PracticeState {
  loading: boolean;
  saving: boolean;
  session?: Session;
  rating: boolean;
  error?: string;
  failedSave: boolean;
}
type PendingWrite = { kind: 'result'; result: DrillResult } | { kind: 'end'; sessionId: string } | { kind: 'defer'; sessionId: string; entryId: string; queueVersion: number };

/** Coordinates UI intent; only the repository may advance the persisted session. */
export class PracticeController {
  private state: PracticeState = { loading: true, saving: false, rating: false, failedSave: false };
  private listeners = new Set<() => void>();
  private pending?: PendingWrite;
  private loadVersion = 0;
  constructor(private repository: PracticeRepository, private sessionId?: string) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(patch: Partial<PracticeState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  async load() {
    if (this.state.saving) return;
    const version = ++this.loadVersion;
    this.pending = undefined;
    this.publish({ loading: true, error: undefined, failedSave: false, rating: false });
    try {
      const sessions = await this.repository.listSessions();
      if (version !== this.loadVersion) return;
      const active = sessions.filter(s => s.status === 'active');
      if (active.length > 1) throw new Error('Multiple active sessions were found.');
      const session = this.sessionId ? sessions.find(s => s.id === this.sessionId) : active[0];
      this.publish({ loading: false, session, error: this.sessionId && !session ? 'Practice session not found on this device. Open History or restore a backup in Settings.' : undefined });
    } catch {
      if (version === this.loadVersion) this.publish({ loading: false, error: 'Your saved practice could not be loaded. Please retry.' });
    }
  }
  private actionable() {
    return !this.state.loading && !this.state.saving && !this.pending && this.state.session?.status === 'active';
  }
  openRating() {
    if (this.actionable()) this.publish({ rating: true, error: undefined });
  }
  cancelRating() {
    if (this.actionable()) this.publish({ rating: false });
  }
  async rate(feel?: FeelAnswer) {
    if (!this.actionable() || !this.state.rating) return;
    await this.record('done', feel);
  }
  async skip() {
    if (!this.actionable() || this.state.rating) return;
    const session = this.state.session!;
    const entries = sessionEntries(session);
    if (session.currentEntry >= entries.length - 1) return;
    this.pending = { kind: 'defer', sessionId: session.id, entryId: entries[session.currentEntry].id, queueVersion: session.queueVersion ?? 0 };
    await this.persist();
  }
  private async record(status: 'done' | 'skipped', feel?: FeelAnswer) {
    const session = this.state.session!;
    const entry = sessionEntries(session)[session.currentEntry];
    const result = resultSchema.parse({
      schemaVersion: 1, id: crypto.randomUUID(), sessionId: session.id, entryId: entry.id,
      status, completedAt: new Date().toISOString(), questionnaireVersion: 'v1',
      answers: feel ? { feel } : {}, setupSnapshot: [...entry.drill.setupDetails],
    });
    this.pending = { kind: 'result', result };
    await this.persist();
  }
  async endEarly() {
    if (!this.actionable()) return;
    this.pending = { kind: 'end', sessionId: this.state.session!.id };
    await this.persist();
  }
  async retrySave() {
    if (this.pending && !this.state.saving) await this.persist();
  }
  private async persist() {
    const pending = this.pending;
    if (!pending || this.state.saving) return;
    this.publish({ saving: true, error: undefined, failedSave: false });
    try {
      const session = pending.kind === 'result'
        ? await this.repository.recordResult(pending.result)
        : pending.kind === 'defer'
          ? await this.repository.deferEntry(pending.sessionId, pending.entryId, pending.queueVersion)
          : await this.repository.endSession(pending.sessionId);
      this.pending = undefined;
      this.publish({ session, saving: false, rating: false, error: undefined, failedSave: false });
    } catch {
      // Retain the exact intent and ID for a safe retry, even if a previous commit succeeded.
      this.publish({ saving: false, failedSave: true, error: 'Your progress could not be saved. Retry saving before moving on, or reload the last saved progress.' });
    }
  }
}
