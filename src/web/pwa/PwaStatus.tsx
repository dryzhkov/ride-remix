import { useEffect, useRef, useState } from 'react';
import type { PracticeRepository } from '../../domain/repository';
import './pwa.css';

function message(worker: ServiceWorker, type: string): Promise<{ ready?: boolean; applied?: boolean; reason?: string }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('Offline worker did not respond.')); }, 5000);
    channel.port1.onmessage = e => { clearTimeout(timeout); channel.port1.close(); resolve(e.data); };
    worker.postMessage({ type }, [channel.port2]);
  });
}
export function PwaStatus({ repository, onStatus }: { repository: PracticeRepository; onStatus: (status: string) => void }) {
  const [status, setStatus] = useState('Checking offline availability…');
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkNotice, setCheckNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const operationLock = useRef(false);
  const cooldownUntil = useRef(0);
  const checkTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const timer = setInterval(() => setCooldown(Math.max(0, Math.ceil((cooldownUntil.current - Date.now()) / 1000))), 1000);
    return () => { clearInterval(timer); clearTimeout(checkTimeout.current); };
  }, []);
  useEffect(() => {
    if (!import.meta.env?.PROD || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    let refresh: ReturnType<typeof setInterval> | undefined;
    const inspect = async (reg: ServiceWorkerRegistration) => {
      if (cancelled) return;
      setWaiting(Boolean(reg.waiting));
      if (!navigator.serviceWorker.controller) { setStatus('Installing offline assets…'); return; }
      try { const result = await message(navigator.serviceWorker.controller, 'STATUS'); if (!cancelled) setStatus(result.ready ? 'Ready for offline practice on this device.' : 'Offline assets are incomplete. Reconnect and check for updates.'); }
      catch { if (!cancelled) setStatus('Offline readiness could not be verified. Reconnect and check again.'); }
    };
    let reg: ServiceWorkerRegistration | undefined;
    const changed = () => { if (reg) void inspect(reg); };
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(r => {
      reg = r; if (cancelled) return;
      setRegistration(r); void inspect(r);
      refresh = setInterval(() => void inspect(r), 15000);
      r.addEventListener('updatefound', () => {
        if (cancelled) return;
        setCheckNotice('Downloading the update…');
        const worker = r.installing;
        worker?.addEventListener('statechange', () => {
          if (cancelled) return;
          void inspect(r);
          if (worker.state === 'installed') setCheckNotice(r.waiting ? 'Update ready. Apply it between practice sessions.' : 'Offline app saved on this device.');
          if (worker.state === 'redundant') setCheckNotice('Update installation stopped. Reconnect and check again.');
        });
      });
    }).catch(() => { if (!cancelled) setStatus('Offline installation failed. Your saved practice data remains on this device. Reconnect and reload to retry.'); });
    return () => { cancelled = true; if (refresh) clearInterval(refresh); navigator.serviceWorker.removeEventListener('controllerchange', changed); };
  }, []);
  const displayStatus = !import.meta.env?.PROD ? 'Offline installation is available in the production build.' : !('serviceWorker' in navigator) ? 'This browser does not support offline installation.' : status;
  useEffect(() => { onStatus(waiting ? 'An app update is ready. Open Settings to apply it.' : displayStatus); }, [displayStatus, waiting, onStatus]);
  async function checkForUpdates() {
    if (!registration || operationLock.current || Date.now() < cooldownUntil.current) return;
    operationLock.current = true;
    setChecking(true); setError(''); setCheckNotice('Checking for updates…');
    try {
      await Promise.race([
        registration.update(),
        new Promise<never>((_, reject) => {
          checkTimeout.current = setTimeout(() => reject(new Error('The update check timed out. Reconnect and try again.')), 15000);
        }),
      ]);
      setWaiting(Boolean(registration.waiting));
      setCheckNotice(registration.waiting ? 'Update ready. Apply it between practice sessions.' : registration.installing ? 'Downloading the update…' : 'Check complete. No new update found.');
    } catch (e) {
      setCheckNotice('');
      setError(e instanceof Error && e.message.includes('timed out') ? e.message : 'Could not check for updates. Reconnect and try again.');
    } finally {
      clearTimeout(checkTimeout.current);
      cooldownUntil.current = Date.now() + 30000;
      setCooldown(30); setChecking(false); operationLock.current = false;
    }
  }
  async function apply() {
    if (!registration?.waiting || operationLock.current) return;
    operationLock.current = true;
    setBusy(true); setError('');
    try {
      if ((await repository.listSessions()).some(s => s.status === 'active')) { setError('End the active practice session before updating.'); return; }
      const result = await message(registration.waiting, 'APPLY_UPDATE');
      if (!result.applied) { setError(result.reason ?? 'Update postponed.'); return; }
      // Wait for the new worker to control this page before loading its shell.
      if (registration.waiting) await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); reject(new Error('Update is taking longer than expected. Reload when practice is finished.')); }, 10000);
        const changed = () => { clearTimeout(timeout); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(); };
        navigator.serviceWorker.addEventListener('controllerchange', changed);
      });
      location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not apply the update.'); } finally { setBusy(false); operationLock.current = false; }
  }
  return <section className="pwa-status settings-card" aria-label="Offline status"><h2>Offline status</h2><p className="settings-description">Practice anywhere with this app saved on your device.</p>
    <p role="status">{displayStatus}</p>
    {waiting && <><p>An app and library update is ready. Apply it between practice sessions.</p><button className="settings-action" disabled={busy || checking} aria-busy={busy} onClick={() => void apply()}>{busy ? 'Applying update…' : 'Apply update'}</button></>}
    {registration && <button className="settings-action" disabled={busy || checking || cooldown > 0} aria-busy={checking} onClick={() => void checkForUpdates()}>{checking ? 'Checking…' : cooldown > 0 ? `Check again in ${cooldown}s` : 'Check for updates'}</button>}
    {checkNotice && <p className="update-feedback" role="status">{checkNotice}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
