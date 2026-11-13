import { useEffect, useState } from 'react';
import { getStarterLibrary } from '../../content/starter-library';
import { deckSchema } from '../../domain/schemas';
import type { Deck, DrillRevision } from '../../domain/schemas';
import { filterDrills, focusLabels, generateDrills } from '../../domain/generation';
import type { GenerationInputs } from '../../domain/generation';
import type { PracticeRepository } from '../../domain/repository';
import './deck.css';
import { Icon } from '../ui/Icon';
import { ShareDeckButton } from '../sharing/ShareDeckButton';

const initialInputs: GenerationInputs = { focuses: [], equipment: { cones: 'unspecified', obstacle: 'unspecified', incline: 'unspecified' } };
const focuses = Object.keys(focusLabels) as (keyof typeof focusLabels)[];
const equipment = ['cones', 'obstacle', 'incline'] as const;
const latest = (revisions: DrillRevision[]) => {
  const byId = new Map<string, DrillRevision>();
  for (const r of revisions) if (!byId.has(r.id) || r.createdAt >= byId.get(r.id)!.createdAt) byId.set(r.id, r);
  return [...byId.values()];
};
const entry = (drill: DrillRevision) => ({ id: crypto.randomUUID(), drill, plannedDurationMinutes: drill.suggestedDurationMinutes });

