import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Brain, FileText, ListPlus, LoaderCircle, Paperclip, Square, X, AtSign, Slash, Gauge } from 'lucide-react';
import { CLAUDE_PERMISSION_MODES, type ClaudeAttachment, type ClaudeCommand, type ClaudeEffort, type ClaudeModelOption, type ClaudePermissionMode, type ClaudeUsage } from '../../../shared/claude';
import { api, json } from '../../api';
import { SelectMenu } from '../ui/Dropdown';
import { EFFORT_DESCRIPTIONS, EFFORT_LABELS, modelEfforts } from './catalog';
import { compactTokens, money } from './Timeline';
import { ContextRing } from './Working';

export interface ComposerSettings { model: string; effort: ClaudeEffort | null; thinking: boolean; permissionMode: ClaudePermissionMode }
interface Props {
  workspaceId: string; draft: string; onDraft: (value: string) => void; attachments: ClaudeAttachment[]; onAttachments: (value: ClaudeAttachment[]) => void;
  settings: ComposerSettings; onSettings: (patch: Partial<ComposerSettings>) => void; models: ClaudeModelOption[]; modelsLoading: boolean;
  commands: ClaudeCommand[]; running: boolean; stopping: boolean; sending: boolean; disabled: boolean; usage?: ClaudeUsage;
  onSend: () => void; onStop: () => void; onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void; focusKey?: string;
}
type Menu = { kind: 'command'; query: string } | { kind: 'file'; query: string; start: number } | null;
const DEFAULT = '$auto';
const LOCAL_COMMANDS: ClaudeCommand[] = [
  { name: 'clear', description: 'Start a new conversation', builtin: true },
  { name: 'compact', description: 'Summarize the conversation to free up context', argumentHint: '[instructions]', builtin: true },
];
const modeColors: Record<ClaudePermissionMode, string> = { default: '', acceptEdits: 'is-accept', plan: 'is-plan', auto: 'is-auto', dontAsk: 'is-dontask', bypassPermissions: 'is-bypass' };
const coarse = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
}

