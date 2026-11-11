import { useMemo, useSyncExternalStore } from 'react';
import type { PracticeRepository } from '../../domain/repository';
import { getAuthSession } from '../api/auth';
import { publishDeck } from '../api/sharing';
import { DeckPublisher } from './publisher';
import './sharing.css';

export interface ShareDeckButtonProps { repository: PracticeRepository; deckId: string }
export function ShareDeckButton({ repository, deckId }: ShareDeckButtonProps) {
  const publisher = useMemo(() => new DeckPublisher(repository, deckId, {
    getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key),
  }, { session: getAuthSession, publish: publishDeck }), [repository, deckId]);
  const state = useSyncExternalStore(publisher.subscribe, publisher.getSnapshot);
  const publication = state.pending?.publication;
  return <section className="sharing-publish" aria-label="Share this deck">
    <h3>Share a deck link</h3>
    <p>Anyone with the link can preview this snapshot and save a copy. Your practice history and account details stay private.</p>
    {publication ? <>
      <p role="status">Your deck link is ready.</p>
      <a className="sharing-url" href={publication.url}>{publication.url}</a>
      <p>Select and copy the link to invite a friend.</p>
      <button type="button" onClick={() => void publisher.startNewPublication()} disabled={state.publishing}>Create another link</button>
    </> : <>
      {state.pending && <p>A saved publication of “{state.pending.request.deck.title}” is waiting. Retry sends the same snapshot.</p>}
      <button type="button" className="sharing-primary" onClick={() => void publisher.publish()} disabled={state.publishing || state.accountChanged}>
        {state.publishing ? 'Publishing…' : state.pending ? 'Retry publishing' : 'Publish deck link'}
      </button>
      {(state.pending || state.error) && <button type="button" onClick={() => void publisher.startNewPublication()} disabled={state.publishing}>Start a new publication</button>}
    </>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.needsLogin && <p><a href="/auth/login">Sign in to publish</a>. Return to this deck afterward and retry.</p>}
  </section>;
}
