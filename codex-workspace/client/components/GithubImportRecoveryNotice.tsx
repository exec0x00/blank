import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { GithubImportRecovery } from '../../shared/types';
import { api } from '../api';
import './github-import-recovery.css';

function recoveryRecords(value: unknown): GithubImportRecovery[] {
  if (!Array.isArray(value) || !value.every(record => record && typeof record === 'object'
    && typeof record.workspaceId === 'string' && typeof record.workspaceName === 'string'
    && typeof record.stageId === 'string' && typeof record.reason === 'string')) {
    throw new Error('Import status was unavailable.');
  }
  return value;
}

function readable(value: string, limit: number): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/** Recovery is informational. Only the import form can create a workspace. */
export default function GithubImportRecoveryNotice({ refreshKey }: { refreshKey: number }) {
  const [records, setRecords] = useState<GithubImportRecovery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [locked, setLocked] = useState(() => document.body.dataset.workspaceLocked === 'true');
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    const lock = () => {
      pending.current?.abort();
      pending.current = null;
      setLocked(true);
      setRecords([]);
      setLoading(false);
      setError(false);
    };
    const unlock = () => { setLocked(false); setRevision(current => current + 1); };
    window.addEventListener('codex:session-locked', lock);
    window.addEventListener('codex:session-expired', lock);
    window.addEventListener('codex:session-unlocked', unlock);
    return () => {
      window.removeEventListener('codex:session-locked', lock);
      window.removeEventListener('codex:session-expired', lock);
      window.removeEventListener('codex:session-unlocked', unlock);
      pending.current?.abort();
      pending.current = null;
    };
  }, []);

  useEffect(() => {
    if (locked) return;
    const controller = new AbortController();
    pending.current = controller;
    const current = () => !controller.signal.aborted && pending.current === controller;
    setLoading(true);
    setError(false);
    api<unknown>('/github/imports/recovery', { signal: controller.signal })
      .then(value => { if (current()) setRecords(recoveryRecords(value)); })
      // The server returns sanitized reasons in successful responses. Raw
      // transport errors may contain internal details and are not displayed.
      .catch(() => { if (current()) setError(true); })
      .finally(() => { if (current()) { pending.current = null; setLoading(false); } });
    return () => {
      controller.abort();
      if (pending.current === controller) pending.current = null;
    };
  }, [locked, revision, refreshKey]);

  if (locked || !loading && !error && records.length === 0) return null;

  return <section className="github-import-recovery" aria-label="Import recovery status" aria-busy={loading}>
    <div className="github-import-recovery-heading">
      <h3>{records.length ? 'Interrupted imports' : 'Import status'}</h3>
      <button className="button ghost" type="button" onClick={() => setRevision(current => current + 1)} disabled={loading} aria-label="Refresh import status">
        <RefreshCw size={14} className={loading ? 'github-spinner' : ''} aria-hidden="true" /><span>Refresh</span>
      </button>
    </div>
    {loading && <p className="github-import-recovery-check" role="status">Checking interrupted imports…</p>}
    {error && <p className="github-import-recovery-error" role="alert">Could not check interrupted imports. Refresh to try again.</p>}
    {records.length > 0 && <ul className="github-import-recovery-list" aria-label="Interrupted imports">
      {records.map((record, index) => <li key={record.stageId || `${record.workspaceId}:${index}`}>
        <strong className="text-ellipsis" data-tooltip={readable(record.workspaceName, 80) || 'GitHub import'}>{readable(record.workspaceName, 80) || 'GitHub import'}</strong>
        <p>{readable(record.reason, 500) || 'Import recovery could not be confirmed.'}</p>
      </li>)}
    </ul>}
  </section>;
}
