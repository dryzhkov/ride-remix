import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { getStarterLibrary } from '../../content/starter-library';
import { drillRevisionSchema, deckSchema } from '../../domain/schemas';
import type { Deck, DrillRevision } from '../../domain/schemas';
import { eligibleDrills, focusLabels, generateDrills } from '../../domain/generation';
import type { GenerationInputs } from '../../domain/generation';
import type { PracticeRepository } from '../../domain/repository';
import './deck.css';
import { Icon } from '../ui/Icon';
import { ShareDeckButton } from '../sharing/ShareDeckButton';

const initialInputs: GenerationInputs = { timeBudgetMinutes: 20, focuses: [], equipment: { cones: 'unspecified', obstacle: 'unspecified', incline: 'unspecified' } };
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
  const [editor, setEditor] = useState<{ drill?: DrillRevision; copy: boolean }>();
  const [swapId, setSwapId] = useState<string>();
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
      if (!Number.isInteger(inputs.timeBudgetMinutes) || inputs.timeBudgetMinutes <= 0) { setNotice('Enter a positive whole number of minutes.'); return; }
      const generated = generateDrills(library, inputs);
      if (generated.emptyReason) { setNotice(generated.emptyReason); return; }
      const now = new Date().toISOString();
      await save({ schemaVersion: 1, id: crypto.randomUUID(), title: 'Practice deck', generationInputs: structuredClone(inputs),
        entries: generated.drills.map(entry), createdAt: now, updatedAt: now });
      setSwapId(undefined);
    });
  }
  function changeDeck(next: Deck) { void perform(() => save(next)); }
  const used = new Set(deck?.entries.map(e => e.drill.id));
  const swaps = eligibleDrills(library, inputs).filter(d => !used.has(d.id));
  return <section className="deck-screen" aria-label="Build a practice deck">
    <div className="page-heading"><p className="eyebrow">{mode === 'list' ? 'YOUR NEXT RIDE' : mode === 'new' ? 'MAKE TIME TO RIDE' : 'READY WHEN YOU ARE'}</p>
    <h1>{mode === 'list' ? 'Your decks' : mode === 'new' ? 'New deck' : deck?.title ?? 'Deck'}</h1>
    <p>{mode === 'list' ? 'A little practice. A better ride.' : mode === 'new' ? 'Choose your time and focus. We’ll mix the drills.' : 'Remix your drills, then get riding.'}</p></div>
    {mode !== 'list' && <a className="back-link" href="/deck" onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onShowDecks(); } }}>← All decks</a>}
    {mode === 'list' && !busy && (decks.length ? <div className="saved-deck-grid">{[...decks].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(d => <article className="saved-deck-card" key={d.id}>
      <div className="card-topline"><span className="deck-badge"><Icon name="deck" />{d.entries.length} drills</span><span>{d.entries.reduce((n,e) => n + e.plannedDurationMinutes, 0)} min</span></div>
      <h2><a href={`/deck/${d.id}`} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); onOpenDeck(d.id); } }}>{d.title}</a></h2>
      <p className="deck-preview">{d.entries.map(e => e.drill.title).join(' · ')}</p>
      <div className="deck-actions"><button className="deck-primary" disabled={busy} onClick={() => onStartPractice(d.id)}><Icon name="practice" />Start practice</button><button onClick={() => onOpenDeck(d.id)}>Remix deck</button></div>
    </article>)}</div> : <div className="empty-card"><Icon name="deck" /><h2>Your next ride starts here</h2><p>Make a short practice deck from your time, focus, and available setup.</p><p>Tap <strong>+ New deck</strong> to get started.</p></div>)}
    {busy && <p role="status">Loading your decks…</p>}
    {mode === 'detail' && !busy && !deck && !error && <div className="empty-card"><h2>Deck not found</h2><p>This deck isn’t saved in this browser. Open your decks or restore a backup in Settings.</p></div>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {mode !== 'list' && (mode === 'new' || deck) && <details className="generation-card" open={mode === 'new'}><summary>{mode === 'new' ? 'Build your deck' : 'Swap filters'}</summary>
    <fieldset disabled={busy} className="deck-controls"><legend className="sr-only">Deck inputs</legend>
      <label>Time budget (minutes)<input type="number" min="1" step="1" value={inputs.timeBudgetMinutes} onChange={e => setInputs({ ...inputs, timeBudgetMinutes: Number(e.target.value) })} /></label>
      <fieldset><legend>Skill focus</legend>
        <label className="deck-choice"><input type="checkbox" checked={!inputs.focuses.length} onChange={() => setInputs({ ...inputs, focuses: [] })} />All skills</label>
        {focuses.map(f => <label className="deck-choice" key={f}><input type="checkbox" checked={inputs.focuses.includes(f)} onChange={() => setInputs({ ...inputs, focuses: inputs.focuses.includes(f) ? inputs.focuses.filter(x => x !== f) : [...inputs.focuses, f] })} />{focusLabels[f]}</label>)}
      </fieldset>
      <p className="equipment-hint">Equipment available</p><div className="deck-equipment">{equipment.map(e => <label key={e}>{e[0].toUpperCase() + e.slice(1)}<select value={inputs.equipment[e]} onChange={event => setInputs({ ...inputs, equipment: { ...inputs.equipment, [e]: event.target.value as GenerationInputs['equipment'][typeof e] } })}>
        <option value="unspecified">Not set</option><option value="available">Yes</option><option value="unavailable">No</option>
      </select></label>)}</div>
      {mode === 'new' && <button className="deck-primary generate-action" onClick={() => void generate()}><Icon name="plus" />Generate new deck</button>}
    </fieldset></details>}
    {deck && <section className="deck-detail" aria-label="Your saved deck"><h2 className="sr-only">{deck.title}</h2>
      <p><strong>{deck.entries.reduce((n,e) => n + e.plannedDurationMinutes, 0)} minutes planned</strong> · {deck.entries.length} drills</p>
      <p className="subtle">Saved automatically · Manual additions can exceed your budget.</p>
      <div className="deck-bottom-actions"><button className="deck-primary" disabled={busy} onClick={() => onStartPractice(deck.id)}><Icon name="practice" />Start practice</button>
      <details className="deck-share"><summary>Share deck ↗</summary><ShareDeckButton repository={repository} deckId={deck.id} /></details></div>
      <ol className="deck-entries">{deck.entries.map((e, index) => <li key={e.id}>
        <h3><span className="entry-number">{index + 1}</span>{e.drill.title}</h3><p>{e.drill.cue}</p><details><summary>Setup{e.drill.requiredEquipment.length ? ` · ${e.drill.requiredEquipment.join(', ')}` : ' · no equipment'}</summary><Requirements drill={e.drill} /></details>
        <label>Planned minutes<input disabled={busy} aria-label={`Minutes for ${e.drill.title}`} type="number" min="1" step="1" value={e.plannedDurationMinutes} onChange={event => { const minutes = Number(event.target.value); if (Number.isInteger(minutes) && minutes > 0) changeDeck({ ...deck, entries: deck.entries.map(x => x.id === e.id ? { ...x, plannedDurationMinutes: minutes } : x) }); }} /></label>
        <div className="deck-actions">
          <button disabled={busy || index === 0} aria-label={`Move ${e.drill.title} up`} onClick={() => { const entries = [...deck.entries]; [entries[index-1], entries[index]] = [entries[index], entries[index-1]]; changeDeck({ ...deck, entries }); }}>↑ Up</button>
          <button disabled={busy || index === deck.entries.length-1} aria-label={`Move ${e.drill.title} down`} onClick={() => { const entries = [...deck.entries]; [entries[index+1], entries[index]] = [entries[index], entries[index+1]]; changeDeck({ ...deck, entries }); }}>↓ Down</button>
          <button disabled={busy} onClick={() => setSwapId(swapId === e.id ? undefined : e.id)}>Swap</button>
          <button disabled={busy || deck.entries.length === 1} onClick={() => changeDeck({ ...deck, entries: deck.entries.filter(x => x.id !== e.id) })}>Remove</button>
        </div>
        {swapId === e.id && <div><p>Swaps follow the focus and equipment choices above.</p>{!swaps.length && <p>No unused drills match. Change the generation inputs and generate a new deck, or add manually below.</p>}
          {swaps.map(d => <button key={d.id} disabled={busy} onClick={() => { void perform(async () => { await save({ ...deck, generationInputs: structuredClone(inputs), entries: deck.entries.map(x => x.id === e.id ? { ...entry(d), id: e.id } : x) }); setSwapId(undefined); }); }}>Use {d.title} · {d.suggestedDurationMinutes} min</button>)}</div>}
      </li>)}</ol>
      {deck.entries.length === 1 && <p>Keep at least one drill in a saved deck.</p>}

    </section>}
    {mode !== 'list' && (mode === 'new' || deck) && <details className="library-panel"><summary>Drill library <span className="subtle">{library.length} drills · add or adapt</span></summary><section aria-label="Drill library"><h2 className="sr-only">Drill library</h2><p>Pick any drill manually, including drills outside your generation filters.</p>
      <button disabled={busy} onClick={() => setEditor({ copy: false })}>Create custom drill</button>
      <div className="deck-library">{library.map(d => <article key={d.id}><h3>{d.title}</h3><p>{d.cue}</p><p>{d.focusTags.map(f => focusLabels[f]).join(' · ')} · {d.suggestedDurationMinutes} min</p><Requirements drill={d} />
        <details><summary>Practice guide</summary><ol>{d.instructions.map((line, i) => <li key={i}>{line}</li>)}</ol></details>
        <div className="deck-actions"><button disabled={busy || used.has(d.id)} onClick={() => void perform(async () => {
          if (deck) await save({ ...deck, entries: [...deck.entries, entry(d)] });
          else { const now = new Date().toISOString(); await save({ schemaVersion: 1, id: crypto.randomUUID(), title: 'Practice deck', generationInputs: structuredClone(inputs), entries: [entry(d)], createdAt: now, updatedAt: now }); }
        })}>{used.has(d.id) ? 'In this deck' : 'Add to deck'}</button>
        <button disabled={busy} onClick={() => setEditor({ drill: d, copy: true })}>Copy and adapt</button>
        {d.origin === 'custom' && <button disabled={busy} onClick={() => setEditor({ drill: d, copy: false })}>Edit custom drill</button>}</div>
      </article>)}</div>
    </section></details>}
    {editor && <DrillEditor key={`${editor.drill?.revisionId ?? 'new'}-${editor.copy}`} drill={editor.drill} copy={editor.copy} busy={busy} onCancel={() => setEditor(undefined)} onSave={revision => void perform(async () => {
      await repository.saveRevision(revision);
      setLibrary(previous => latest([...previous, revision])); setEditor(undefined);
      setNotice('Custom drill saved. Existing decks keep their saved revision. Remove and add the drill to use this revision.');
    })} />}
  </section>;
}
function Requirements({ drill }: { drill: DrillRevision }) {
  return <div className="deck-requirements"><p>Equipment: {drill.requiredEquipment.length ? drill.requiredEquipment.join(', ') : 'None required'}</p>
    {drill.setupDetails.map((s,i) => <p key={i}>{s}</p>)}{drill.terrainRequirements.map((s,i) => <p key={i}>Terrain: {s}</p>)}
    {!drill.automaticGeneration && <p>Manual selection only.</p>}
  </div>;
}
function DrillEditor({ drill, copy, busy, onSave, onCancel }: { drill?: DrillRevision; copy: boolean; busy: boolean; onSave: (d: DrillRevision) => void; onCancel: () => void }) {
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const lines = (key: string) => String(form.get(key) ?? '').split('\n').map(s => s.trim()).filter(Boolean);
    const parsed = drillRevisionSchema.safeParse({ schemaVersion: 1, id: drill && !copy ? drill.id : crypto.randomUUID(), revisionId: crypto.randomUUID(), origin: 'custom',
      ...(drill ? { derivedFrom: copy ? { id: drill.id, revisionId: drill.revisionId } : drill.derivedFrom } : {}),
      title: form.get('title'), cue: form.get('cue'), instructions: lines('instructions'), setupDetails: lines('setup'),
      focusTags: form.getAll('focus'), requiredEquipment: form.getAll('equipment'), terrainRequirements: lines('terrain'),
      automaticGeneration: form.get('automatic') === 'on', suggestedDurationMinutes: Number(form.get('duration')), createdAt: new Date().toISOString() });
    if (!parsed.success) { setError('Enter a title, cue, at least one instruction and focus, and a positive whole-number duration. Text must be under 10,000 characters per field or line.'); return; }
    onSave(parsed.data);
  }
  return <section className="deck-editor" aria-label="Custom drill editor"><h2>{drill && !copy ? 'Edit custom drill' : 'Create custom drill'}</h2>
    <p>Each edit saves a new revision. Your existing practice history stays intact.</p>{error && <p role="alert">{error}</p>}
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label>Title<input name="title" required maxLength={10000} defaultValue={drill ? `${drill.title}${copy ? ' (copy)' : ''}` : ''} /></label>
      <label>Short cue<input name="cue" required maxLength={10000} defaultValue={drill?.cue} /></label>
      <label>Instructions (one step per line)<textarea name="instructions" required defaultValue={drill?.instructions.join('\n')} /></label>
      <label>Setup (one detail per line)<textarea name="setup" defaultValue={drill?.setupDetails.join('\n')} /></label>
      <label>Terrain requirements (one per line)<textarea name="terrain" defaultValue={drill?.terrainRequirements.join('\n')} /></label>
      <label>Suggested minutes<input type="number" name="duration" required min="1" step="1" defaultValue={drill?.suggestedDurationMinutes ?? 10} /></label>
      <fieldset><legend>Focus (choose at least one)</legend>{focuses.map(f => <label className="deck-choice" key={f}><input type="checkbox" name="focus" value={f} defaultChecked={drill?.focusTags.includes(f)} />{focusLabels[f]}</label>)}</fieldset>
      <fieldset><legend>Required equipment</legend>{equipment.map(e => <label className="deck-choice" key={e}><input type="checkbox" name="equipment" value={e} defaultChecked={drill?.requiredEquipment.includes(e)} />{e}</label>)}</fieldset>
      <label className="deck-choice"><input name="automatic" type="checkbox" defaultChecked={drill?.automaticGeneration ?? true} />Include in automatic generation</label>
      <p>Leave automatic generation off for rut and sidehill drills.</p>
      <div className="deck-actions"><button className="deck-primary" type="submit">Save drill</button><button type="button" onClick={onCancel}>Cancel</button></div>
    </fieldset></form>
  </section>;
}
