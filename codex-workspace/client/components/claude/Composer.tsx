import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react';
import { CLAUDE_PERMISSION_MODES, type ClaudeAttachment, type ClaudeCommand, type ClaudeEffort, type ClaudeGoal, type ClaudeModelOption, type ClaudePermissionMode,
  type ClaudeQueuedMessage, type ClaudeTodo } from '../../../shared/claude';
import { api, json } from '../../api';
import { modelEfforts } from './catalog';
import { ArrowUp, BrainOff, BrainOn, Check, Chevron, Close, Edit, FileGlyph, ModeIcon, Plus, Queue, Steer, StopSquare } from './composer/icons';
import { ModelPicker } from './composer/ModelPicker';
import { StatusTray, type TrayState } from './composer/StatusTray';
import { useCustomScroll } from './composer/useCustomScroll';
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
import './composer/composer.css';

export interface ComposerSettings { model: string; effort: ClaudeEffort | null; thinking: boolean; permissionMode: ClaudePermissionMode }
export type QueueAction = 'edit' | 'steer' | 'remove';
interface Props {
  workspaceId: string; draft: string; onDraft: (value: string) => void; attachments: ClaudeAttachment[]; onAttachments: (value: ClaudeAttachment[]) => void;
  settings: ComposerSettings; onSettings: (patch: Partial<ComposerSettings>) => void; models: ClaudeModelOption[]; modelsLoading: boolean;
  commands: ClaudeCommand[]; running: boolean; stopping: boolean; sending: boolean; disabled: boolean;
  status: { label: string; startedAt?: string }; goal?: ClaudeGoal | null; todos?: ClaudeTodo[] | null; queue: ClaudeQueuedMessage[];
  onSend: () => void; onQueue: () => void; onSteer: () => void; onStop: () => void;
  onQueueAction: (item: ClaudeQueuedMessage, action: QueueAction) => void; onClearGoal: () => void; onResumeGoal: () => void;
  onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void; focusKey?: string;
}
type Menu = { kind: 'command'; query: string } | { kind: 'file'; query: string; start: number } | null;
type Pop = 'mode' | 'model' | null;
const LOCAL_COMMANDS: ClaudeCommand[] = [
  { name: 'clear', description: 'Start a new conversation', builtin: true },
  { name: 'compact', description: 'Summarize the conversation to free up context', argumentHint: '[instructions]', builtin: true },
];
const coarse = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const extension = (name: string, media: string) => { const dot = name.lastIndexOf('.'); return (dot > 0 ? name.slice(dot + 1) : media.split('/')[1] || 'file').toUpperCase().slice(0, 5); };

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
}
function highlight(text: string, query: string) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  return at < 0 ? text : <>{text.slice(0, at)}<mark>{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>;
}

