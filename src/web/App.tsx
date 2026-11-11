import { useState } from 'react';

const screens = ['Deck', 'Practice', 'History'] as const;
type Screen = (typeof screens)[number];

const descriptions: Record<Screen, string> = {
  Deck: 'Build your next practice deck.',
  Practice: 'Your drills will appear here when you start a deck.',
  History: 'Your completed practice sessions will appear here.',
};

export function App() {
  const [screen, setScreen] = useState<Screen>('Deck');

  return (
    <div className="app">
      <header><a className="brand" href="/">Ride Remix</a></header>
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
