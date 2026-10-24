import { useEffect, useState } from 'react';
import { ArrowLeft, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import type { ClaudeSkill, ClaudeSkillScope } from '../../../shared/claude';
import { api, json } from '../../api';

type Notify = (message: string, kind?: 'error' | 'success' | 'info') => void;
interface Draft { name: string; scope: ClaudeSkillScope; content: string; saved: string; existing: boolean }

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const template = (name: string) => `---
name: ${name || 'my-skill'}
description: What this skill does and when Claude should use it.
---

# ${name || 'My skill'}

Step-by-step instructions Claude follows when this skill applies.
`;

/** Create and edit Claude Code skills (SKILL.md) for this workspace or for every workspace. */
export function SkillsEditor({ workspaceId, onNotify, onChanged }: { workspaceId: string; onNotify: Notify; onChanged: () => void }) {
  const base = `/claude/workspaces/${encodeURIComponent(workspaceId)}/skills`;
  const [skills, setSkills] = useState<ClaudeSkill[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = () => api<ClaudeSkill[]>(base).then(setSkills).catch(error => { setSkills([]); onNotify(error instanceof Error ? error.message : 'Skills are unavailable.', 'error'); });
  useEffect(() => { void load(); }, [base]);

  async function open(skill: ClaudeSkill) {
    setBusy(true);
    try {
      const value = await api<ClaudeSkill>(`${base}/${skill.scope}/${skill.name}`);
      setDraft({ name: value.name, scope: value.scope, content: value.content ?? '', saved: value.content ?? '', existing: true });
      setConfirmDelete(false);
    } catch (error) { onNotify(error instanceof Error ? error.message : 'The skill could not be opened.', 'error'); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!draft || !NAME.test(draft.name)) return;
    setBusy(true);
    try {
      await api(`${base}/${draft.scope}/${draft.name}`, json('PUT', { content: draft.content }));
      setDraft({ ...draft, saved: draft.content, existing: true });
      onNotify(`Skill /${draft.name} saved. Claude can use it from the next message.`, 'success');
      await load(); onChanged();
    } catch (error) { onNotify(error instanceof Error ? error.message : 'The skill could not be saved.', 'error'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!draft) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    try {
      await api(`${base}/${draft.scope}/${draft.name}`, json('DELETE'));
      onNotify(`Skill /${draft.name} deleted.`, 'success');
      setDraft(null); await load(); onChanged();
    } catch (error) { onNotify(error instanceof Error ? error.message : 'The skill could not be deleted.', 'error'); }
    finally { setBusy(false); setConfirmDelete(false); }
  }

  if (draft) {
    const nameError = draft.name && !NAME.test(draft.name) ? 'Use lowercase letters, numbers, and hyphens.' : '';
    const taken = !draft.existing && skills?.some(skill => skill.name === draft.name && skill.scope === draft.scope);
    return <div className="claude-skill-editor">
      <div className="claude-tools-toolbar">
        <button type="button" className="button ghost" onClick={() => setDraft(null)}><ArrowLeft size={13} />All skills</button>
        <span className="claude-skill-path">{draft.scope === 'project' ? `.claude/skills/${draft.name || '…'}/SKILL.md` : `Your skills / ${draft.name || '…'}`}</span>
      </div>
      <div className="claude-skill-fields">
        <label className="field"><span>Name</span>
          <input className="input claude-mono" value={draft.name} disabled={draft.existing} maxLength={64} placeholder="review-pr" autoFocus={!draft.existing}
            onChange={event => { const name = event.target.value.toLowerCase().replace(/\s+/g, '-'); setDraft({ ...draft, name, content: draft.content === template(draft.name) ? template(name) : draft.content }); }} />
          {(nameError || taken) && <small className="form-error">{nameError || 'A skill with this name already exists here.'}</small>}</label>
        <div className="field"><span>Available in</span>
          <div className="claude-segment">{(['project', 'user'] as const).map(scope => <button key={scope} type="button" disabled={draft.existing} className={draft.scope === scope ? 'active' : ''} onClick={() => setDraft({ ...draft, scope })}>
            {scope === 'project' ? 'This workspace' : 'All workspaces'}</button>)}</div></div>
      </div>
      <textarea className="input claude-mono claude-memory" rows={16} value={draft.content} spellCheck={false} onChange={event => setDraft({ ...draft, content: event.target.value })} />
      <p className="claude-tools-help">Keep the <code>description</code> specific: Claude reads it to decide when the skill applies. You can also run it directly with <code>/{draft.name || 'name'}</code>.</p>
      <div className="claude-tools-actions">
        {draft.existing && <button type="button" className={`button ${confirmDelete ? 'danger' : 'ghost'}`} disabled={busy} onClick={() => void remove()}><Trash2 size={13} />{confirmDelete ? 'Delete for good?' : 'Delete'}</button>}
        <span className="claude-skill-spacer" />
        <button type="button" className="button primary" disabled={busy || !NAME.test(draft.name) || !!taken || !draft.content.trim() || draft.content === draft.saved}
          onClick={() => void save()}>{busy && <LoaderCircle size={14} className="chat-spin" />}{draft.existing ? 'Save skill' : 'Create skill'}</button>
      </div>
    </div>;
  }

  return <>
    <div className="claude-tools-toolbar"><p className="claude-tools-help">Skills are reusable instructions Claude loads when they fit the task, or that you run with <code>/name</code>.</p>
      <button type="button" className="button primary" onClick={() => setDraft({ name: '', scope: 'project', content: template(''), saved: '', existing: false })}><Plus size={13} />New skill</button></div>
    {!skills ? <p className="claude-tools-empty"><LoaderCircle size={14} className="chat-spin" />Loading skills…</p>
      : !skills.length ? <p className="claude-tools-empty">No skills yet. Create one to teach Claude a repeatable workflow.</p>
        : <ul className="claude-tools-list">{skills.map(skill => <li key={`${skill.scope}:${skill.name}`} className="is-action is-clickable" onClick={() => void open(skill)}>
          <div><strong>/{skill.name} <em>· {skill.scope === 'project' ? 'this workspace' : 'all workspaces'}</em></strong><small>{skill.description || 'No description'}</small></div>
          <button type="button" className="button" disabled={busy} onClick={event => { event.stopPropagation(); void open(skill); }}>Edit</button></li>)}</ul>}
  </>;
}
