import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Settings2 } from 'lucide-react';
import type { CodexSkill, CodexSkillList } from '../../../shared/types';
import { api } from '../../api';
import { SelectMenu } from '../ui/Dropdown';
import PageNavigation from '../ui/PageNavigation';
import { MAX_SELECTED_SKILLS, readSkillList, skillScopeLabel, SKILL_PICKER_PAGE_SIZE } from './skill-picker';
import './skill-picker.css';

export interface SkillPickerProps {
  workspaceId: string; draftKey: string; selectedIds: readonly string[]; locked: boolean; disabled?: boolean;
  onSelect: (skill: CodexSkill) => void; onManage: () => void;
}
export function SkillPicker(props: SkillPickerProps) { return <ScopedSkillPicker key={JSON.stringify([props.workspaceId, props.draftKey, props.locked])} {...props} />; }
function ScopedSkillPicker({ workspaceId, selectedIds, locked, disabled = false, onSelect, onManage }: SkillPickerProps) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [list, setList] = useState<CodexSkillList | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [sessionLocked, setSessionLocked] = useState(locked || document.body.dataset.workspaceLocked === 'true');
  const request = useRef<AbortController | null>(null), alive = useRef(false), blocked = useRef(sessionLocked); blocked.current = sessionLocked;
  useEffect(() => {
    alive.current = true;
    const lock = () => { blocked.current = true; request.current?.abort(); request.current = null; setSessionLocked(true); setOpen(false); setList(null); setError(''); setLoading(false); };
    const unlock = () => { blocked.current = locked || document.body.dataset.workspaceLocked === 'true'; setSessionLocked(blocked.current); };
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('codex:session-locked', lock); window.addEventListener('codex:session-expired', lock); window.addEventListener('codex:session-unlocked', unlock);
    window.addEventListener('codex:skills-changed', refresh); window.addEventListener('codex:runtime-changed', refresh);
    return () => {
      alive.current = false; request.current?.abort();
      window.removeEventListener('codex:session-locked', lock); window.removeEventListener('codex:session-expired', lock); window.removeEventListener('codex:session-unlocked', unlock);
      window.removeEventListener('codex:skills-changed', refresh); window.removeEventListener('codex:runtime-changed', refresh);
    };
  }, [locked]);
  useEffect(() => {
    if (!open || sessionLocked || disabled) return;
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    const current = () => alive.current && !blocked.current && !controller.signal.aborted && request.current === controller;
    setLoading(true); setError('');
    void api<unknown>(`/workspaces/${encodeURIComponent(workspaceId)}/codex/skills`, { signal: controller.signal }).then(value => { if (current()) setList(readSkillList(value)); })
      .catch(failure => { if (current()) setError(failure instanceof Error ? failure.message : 'Skills could not be loaded.'); })
      .finally(() => { if (current()) { request.current = null; setLoading(false); } });
    return () => controller.abort();
  }, [workspaceId, open, sessionLocked, disabled, revision]);
  const skills = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return (list?.skills ?? []).filter(skill => skill.enabled && (!search || `${skill.name}\n${skill.description}\n${skill.path}`.toLocaleLowerCase().includes(search)));
  }, [list, query]);
  const start = Math.min(offset, Math.max(0, Math.ceil(skills.length / SKILL_PICKER_PAGE_SIZE) - 1) * SKILL_PICKER_PAGE_SIZE);
  const page = skills.slice(start, start + SKILL_PICKER_PAGE_SIZE), waiting = loading || open && !list && !error;
  return <SelectMenu value="" aria-label="Add a skill" data-tooltip="Add a skill" className="chat-skill-select" menuClassName="chat-skill-picker-menu" compact searchable searchPlaceholder="Find a skill…"
    disabled={disabled || locked || sessionLocked} renderValue={() => <BookOpen size={14} />} onOpenChange={value => {
      if (!value) request.current?.abort();
      else { setQuery(''); setOffset(0); setList(null); setError(''); }
      setOpen(value);
    }} onValueChange={path => {
      if (disabled || waiting || blocked.current || document.body.dataset.workspaceLocked === 'true') return;
      if (path === '$manage') { onManage(); return; }
      const skill = page.find(item => item.path === path);
      if (skill && !selectedIds.includes(path) && selectedIds.length < MAX_SELECTED_SKILLS) onSelect(skill);
    }} options={[
      ...page.map(skill => ({ value: skill.path, label: skill.name, description: skill.description, group: skillScopeLabel(skill.scope), keywords: skill.path,
        disabled: waiting || selectedIds.includes(skill.path) || selectedIds.length >= MAX_SELECTED_SKILLS })),
      ...(!page.length ? [{ value: '$empty', label: waiting ? 'Loading skills…' : error ? 'Skills could not be loaded' : query ? 'No matching skills' : 'No enabled skills', disabled: true }] : []),
      { value: '$manage', label: 'Skills settings', description: 'View skills and change which are enabled.', icon: <Settings2 size={14} />, disabled: waiting },
    ]} remoteSearch={{ query, onQueryChange: value => { setQuery(value.slice(0, 160)); setOffset(0); }, loading: waiting, error: error || undefined, onRetry: () => setRevision(value => value + 1),
      onPreviousPage: () => setOffset(Math.max(0, start - SKILL_PICKER_PAGE_SIZE)), onNextPage: () => setOffset(start + SKILL_PICKER_PAGE_SIZE),
      footer: <div className="chat-skill-picker-footer"><PageNavigation label="Skills" offset={start} count={page.length} total={skills.length} hasPrevious={start > 0} hasNext={start + page.length < skills.length}
        loading={waiting} disabled={disabled || sessionLocked} onPrevious={() => setOffset(Math.max(0, start - SKILL_PICKER_PAGE_SIZE))} onNext={() => setOffset(start + SKILL_PICKER_PAGE_SIZE)} />
        {!!list?.errors.length && <p>Some skills could not be read. Open Skills settings for details.</p>}
        {selectedIds.length >= MAX_SELECTED_SKILLS && <p role="status">Twelve skills are selected. Remove one to choose another.</p>}
      </div> }} />;
}
