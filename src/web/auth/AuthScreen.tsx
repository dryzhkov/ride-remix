import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthSession, logout, redeemLoginLink, requestLoginLink, requestAccess } from '../api/auth';
import { TurnstileChallenge } from './TurnstileChallenge';
import type { AuthAccount } from '../../contracts/auth';

// Keep the secret in memory only. It never appears in a request URL, storage, or referrer.
const confirmationToken = location.pathname === '/auth/confirm'
  ? new URLSearchParams(location.hash.slice(1)).get('token') : null;
if (location.pathname === '/auth/confirm' && location.hash) history.replaceState(null, '', '/auth/confirm');

export function AuthScreen() {
  const confirmation = location.pathname === '/auth/confirm';
  const accessRequest = /^\/invite\/?$/.test(location.pathname);
  const [challengeToken, setChallengeToken] = useState('');
  const [challengeAttempt, setChallengeAttempt] = useState(0);
  const receiveToken = useCallback((token: string) => setChallengeToken(token), []);
  const [email, setEmail] = useState('');
  const [account, setAccount] = useState<AuthAccount>();
  const [csrfToken, setCsrfToken] = useState<string>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const actionLock = useRef(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownUntil = useRef(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(Math.max(0, Math.ceil((cooldownUntil.current - Date.now()) / 1000))), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    const abort = new AbortController();
    getAuthSession(abort.signal).then(session => {
      setAccount(session.account); setCsrfToken(session.csrfToken);
    }).catch(() => { /* Sign-in remains available when unauthenticated or offline. */ });
    return () => abort.abort();
  }, []);
  async function perform(action: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : 'Sign-in is unavailable. Please try again.'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  return <main id="main-content" className="auth-screen">
    <h1>{confirmation && !confirmed ? 'Confirm sign-in' : account ? 'Your account' : accessRequest ? 'Request access' : 'Sign in'}</h1>
    {!account && !confirmation && <>
      <p>{accessRequest ? 'Request access to the Ride Remix beta. We’ll email you when you’re approved.' : 'Already approved? Enter your approved email to receive a sign-in link.'}</p>
      <p><a href={accessRequest ? '/auth/login' : '/invite'}>{accessRequest ? 'Already approved? Sign in' : 'New here? Request access first'}</a></p>
    </>}
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
      event.preventDefault();
      if (!challengeToken || actionLock.current || cooldownUntil.current > Date.now()) return;
      void perform(async () => {
        try {
          const response = accessRequest ? await requestAccess(email, challengeToken) : await requestLoginLink(email, challengeToken);
          setMessage(response.message);
          cooldownUntil.current = Date.now() + 60_000;
          setCooldown(60);
        } finally { setChallengeToken(''); setChallengeAttempt(value => value + 1); }
      });
    }}>
      <label htmlFor="login-email">Email address</label>
      <input disabled={busy} id="login-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} />
      <TurnstileChallenge key={`${accessRequest}-${challengeAttempt}`} action={accessRequest ? 'access_request' : 'login'} onToken={receiveToken} />
      <button className="auth-action" type="submit" aria-busy={busy} disabled={busy || cooldown > 0 || !challengeToken}>{cooldown > 0 ? `${accessRequest ? 'Access requested' : 'Link requested'} · ${cooldown}s` : busy ? 'Submitting…' : accessRequest ? 'Submit access request' : 'Email me a sign-in link'}</button>

    </form>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}

  </main>;
}
