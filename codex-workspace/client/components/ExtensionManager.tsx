import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, BookOpen, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import type { CodexSkill, CodexSkillList } from '../../shared/types';
import { api, json } from '../api';
import { SelectMenu } from './ui/Dropdown';
import PageNavigation from './ui/PageNavigation';
import { readSkillList, skillScopeLabel, SKILL_PICKER_PAGE_SIZE } from './chat/skill-picker';
import './extensions.css';

export interface ExtensionManagerProps { workspaceId?: string; onNotify?: (message: string, kind?: 'error' | 'success' | 'info') => void }
export default function ExtensionManager(props: ExtensionManagerProps) { return <NativeSkills key={props.workspaceId || 'none'} {...props} />; }

function NativeSkills({ workspaceId, onNotify }: ExtensionManagerProps) {
  const [list, setList] = useState<CodexSkillList | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null), [notice, setNotice] = useState('');
  const [query, setQuery] = useState(''), [scope, setScope] = useState('$all'), [offset, setOffset] = useState(0), [errorOffset, setErrorOffset] = useState(0);
  const [revision, setRevision] = useState(0), [locked, setLocked] = useState(() => document.body.dataset.workspaceLocked === 'true');
  const request = useRef<AbortController | null>(null), alive = useRef(false), blocked = useRef(locked); blocked.current = locked;
  const path = workspaceId ? `/workspaces/${encodeURIComponent(workspaceId)}/codex/skills` : null;
  useEffect(() => {
    alive.current = true;
    const lock = () => { blocked.current = true; request.current?.abort(); request.current = null; setLocked(true); setList(null); setPending(null); setLoading(false); setError(''); setNotice(''); };
    const unlock = () => { blocked.current = false; setLocked(false); setRevision(value => value + 1); };
    window.addEventListener('codex:session-locked', lock); window.addEventListener('codex:session-expired', lock); window.addEventListener('codex:session-unlocked', unlock);
    return () => { alive.current = false; request.current?.abort(); window.removeEventListener('codex:session-locked', lock); window.removeEventListener('codex:session-expired', lock); window.removeEventListener('codex:session-unlocked', unlock); };
  }, []);
  useEffect(() => {
    if (!path || locked || document.body.dataset.workspaceLocked === 'true') return;
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    const current = () => alive.current && !blocked.current && !controller.signal.aborted && request.current === controller;
    setLoading(true); setError('');
    void api<unknown>(path, { signal: controller.signal }).then(value => { if (current()) setList(readSkillList(value)); })
      .catch(failure => { if (current()) setError(failure instanceof Error ? failure.message : 'Skills could not be loaded.'); })
      .finally(() => { if (current()) { request.current = null; setLoading(false); } });
    return () => controller.abort();
  }, [path, locked, revision]);

  async function toggle(skill: CodexSkill) {
    if (!path || locked || blocked.current || request.current || pending || document.body.dataset.workspaceLocked === 'true') return;
    const controller = new AbortController(); request.current = controller; setPending(skill.path); setError(''); setNotice('');
    const current = () => alive.current && !blocked.current && !controller.signal.aborted && request.current === controller;
    try {
      await api(path, { ...json('PATCH', { path: skill.path, enabled: !skill.enabled }), signal: controller.signal });
      if (!current()) return;
      const updated = readSkillList(await api<unknown>(path, { signal: controller.signal }));
      if (!current()) return;
      setList(updated);
      const saved = updated.skills.find(item => item.path === skill.path);
      const message = saved ? `${saved.name} is ${saved.enabled ? 'enabled' : 'disabled'}.` : 'The Codex skill list changed. Review the current skills.';
      setNotice(message); onNotify?.(message, 'info');
      window.dispatchEvent(new CustomEvent('codex:skills-changed', { detail: { workspaceId } }));
    } catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : 'The skill could not be updated.'); }
    finally { if (current()) { request.current = null; setPending(null); } }
  }

  const scopes = [...new Set(list?.skills.map(skill => skill.scope) ?? [])];
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return (list?.skills ?? []).filter(skill => (scope === '$all' || skill.scope === scope)
      && (!search || `${skill.name}\n${skill.description}\n${skill.path}`.toLocaleLowerCase().includes(search)));
  }, [list, query, scope]);
  const start = Math.min(offset, Math.max(0, Math.ceil(filtered.length / SKILL_PICKER_PAGE_SIZE) - 1) * SKILL_PICKER_PAGE_SIZE);
  const rows = filtered.slice(start, start + SKILL_PICKER_PAGE_SIZE), disabled = locked || loading || !!pending;
  const issues = list?.errors ?? [], issueStart = Math.min(errorOffset, Math.max(0, Math.ceil(issues.length / SKILL_PICKER_PAGE_SIZE) - 1) * SKILL_PICKER_PAGE_SIZE);
  return <section className="native-skills" aria-label="Codex skills">
    <div className="native-skills-heading"><BookOpen size={21} aria-hidden="true" /><div><h3>Skills</h3><p>Choose which discovered skills Codex can use.</p></div>
      <button type="button" className="icon-button" aria-label="Refresh skills" data-tooltip="Refresh skills" disabled={!path || disabled} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button></div>
    {!path ? <p className="native-skills-empty">Choose a workspace to view its skills.</p> : locked ? <p className="native-skills-empty">Unlock the workspace to view skills.</p> : <>
      <div className="native-skills-toolbar"><label className="native-skills-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search skills" placeholder="Search skills…" maxLength={160} value={query}
        onChange={event => { setQuery(event.target.value); setOffset(0); }} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} /></label>
        <SelectMenu aria-label="Skill scope" value={scope} onValueChange={value => { setScope(value); setOffset(0); }} className="select" options={[{ value: '$all', label: 'All scopes' }, ...scopes.map(value => ({ value, label: skillScopeLabel(value) }))]} /></div>
      {error && <div className="native-skills-error" role="alert"><AlertCircle size={15} aria-hidden="true" /><span>{error}</span><button type="button" className="text-button" disabled={disabled} onClick={() => setRevision(value => value + 1)}>Retry skills</button></div>}
      {notice && <p className="native-skills-notice" role="status">{notice}</p>}
      {loading && !list ? <p className="native-skills-empty" role="status"><LoaderCircle size={16} className="spin" />Loading skills…</p> : rows.length ? <ul className="native-skills-list" aria-label="Available skills" aria-busy={loading}>
        {rows.map((skill, index) => <li key={skill.path} aria-posinset={start + index + 1} aria-setsize={filtered.length}>
          <div><div className="native-skill-name"><strong className="text-ellipsis" data-tooltip={skill.name}>{skill.name}</strong><span>{skillScopeLabel(skill.scope)}</span></div><p>{skill.description || 'No description provided.'}</p><code className="text-ellipsis" data-tooltip={skill.path}>{skill.path}</code></div>
          <button type="button" role="switch" aria-label={skill.name} aria-checked={skill.enabled} className={`switch native-skill-switch ${skill.enabled ? 'is-on' : ''}`} disabled={disabled} onClick={() => void toggle(skill)}>
            {pending === skill.path ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <span />}</button>
        </li>)}
      </ul> : !error && <p className="native-skills-empty">{query || scope !== '$all' ? 'No skills match this search.' : 'Codex found no skills in this workspace.'}</p>}
      <PageNavigation label="Skills" offset={start} count={rows.length} total={filtered.length} hasPrevious={start > 0} hasNext={start + rows.length < filtered.length} loading={loading}
        onPrevious={() => setOffset(Math.max(0, start - SKILL_PICKER_PAGE_SIZE))} onNext={() => setOffset(start + SKILL_PICKER_PAGE_SIZE)} />
      {issues.length > 0 && <details className="native-skills-issues"><summary>{issues.length} {issues.length === 1 ? 'skill could' : 'skills could'} not be read</summary><ul>
        {issues.slice(issueStart, issueStart + SKILL_PICKER_PAGE_SIZE).map((issue, index) => <li key={`${issue.path}:${index}`}><code className="text-ellipsis" data-tooltip={issue.path}>{issue.path}</code><p>{issue.message}</p></li>)}
      </ul><PageNavigation label="Skill errors" offset={issueStart} count={Math.min(SKILL_PICKER_PAGE_SIZE, issues.length - issueStart)} total={issues.length} hasPrevious={issueStart > 0} hasNext={issueStart + SKILL_PICKER_PAGE_SIZE < issues.length}
        onPrevious={() => setErrorOffset(Math.max(0, issueStart - SKILL_PICKER_PAGE_SIZE))} onNext={() => setErrorOffset(issueStart + SKILL_PICKER_PAGE_SIZE)} /></details>}
    </>}
  </section>;
}
