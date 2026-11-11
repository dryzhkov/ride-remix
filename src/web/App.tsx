import { useState } from 'react';
import { AuthScreen } from './auth/AuthScreen';

const screens = ['Deck', 'Practice', 'History'] as const;
type Screen = (typeof screens)[number];

const descriptions: Record<Screen, string> = {
  Deck: 'Build your next practice deck.',
  Practice: 'Your drills will appear here when you start a deck.',
  History: 'Your completed practice sessions will appear here.',
};

export function App() {
  const [screen, setScreen] = useState<Screen>('Deck');
  if (location.pathname.startsWith('/auth/')) return <div className="app"><header><a className="brand" href="/">Ride Remix</a><a className="account-link" href="/auth/login">Account</a></header><AuthScreen /></div>;

  return (
    <div className="app">
      <header><a className="brand" href="/">Ride Remix</a><a className="account-link" href="/auth/login">Account</a></header>
      <main id="main-content">
        <h1>{screen}</h1>
        <p>{descriptions[screen]}</p>
      </main>
      <nav aria-label="Main navigation">
        {screens.map((name) => (
          <button
            key={name}
            type="button"
            aria-current={screen === name ? 'page' : undefined}
            onClick={() => setScreen(name)}
          >
            {name}
          </button>
        ))}
      </nav>
    </div>
  );
}
