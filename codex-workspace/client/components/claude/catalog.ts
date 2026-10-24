import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import type { ClaudeCapabilities, ClaudeEffort, ClaudeModelOption } from '../../../shared/claude';

let modelPromise: Promise<ClaudeModelOption[]> | null = null;
let modelValue: ClaudeModelOption[] | null = null;
const capabilityValues = new Map<string, ClaudeCapabilities>();
const capabilityPromises = new Map<string, Promise<ClaudeCapabilities>>();

export const EFFORT_LABELS: Record<ClaudeEffort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultracode: 'Ultracode' };
export const EFFORT_DESCRIPTIONS: Record<ClaudeEffort, string> = {
  low: 'Fastest replies, minimal reasoning', medium: 'Balanced speed and depth', high: 'Thinks carefully before acting',
  xhigh: 'Deeper reasoning for hard problems', max: 'Maximum reasoning, slowest',
  ultracode: 'Plans and runs multi-step workflows for large tasks',
};

export function useClaudeModels() {
  const [models, setModels] = useState<ClaudeModelOption[]>(modelValue ?? []);
  const [loading, setLoading] = useState(!modelValue);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((refresh = false) => {
    if (refresh) modelPromise = null;
    setLoading(true); setError(null);
    modelPromise ??= api<{ data: ClaudeModelOption[] }>(`/claude/models${refresh ? '?refresh=1' : ''}`).then(value => (modelValue = value.data));
    modelPromise.then(value => setModels(value), failure => { modelPromise = null; setError(failure instanceof Error ? failure.message : 'Models are unavailable.'); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  return { models, loading, error, reload: () => load(true) };
}

export function modelLabel(models: ClaudeModelOption[], id: string) {
  return models.find(model => model.id === id)?.label ?? id;
}
export function modelEfforts(models: ClaudeModelOption[], id: string): ClaudeEffort[] {
  return models.find(model => model.id === id)?.efforts ?? ['low', 'medium', 'high', 'xhigh', 'max'];
}

export function useClaudeCapabilities(workspaceId: string | undefined) {
  const [value, setValue] = useState<ClaudeCapabilities | null>(workspaceId ? capabilityValues.get(workspaceId) ?? null : null);
  const [loading, setLoading] = useState(false);
  const load = useCallback((refresh = false) => {
    if (!workspaceId) return;
    if (refresh) capabilityPromises.delete(workspaceId);
    setLoading(true);
    let promise = capabilityPromises.get(workspaceId);
    if (!promise) {
      promise = api<ClaudeCapabilities>(`/claude/workspaces/${encodeURIComponent(workspaceId)}/capabilities${refresh ? '?refresh=1' : ''}`, { timeoutMs: 60_000 })
        .then(result => { capabilityValues.set(workspaceId, result); return result; });
      promise.catch(() => capabilityPromises.delete(workspaceId));
      capabilityPromises.set(workspaceId, promise);
    }
    promise.then(setValue, failure => setValue({ commands: [], agents: [], outputStyles: [], mcpServers: [], loadedAt: new Date().toISOString(), error: failure instanceof Error ? failure.message : 'Unavailable' }))
      .finally(() => setLoading(false));
  }, [workspaceId]);
  useEffect(() => { setValue(workspaceId ? capabilityValues.get(workspaceId) ?? null : null); load(); }, [workspaceId, load]);
  return { capabilities: value, loading, reload: () => load(true) };
}
