import { useEffect, useState } from 'react';
import { Bot, Download, FileText, ListTodo, LoaderCircle, Plug, RefreshCw, Search, Settings2, Slash } from 'lucide-react';
import type { Workspace } from '../../shared/types';
import type { ClaudeConversation, ClaudeNativeSession } from '../../shared/claude';
import Modal from './Modal';
import { api, json } from '../api';
import { setUiThread } from '../ui-state';
import { useClaudeCapabilities } from './claude/catalog';
import { relativeTime } from './claude/HistoryPanel';
import './claude/claude.css';

type Section = 'commands' | 'agents' | 'mcp' | 'memory' | 'sessions';
interface Props {
  workspace: Workspace; initialSection: Section; onClose: () => void;
  onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void; onOpenSettings: (tab: string) => void;
}
const tabs = [
  { id: 'commands', label: 'Commands & skills', icon: Slash },
  { id: 'agents', label: 'Subagents', icon: Bot },
  { id: 'mcp', label: 'MCP servers', icon: Plug },
  { id: 'memory', label: 'Project memory', icon: FileText },
  { id: 'sessions', label: 'Sessions', icon: ListTodo },
] as const;

export default function ClaudeToolsDialog({ workspace, initialSection, onClose, onNotify, onOpenSettings }: Props) {
  const [section, setSection] = useState<Section>(initialSection);
  const [query, setQuery] = useState('');
  const { capabilities, loading, reload } = useClaudeCapabilities(workspace.id);
  const [memory, setMemory] = useState<{ content: string; saved: string; exists: boolean; version?: string } | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [sessions, setSessions] = useState<ClaudeNativeSession[] | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    if (section !== 'memory' || memory) return;
    void api<{ content: string; version?: string }>(`/workspaces/${encodeURIComponent(workspace.id)}/file?path=CLAUDE.md`)
      .then(value => setMemory({ content: value.content, saved: value.content, exists: true, version: value.version }))
      .catch(() => setMemory({ content: '', saved: '', exists: false }));
  }, [section, memory, workspace.id]);
  useEffect(() => {
    if (section !== 'sessions') return;
    void api<ClaudeNativeSession[]>(`/claude/sessions?workspaceId=${encodeURIComponent(workspace.id)}`).then(setSessions).catch(error => { setSessions([]); onNotify(error instanceof Error ? error.message : 'Sessions are unavailable.', 'error'); });
  }, [section, workspace.id]);

  async function saveMemory() {
    if (!memory) return;
    setMemoryBusy(true);
    try {
      const base = `/workspaces/${encodeURIComponent(workspace.id)}`;
      if (!memory.exists) await api(`${base}/files`, json('POST', { path: 'CLAUDE.md', kind: 'file' })).catch(() => undefined);
      const saved = await api<{ version?: string }>(`${base}/file`, json('PUT', { path: 'CLAUDE.md', content: memory.content, ...(memory.version ? { expectedVersion: memory.version } : {}) }));
      setMemory({ ...memory, saved: memory.content, exists: true, version: saved.version }); onNotify('CLAUDE.md saved.', 'success');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'CLAUDE.md could not be saved. Edit it in the editor instead.', 'error'); }
    finally { setMemoryBusy(false); }
  }
  async function importSession(session: ClaudeNativeSession) {
    setImporting(session.sessionId);
    try {
      const created = await api<ClaudeConversation>(`/claude/sessions/${session.sessionId}/import`, json('POST', { workspaceId: workspace.id }));
      setUiThread(workspace.id, created.id); onNotify('Session imported. Open it from conversation history.', 'success');
      setSessions(list => list?.filter(item => item.sessionId !== session.sessionId) ?? null);
      window.dispatchEvent(new CustomEvent('codex:new-thread'));
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Import failed.', 'error'); }
    finally { setImporting(null); }
  }

  const needle = query.trim().toLowerCase();
  const commands = (capabilities?.commands ?? []).filter(command => !needle || command.name.toLowerCase().includes(needle) || command.description.toLowerCase().includes(needle));
  const agents = (capabilities?.agents ?? []).filter(agent => !needle || agent.name.toLowerCase().includes(needle) || agent.description.toLowerCase().includes(needle));

  return <Modal open title="Claude tools" titleId="claude-tools-title" description={`What Claude Code can use in ${workspace.name}`} onClose={onClose} className="claude-tools-dialog">
    <div className="claude-tools">
      <nav className="claude-tools-nav">{tabs.map(tab => <button key={tab.id} type="button" className={section === tab.id ? 'active' : ''} onClick={() => { setSection(tab.id); setQuery(''); }}><tab.icon size={15} /><span>{tab.label}</span></button>)}</nav>
      <div className="claude-tools-content">
        {(section === 'commands' || section === 'agents' || section === 'mcp') && <div className="claude-tools-toolbar">
          {section !== 'mcp' && <label className="chat-history-search"><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${section}`} /></label>}
          <button type="button" className="button" onClick={reload} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''} />Reload</button>
        </div>}
        {capabilities?.error && section !== 'memory' && section !== 'sessions' && <p className="form-error">{capabilities.error}</p>}
        {!capabilities && loading && section !== 'memory' && section !== 'sessions' && <p className="claude-tools-empty"><LoaderCircle size={14} className="chat-spin" />Asking Claude Code what is available…</p>}
        {section === 'commands' && capabilities && <><p className="claude-tools-help">Type <code>/</code> in the composer to run these. Add your own in <code>.claude/commands</code> or <code>.claude/skills</code>.</p>
          <ul className="claude-tools-list">{commands.map(command => <li key={command.name}><strong>/{command.name}{command.argumentHint ? <em> {command.argumentHint}</em> : null}</strong><small>{command.description}</small></li>)}</ul>
          {!commands.length && <p className="claude-tools-empty">No commands match.</p>}</>}
        {section === 'agents' && capabilities && <><p className="claude-tools-help">Claude delegates to these with the Agent tool. Add custom agents in <code>.claude/agents</code>.</p>
          <ul className="claude-tools-list">{agents.map(agent => <li key={agent.name}><strong>{agent.name}{agent.model ? <em> · {agent.model}</em> : null}</strong><small>{agent.description}</small></li>)}</ul></>}
        {section === 'mcp' && capabilities && <>{capabilities.mcpServers.length ? <ul className="claude-status-list">{capabilities.mcpServers.map(server => <li key={server.name}><span className={`claude-status-dot is-${server.status}`} /><strong>{server.name}</strong><small>{server.status}{server.tools ? ` · ${server.tools} tools` : ''}{server.error ? ` · ${server.error}` : ''}</small></li>)}</ul>
          : <p className="claude-tools-empty">No MCP servers are connected in this workspace.</p>}
          <button type="button" className="button" onClick={() => onOpenSettings('mcp')}><Settings2 size={13} />Configure MCP servers</button></>}
        {section === 'memory' && <><p className="claude-tools-help"><code>CLAUDE.md</code> in the workspace root holds project instructions Claude reads at the start of every conversation. Run <code>/init</code> to generate one.</p>
          {!memory ? <p className="claude-tools-empty"><LoaderCircle size={14} className="chat-spin" />Loading…</p> : <>
            <textarea className="input claude-mono claude-memory" rows={16} value={memory.content} placeholder="# Project instructions" onChange={event => setMemory({ ...memory, content: event.target.value })} />
            <div className="claude-tools-actions"><button type="button" className="button ghost" onClick={() => onOpenSettings('instructions')}>User memory…</button>
              <button type="button" className="button primary" disabled={memoryBusy || memory.content === memory.saved} onClick={() => void saveMemory()}>{memoryBusy && <LoaderCircle size={14} className="chat-spin" />}Save CLAUDE.md</button></div></>}</>}
        {section === 'sessions' && <><p className="claude-tools-help">Sessions started with <code>claude</code> in the terminal or by other tools in this workspace. Import one to continue it here.</p>
          {!sessions ? <p className="claude-tools-empty"><LoaderCircle size={14} className="chat-spin" />Looking for sessions…</p> : !sessions.length ? <p className="claude-tools-empty">No sessions to import.</p>
            : <ul className="claude-tools-list">{sessions.map(session => <li key={session.sessionId} className="is-action"><div><strong>{session.title}</strong><small>{relativeTime(session.lastModified)}{session.gitBranch ? ` · ${session.gitBranch}` : ''}</small></div>
              <button type="button" className="button" disabled={!!importing} onClick={() => void importSession(session)}>{importing === session.sessionId ? <LoaderCircle size={13} className="chat-spin" /> : <Download size={13} />}Import</button></li>)}</ul>}</>}
      </div>
    </div>
  </Modal>;
}
