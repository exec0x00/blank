import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Brain, Check, Cpu, FileText, Info, Loader2, LogOut, Palette, Plug, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import type { AppSettings } from '../../shared/types';
import { CLAUDE_PERMISSION_MODES, type ClaudeEffort, type ClaudePermissionMode, type ClaudePreferences, type ClaudeSettingSource } from '../../shared/claude';
import Modal from './Modal';
import { SelectMenu } from './ui/Dropdown';
import { api, json } from '../api';
import { EFFORT_DESCRIPTIONS, EFFORT_LABELS, modelEfforts, useClaudeCapabilities, useClaudeModels } from './claude/catalog';
import './settings.css';
import './settings-layout.css';
import './claude/claude.css';

export type SettingsPatch = Partial<Pick<AppSettings, 'model' | 'fontSize' | 'wordWrap'>> & { claude?: Partial<ClaudePreferences> };
const settingsTabs = ['agent', 'permissions', 'instructions', 'mcp', 'appearance', 'about'] as const;
export type SettingsTab = (typeof settingsTabs)[number];
const validTab = (value: unknown): SettingsTab => settingsTabs.find(tab => tab === value) ?? 'agent';
const sections = [
  { tab: 'agent', label: 'Model & reasoning', icon: Cpu },
  { tab: 'permissions', label: 'Permissions', icon: ShieldCheck },
  { tab: 'instructions', label: 'Instructions & memory', icon: FileText },
  { tab: 'mcp', label: 'MCP servers', icon: Plug },
  { tab: 'appearance', label: 'Appearance', icon: Palette },
  { tab: 'about', label: 'About', icon: Info },
] as const;
const DEFAULT = '$default';
const defaults: ClaudePreferences = {
  model: 'claude-sonnet-5-5', effort: null, thinking: true, permissionMode: 'default', maxTurns: null, maxBudgetUsd: null, fallbackModel: null,
  appendSystemPrompt: '', outputStyle: null, additionalDirectories: [], allowedTools: [], disallowedTools: [], settingSources: ['user', 'project', 'local'], mcpServers: {}, fileCheckpointing: true,
};
type Draft = ClaudePreferences & { fontSize: number; wordWrap: boolean };
const draftFrom = (settings: AppSettings): Draft => ({ ...defaults, ...settings.claude, fontSize: settings.fontSize, wordWrap: settings.wordWrap });
const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);

interface Props {
  open: boolean; onClose: () => void; settings: AppSettings; onSave: (patch: SettingsPatch) => Promise<void>; onLogout: () => Promise<void>;
  initialTab?: SettingsTab | string; workspaceId?: string;
}

