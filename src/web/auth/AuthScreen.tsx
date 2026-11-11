import { useEffect, useState } from 'react';
import { getAuthSession, logout, redeemLoginLink, requestLoginLink } from '../api/auth';
import type { AuthAccount } from '../../contracts/auth';

// Keep the secret in memory only. It never appears in a request URL, storage, or referrer.
const confirmationToken = location.pathname === '/auth/confirm'
  ? new URLSearchParams(location.hash.slice(1)).get('token') : null;
if (location.pathname === '/auth/confirm' && location.hash) history.replaceState(null, '', '/auth/confirm');

export function AuthScreen() {
  const confirmation = location.pathname === '/auth/confirm';
  const [email, setEmail] = useState('');
  const [account, setAccount] = useState<AuthAccount>();
  const [csrfToken, setCsrfToken] = useState<string>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    getAuthSession(abort.signal).then(session => {
      setAccount(session.account); setCsrfToken(session.csrfToken);
    }).catch(() => { /* Sign-in remains available when unauthenticated or offline. */ });
    return () => abort.abort();
  }, []);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : 'Sign-in is unavailable. Please try again.'); }
    finally { setBusy(false); }
  }
  return <main id="main-content" className="auth-screen">
    <h1>{confirmation && !confirmed ? 'Confirm sign-in' : account ? 'Your account' : 'Sign in'}</h1>
    <p>Sign in to publish decks. Practice and saved history stay on this device and work without signing in.</p>
    {confirmation && !confirmed ? <>
      <p>{confirmationToken ? 'Select Continue to use this sign-in link. It expires after 15 minutes and works once.' : 'This link is missing its sign-in token. Request a new link.'}</p>
      {confirmationToken && <button className="auth-action" disabled={busy} onClick={() => void perform(async () => {
        const session = await redeemLoginLink(confirmationToken);
        setAccount(session.account); setCsrfToken(session.csrfToken); setConfirmed(true);
        setMessage('You are signed in.');
      })}>{busy ? 'Signing in…' : 'Continue'}</button>}
      <p><a href="/auth/login">Request a new sign-in link</a></p>
    </> : account ? <>
      <p>Signed in as {account.email}</p>
      <button className="auth-action" disabled={busy || !csrfToken} onClick={() => void perform(async () => {
        await logout(csrfToken!); setAccount(undefined); setCsrfToken(undefined); setMessage('You are signed out.');
      })}>Sign out</button>
    </> : <form onSubmit={event => {
      event.preventDefault(); void perform(async () => { const response = await requestLoginLink(email); setMessage(response.message); });
    }}>
      <label htmlFor="login-email">Email address</label>
      <input id="login-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} />
      <button className="auth-action" type="submit" disabled={busy}>{busy ? 'Requesting link…' : 'Email me a sign-in link'}</button>
      <p>Access is by invitation. Use the email address that received your invitation.</p>
    </form>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    <p><a href="/">Back to practice</a></p>
  </main>;
}
