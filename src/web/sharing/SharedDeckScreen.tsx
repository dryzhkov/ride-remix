import { useEffect, useRef, useState } from 'react';
import type { PracticeRepository } from '../../domain/repository';
import type { SharedDeck } from '../../contracts/sharing';
import { getSharedDeck } from '../api/sharing';
import './sharing.css';

export interface SharedDeckScreenProps {
  repository: PracticeRepository; publicId: string; onSaved: (deckId: string) => void;
}
export function SharedDeckScreen(props: SharedDeckScreenProps) {
  return <SharedDeckView key={props.publicId} {...props} />;
}
function SharedDeckView({ repository, publicId, onSaved }: SharedDeckScreenProps) {
  const [snapshot, setSnapshot] = useState<SharedDeck>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const savingGuard = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    getSharedDeck(publicId, abort.signal).then(value => {
      if (!abort.signal.aborted) setSnapshot(value);
    }).catch(error => {
      if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'This shared deck could not be loaded. Connect to the internet and retry.');
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [publicId, attempt]);
  async function save() {
    if (!snapshot || savingGuard.current) return;
    savingGuard.current = true; setSaving(true); setError('');
    try {
      const copy = await repository.saveSharedDeck(snapshot.deck, snapshot.id);
      onSaved(copy.id);
    } catch { setError('This copy could not be saved on your device. Your existing decks are unchanged. Please retry.'); }
    finally { savingGuard.current = false; setSaving(false); }
  }
  return <section className="shared-deck" aria-labelledby="shared-deck-title">
    <h1 id="shared-deck-title">Shared deck</h1>
    {loading && <p role="status">Loading shared deck…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !snapshot && <>
      <p>Opening an unsaved shared link requires a connection. A saved copy stays available on this device.</p>
      <button type="button" onClick={() => { setLoading(true); setError(''); setAttempt(value => value + 1); }}>Retry loading</button>
    </>}
    {snapshot && <>
      <h2>{snapshot.deck.title}</h2>
      <p>{snapshot.deck.entries.length} drills · {snapshot.deck.entries.reduce((total, entry) => total + entry.plannedDurationMinutes, 0)} minutes planned</p>
      <p>Save your own copy to practice offline. Editing your copy will keep this shared snapshot unchanged. No sign-in is needed.</p>
      <button type="button" className="sharing-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving copy…' : 'Save a copy'}</button>
      {snapshot.deck.entries.map((entry, index) => <article key={entry.id}>
        <h3>{index + 1}. {entry.drill.title}</h3>
        <p className="sharing-cue">{entry.drill.cue}</p>
        <p>{entry.plannedDurationMinutes} minutes</p>
        <h4>Setup</h4>
        {entry.drill.setupDetails.length ? <ul>{entry.drill.setupDetails.map((detail, index) => <li key={index}>{detail}</li>)}</ul> : <p>No additional setup.</p>}
        {entry.drill.requiredEquipment.length > 0 && <p><strong>Equipment:</strong> {entry.drill.requiredEquipment.join(', ')}</p>}
        {entry.drill.terrainRequirements.length > 0 && <p><strong>Terrain:</strong> {entry.drill.terrainRequirements.join(' · ')}</p>}
        <h4>Instructions</h4>
        <ol>{entry.drill.instructions.map((instruction, index) => <li key={index}>{instruction}</li>)}</ol>
      </article>)}
    </>}
    <p><a href="/">Back to your decks</a></p>
  </section>;
}
