export type AppRoute =
  | { page: 'deck'; mode: 'list' | 'new'; id?: undefined }
  | { page: 'deck'; mode: 'detail'; id: string }
  | { page: 'practice'; id?: string }
  | { page: 'history' | 'settings' }
  | { page: 'shared'; id: string }
  | { page: 'missing' };

export function parseRoute(pathname: string): AppRoute {
  const path = pathname.replace(/\/$/, '') || '/';
  if (path === '/') return { page: 'practice' };
  if (path === '/deck') return { page: 'deck', mode: 'list' };
  if (path === '/deck/new') return { page: 'deck', mode: 'new' };
  if (path === '/practice') return { page: 'practice' };
  if (path === '/history') return { page: 'history' };
  if (path === '/settings') return { page: 'settings' };
  const match = path.match(/^\/(deck|practice|s)\/([^/]+)$/);
  if (match) {
    let id: string;
    try { id = decodeURIComponent(match[2]); } catch { return { page: 'missing' }; }
    if (match[1] === 's') return { page: 'shared', id };
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) return { page: 'missing' };
    return match[1] === 'deck' ? { page: 'deck', mode: 'detail', id } : { page: 'practice', id };
  }
  return { page: 'missing' };
}