export default function SettingsDialog({ open, onClose, settings, onSave, onLogout, initialTab = 'agent', workspaceId }: Props) {
  const [tab, setTab] = useState<SettingsTab>(() => validTab(initialTab));
  const [baseline, setBaseline] = useState(() => draftFrom(settings));
  const [draft, setDraft] = useState(baseline);
  const [mcpText, setMcpText] = useState(() => JSON.stringify(baseline.mcpServers, null, 2));
  const [allowedText, setAllowedText] = useState(() => baseline.allowedTools.join('\n'));
  const [deniedText, setDeniedText] = useState(() => baseline.disallowedTools.join('\n'));
  const [directoriesText, setDirectoriesText] = useState(() => baseline.additionalDirectories.join('\n'));
  const [memory, setMemory] = useState<{ content: string; saved: string; path: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const catalog = useClaudeModels();
  const { capabilities, loading: capabilitiesLoading, reload: reloadCapabilities } = useClaudeCapabilities(tab === 'mcp' || tab === 'about' || tab === 'instructions' ? workspaceId : undefined);

  useEffect(() => { setTab(validTab(initialTab)); }, [initialTab]);
  useEffect(() => {
    if (!open || memory) return;
    void api<{ content: string; path: string }>('/claude/memory').then(value => setMemory({ content: value.content, saved: value.content, path: value.path })).catch(() => undefined);
  }, [open, memory]);

  const mcpParsed = useMemo(() => {
    try { const value = JSON.parse(mcpText || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? { value: value as ClaudePreferences['mcpServers'] } : { error: 'Enter a JSON object keyed by server name.' }; }
    catch (failure) { return { error: failure instanceof Error ? failure.message : 'Invalid JSON.' }; }
  }, [mcpText]);
  const effective: Draft = {
    ...draft, mcpServers: mcpParsed.value ?? draft.mcpServers,
    allowedTools: lines(allowedText), disallowedTools: lines(deniedText), additionalDirectories: lines(directoriesText),
  };
  const changedKeys = (Object.keys(effective) as (keyof Draft)[]).filter(key => JSON.stringify(effective[key]) !== JSON.stringify(baseline[key]));
  const memoryChanged = !!memory && memory.content !== memory.saved;
  const hasChanges = changedKeys.length > 0 || memoryChanged;
  const directoryError = effective.additionalDirectories.find(item => !item.startsWith('/'));
  const validationError = mcpParsed.error ? `MCP servers: ${mcpParsed.error}` : directoryError ? `Additional directories must be absolute paths (${directoryError}).` : '';
  const efforts = modelEfforts(catalog.models, draft.model);
  const update = (patch: Partial<Draft>) => { setDraft(current => ({ ...current, ...patch })); setNotice(''); };
  const requestLeave = (action: () => void) => { if (hasChanges && !busy) setPendingLeave(() => action); else action(); };

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!hasChanges || validationError || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (changedKeys.length) {
        const claude: Partial<ClaudePreferences> = {};
        for (const key of changedKeys) if (key !== 'fontSize' && key !== 'wordWrap') (claude as Record<string, unknown>)[key] = effective[key];
        await onSave({ ...(changedKeys.includes('fontSize') ? { fontSize: effective.fontSize } : {}), ...(changedKeys.includes('wordWrap') ? { wordWrap: effective.wordWrap } : {}), ...(Object.keys(claude).length ? { claude } : {}) });
      }
      if (memory && memoryChanged) {
        const saved = await api<{ content: string; path: string }>('/claude/memory', json('PUT', { content: memory.content }));
        setMemory({ content: saved.content, saved: saved.content, path: saved.path });
      }
      setBaseline(effective); setDraft(effective); setNotice('Settings saved. New turns use them right away.');
      if (changedKeys.some(key => ['mcpServers', 'settingSources', 'allowedTools', 'disallowedTools', 'outputStyle'].includes(key))) reloadCapabilities();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Settings could not be saved.'); }
    finally { setBusy(false); }
  }

  const sourceToggle = (source: ClaudeSettingSource) => update({ settingSources: draft.settingSources.includes(source) ? draft.settingSources.filter(item => item !== source) : [...draft.settingSources, source] });

  return <Modal open={open} onClose={() => requestLeave(onClose)} title="Settings" titleId="settings-dialog-title" description="Make Claude Code work your way." className="settings-dialog">
    <form onSubmit={event => void save(event)} className="settings-form" noValidate>
      <div className="settings-mobile-navigation">
        <SelectMenu aria-label="Settings category" value={tab} onValueChange={setTab} className="select" options={sections.map(section => ({ value: section.tab, label: section.label, icon: <section.icon size={16} /> }))} />
        <button type="button" className="icon-button" aria-label="Lock workspace" onClick={() => requestLeave(() => { void onLogout(); })}><LogOut size={17} /></button>
      </div>
      <div className="settings-layout"><nav className="settings-nav" aria-label="Settings categories">
        <span className="settings-nav-label">Preferences</span>
        {sections.map(section => <button key={section.tab} type="button" className={tab === section.tab ? 'active' : ''} aria-current={tab === section.tab ? 'page' : undefined} onClick={() => setTab(section.tab)}><section.icon size={17} /><span>{section.label}</span></button>)}
        <div className="settings-nav-spacer" /><button type="button" className="settings-lock" onClick={() => requestLeave(() => { void onLogout(); })}><LogOut size={17} /><span>Lock workspace</span></button>
      </nav><div className="settings-content">

        <div hidden={tab !== 'agent'}><div className="settings-section">
          <div className="settings-section-title"><span className="settings-section-icon"><Cpu size={20} /></span><div><h3>Model & reasoning</h3><p>Defaults for new conversations. Each conversation can change these from the composer.</p></div></div>
          <section className="settings-preference-card">
            <div className="field-label-row"><label className="field-label">Default model</label><button className="text-button" type="button" onClick={catalog.reload} disabled={catalog.loading}><RefreshCw size={12} className={catalog.loading ? 'spin' : ''} />Refresh models</button></div>
            <SelectMenu aria-label="Default model" className="select" value={draft.model} onValueChange={model => update({ model })}
              options={(catalog.models.length ? catalog.models : [{ id: draft.model, label: draft.model }]).map(model => ({ value: model.id, label: model.label, description: model.description ? `${model.description} · ${model.id}` : model.id }))} />
            {catalog.error && <p className="form-error">{catalog.error}</p>}
            <div className="settings-field-group">
              <label className="field-label">Reasoning effort</label>
              <div className="claude-choice-grid" role="radiogroup" aria-label="Reasoning effort">
                {[null, ...efforts].map(value => <button type="button" key={value ?? 'default'} role="radio" aria-checked={draft.effort === value} className={draft.effort === value ? 'is-selected' : ''} onClick={() => update({ effort: value as ClaudeEffort | null })}>
                  <strong>{value ? EFFORT_LABELS[value] : 'Auto'}</strong><small>{value ? EFFORT_DESCRIPTIONS[value] : 'Claude Code picks per model'}</small></button>)}
              </div>
            </div>
            <div className="setting-row settings-field-group"><div><label id="thinking-label"><Brain size={13} /> Extended thinking</label><p>Let Claude reason before answering and show a summary of its thinking.</p></div>
              <button className={'switch ' + (draft.thinking ? 'is-on' : '')} type="button" role="switch" aria-checked={draft.thinking} aria-labelledby="thinking-label" onClick={() => update({ thinking: !draft.thinking })}><span /></button></div>
          </section>
          <section className="settings-preference-card">
            <div className="settings-card-heading"><div><h4>Limits & fallback</h4><p>Optional guard rails for long autonomous runs.</p></div></div>
            <div className="claude-field-grid">
              <label className="field"><span>Max agent turns per message</span><input className="input" type="number" min={1} max={500} placeholder="No limit" value={draft.maxTurns ?? ''} onChange={event => update({ maxTurns: event.target.value ? Number(event.target.value) : null })} /></label>
              <label className="field"><span>Max spend per message (USD)</span><input className="input" type="number" min={0.01} step={0.01} placeholder="No limit" value={draft.maxBudgetUsd ?? ''} onChange={event => update({ maxBudgetUsd: event.target.value ? Number(event.target.value) : null })} /></label>
              <label className="field"><span>Fallback model when overloaded</span>
                <SelectMenu aria-label="Fallback model" className="select" value={draft.fallbackModel ?? DEFAULT} onValueChange={value => update({ fallbackModel: value === DEFAULT ? null : value })}
                  options={[{ value: DEFAULT, label: 'None' }, ...catalog.models.filter(model => model.id !== draft.model).map(model => ({ value: model.id, label: model.label }))]} /></label>
            </div>
          </section>
        </div></div>

        <div hidden={tab !== 'permissions'}><div className="settings-section">
          <div className="settings-section-title"><span className="settings-section-icon"><ShieldCheck size={20} /></span><div><h3>Permissions</h3><p>Choose when Claude asks before using tools. You can switch modes per conversation at any time, even mid-turn.</p></div></div>
          <section className="settings-preference-card">
            <label className="field-label">Default permission mode</label>
            <div className="claude-mode-list" role="radiogroup" aria-label="Default permission mode">
              {CLAUDE_PERMISSION_MODES.map(mode => <button type="button" role="radio" key={mode.value} aria-checked={draft.permissionMode === mode.value} className={draft.permissionMode === mode.value ? 'is-selected' : ''}
                onClick={() => update({ permissionMode: mode.value as ClaudePermissionMode })}><span className={`claude-mode-dot is-${mode.value}`} /><span><strong>{mode.label}</strong><small>{mode.description}</small></span>{draft.permissionMode === mode.value && <Check size={15} />}</button>)}
            </div>
            {draft.permissionMode === 'bypassPermissions' && <p className="settings-inline-notice">Bypass mode runs every command and edit without asking. Use it only in workspaces you can restore.</p>}
          </section>
          <section className="settings-preference-card">
            <div className="settings-card-heading"><div><h4>Tool rules</h4><p>One rule per line, using Claude Code syntax such as <code>Bash(npm test:*)</code>, <code>Edit</code>, or <code>mcp__github</code>.</p></div></div>
            <div className="claude-field-grid is-two">
              <label className="field"><span>Always allow</span><textarea className="input claude-mono" rows={5} value={allowedText} onChange={event => { setAllowedText(event.target.value); setNotice(''); }} placeholder={'Read\nBash(git status)\nBash(npm run test:*)'} /></label>
              <label className="field"><span>Always deny</span><textarea className="input claude-mono" rows={5} value={deniedText} onChange={event => { setDeniedText(event.target.value); setNotice(''); }} placeholder={'Bash(rm -rf:*)\nWebFetch'} /></label>
            </div>
            <label className="field settings-field-group"><span>Additional directories Claude may access</span><textarea className="input claude-mono" rows={3} value={directoriesText} onChange={event => { setDirectoriesText(event.target.value); setNotice(''); }} placeholder="/data/workspaces/shared" /></label>
            <div className="setting-row settings-field-group"><div><label id="checkpoint-label">File checkpoints</label><p>Record file states so you can rewind Claude's edits along with the conversation.</p></div>
              <button className={'switch ' + (draft.fileCheckpointing ? 'is-on' : '')} type="button" role="switch" aria-checked={draft.fileCheckpointing} aria-labelledby="checkpoint-label" onClick={() => update({ fileCheckpointing: !draft.fileCheckpointing })}><span /></button></div>
          </section>
        </div></div>

        <div hidden={tab !== 'instructions'}><div className="settings-section">
          <div className="settings-section-title"><span className="settings-section-icon"><FileText size={20} /></span><div><h3>Instructions & memory</h3><p>Guidance Claude follows in every conversation.</p></div></div>
          <section className="settings-preference-card">
            <div className="settings-card-heading"><div><h4>User memory (CLAUDE.md)</h4><p>Loaded in every workspace. Project instructions live in each workspace's own <code>CLAUDE.md</code>.</p></div></div>
            <textarea className="input claude-mono claude-memory" rows={10} value={memory?.content ?? ''} disabled={!memory} placeholder="# Preferences&#10;- Prefer TypeScript&#10;- Run tests before finishing" onChange={event => { setMemory(current => current ? { ...current, content: event.target.value } : current); setNotice(''); }} />
            {memory && <p className="field-help">{memory.path}</p>}
          </section>
          <section className="settings-preference-card">
            <div className="settings-card-heading"><div><h4>Append to system prompt</h4><p>Added after Claude Code's own system prompt for every turn.</p></div></div>
            <textarea className="input" rows={5} value={draft.appendSystemPrompt} onChange={event => update({ appendSystemPrompt: event.target.value })} placeholder="Always explain your plan briefly before editing files." />
            <div className="claude-field-grid settings-field-group">
              <label className="field"><span>Output style</span>
                <SelectMenu aria-label="Output style" className="select" value={draft.outputStyle ?? DEFAULT} onValueChange={value => update({ outputStyle: value === DEFAULT ? null : value })}
                  options={[{ value: DEFAULT, label: 'Default' }, ...[...new Set([...(capabilities?.outputStyles ?? []), ...(draft.outputStyle ? [draft.outputStyle] : [])])].filter(style => style !== 'default').map(style => ({ value: style, label: style }))]} /></label>
            </div>
          </section>
          <section className="settings-preference-card">
            <div className="settings-card-heading"><div><h4>Settings sources</h4><p>Which Claude Code settings files, CLAUDE.md files, skills, commands, and agents are loaded.</p></div></div>
            {([['user', 'User', 'Your Claude config directory (memory, skills, agents)'], ['project', 'Project', '.claude/settings.json, CLAUDE.md, .claude/commands in the workspace'], ['local', 'Local', '.claude/settings.local.json in the workspace']] as const).map(([source, label, help]) =>
              <div className="setting-row" key={source}><div><label id={`source-${source}`}>{label}</label><p>{help}</p></div>
                <button className={'switch ' + (draft.settingSources.includes(source) ? 'is-on' : '')} type="button" role="switch" aria-checked={draft.settingSources.includes(source)} aria-labelledby={`source-${source}`} onClick={() => sourceToggle(source)}><span /></button></div>)}
          </section>
        </div></div>

        <div hidden={tab !== 'mcp'}><div className="settings-section">
          <div className="settings-section-title"><span className="settings-section-icon"><Plug size={20} /></span><div><h3>MCP servers</h3><p>Connect tools over the Model Context Protocol. Servers from a workspace's <code>.mcp.json</code> load automatically.</p></div></div>
          <section className="settings-preference-card">
            <div className="field-label-row"><label className="field-label">Server status</label><button className="text-button" type="button" onClick={reloadCapabilities} disabled={capabilitiesLoading || !workspaceId}><RefreshCw size={12} className={capabilitiesLoading ? 'spin' : ''} />Check servers</button></div>
            {!workspaceId ? <p className="field-help">Open a workspace to check server status.</p> : capabilitiesLoading && !capabilities ? <p className="field-help"><Loader2 size={12} className="spin" /> Checking servers…</p>
              : capabilities?.mcpServers.length ? <ul className="claude-status-list">{capabilities.mcpServers.map(server => <li key={server.name}><span className={`claude-status-dot is-${server.status}`} /><strong>{server.name}</strong><small>{server.status}{server.tools ? ` · ${server.tools} tools` : ''}{server.error ? ` · ${server.error}` : ''}</small></li>)}</ul>
              : <p className="field-help">No MCP servers are connected.</p>}
          </section>
          <section className="settings-preference-card">
            <div className="settings-card-heading"><div><h4>Configured servers</h4><p>JSON in the same shape as <code>.mcp.json</code>'s <code>mcpServers</code>.</p></div><button type="button" className="text-button" onClick={() => setMcpText(JSON.stringify({ ...(mcpParsed.value ?? {}), example: { type: 'http', url: 'https://example.com/mcp' } }, null, 2))}>Add example</button></div>
            <textarea className="input claude-mono" rows={12} spellCheck={false} value={mcpText} aria-invalid={!!mcpParsed.error} onChange={event => { setMcpText(event.target.value); setNotice(''); }} />
            {mcpParsed.error && <p className="form-error">{mcpParsed.error}</p>}
          </section>
        </div></div>

        <div hidden={tab !== 'appearance'}><div className="settings-section">
          <div className="settings-section-title"><span className="settings-section-icon"><Palette size={20} /></span><div><h3>Appearance</h3><p>Make the editor and terminal comfortable to read.</p></div></div>
          <section className="settings-preference-card">
            <div className="setting-row"><div><label htmlFor="editor-font-size">Editor font size</label><p>Also used by the terminal.</p></div><span className="font-size-value">{draft.fontSize}<span>px</span></span></div>
            <input id="editor-font-size" className="range-input" type="range" min={11} max={22} step={1} value={draft.fontSize} onChange={event => update({ fontSize: Number(event.target.value) })} />
            <div className="settings-size-presets" role="group" aria-label="Font size presets">{[{ size: 12, label: 'Compact' }, { size: 14, label: 'Comfortable' }, { size: 18, label: 'Large' }].map(preset => <button className="button" type="button" key={preset.size} aria-pressed={draft.fontSize === preset.size} onClick={() => update({ fontSize: preset.size })}>{preset.label}<small>{preset.size}px</small></button>)}</div>
            <div className="font-preview" style={{ fontSize: draft.fontSize }}><span>const</span> nextIdea = <em>"hello, world"</em>;</div>
          </section><section className="settings-preference-card">
            <div className="setting-row"><div><label id="word-wrap-label">Wrap long lines</label><p>Keep code within the width of the editor.</p></div><button className={'switch ' + (draft.wordWrap ? 'is-on' : '')} type="button" role="switch" aria-checked={draft.wordWrap} aria-labelledby="word-wrap-label" onClick={() => update({ wordWrap: !draft.wordWrap })}><span /></button></div>
          </section>
        </div></div>

        <div hidden={tab !== 'about'}><div className="settings-section">
          <div className="settings-section-title"><span className="settings-section-icon"><Info size={20} /></span><div><h3>About</h3><p>Claude Code runs inside each workspace through the official Claude Agent SDK.</p></div></div>
          <section className="settings-preference-card">
            <dl className="claude-facts">
              <div><dt>Agent</dt><dd>Claude Code (Agent SDK)</dd></div>
              <div><dt>API</dt><dd>{settings.agentConfigured ? 'Connected through the Space PASSWORD secret' : 'Not configured — add the PASSWORD secret'}</dd></div>
              <div><dt>Models available</dt><dd>{catalog.models.length ? catalog.models.map(model => model.label).join(', ') : catalog.loading ? 'Loading…' : 'Unavailable'}</dd></div>
              <div><dt>Slash commands</dt><dd>{capabilities ? capabilities.commands.length : '…'}</dd></div>
              <div><dt>Subagents</dt><dd>{capabilities ? capabilities.agents.map(agent => agent.name).join(', ') || 'None' : '…'}</dd></div>
            </dl>
            {capabilities?.error && <p className="form-error">{capabilities.error}</p>}
          </section>
        </div></div>
      </div></div>
      {validationError && hasChanges && <p className="form-error settings-error" role="status">{validationError}</p>}
      {error && <p className="form-error settings-error" role="alert">{error}</p>}
      {notice && <p className="settings-save-notice" role="status">{notice}</p>}
      {pendingLeave && <div className="settings-discard" role="alert"><span>You have unsaved settings.</span><div><button type="button" className="button" onClick={() => setPendingLeave(null)}>Keep editing</button><button type="button" className="button" onClick={() => { const action = pendingLeave; setPendingLeave(null); action(); }}>Discard changes</button></div></div>}
      <div className="modal-footer"><span className={`settings-footer-hint${hasChanges ? ' has-changes' : ''}`} role="status">{hasChanges ? <><span className="settings-unsaved-dot" />Unsaved changes</> : 'No unsaved changes'}</span>
        {hasChanges && <button className="button ghost" type="button" onClick={() => { setDraft(baseline); setMcpText(JSON.stringify(baseline.mcpServers, null, 2)); setAllowedText(baseline.allowedTools.join('\n')); setDeniedText(baseline.disallowedTools.join('\n')); setDirectoriesText(baseline.additionalDirectories.join('\n')); setMemory(current => current ? { ...current, content: current.saved } : current); }}><RotateCcw size={14} />Revert</button>}
        <button className="button ghost" type="button" onClick={() => requestLeave(onClose)}>Close</button>
        <button className="button primary" type="submit" disabled={busy || !hasChanges || !!validationError}>{busy && <Loader2 size={15} className="spin" />}Save changes</button>
      </div>
    </form>
  </Modal>;
}
