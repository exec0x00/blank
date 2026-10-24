import type { CodexSkill, CodexSkillList } from '../../../shared/types';

export const SKILL_PICKER_PAGE_SIZE = 30;
export const MAX_SELECTED_SKILLS = 12;
export type SkillSelectionLabel = Pick<CodexSkill, 'name'>;
export type SkillSelectionLabels = Record<string, SkillSelectionLabel>;
export function skillScopeLabel(scope: string): string {
  return ({ repo: 'Workspace', project: 'Workspace', user: 'Personal', system: 'Built-in', admin: 'Organization' } as Record<string, string>)[scope] || scope;
}
export function readSkillList(value: unknown): CodexSkillList {
  const data = value as CodexSkillList | null;
  if (!data || !Array.isArray(data.skills) || data.skills.length > 5000 || !Array.isArray(data.errors) || data.errors.length > 5000
    || data.skills.some(skill => !skill || typeof skill.name !== 'string' || !skill.name || typeof skill.description !== 'string'
      || typeof skill.path !== 'string' || !skill.path.startsWith('/') || skill.path.length > 4096 || /[\u0000-\u001f\u007f]/.test(skill.path)
      || typeof skill.enabled !== 'boolean' || typeof skill.scope !== 'string')
    || new Set(data.skills.map(skill => skill.path)).size !== data.skills.length
    || data.errors.some(error => !error || typeof error.path !== 'string' || typeof error.message !== 'string')) {
    throw new Error('The Codex skill list could not be read. Refresh skills to try again.');
  }
  return { skills: data.skills.map(({ name, description, path, enabled, scope }) => ({ name, description, path, enabled, scope })),
    errors: data.errors.map(({ path, message }) => ({ path, message })) };
}
export function retainSkillSelectionLabels(labels: SkillSelectionLabels, drafts: Record<string, string[]>): SkillSelectionLabels {
  const selected = new Set(Object.values(drafts).flat());
  const retained = Object.entries(labels).filter(([path]) => selected.has(path));
  return retained.length === Object.keys(labels).length ? labels : Object.fromEntries(retained);
}
