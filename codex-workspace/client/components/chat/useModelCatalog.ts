import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../api';
import { modelOptions, validModelCatalogResponse, type ModelCatalogResponse } from './models';

export function useModelCatalog(selectedModel: string, enabled = true) {
  const [response, setResponse] = useState<ModelCatalogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [retryable, setRetryable] = useState(false);
  const [locked, setLocked] = useState(() => document.body.dataset.workspaceLocked === 'true');
  const pending = useRef<AbortController | null>(null);
  const reload = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    const lock = () => { pending.current?.abort(); setLocked(true); setResponse(null); setLoaded(false); setError(null); };
    const unlock = () => { setLocked(false); reload(); };
    window.addEventListener('codex:runtime-changed', reload);
    window.addEventListener('codex:connection-restored', reload);
    window.addEventListener('online', reload);
    window.addEventListener('codex:session-locked', lock);
    window.addEventListener('codex:session-expired', lock);
    window.addEventListener('codex:session-unlocked', unlock);
    return () => {
      pending.current?.abort();
      window.removeEventListener('codex:runtime-changed', reload);
      window.removeEventListener('codex:connection-restored', reload);
      window.removeEventListener('online', reload);
      window.removeEventListener('codex:session-locked', lock);
      window.removeEventListener('codex:session-expired', lock);
      window.removeEventListener('codex:session-unlocked', unlock);
    };
  }, [reload]);

  useEffect(() => {
    if (!enabled || locked || document.body.dataset.workspaceLocked === 'true') { setLoading(false); return; }
    const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError(null); setRetryable(false);
    const timer = setTimeout(() => {
      if (pending.current !== controller || controller.signal.aborted) return;
      pending.current = null; controller.abort(); setLoading(false); setRetryable(true);
      setError('The model list is taking too long to load. Trying again…');
    }, 15_000);
    void api<unknown>('/models', { signal: controller.signal, cache: 'no-store' }).then(value => {
      if (controller.signal.aborted || pending.current !== controller) return;
      if (!validModelCatalogResponse(value)) throw new Error('The Codex model list could not be read. Refresh models to try again.');
      setResponse(value); setLoaded(true);
      if (!value.connected) { setError('Codex has not made its model list available yet. Trying again…'); setRetryable(true); }
    }).catch(failure => {
      if (!controller.signal.aborted && pending.current === controller) {
        // A failed metadata refresh does not revoke the previously confirmed
        // catalog or the native process state. Native requests still validate
        // their selected options on the server.
        setError(failure instanceof TypeError ? 'The model list could not be reached. Trying again…'
          : failure instanceof Error ? failure.message : 'Models could not be loaded.');
        setRetryable(failure instanceof TypeError || failure instanceof ApiError
          && ([408, 429, 502, 503, 504].includes(failure.status) || failure.code === 'REQUEST_TIMEOUT'));
      }
    }).finally(() => {
      clearTimeout(timer);
      if (pending.current === controller) { pending.current = null; if (!controller.signal.aborted) setLoading(false); }
    });
    return () => { clearTimeout(timer); controller.abort(); if (pending.current === controller) pending.current = null; };
  }, [enabled, locked, revision]);

  useEffect(() => {
    if (!enabled || locked || !error || !retryable || !navigator.onLine) return;
    const timer = setTimeout(reload, 5000);
    return () => clearTimeout(timer);
  }, [enabled, locked, error, retryable, reload]);

  const options = useMemo(() => modelOptions(response, selectedModel), [response, selectedModel]);
  return { options, loading, loaded, error, reload, connected: response?.connected === true };
}
