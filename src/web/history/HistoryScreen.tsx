import { useEffect, useRef, useState } from 'react';
import type { PracticeRepository } from '../../domain/repository';
import { deckFromHistory, repeatDeck, summarizeHistory } from '../../domain/history';
import type { HistorySummary } from '../../domain/history';
import type { Deck } from '../../domain/schemas';
import './history.css';

export interface HistoryScreenProps {
  repository: PracticeRepository;
  onEditDeck: (deckId: string) => void;
  onStartPractice: (deckId: string) => void;
}
const statusLabels = { active: 'In progress', completed: 'Completed', 'ended-early': 'Ended early' };
function date(value: string) { return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
function Setup({ details }: { details: string[] }) {
  return details.length ? <ul>{details.map((line, i) => <li key={i}>{line}</li>)}</ul> : <p>No setup details recorded.</p>;
}

export function HistoryScreen({ repository, onEditDeck, onStartPractice }: HistoryScreenProps) {
  const [summary, setSummary] = useState<HistorySummary>();
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  useEffect(() => {
    let cancelled = false;
    // Export provides one consistent snapshot of sessions and results from IndexedDB.
    repository.exportArchive().then(archive => {
      if (!cancelled) { setSummary(summarizeHistory(archive.sessions, archive.results)); setError(undefined); }
    }).catch(() => { if (!cancelled) setError('Could not load your local history. Please try again.'); });
    return () => { cancelled = true; };
  }, [repository, reload]);

  async function save(deck: Deck, start: boolean) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(undefined);
    try {
      if (start && (await repository.listSessions()).some(session => session.status === 'active')) {
        setError('You already have a practice session in progress. Resume or end it in Practice before starting another.');
        return;
      }
      await repository.saveDeck(deck);
      if (start) onStartPractice(deck.id); else onEditDeck(deck.id);
    } catch { setError('Could not save the new deck. Your history is unchanged. Please try again.'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  const active = summary?.sessions.some(item => item.session.status === 'active');
  return <section className="history-screen" aria-labelledby="history-title">
    <h1 id="history-title">History</h1>
    <p>Your practice on this device. Choose what you want to bring into your next ride.</p>
    {error && <div role="alert"><p>{error}</p>{!summary && <button type="button" onClick={() => setReload(value => value + 1)}>Try again</button>}</div>}
    {!summary && !error && <p role="status">Loading history…</p>}
    {summary && summary.sessions.length === 0 && <p>No practice sessions yet. Build a deck and start practicing to see your progress here.</p>}
    {summary && summary.sessions.length > 0 && <>
      {active && <p className="history-notice">A session is in progress. You can prepare your next deck, or open Practice to resume it.</p>}
      <section aria-labelledby="drill-history-title">
        <h2 id="drill-history-title">Your drills</h2>
        <p>Completed counts include Done, with or without a rating. Skipped drills do not count.</p>
        {summary.drills.length === 0 && <p>No drills recorded yet.</p>}
        {summary.drills.length > 0 && <>
          <fieldset disabled={busy}>
            <legend>Select drills for your next deck</legend>
            {summary.drills.map(item => <article className="history-card" key={item.drill.id}>
              <label className="history-selection"><input type="checkbox" checked={selected.includes(item.drill.id)}
                onChange={event => setSelected(previous => event.target.checked ? [...previous, item.drill.id] : previous.filter(id => id !== item.drill.id))} />
                <span>{item.drill.title} <span className="history-count">{item.completedCount} completed</span></span>
              </label>
              <details><summary>Attempts and ratings</summary>
                <ol className="history-attempts">{item.attempts.map(attempt => <li key={attempt.result.id}>
                  <p><time dateTime={attempt.result.completedAt}>{date(attempt.result.completedAt)}</time> · {attempt.result.status === 'skipped' ? 'Skipped' : attempt.ratingLabel}</p>
                  {attempt.drill.title !== item.drill.title && <p>Recorded as: {attempt.drill.title}</p>}
                  <p className="history-label">Recorded setup</p><Setup details={attempt.result.setupSnapshot} />
                </li>)}</ol>
              </details>
            </article>)}
          </fieldset>
          <button className="history-action" type="button" disabled={busy || selected.length === 0}
            onClick={() => void save(deckFromHistory(summary.drills.filter(item => selected.includes(item.drill.id)).map(item => item.drill)), false)}>
            {busy ? 'Saving…' : `Build next deck${selected.length ? ` (${selected.length})` : ''}`}
          </button>
        </>}
      </section>
      <section aria-labelledby="recent-sessions-title"><h2 id="recent-sessions-title">Recent sessions</h2>
        <ol className="history-sessions">{summary.sessions.map(item => <li className="history-card" key={item.session.id}>
          <h3>{item.session.deckSnapshot.title}</h3>
          <p><time dateTime={item.session.startedAt}>{date(item.session.startedAt)}</time> · {statusLabels[item.session.status]}</p>
          <p>{item.completedCount} done · {item.skippedCount} skipped · {item.unattemptedCount} unattempted</p>
          <details><summary>Session details</summary>
            {item.session.endedAt && <p>Finished <time dateTime={item.session.endedAt}>{date(item.session.endedAt)}</time></p>}
            <ol>{item.entries.map(({ entry, result, ratingLabel }) => <li key={entry.id}>
              <h4>{entry.drill.title}</h4><p>{entry.plannedDurationMinutes} minutes planned · {result ? result.status === 'skipped' ? 'Skipped' : `Done · ${ratingLabel}` : 'Unattempted'}</p>
              {result && <p><time dateTime={result.completedAt}>{date(result.completedAt)}</time></p>}
              <p className="history-label">{result ? 'Recorded setup' : 'Planned setup'}</p><Setup details={result?.setupSnapshot ?? entry.drill.setupDetails} />
              <details><summary>Recorded drill guide</summary><p>{entry.drill.cue}</p><ol>{entry.drill.instructions.map((instruction, i) => <li key={i}>{instruction}</li>)}</ol></details>
            </li>)}</ol>
          </details>
          <button className="history-action" type="button" disabled={busy || active}
            onClick={() => void save(repeatDeck(item.session.deckSnapshot), true)}>Repeat this deck</button>
        </li>)}</ol>
      </section>
    </>}
  </section>;
}
