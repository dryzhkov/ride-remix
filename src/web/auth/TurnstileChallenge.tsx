import { useEffect, useRef, useState } from 'react';
import { getChallengeConfig } from '../api/auth';

type Action = 'login' | 'access_request';
interface Turnstile {
  render(element: HTMLElement, options: { sitekey: string; action: Action; theme: string; size: string; callback(token: string): void; 'expired-callback'(): void; 'error-callback'(): void }): string;
  remove(id: string): void;
}
declare global { interface Window { turnstile?: Turnstile } }
let script: Promise<void> | undefined;
function loadScript() {
  if (!script) script = new Promise<void>((resolve, reject) => {
    const element = document.createElement('script');
    element.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    element.async = true;
    element.onload = () => resolve();
    element.onerror = () => { element.remove(); script = undefined; reject(new Error('Verification could not load. Reconnect and try again.')); };
    document.head.append(element);
  });
  return script;
}
export function TurnstileChallenge({ action, onToken }: { action: Action; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let widget: string | undefined;
    const abort = new AbortController();
    async function install() {
      try {
        const { siteKey } = await getChallengeConfig(abort.signal);
        if (!siteKey) throw new Error('Online verification is not configured yet. Please try again later.');
        await loadScript();
        if (cancelled || !container.current) return;
        if (!window.turnstile) throw new Error('Verification could not load. Please retry.');
        widget = window.turnstile.render(container.current, {
          sitekey: siteKey, action, theme: 'auto', size: 'flexible',
          callback: token => { if (!cancelled) { setError(''); onToken(token); } },
          'expired-callback': () => { if (!cancelled) onToken(''); },
          'error-callback': () => { if (!cancelled) { onToken(''); setError('Verification failed. Reconnect or reload to retry.'); } },
        });
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Verification is unavailable.'); }
    }
    void install();
    return () => { cancelled = true; abort.abort(); if (widget) window.turnstile?.remove(widget); };
  }, [action, onToken]);
  return <div><div ref={container} aria-label="Human verification" />{error && <p role="alert">{error}</p>}</div>;
}