export function Composer(props: Props) {
  const { workspaceId, draft, onDraft, attachments, onAttachments, settings, onSettings, models, modelsLoading, commands, running, stopping, sending, disabled,
    status, goal, todos, queue, onSend, onQueue, onSteer, onStop, onQueueAction, onClearGoal, onResumeGoal, onNotify, focusKey } = props;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const bubbles = useRef<HTMLDivElement>(null);
  const menuList = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(0);
  const [pop, setPop] = useState<Pop>(null);
  const [bumped, setBumped] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<ClaudeAttachment | null>(null);
  const [collapseKey, setCollapseKey] = useState(0);
  // The tray follows the run: working while Claude runs, then a still word until dismissed.
  const [tray, setTray] = useState<{ state: TrayState; endedAt?: number; dismissed: boolean }>({ state: 'done', dismissed: true });
  const stopAsked = useRef(false);
  const wasRunning = useRef(running);

  useCustomScroll(textarea, { right: 5, inset: 2 });
  useCustomScroll(bubbles, { right: -14 });
  useCustomScroll(menuList, { right: 2, inset: 4 }, [menu?.kind]);

  useEffect(() => { textarea.current?.focus({ preventScroll: true }); }, [focusKey]);
  useLayoutEffect(() => {
    const element = textarea.current; if (!element) return;
    element.style.height = 'auto';
    const max = parseFloat(getComputedStyle(element).maxHeight) || 216;
    element.style.height = `${Math.min(element.scrollHeight, max)}px`;
    element.classList.toggle('scroll', element.scrollHeight > max + 1);
  }, [draft]);
  useEffect(() => {
    if (running && !wasRunning.current) { stopAsked.current = false; setTray({ state: 'working', dismissed: false }); }
    if (!running && wasRunning.current) setTray(value => ({ ...value, state: stopAsked.current ? 'stopped' : 'done', endedAt: Date.now() }));
    wasRunning.current = running;
  }, [running]);
  // A finished run folds away on its own unless a goal or the queue keeps it relevant.
  useEffect(() => {
    if (running || tray.dismissed || tray.state !== 'done' || goal || queue.length) return;
    const timer = window.setTimeout(() => setTray(value => ({ ...value, dismissed: true })), 6000);
    return () => window.clearTimeout(timer);
  }, [running, tray.dismissed, tray.state, goal, queue.length]);
  useEffect(() => {
    if (!pop) return;
    const close = (event: PointerEvent) => { if (!(event.target as Element).closest('.qc-anchor')) setPop(null); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setPop(null); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [pop]);
  useEffect(() => {
    if (!lightbox) return;
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setLightbox(null); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [lightbox]);

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
  useEffect(() => { menuList.current?.querySelector('.qc-item.hl')?.scrollIntoView({ block: 'nearest' }); }, [menuIndex]);
  // Keep the menu inside the room above the composer.
  useLayoutEffect(() => {
    if (!menu || !menuList.current || !composer.current) return;
    menuList.current.style.maxHeight = `${Math.max(110, Math.min(300, composer.current.getBoundingClientRect().top - 52))}px`;
  }, [menu]);

  function detectMenu(value: string, caret: number) {
    if (/^\/[\w:.-]*$/.test(value.slice(0, caret)) && !value.slice(0, caret).includes(' ')) { setMenu({ kind: 'command', query: value.slice(1, caret) }); setMenuIndex(0); setPop(null); return; }
    const match = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    if (match) { setMenu({ kind: 'file', query: match[2], start: caret - match[2].length - 1 }); setMenuIndex(0); setPop(null); return; }
    setMenu(null);
  }
  function choose(index: number) {
    if (menu?.kind === 'command') {
      const command = commandMatches[index]; if (!command) return;
      onDraft(`/${command.name} `); setMenu(null);
    } else if (menu?.kind === 'file') {
      const file = fileMatches[index]; if (!file) return;
      const caret = textarea.current?.selectionStart ?? draft.length;
      onDraft(`${draft.slice(0, menu.start)}@${file} ${draft.slice(caret)}`); setMenu(null);
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
    if (added.length) {
      onAttachments([...attachments, ...added]);
      requestAnimationFrame(() => strip.current?.scrollTo({ left: strip.current.scrollWidth, behavior: 'smooth' }));
    }
  }
  function removeAttachment(attachment: ClaudeAttachment) {
    setRemoving(value => new Set(value).add(attachment.id));
    window.setTimeout(() => { onAttachments(attachments.filter(item => item.id !== attachment.id)); setRemoving(value => { const next = new Set(value); next.delete(attachment.id); return next; }); }, 180);
  }

  const hasText = !!draft.trim() || attachments.length > 0;
  const canSend = !disabled && !sending && uploading === 0 && hasText;
  const stopMode = running && !hasText;
  function primary() {
    setCollapseKey(value => value + 1); setMenu(null);
    if (stopMode) { stopAsked.current = true; onStop(); return; }
    if (!canSend) return;
    if (running) onQueue(); else onSend();
  }
  function steer() { if (!canSend) return; setCollapseKey(value => value + 1); setMenu(null); if (running) onSteer(); else onSend(); }
  function bump(name: string) { setBumped(null); requestAnimationFrame(() => setBumped(name)); }
  function setMode(mode: ClaudePermissionMode) { onSettings({ permissionMode: mode }); bump('mode'); setPop(null); }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (menu && menuItems) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setMenuIndex(index => (index + 1) % menuItems); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setMenuIndex(index => (index - 1 + menuItems) % menuItems); return; }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) { event.preventDefault(); choose(menuIndex); return; }
    }
    if (event.key === 'Escape' && menu) { event.preventDefault(); setMenu(null); return; }
    if (event.key === 'Escape' && running) { event.preventDefault(); stopAsked.current = true; onStop(); return; }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && running) { event.preventDefault(); steer(); return; }
    if (event.key === 'Enter' && !event.shiftKey && (event.metaKey || event.ctrlKey || !coarse())) { event.preventDefault(); primary(); return; }
    if (event.key === 'Tab' && event.shiftKey && !menu) {
      event.preventDefault();
      const order: ClaudePermissionMode[] = ['default', 'acceptEdits', 'plan'];
      setMode(order[(order.indexOf(settings.permissionMode) + 1) % order.length] ?? 'default');
    }
  }
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const images = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
    if (images.length) { event.preventDefault(); void upload(images); }
  }
  function drop(event: DragEvent) {
    event.preventDefault(); setDragging(0);
    if (event.dataTransfer.files.length) void upload(event.dataTransfer.files);
  }

  const efforts = modelEfforts(models, settings.model);
  const mode = CLAUDE_PERMISSION_MODES.find(item => item.value === settings.permissionMode)!;
  // A goal keeps its tray; otherwise a finished run can be dismissed.
  const trayShown = running || !tray.dismissed || !!goal;
  const trayLabel = running ? status.label : tray.state === 'stopped' ? (goal ? 'Paused' : 'Stopped') : 'Completed';
  const modelOptions = models.length ? models : [{ id: settings.model, label: modelsLoading ? 'Loading…' : settings.model }];

  return <div className="qc">
    {(attachments.length > 0 || uploading > 0) && <div className="qc-attachments" ref={strip}
      onWheel={event => { const box = event.currentTarget; if (box.scrollWidth <= box.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return; box.scrollLeft += event.deltaY; }}>
      {attachments.map(attachment => {
        const image = attachment.kind === 'image';
        return <div key={attachment.id} className={`qc-file${image ? ' img' : ''}${removing.has(attachment.id) ? ' out' : ''}`} title={attachment.name}
          onClick={event => { if (image && !(event.target as Element).closest('.qc-x')) setLightbox(attachment); }}>
          {image && <img alt="" decoding="async" src={`/api/claude/attachments/${attachment.id}`} onLoad={event => event.currentTarget.classList.add('ld')} />}
          <span className="qc-type">{extension(attachment.name, attachment.mediaType)}</span>
          {!image && <FileGlyph />}
          <div className="qc-meta-b"><div className="qc-name">{attachment.name}</div><div className="qc-size">{size(attachment.size)}</div></div>
          <button type="button" className="qc-x" aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(attachment)}><Close size={10} /></button>
        </div>;
      })}
      {Array.from({ length: uploading }, (_, index) => <div key={`up-${index}`} className="qc-file is-uploading"><span className="qc-type">…</span><div className="qc-meta-b"><div className="qc-name qc-shimmer">Uploading</div></div></div>)}
    </div>}

    {queue.length > 0 && <div className="qc-bubbles" ref={bubbles} aria-live="polite">{queue.map(item => <div key={item.id} className="qc-bubble new" data-kind="queue">
      <span className="qc-b-acts">
        <button type="button" aria-label="Edit" onClick={() => onQueueAction(item, 'edit')}><Edit /></button>
        <button type="button" aria-label={running ? 'Send as steering' : 'Run now'} onClick={() => onQueueAction(item, 'steer')}><Steer size={13} /></button>
        <button type="button" aria-label="Remove" data-a="x" onClick={() => onQueueAction(item, 'remove')}><Close /></button>
      </span>
      <div className="qc-b-pill"><span className="qc-b-ic"><Queue /></span><span className="qc-b-text" title={item.text}>{item.text || `${item.attachments?.length ?? 0} attachments`}</span></div>
    </div>)}</div>}

    <StatusTray show={trayShown} state={running ? 'working' : tray.state} label={trayLabel} startedAt={status.startedAt} endedAt={tray.endedAt}
      goal={goal} todos={todos} collapseKey={collapseKey}
      onPause={() => { stopAsked.current = true; onStop(); }} onResume={onResumeGoal} onClearGoal={onClearGoal}
      onDismiss={() => { if (goal) setCollapseKey(value => value + 1); else setTray(value => ({ ...value, dismissed: true })); }} />

    <div ref={composer} className={`qc-composer${hasText ? ' has-text' : ''}${dragging ? ' dragging' : ''}${running ? ' running' : ''}`}
      onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(value => value + 1); } }}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDragLeave={() => setDragging(value => Math.max(0, value - 1))} onDrop={drop}>
      <div className={`qc-pop qc-suggest${menu && menuItems ? ' open' : ''}`} role="listbox" aria-label={menu?.kind === 'file' ? 'Files' : 'Commands'}>
        <div className="qc-pop-h"><span>{menu?.kind === 'file' ? 'Files' : 'Commands'}</span></div>
        <div className="qc-sug-wrap"><div className="qc-sug-list" ref={menuList}>
          {menu?.kind === 'command' && commandMatches.map((command, index) => <button type="button" role="option" aria-selected={index === menuIndex} key={command.name}
            className={`qc-item${index === menuIndex ? ' hl' : ''}`} onMouseEnter={() => setMenuIndex(index)} onMouseDown={event => { event.preventDefault(); choose(index); }}>
            <span className="qc-body qc-row"><span className="qc-cmd">/{highlight(command.name, menu.query)}</span><span className="qc-d">{command.description}</span></span></button>)}
          {menu?.kind === 'file' && fileMatches.map((file, index) => <button type="button" role="option" aria-selected={index === menuIndex} key={file}
            className={`qc-item${index === menuIndex ? ' hl' : ''}`} onMouseEnter={() => setMenuIndex(index)} onMouseDown={event => { event.preventDefault(); choose(index); }}>
            <span className="qc-body qc-row"><span className="qc-cmd">{highlight(file, menu.query)}</span></span></button>)}
        </div></div>
      </div>
      <div className="qc-drop">Drop files to attach</div>
      <div className="qc-field">
        <textarea ref={textarea} rows={1} value={draft} maxLength={200_000} disabled={disabled} aria-label="Prompt" spellCheck={false}
          onChange={event => { onDraft(event.target.value); detectMenu(event.target.value, event.target.selectionStart); }}
          onClick={event => detectMenu(event.currentTarget.value, event.currentTarget.selectionStart)}
          onBlur={() => setTimeout(() => { if (document.activeElement !== textarea.current) setMenu(null); }, 150)}
          onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) detectMenu(event.currentTarget.value, event.currentTarget.selectionStart); }}
          onKeyDown={keyDown} onPaste={paste} />
        <div className="qc-ph"><span key={running ? 'run' : 'idle'}>{running ? 'Steer or queue a follow-up…' : "What's on your mind?"}</span></div>
      </div>
      <div className="qc-toolbar">
        <div className="qc-tl">
          <button type="button" className="qc-ibtn" aria-label="Attach files" data-tip="Attach files" disabled={disabled} onClick={() => fileInput.current?.click()}><Plus /></button>
          <input ref={fileInput} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.json,.yaml,.yml,.csv,.ts,.tsx,.js,.py"
            onChange={event => { if (event.target.files) void upload(event.target.files); event.target.value = ''; }} />
          <button type="button" className={`qc-ibtn qc-think${bumped === 'think' ? ' bump' : ''}`} aria-pressed={settings.thinking} aria-label="Extended thinking"
            data-tip={settings.thinking ? 'Extended thinking' : 'Thinking off'} onClick={() => { onSettings({ thinking: !settings.thinking }); bump('think'); }}><BrainOn /><BrainOff /></button>
          <div className="qc-anchor qc-mode-anchor">
            <button type="button" className={`qc-pill qc-mode-pill${pop === 'mode' ? ' active' : ''}${bumped === 'mode' ? ' bump' : ''}`} aria-haspopup="true" aria-expanded={pop === 'mode'}
              aria-label={`Permissions: ${mode.label}`} onClick={() => { setMenu(null); setPop(pop === 'mode' ? null : 'mode'); }}>
              <span className="qc-micon-wrap" key={mode.value}><ModeIcon mode={mode.value} /></span>
              <span className="qc-mode-label" key={`l-${mode.value}`}>{mode.label}</span><Chevron />
            </button>
            <div className={`qc-pop${pop === 'mode' ? ' open' : ''}`} role="menu">{CLAUDE_PERMISSION_MODES.map((item, index) => <button type="button" role="menuitemradio"
              aria-checked={item.value === mode.value} key={item.value} className={`qc-item${item.value === mode.value ? ' sel' : ''}`} style={{ '--i': index } as CSSProperties}
              onClick={() => setMode(item.value)}>
              <span className="qc-mi"><ModeIcon mode={item.value} /></span><span className="qc-body"><span className="qc-t">{item.label}</span><span className="qc-d">{item.description}</span></span><Check /></button>)}</div>
          </div>
        </div>
        <div className="qc-tr">
          <ModelPicker models={modelOptions} model={settings.model} efforts={efforts} effort={settings.effort} open={pop === 'model'}
            onOpen={open => { setMenu(null); setPop(open ? 'model' : null); }} onModel={model => onSettings({ model })} onEffort={effort => onSettings({ effort })} />
          <button type="button" className={`qc-send${stopMode ? ' stop' : ''}`} disabled={stopMode ? stopping : !canSend}
            aria-label={stopMode ? 'Stop' : running ? 'Queue message' : 'Send'} onClick={primary}><ArrowUp /><StopSquare /></button>
        </div>
      </div>
    </div>
    {lightbox && <div className="qc-lightbox open" onClick={() => setLightbox(null)} role="dialog" aria-label={lightbox.name}>
      <figure><img alt={lightbox.name} src={`/api/claude/attachments/${lightbox.id}`} /><figcaption>{lightbox.name}</figcaption></figure></div>}
  </div>;
}
