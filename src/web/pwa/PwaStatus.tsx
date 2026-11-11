import { useEffect, useState } from 'react';
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
export function PwaStatus({ repository }: { repository: PracticeRepository }) {
  const [status, setStatus] = useState('Checking offline availability…');
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
      r.addEventListener('updatefound', () => { r.installing?.addEventListener('statechange', () => void inspect(r)); });
    }).catch(() => { if (!cancelled) setStatus('Offline installation failed. Your saved practice data remains on this device. Reconnect and reload to retry.'); });
    return () => { cancelled = true; if (refresh) clearInterval(refresh); navigator.serviceWorker.removeEventListener('controllerchange', changed); };
  }, []);
  async function apply() {
    if (!registration?.waiting || busy) return;
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
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not apply the update.'); } finally { setBusy(false); }
  }
  return <aside className="pwa-status" aria-label="Offline availability">
    <p role="status">{!import.meta.env?.PROD ? 'Offline installation is available in the production build.' : !('serviceWorker' in navigator) ? 'This browser does not support offline installation.' : status}</p>
    {waiting && <><p>An app and library update is ready. Apply it between practice sessions.</p><button disabled={busy} onClick={() => void apply()}>Apply update</button></>}
    {registration && <button disabled={busy} onClick={() => { void registration.update().catch(() => setError('Could not check for updates. Reconnect and try again.')); }}>Check for updates</button>}
    {error && <p role="alert">{error}</p>}
  </aside>;
}
