import { useEffect, useRef, useState } from 'react';
import type { PracticeRepository } from '../domain/repository';
import { openPracticeRepository } from '../repositories/indexed-db';
import { AuthScreen } from './auth/AuthScreen';
import { DeckScreen } from './deck/DeckScreen';
import { PracticeScreen } from './practice/PracticeScreen';
import { HistoryScreen } from './history/HistoryScreen';

const screens = ['Deck', 'Practice', 'History'] as const;
type Screen = (typeof screens)[number];

export function App() {
  if (location.pathname.startsWith('/auth/')) return <div className="app"><Header /><AuthScreen /></div>;
  return <PracticeApp />;
}

function Header() {
  return <header><a className="brand" href="/">Ride Remix</a><a className="account-link" href="/auth/login">Account</a></header>;
}

function PracticeApp() {
  const [screen, setScreen] = useState<Screen>('Deck');
  const [repository, setRepository] = useState<PracticeRepository>();
  const [selectedDeckId, setSelectedDeckId] = useState<string>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [starting, setStarting] = useState(false);
  const startLock = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let connection: PracticeRepository | undefined;
    async function load() {
      try {
        connection = await openPracticeRepository();
        if (cancelled) { connection.close(); return; }
        const sessions = await connection.listSessions();
        if (cancelled) return;
        setRepository(connection);
        if (sessions.some(session => session.status === 'active')) setScreen('Practice');
        setError('');
        setLoading(false);
      } catch {
        connection?.close();
        if (!cancelled) {
          setError('Could not open your saved practice. Please try again.');
          setLoading(false);
        }
      }
    }
    void load();
    return () => { cancelled = true; connection?.close(); };
  }, [retry]);

  async function startPractice(deckId: string) {
    if (!repository || startLock.current) return;
    startLock.current = true;
    setStarting(true);
    setError('');
    try {
      const active = (await repository.listSessions()).find(session => session.status === 'active');
      if (active) {
        setScreen('Practice');
        setError('Resume or end your current session before starting another deck.');
      } else {
        await repository.startSession(deckId);
        setScreen('Practice');
      }
    } catch {
      setError('Could not start practice. Your saved decks are available. Please try again.');
    } finally {
      startLock.current = false;
      setStarting(false);
    }
  }

  return <div className="app">
    <Header />
    <main id="main-content">
      {error && <div role="alert"><p>{error}</p>{!repository && <button type="button" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Try again</button>}</div>}
      {loading && <p role="status">Loading saved practice…</p>}
      {repository && <fieldset className="app-screen" disabled={starting}>
        {screen === 'Deck' && <DeckScreen repository={repository} selectedDeckId={selectedDeckId} onStartPractice={id => void startPractice(id)} />}
        {screen === 'Practice' && <PracticeScreen repository={repository} onViewHistory={() => setScreen('History')} />}
        {screen === 'History' && <HistoryScreen repository={repository} onStartPractice={id => void startPractice(id)} onEditDeck={id => { setSelectedDeckId(id); setScreen('Deck'); }} />}
      </fieldset>}
      {starting && <p role="status">Starting practice…</p>}
    </main>
    <nav aria-label="Main navigation">
      {screens.map(name => <button key={name} type="button" disabled={starting} aria-current={screen === name ? 'page' : undefined} onClick={() => { setError(''); setScreen(name); }}>{name}</button>)}
    </nav>
  </div>;
}