export interface DeckScreenProps {
  repository: PracticeRepository;
  onStartPractice: (deckId: string) => void;
  selectedDeckId?: string;
  mode: 'list' | 'new' | 'detail';
  onOpenDeck: (deckId: string) => void;
  onShowDecks: () => void;
}
export function DeckScreen({ repository, onStartPractice, selectedDeckId, mode, onOpenDeck, onShowDecks }: DeckScreenProps) {
  const [inputs, setInputs] = useState<GenerationInputs>(initialInputs);
  const [library, setLibrary] = useState<DrillRevision[]>(getStarterLibrary().drills);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deck, setDeck] = useState<Deck>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false;
    Promise.all([repository.listRevisions(), repository.listDecks()]).then(([revisions, saved]) => {
      if (cancelled) return;
      setLibrary(latest([...getStarterLibrary().drills, ...revisions])); setDecks(saved);
      const chosen = mode === 'detail' ? saved.find(d => d.id === selectedDeckId) : undefined;
      setDeck(chosen); if (chosen) setInputs(chosen.generationInputs);
      setBusy(false);
    }).catch(() => { if (!cancelled) { setError('Could not load your decks. Reopen Deck to try again.'); setBusy(false); } });
    return () => { cancelled = true; };
  }, [repository, selectedDeckId, mode]);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Please try again.'); }
    finally { setBusy(false); }
  }
  async function save(next: Deck) {
    const validated = deckSchema.parse({ ...next, updatedAt: new Date().toISOString() });
    await repository.saveDeck(validated);
    setDeck(validated); setDecks(previous => [...previous.filter(d => d.id !== validated.id), validated]);
    setNotice('Saved on this device.');
    if (mode === 'new') onOpenDeck(validated.id);
  }
  async function generate() {
    await perform(async () => {
      const generated = generateDrills(library, inputs);
      if (generated.emptyReason) { setNotice(generated.emptyReason); return; }
      const now = new Date().toISOString();
      await save({ schemaVersion: 1, id: crypto.randomUUID(), title: 'Practice deck', generationInputs: structuredClone(inputs),
        entries: generated.drills.map(entry), createdAt: now, updatedAt: now });
    });
  }
  function changeDeck(next: Deck) { void perform(() => save(next)); }
  function updateInputs(next: GenerationInputs) {
    setInputs(next);
    if (deck) changeDeck({ ...deck, generationInputs: next });
  }
  const filteredLibrary = filterDrills(library, inputs);
  const used = new Set(deck?.entries.map(e => e.drill.id));
  return <section className="deck-screen" aria-label="Build a practice deck">
    <div className="page-heading"><p className="eyebrow">{mode === 'list' ? 'YOUR NEXT RIDE' : mode === 'new' ? 'MAKE TIME TO RIDE' : 'READY WHEN YOU ARE'}</p>
    <h1>{mode === 'list' ? 'Your decks' : mode === 'new' ? 'New deck' : deck?.title ?? 'Deck'}</h1>
    <p>{mode === 'list' ? 'A little practice. A better ride.' : mode === 'new' ? 'Choose your focus and available setup. We’ll mix the drills.' : 'Remix your drills, then get riding.'}</p></div>
    {mode !== 'list' && <a className="back-link" href="/deck" onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onShowDecks(); } }}>← All decks</a>}
    {mode === 'list' && !busy && (decks.length ? <div className="saved-deck-grid">{[...decks].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(d => <article className="saved-deck-card" key={d.id}>
      <div className="card-topline"><span className="deck-badge"><Icon name="deck" />{d.entries.length} drills</span><span>{d.entries.reduce((n,e) => n + e.plannedDurationMinutes, 0)} min</span></div>
      <h2><a href={`/deck/${d.id}`} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); onOpenDeck(d.id); } }}>{d.title}</a></h2>
      <p className="deck-preview">{d.entries.map(e => e.drill.title).join(' · ')}</p>
      <div className="deck-actions"><button className="deck-primary" disabled={busy} onClick={() => onStartPractice(d.id)}><Icon name="practice" />Start practice</button><button onClick={() => onOpenDeck(d.id)}>Remix deck</button></div>
    </article>)}</div> : <div className="empty-card"><Icon name="deck" /><h2>Your next ride starts here</h2><p>Make a practice deck from your focus and available setup.</p><p>Tap <strong>+ New deck</strong> to get started.</p></div>)}
    {busy && <p role="status">Loading your decks…</p>}
    {mode === 'detail' && !busy && !deck && !error && <div className="empty-card"><h2>Deck not found</h2><p>This deck isn’t saved in this browser. Open your decks or restore a backup in Settings.</p></div>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {mode !== 'list' && (mode === 'new' || deck) && <details className="generation-card" open={mode === 'new'}><summary>Drill Filters</summary>
    <fieldset disabled={busy} className="deck-controls"><legend className="sr-only">Deck inputs</legend>
      <fieldset><legend>Skill focus</legend>
        <label className="deck-choice"><input type="checkbox" checked={!inputs.focuses.length} onChange={() => updateInputs({ ...inputs, focuses: [] })} />All skills</label>
        {focuses.map(f => <label className="deck-choice" key={f}><input type="checkbox" checked={inputs.focuses.includes(f)} onChange={() => updateInputs({ ...inputs, focuses: inputs.focuses.includes(f) ? inputs.focuses.filter(x => x !== f) : [...inputs.focuses, f] })} />{focusLabels[f]}</label>)}
      </fieldset>
      <p className="equipment-hint">Equipment available</p><div className="deck-equipment">{equipment.map(e => <label key={e}>{e[0].toUpperCase() + e.slice(1)}<select value={inputs.equipment[e]} onChange={event => updateInputs({ ...inputs, equipment: { ...inputs.equipment, [e]: event.target.value as GenerationInputs['equipment'][typeof e] } })}>
        <option value="unspecified">Not set</option><option value="available">Yes</option><option value="unavailable">No</option>
      </select></label>)}</div>
      {mode === 'new' && <button className="deck-primary generate-action" onClick={() => void generate()}><Icon name="plus" />Generate new deck</button>}
    </fieldset></details>}
    {deck && <section className="deck-detail" aria-label="Your saved deck"><h2 className="sr-only">{deck.title}</h2>
      <p><strong>{deck.entries.reduce((n,e) => n + e.plannedDurationMinutes, 0)} minutes planned</strong> · {deck.entries.length} drills</p>
      <p className="subtle">Saved automatically.</p>
      <div className="deck-bottom-actions"><button className="deck-primary" disabled={busy} onClick={() => onStartPractice(deck.id)}><Icon name="practice" />Start practice</button>
      <details className="deck-share"><summary>Share deck ↗</summary><ShareDeckButton repository={repository} deckId={deck.id} /></details></div>
      <ol className="deck-entries">{deck.entries.map((e, index) => <li key={e.id}>
        <h3><span className="entry-number">{index + 1}</span><span>{e.drill.title}</span></h3><p className="drill-cue">{e.drill.cue}</p><details className="drill-setup"><summary>Setup</summary><Requirements drill={e.drill} /></details>

        <div className="drill-card-actions">
          <div className="drill-reorder" role="group" aria-label={`Reorder ${e.drill.title}`}>
          <button disabled={busy || index === 0} aria-label={`Move ${e.drill.title} up`} onClick={() => { const entries = [...deck.entries]; [entries[index-1], entries[index]] = [entries[index], entries[index-1]]; changeDeck({ ...deck, entries }); }}>↑ Up</button>
          <button disabled={busy || index === deck.entries.length-1} aria-label={`Move ${e.drill.title} down`} onClick={() => { const entries = [...deck.entries]; [entries[index+1], entries[index]] = [entries[index], entries[index+1]]; changeDeck({ ...deck, entries }); }}>↓ Down</button>
          </div>
          <button className="drill-remove" aria-label={`Remove ${e.drill.title}`} disabled={busy || deck.entries.length === 1} onClick={() => changeDeck({ ...deck, entries: deck.entries.filter(x => x.id !== e.id) })}>Remove</button>
        </div>
      </li>)}</ol>
      {deck.entries.length === 1 && <p>Keep at least one drill in a saved deck.</p>}

    </section>}
    {mode !== 'list' && (mode === 'new' || deck) && <details className="library-panel"><summary>Drill library <span className="subtle">{filteredLibrary.length} drills</span></summary><section aria-label="Drill library"><h2 className="sr-only">Drill library</h2><p>Add drills that match your filters, or change Drill Filters to see more. Terrain-specific drills are available for manual selection.</p>
      {!filteredLibrary.length && <p>No drills match these filters. Choose All skills or adjust equipment availability.</p>}
      <div className="deck-library">{filteredLibrary.map(d => <article key={d.id}><h3>{d.title}</h3><p>{d.cue}</p><p>{d.focusTags.map(f => focusLabels[f]).join(' · ')} · {d.suggestedDurationMinutes} min</p><Requirements drill={d} />
        <details><summary>Practice guide</summary><ol>{d.instructions.map((line, i) => <li key={i}>{line}</li>)}</ol></details>
        <div className="deck-actions"><button disabled={busy || used.has(d.id)} onClick={() => void perform(async () => {
          if (deck) await save({ ...deck, entries: [...deck.entries, entry(d)] });
          else { const now = new Date().toISOString(); await save({ schemaVersion: 1, id: crypto.randomUUID(), title: 'Practice deck', generationInputs: structuredClone(inputs), entries: [entry(d)], createdAt: now, updatedAt: now }); }
        })}>{used.has(d.id) ? 'In this deck' : 'Add to deck'}</button>
        </div>
      </article>)}</div>
    </section></details>}

  </section>;
}
function Requirements({ drill }: { drill: DrillRevision }) {
  return <div className="deck-requirements"><p>Equipment: {drill.requiredEquipment.length ? drill.requiredEquipment.join(', ') : 'None required'}</p>
    {drill.setupDetails.map((s,i) => <p key={i}>{s}</p>)}{drill.terrainRequirements.map((s,i) => <p key={i}>Terrain: {s}</p>)}
    {!drill.automaticGeneration && <p>Manual selection only.</p>}
  </div>;
}
