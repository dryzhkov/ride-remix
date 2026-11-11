import { useState } from 'react';
import type { PracticeRepository, ImportReport } from '../../domain/repository';
import { exportBackup, restoreBackup } from './archive';
import './recovery.css';

export function RecoveryScreen({ repository, onImported }: { repository: PracticeRepository; onImported?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState<ImportReport>();
  async function run(action: () => Promise<void>) {
    if (busy) return; setBusy(true); setError(''); setNotice(''); setReport(undefined);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Storage operation failed. Please try again.'); }
    finally { setBusy(false); }
  }
  return <section className="recovery-screen"><h1>Backup and recovery</h1>
    <p>Your decks, custom drills, and practice history live in this browser. They do not sync with your account. Clearing browser data or storage eviction can erase them. Keep a JSON backup somewhere you can find again.</p>
    <p>Signing in on another device restores publishing access. Restore a backup to bring your local practice data with you. Backups exclude login credentials and account details.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button disabled={busy} onClick={() => void run(async () => {
      const text = await exportBackup(repository); const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `ride-remix-backup-${new Date().toISOString().slice(0,10)}.json`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Backup download requested. Check your downloads and keep the file safe.');
    })}>Download JSON backup</button>
    <h2>Restore a backup</h2><p>The full file is checked before importing. Identical records are skipped. Existing records win conflicts, and your active session is preserved.</p>
    <label>Choose backup file<input disabled={busy} type="file" accept=".json,application/json" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (file) void run(async () => { const result = await restoreBackup(repository, await file.text()); setReport(result); setNotice('Backup import finished.'); onImported?.(); });
    }} /></label>
    {report && <section aria-label="Import report"><h2>Import report</h2>{(['imported', 'skipped', 'conflicting'] as const).map(kind => <details key={kind}><summary>{kind === 'conflicting' ? 'Conflicts (existing records kept)' : kind[0].toUpperCase() + kind.slice(1)}: {report[kind].length}</summary><ul>{report[kind].map(record => <li key={record}>{record}</li>)}</ul></details>)}</section>}
    <h2>Protect browser storage</h2><p>Ask this browser to keep local data when storage is low. This does not protect against clearing data, losing the device, or uninstalling the browser.</p>
    <button disabled={busy} onClick={() => void run(async () => {
      if (!navigator.storage?.persist) { setNotice('This browser cannot request persistent storage. Keep regular backups.'); return; }
      const persisted = await navigator.storage.persist();
      setNotice(persisted ? 'Persistent storage granted. Keep regular backups too.' : 'Persistent storage was not granted. Your data is still local; keep regular backups.');
    })}>Request persistent storage</button>
  </section>;
}