export function Composer(props: Props) {
  const { workspaceId, draft, onDraft, attachments, onAttachments, settings, onSettings, models, modelsLoading, commands, running, stopping, sending, disabled, usage, onSend, onStop, onNotify, focusKey } = props;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => { textarea.current?.focus({ preventScroll: true }); }, [focusKey]);
  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }, [draft]);

  const allCommands = useMemo(() => {
    const seen = new Set<string>();
    return [...LOCAL_COMMANDS, ...commands].filter(command => !seen.has(command.name) && seen.add(command.name));
  }, [commands]);
  const commandMatches = menu?.kind === 'command' ? allCommands.filter(command => command.name.toLowerCase().includes(menu.query.toLowerCase()))
    .sort((a, b) => Number(!a.name.startsWith(menu.query)) - Number(!b.name.startsWith(menu.query))).slice(0, 40) : [];
  const fileMatches = menu?.kind === 'file' ? files.slice(0, 30) : [];
  const menuItems = menu?.kind === 'command' ? commandMatches.length : fileMatches.length;

  useEffect(() => {
    if (menu?.kind !== 'file') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<string[]>(`/workspaces/${encodeURIComponent(workspaceId)}/file-paths?q=${encodeURIComponent(menu.query)}`, { signal: controller.signal })
        .then(value => setFiles(value.slice(0, 30))).catch(() => undefined);
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [menu?.kind, menu?.kind === 'file' ? menu.query : '', workspaceId]);

  function detectMenu(value: string, caret: number) {
    if (/^\/[\w:.-]*$/.test(value.slice(0, caret)) && !value.slice(0, caret).includes(' ')) { setMenu({ kind: 'command', query: value.slice(1, caret) }); setMenuIndex(0); return; }
    const before = value.slice(0, caret);
    const match = /(^|\s)@([^\s@]*)$/.exec(before);
    if (match) { setMenu({ kind: 'file', query: match[2], start: caret - match[2].length - 1 }); setMenuIndex(0); return; }
    setMenu(null);
  }
  function choose(index: number) {
    if (menu?.kind === 'command') {
      const command = commandMatches[index]; if (!command) return;
      onDraft(`/${command.name} `); setMenu(null);
    } else if (menu?.kind === 'file') {
      const file = fileMatches[index]; if (!file) return;
      const caret = textarea.current?.selectionStart ?? draft.length;
      const next = `${draft.slice(0, menu.start)}@${file} ${draft.slice(caret)}`;
      onDraft(next); setMenu(null);
      requestAnimationFrame(() => { const position = menu.start + file.length + 2; textarea.current?.setSelectionRange(position, position); });
    }
    textarea.current?.focus();
  }

  async function upload(list: FileList | File[]) {
    const chosen = [...list].slice(0, Math.max(0, 10 - attachments.length));
    if (!chosen.length) { onNotify('Attach at most 10 files per message.', 'error'); return; }
    setUploading(value => value + chosen.length);
    const added: ClaudeAttachment[] = [];
    for (const file of chosen) {
      try {
        if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} is larger than 12 MB.`);
        const data = await readFile(file);
        added.push(await api<ClaudeAttachment>('/claude/attachments', { ...json('POST', { name: file.name || 'pasted-image.png', mediaType: file.type || 'application/octet-stream', data }), timeoutMs: 120_000 }));
      } catch (failure) { onNotify(failure instanceof Error ? failure.message : `${file.name} could not be attached.`, 'error'); }
      finally { setUploading(value => value - 1); }
    }
    if (added.length) onAttachments([...attachments, ...added]);
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (menu && menuItems) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setMenuIndex(index => (index + 1) % menuItems); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setMenuIndex(index => (index - 1 + menuItems) % menuItems); return; }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) { event.preventDefault(); choose(menuIndex); return; }
    }
    if (menu && event.key === 'Escape') { event.preventDefault(); setMenu(null); return; }
    if (event.key === 'Escape' && running) { event.preventDefault(); onStop(); return; }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || (!event.shiftKey && !coarse()))) { event.preventDefault(); if (canSend) onSend(); }
    if (event.key === 'Tab' && event.shiftKey && !menu) {
      event.preventDefault();
      const order: ClaudePermissionMode[] = ['default', 'acceptEdits', 'plan'];
      onSettings({ permissionMode: order[(order.indexOf(settings.permissionMode) + 1) % order.length] ?? 'default' });
    }
  }
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const images = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
    if (images.length) { event.preventDefault(); void upload(images); }
  }
  function drop(event: DragEvent) {
    event.preventDefault(); setDragging(false);
    if (event.dataTransfer.files.length) void upload(event.dataTransfer.files);
  }

  const canSend = !disabled && !sending && uploading === 0 && (!!draft.trim() || attachments.length > 0);
  const efforts = modelEfforts(models, settings.model);
  const contextPercent = usage?.contextWindow && usage.contextTokens ? Math.min(100, Math.round(usage.contextTokens / usage.contextWindow * 100)) : null;
  const mode = CLAUDE_PERMISSION_MODES.find(item => item.value === settings.permissionMode)!;

  return <div className="claude-composer-wrap">
      {menu && menuItems > 0 && <div className="claude-menu" role="listbox" aria-label={menu.kind === 'command' ? 'Slash commands' : 'Files'}>
        <div className="claude-menu-heading">{menu.kind === 'command' ? <><Slash size={12} />Commands & skills</> : <><AtSign size={12} />Mention a file</>}</div>
        {menu.kind === 'command' ? commandMatches.map((command, index) => <button type="button" role="option" aria-selected={index === menuIndex} key={command.name} className={index === menuIndex ? 'is-active' : ''}
          onMouseEnter={() => setMenuIndex(index)} onMouseDown={event => { event.preventDefault(); choose(index); }}>
          <strong>/{command.name}</strong>{command.argumentHint && <em>{command.argumentHint}</em>}<small>{command.description}</small></button>)
          : fileMatches.map((file, index) => <button type="button" role="option" aria-selected={index === menuIndex} key={file} className={index === menuIndex ? 'is-active' : ''}
            onMouseEnter={() => setMenuIndex(index)} onMouseDown={event => { event.preventDefault(); choose(index); }}><FileText size={13} /><strong>{file.split('/').pop()}</strong><small>{file}</small></button>)}
      </div>}
    <form className={`chat-composer claude-composer${running ? ' is-working' : ''}${dragging ? ' is-dragging-files' : ''} ${modeColors[settings.permissionMode]}`}
      onSubmit={event => { event.preventDefault(); if (canSend) onSend(); }}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }} onDragLeave={() => setDragging(false)} onDrop={drop}>
      {dragging && <div className="claude-drop-hint">Drop images, PDFs, or text files to attach</div>}
      {(attachments.length > 0 || uploading > 0) && <div className="claude-attachments">{attachments.map(attachment => <span key={attachment.id} className="claude-attachment">
        {attachment.kind === 'image' ? <img src={`/api/claude/attachments/${attachment.id}`} alt="" /> : <FileText size={14} />}
        <span className="text-ellipsis">{attachment.name}</span>
        <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => onAttachments(attachments.filter(item => item.id !== attachment.id))}><X size={12} /></button></span>)}
        {uploading > 0 && <span className="claude-attachment is-uploading"><LoaderCircle size={14} className="chat-spin" />Uploading…</span>}</div>}
      <label className="chat-sr-only" htmlFor={`claude-prompt-${workspaceId}`}>Message Claude</label>
      <textarea ref={textarea} id={`claude-prompt-${workspaceId}`} rows={2} value={draft} maxLength={200_000} disabled={disabled}
        placeholder={running ? 'Queue a follow-up for Claude…' : settings.permissionMode === 'plan' ? 'Describe what to plan…' : 'Ask Claude to build, fix, or explain… (/ for commands, @ for files)'}
        onChange={event => { onDraft(event.target.value); detectMenu(event.target.value, event.target.selectionStart); }}
        onClick={event => detectMenu(event.currentTarget.value, event.currentTarget.selectionStart)} onBlur={() => setTimeout(() => { if (document.activeElement !== textarea.current) setMenu(null); }, 150)}
        onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) detectMenu(event.currentTarget.value, event.currentTarget.selectionStart); }}
        onKeyDown={keyDown} onPaste={paste} spellCheck={false} />
      <div className="chat-composer-controls">
        <button type="button" className="chat-meta-button claude-attach" aria-label="Attach files" title="Attach images, PDFs, or text files" disabled={disabled} onClick={() => fileInput.current?.click()}><Paperclip size={15} /></button>
        <input ref={fileInput} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.json,.yaml,.yml,.csv,.ts,.tsx,.js,.py" onChange={event => { if (event.target.files) void upload(event.target.files); event.target.value = ''; }} />
        <SelectMenu value={settings.permissionMode} onValueChange={value => onSettings({ permissionMode: value })} aria-label="Permission mode" className={`chat-permissions claude-mode-select ${modeColors[settings.permissionMode]}`} compact align="start"
          title="Permission mode (Shift+Tab cycles)" renderValue={() => <><span className={`claude-mode-dot is-${settings.permissionMode}`} />{mode.label}</>}
          options={CLAUDE_PERMISSION_MODES.map(item => ({ value: item.value, label: item.label, description: item.description, icon: <span className={`claude-mode-dot is-${item.value}`} /> }))} />
        <span className="chat-composer-spacer" />
        {contextPercent !== null && contextPercent >= 1 && <ContextRing percent={contextPercent} title={`${usage!.contextTokens.toLocaleString()} of ${usage!.contextWindow!.toLocaleString()} context tokens used${usage!.totalCostUsd ? ` · ${money(usage!.totalCostUsd)} spent` : ''}`} />}
        {running && <button type="button" className="chat-send chat-stop" aria-label="Stop Claude" title="Stop (Esc)" disabled={stopping} onClick={onStop}>{stopping ? <LoaderCircle size={15} className="chat-spin" /> : <Square size={13} />}</button>}
        <button type="submit" className={`chat-send claude-send${running ? ' claude-queue' : ''}${canSend ? ' is-ready' : ''}`} aria-label={running ? 'Queue message' : 'Send message'} title={running ? 'Queue for when Claude finishes' : 'Send (Enter)'} disabled={!canSend}>
          <span className="claude-icon-swap" key={sending ? 'sending' : running ? 'queue' : 'send'}>{sending ? <LoaderCircle size={16} className="chat-spin" /> : running ? <ListPlus size={16} /> : <ArrowUp size={18} />}</span></button>
      </div>
    </form>
    <div className="chat-composer-footer claude-composer-footer"><div className="chat-model-controls">
      <SelectMenu value={settings.model} onValueChange={model => onSettings({ model })} aria-label="Model" className="chat-model-select" compact searchable={models.length > 8}
        renderValue={option => option?.label ?? settings.model}
        options={(models.length ? models : [{ id: settings.model, label: modelsLoading ? 'Loading models…' : settings.model }]).map(model => ({ value: model.id, label: model.label, description: model.description }))} />
      <SelectMenu value={settings.effort ?? DEFAULT} onValueChange={value => onSettings({ effort: value === DEFAULT ? null : value as ClaudeEffort })} aria-label="Reasoning effort" className="chat-effort-select" compact
        renderValue={() => <span className="claude-effort-label"><Gauge size={12} />{settings.effort ? EFFORT_LABELS[settings.effort] : 'Auto'}</span>} title="Reasoning effort"
        options={[{ value: DEFAULT, label: 'Auto', description: 'Claude Code chooses for this model' }, ...efforts.map(value => ({ value, label: EFFORT_LABELS[value], description: EFFORT_DESCRIPTIONS[value] }))]} />
      <button type="button" className={`chat-meta-button claude-thinking-toggle${settings.thinking ? ' is-on' : ''}`} aria-pressed={settings.thinking} title={settings.thinking ? 'Extended thinking on' : 'Extended thinking off'}
        onClick={() => onSettings({ thinking: !settings.thinking })}><Brain size={13} /><span>Thinking</span></button>
    </div>{usage && usage.totalCostUsd > 0 && <span className="claude-cost" title={`${compactTokens(usage.inputTokens)} in · ${compactTokens(usage.outputTokens)} out`}>{money(usage.totalCostUsd)}</span>}</div>
  </div>;
}
