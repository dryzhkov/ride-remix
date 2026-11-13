import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { PracticeRepository } from '../domain/repository';
import { openPracticeRepository } from '../repositories/indexed-db';
import { AuthScreen } from './auth/AuthScreen';
import { DeckScreen } from './deck/DeckScreen';
import { PracticeScreen } from './practice/PracticeScreen';
import { HistoryScreen } from './history/HistoryScreen';
import { SharedDeckScreen } from './sharing/SharedDeckScreen';
import { RecoveryScreen } from './recovery/RecoveryScreen';
import { PwaStatus } from './pwa/PwaStatus';
import { parseRoute } from './routes';
import { Icon } from './ui/Icon';

const navigation = [ ['practice', 'Practice'], ['deck', 'Deck'], ['history', 'History'], ['settings', 'Settings'] ] as const;
export function App() {
  if (location.pathname.startsWith('/auth/') || /^\/(?:invite|account)\/?$/.test(location.pathname)) return <div className="app"><Header /><AuthScreen /><nav className="bottom-nav" aria-label="Main navigation">{navigation.map(([page, label]) => <a key={page} href={`/${page}`}><Icon name={page} /><span>{label}</span></a>)}</nav></div>;
  return <PracticeApp />;
}
function Header({ offlineStatus }: { offlineStatus?: string }) {
  return <header className="app-header"><a className="brand" href="/practice">Ride <span>Remix</span><span className="brand-dot" aria-hidden="true">↗</span></a><div className="header-actions">{offlineStatus && <a className="offline-indicator" href="/settings" aria-label={`Offline status: ${offlineStatus}`} title={offlineStatus}><Icon name="offline" />{offlineStatus.startsWith('Ready') && <span className="status-dot" />}</a>}<a className="account-link" href="/account" aria-label="Account" title="Account"><Icon name="account" /></a></div></header>;
}
function PracticeApp() {
  const [offlineStatus, setOfflineStatus] = useState('Checking offline availability…');
  const [path, setPath] = useState(location.pathname);
  const route = parseRoute(path);
  const [contentVersion, setContentVersion] = useState(0);
  const [repository, setRepository] = useState<PracticeRepository>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [starting, setStarting] = useState(false);
  const startLock = useRef(false);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    if (location.pathname === '/') window.history.replaceState(null, '', '/practice');
    const changed = () => { setPath(location.pathname); setError(''); };
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
    window.scrollTo?.(0, 0);
  }, [path]);
  useEffect(() => {
    let cancelled = false;
    let connection: PracticeRepository | undefined;
    async function load() {
      try {
        connection = await openPracticeRepository();
        if (cancelled) { connection.close(); return; }
        await connection.listSessions();
        if (cancelled) return;
        setRepository(connection); setError(''); setLoading(false);
      } catch {
        connection?.close();
        if (!cancelled) { setError('Could not open your saved practice. Please try again.'); setLoading(false); }
      }
    }
    void load();
    return () => { cancelled = true; connection?.close(); };
  }, [retry]);
  function navigate(next: string, replace = false) {
    if (location.pathname !== next) window.history[replace ? 'replaceState' : 'pushState'](null, '', next);
    setPath(next); setError('');
  }
  function follow(event: MouseEvent<HTMLAnchorElement>, next: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(next);
  }
  async function startPractice(deckId: string) {
    if (!repository || startLock.current) return;
    startLock.current = true; setStarting(true); setError('');
    try {
      const active = (await repository.listSessions()).find(session => session.status === 'active');
      if (active) {
        navigate(`/practice/${active.id}`);
        setError('Resume or end your current session before starting another deck.');
      } else {
        const session = await repository.startSession(deckId);
        navigate(`/practice/${session.id}`);
      }
    } catch { setError('Could not start practice. Your saved decks are available. Please try again.'); }
    finally { startLock.current = false; setStarting(false); }
  }
  return <div className="app">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <Header offlineStatus={offlineStatus} />
    <main id="main-content" ref={main} tabIndex={-1}>
      {error && <div className="app-error" role="alert"><p>{error}</p>{!repository && <button type="button" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Try again</button>}</div>}
      {loading && <p role="status">Loading saved practice…</p>}
      {repository && <fieldset className="app-screen" disabled={starting}>
        {route.page === 'shared' && <SharedDeckScreen repository={repository} publicId={route.id} onSaved={id => navigate(`/deck/${id}`)} />}
        {route.page === 'deck' && <DeckScreen key={`${contentVersion}:${route.mode}:${route.id ?? ''}`} repository={repository} mode={route.mode} onShowDecks={() => navigate('/deck')} selectedDeckId={route.id} onOpenDeck={id => navigate(`/deck/${id}`)} onStartPractice={id => void startPractice(id)} />}
        {route.page === 'practice' && <PracticeScreen key={`${contentVersion}:${route.id ?? ''}`} repository={repository} sessionId={route.id} onViewHistory={() => navigate('/history')} onSessionLoaded={id => { if (!route.id) navigate(`/practice/${id}`, true); }} onChooseDeck={() => navigate('/deck')} />}
        {route.page === 'history' && <HistoryScreen key={contentVersion} repository={repository} onViewSession={id => navigate(`/practice/${id}`)} onStartPractice={id => void startPractice(id)} onEditDeck={id => navigate(`/deck/${id}`)} />}

        {route.page === 'missing' && <section className="empty-card"><h1>Page not found</h1><p>This address does not point to a deck or practice session.</p><a href="/deck" onClick={event => follow(event, '/deck')}>Go to your decks</a></section>}
      </fieldset>}
      {starting && <p role="status">Starting practice…</p>}
      {repository && <section className="settings-screen" hidden={route.page !== 'settings'}>
        <div className="page-heading"><p className="eyebrow">YOUR DEVICE</p><h1>Settings</h1><p>Keep your practice ready, protected, and backed up.</p></div>
        <PwaStatus repository={repository} onStatus={setOfflineStatus} />
        <RecoveryScreen repository={repository} onImported={() => setContentVersion(value => value + 1)} />
      </section>}
    </main>
    {route.page === 'deck' && route.mode === 'list' && repository && <a className="fab" href="/deck/new" onClick={event => follow(event, '/deck/new')}><Icon name="plus" /><span>New deck</span></a>}
    <nav className="bottom-nav" aria-label="Main navigation">
      {navigation.map(([page, label]) => <a key={page} href={`/${page}`} aria-current={route.page === page ? 'page' : undefined} onClick={event => follow(event, `/${page}`)}><Icon name={page} /><span>{label}</span></a>)}
    </nav>
  </div>;
}
