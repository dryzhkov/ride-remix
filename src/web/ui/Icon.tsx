export function Icon({ name }: { name: 'deck' | 'practice' | 'history' | 'settings' | 'plus' | 'account' }) {
  const paths = {
    deck: <><rect x="6" y="6" width="14" height="15" rx="3" /><path d="M16 3H6a3 3 0 0 0-3 3v11M10 11h6m-6 5h4" /></>,
    practice: <><path d="m9 5 11 7-11 7Z" /></>,
    history: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2" /></>,
    settings: <><path d="m9 3-.7 2.3-2.1 1.2L4 6l-2 3.5 1.6 1.8v2.4L2 15.5 4 19l2.2-.5 2.1 1.2L9 22h4l.7-2.3 2.1-1.2 2.2.5 2-3.5-1.6-1.8v-2.4L20 9.5 18 6l-2.2.5-2.1-1.2L13 3Z" /><circle cx="11" cy="12.5" r="3" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    account: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
