import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CornerDownLeft, Search, type LucideIcon } from 'lucide-react';
import Modal from './Modal';
import Logo from './Logo';

export interface CommandAction { id: string; label: string; description?: string; Icon: LucideIcon; shortcut?: string; onSelect: () => void; }
interface Props { open: boolean; onClose: () => void; actions: CommandAction[]; }

export default function CommandPalette({ open, onClose, actions }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const search = query.toLowerCase().trim();
    if (!search) return actions;
    return actions.map((action, index) => {
      const label = action.label.toLowerCase();
      const score = label.startsWith(search) ? 0 : label.includes(search) ? 1 : action.description?.toLowerCase().includes(search) ? 2 : 3;
      return { action, index, score };
    }).filter((item) => item.score < 3).sort((left, right) => left.score - right.score || left.index - right.index).map((item) => item.action);
  }, [actions, query]);
  useEffect(() => { if (open) { setQuery(''); setSelected(0); } }, [open]);
  useEffect(() => { setSelected(0); }, [query]);
  useEffect(() => { list.current?.children[selected]?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const invoke = (action: CommandAction) => { onClose(); action.onSelect(); };
  return <Modal open={open} onClose={onClose} title="Go anywhere" titleId="command-palette-title" className="command-dialog">
    <div className="command-search"><Search size={19} /><input data-autofocus value={query} placeholder="Search actions…" aria-label="Search actions" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-results" aria-activedescendant={filtered[selected] ? `command-${filtered[selected].id}` : undefined} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => (value + 1) % Math.max(1, filtered.length)); } else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => (value - 1 + filtered.length) % Math.max(1, filtered.length)); } else if (event.key === 'Enter' && filtered[selected]) { event.preventDefault(); invoke(filtered[selected]); } }} /><kbd>esc</kbd></div>
    <div className="command-section-label">{query ? 'Matching actions' : 'Workspace actions'}</div>
    <div className="command-results" id="command-results" role="listbox" aria-label="Actions" ref={list}>
      {filtered.map((action, index) => <button id={`command-${action.id}`} key={action.id} className={`command-action ${selected === index ? 'selected' : ''}`} role="option" aria-selected={selected === index} data-tooltip={action.label} onClick={() => invoke(action)} onMouseMove={() => setSelected(index)} tabIndex={-1}><span className="command-icon"><action.Icon size={18} /></span><span className="command-action-text"><strong className="text-ellipsis" data-tooltip={action.label}>{action.label}</strong>{action.description && <span>{action.description}</span>}</span>{action.shortcut && <kbd>{action.shortcut}</kbd>}{selected === index && <CornerDownLeft className="command-enter" size={14} />}</button>)}
      {!filtered.length && <div className="command-empty"><Search size={22} /><p>No matching actions</p><span>Try “terminal”, “workspace”, or “settings”.</span></div>}
    </div>
    <div className="command-footer"><span><ArrowUp size={12} /><ArrowDown size={12} />to navigate</span><span><CornerDownLeft size={12} />to select</span><span><Logo size={14} />Arc Workspace</span></div>
  </Modal>;
}
