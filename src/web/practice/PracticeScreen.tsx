import { sessionEntries } from '../../domain/schemas';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { feelOptions, PracticeController } from '../../domain/practice';
import type { PracticeRepository } from '../../domain/repository';
import './practice.css';

export interface PracticeScreenProps {
  repository: PracticeRepository;
  onViewHistory: () => void;
  sessionId?: string;
  onSessionLoaded?: (id: string) => void;
  onChooseDeck?: () => void;
}
export function PracticeScreen({ repository, onViewHistory, sessionId, onSessionLoaded, onChooseDeck }: PracticeScreenProps) {
  const controller = useMemo(() => new PracticeController(repository, sessionId), [repository, sessionId]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const heading = useRef<HTMLHeadingElement>(null);
  const session = state.session;
  useEffect(() => { void controller.load(); }, [controller]);
  useEffect(() => { heading.current?.focus(); }, [state.rating, session?.currentEntry, session?.queueVersion, session?.status]);
  useEffect(() => { if (session && !sessionId) onSessionLoaded?.(session.id); }, [session, sessionId, onSessionLoaded]);
  const disabled = state.saving || state.failedSave;
  const entry = session?.status === 'active' ? sessionEntries(session)[session.currentEntry] : undefined;

  return <section className="practice-screen" aria-labelledby="practice-title">
    <div className="page-heading"><p className="eyebrow">ONE DRILL AT A TIME</p><h1 id="practice-title">Practice</h1></div>
    {state.loading ? <p role="status">Loading saved practice…</p> : <>
      {state.error && <div className="practice-error" role="alert">
        <p>{state.error}</p>
        <div className="practice-actions">
          {state.failedSave && <button type="button" onClick={() => void controller.retrySave()} disabled={state.saving}>Retry save</button>}
          <button type="button" onClick={() => void controller.load()} disabled={state.saving}>{state.failedSave ? 'Reload saved progress' : 'Retry loading'}</button>
        </div>
      </div>}
      {!session && !state.error && <div className="practice-empty">
        <h2>No active practice</h2>
        <p>Build or choose a deck on the Deck screen, then start practice. Your current drill will be saved here as you go.</p><button type="button" className="practice-primary" onClick={onChooseDeck}>Choose a deck</button>
      </div>}
      {session && session.status !== 'active' && <div className="practice-finish">
        <h2 ref={heading} tabIndex={-1}>{session.status === 'completed' ? 'Practice complete' : 'Session ended'}</h2>
        <p>{session.deckSnapshot.title}</p>
        <p>{session.status === 'completed' ? 'Your drill results are saved on this device.' : 'Your recorded results are saved. Remaining drills are unattempted.'}</p>
        <button type="button" className="practice-primary" onClick={onViewHistory}>View history</button>
      </div>}
      {session && entry && <>
        <p className="practice-progress">{session.deckSnapshot.title} · Drill {session.currentEntry + 1} of {session.deckSnapshot.entries.length}</p>
        <progress aria-label="Drills recorded" value={session.currentEntry} max={session.deckSnapshot.entries.length} />
        {state.rating ? <div className="practice-rating">
          <h2 ref={heading} tabIndex={-1}>How did it feel?</h2>
          <p className="practice-rating-title">{entry.drill.title}</p>
          <p className="practice-hint">Tap a rating to save and continue.</p>
          <div className="practice-feel-options">
            {feelOptions.map(option => <button key={option.value} type="button" disabled={disabled} onClick={() => void controller.rate(option.value)}>{option.label}</button>)}
          </div>
          <div className="practice-actions practice-rating-actions">
            <button type="button" disabled={disabled} onClick={() => void controller.rate()}>Continue without rating</button>
            <button type="button" disabled={disabled} onClick={() => controller.cancelRating()}>Back to drill</button>
          </div>
        </div> : <article className="practice-drill">
          <h2 ref={heading} tabIndex={-1}>{entry.drill.title}</h2>
          <p className="practice-cue">{entry.drill.cue}</p>
          <p className="practice-hint">Practice at your own pace. Tap Done when you’re ready.</p>
          <details className="practice-setup"><summary>Setup{entry.drill.requiredEquipment.length ? ` · ${entry.drill.requiredEquipment.join(', ')}` : entry.drill.terrainRequirements.length ? ` · ${entry.drill.terrainRequirements.join(', ')}` : ' · no additional equipment'}</summary>
          {entry.drill.setupDetails.length ? <ul>{entry.drill.setupDetails.map((detail, index) => <li key={index}>{detail}</li>)}</ul> : <p>No additional setup.</p>}
          {entry.drill.requiredEquipment.length > 0 && <p><strong>Equipment:</strong> {entry.drill.requiredEquipment.map(name => name === 'obstacle' ? 'usable obstacle' : name).join(', ')}</p>}
          {entry.drill.terrainRequirements.length > 0 && <p><strong>Terrain:</strong> {entry.drill.terrainRequirements.join(' · ')}</p>}
          </details><h3>Practice guide</h3>
          <ol>{entry.drill.instructions.map((instruction, index) => <li key={index}>{instruction}</li>)}</ol>
          <div className="practice-actions practice-thumb-actions">
            <button type="button" className="practice-primary" disabled={disabled} onClick={() => controller.openRating()}>Done</button>
            <button type="button" disabled={disabled || session.currentEntry === session.deckSnapshot.entries.length - 1} onClick={() => void controller.skip()}>Skip for now</button>
          </div>
          <p className="practice-hint practice-queue-hint">{session.currentEntry === session.deckSnapshot.entries.length - 1 ? 'Last drill — finish it or end the session.' : 'Skip for now moves this drill to the back of the queue.'}</p>
        </article>}
        <p className="practice-save-status" role="status">{state.saving ? 'Saving progress…' : state.failedSave ? 'Progress has not been confirmed saved.' : 'Recorded progress is saved on this device.'}</p>
        <button type="button" className="practice-end" disabled={disabled} onClick={() => void controller.endEarly()}>End session</button>
      </>}
    </>}
  </section>;
}
