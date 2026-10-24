import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from './context';
import { HttpError } from './errors';
import type { UiState, UiStateChange, UiStatePatch } from '../shared/types';
import { validComposerTiers, validServiceTier } from '../shared/service-tiers';

const stateKey = 'ui-state';
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value));
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
const profile = z.enum(['desktop', 'laptop', 'tablet', 'mobile']);
const view = z.enum(['agent', 'editor', 'terminal', 'git', 'github']);
const sidebar = z.enum(['expanded', 'collapsed']);
const split = z.enum(['split', 'focus']);
const agentWidthRatio = z.number().finite().min(0.1).max(0.85);
const explorerWidth = z.number().int().min(160).max(720);
const relativeFile = z.string().min(1).max(4096).refine(value => !/[\\\u0000-\u001f\u007f]/.test(value)
  && !value.startsWith('/') && !/^[a-z]:/i.test(value)
  && value.split('/').every(part => !!part && part !== '.' && part !== '..' && !part.startsWith('.codex-write-')));
const tabs = z.object({ paths: z.array(relativeFile).max(100), active: z.string().max(4096) }).strict()
  .refine(value => new Set(value.paths).size === value.paths.length && (value.active === '' || value.paths.includes(value.active)));
const layoutPreferences = z.object({ view: view.optional(), sidebar: sidebar.optional(), split: split.optional(),
  agentWidthRatio: agentWidthRatio.optional(), explorerWidth: explorerWidth.optional() }).strict();
const editorPreferences = z.object({ minimap: z.boolean().optional(), lineNumbers: z.boolean().optional(), wrap: z.boolean().nullable().optional() }).strict();
const serviceTiers = z.record(z.string(), z.string()).refine(validComposerTiers);
const workspacePreferences = z.object({ threadId: identifier.nullable().optional(), tabs: tabs.optional(), serviceTiers: serviceTiers.optional() }).strict();
const fieldName = z.string().regex(/^(?:layout\.(?:desktop|laptop|tablet|mobile)\.(?:view|sidebar|split|agentWidthRatio|explorerWidth)|editor\.(?:minimap|lineNumbers|wrap)|workspace\.[a-zA-Z0-9_-]{1,128}\.(?:threadId|tabs|serviceTier\.(?:draft|[a-fA-F0-9-]{36})))$/);
const stateSchema = z.object({
  version: z.literal(1), revision,
  layouts: z.object({ desktop: layoutPreferences.optional(), laptop: layoutPreferences.optional(), tablet: layoutPreferences.optional(), mobile: layoutPreferences.optional() }).strict(),
  editor: editorPreferences,
  workspaces: z.record(identifier, workspacePreferences).refine(value => Object.keys(value).length <= 1000),
  fieldRevisions: z.record(fieldName, revision).refine(value => Object.keys(value).length <= 2500),
}).strict().refine(value => Object.values(value.fieldRevisions).every(fieldRevision => fieldRevision <= value.revision));
const changeSchema = z.union([
  z.object({ section: z.literal('layout'), profile, key: z.literal('view'), value: view }).strict(),
  z.object({ section: z.literal('layout'), profile, key: z.literal('sidebar'), value: sidebar }).strict(),
  z.object({ section: z.literal('layout'), profile, key: z.literal('split'), value: split }).strict(),
  z.object({ section: z.literal('layout'), profile, key: z.literal('agentWidthRatio'), value: agentWidthRatio }).strict(),
  z.object({ section: z.literal('layout'), profile, key: z.literal('explorerWidth'), value: explorerWidth }).strict(),
  z.object({ section: z.literal('editor'), key: z.enum(['minimap', 'lineNumbers']), value: z.boolean() }).strict(),
  z.object({ section: z.literal('editor'), key: z.literal('wrap'), value: z.boolean().nullable() }).strict(),
  z.object({ section: z.literal('workspace'), workspaceId: identifier, key: z.literal('threadId'), value: identifier.nullable() }).strict(),
  z.object({ section: z.literal('workspace'), workspaceId: identifier, key: z.literal('tabs'), value: tabs }).strict(),
  z.object({ section: z.literal('workspace'), workspaceId: identifier, key: z.literal('serviceTier'),
    threadId: z.string().uuid().nullable(), value: z.string().refine(validServiceTier) }).strict(),
]);
const patchSchema = z.object({ revision, changes: z.array(changeSchema).min(1).max(512), migration: z.boolean().optional() }).strict();

function emptyState(): UiState { return { version: 1, revision: 0, layouts: {}, editor: {}, workspaces: {}, fieldRevisions: {} }; }
function validatedState(value: unknown): UiState {
  const result = stateSchema.safeParse(value);
  if (!result.success) throw new HttpError(503, 'Saved interface preferences could not be read. Please retry after storage is available.', 'UI_STATE_INVALID');
  return result.data;
}
function fieldKey(change: UiStateChange): string {
  return change.section === 'layout' ? `layout.${change.profile}.${change.key}`
    : change.section === 'editor' ? `editor.${change.key}` : `workspace.${change.workspaceId}.${change.key}${change.key === 'serviceTier' ? '.' + (change.threadId ?? 'draft') : ''}`;
}
function fieldValue(state: UiState, change: UiStateChange): unknown {
  return change.section === 'layout' ? state.layouts[change.profile]?.[change.key]
    : change.section === 'editor' ? state.editor[change.key] : change.key === 'serviceTier'
      ? state.workspaces[change.workspaceId]?.serviceTiers?.[change.threadId ?? 'draft'] : state.workspaces[change.workspaceId]?.[change.key];
}
function sameValue(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

/** Only small, whitelisted selections live here. File buffers and account secrets do not. */
export async function readUiState(ctx: AppContext): Promise<UiState> {
  return validatedState(await ctx.store.read<UiState>(stateKey, emptyState()));
}

async function validateReferences(ctx: AppContext, patch: UiStatePatch): Promise<UiStateChange[]> {
  const workspaceIds = [...new Set(patch.changes.filter(change => change.section === 'workspace').map(change => change.workspaceId))];
  await Promise.all(workspaceIds.map(workspaceId => ctx.workspaces.get(workspaceId)));
  const validated = await Promise.all(patch.changes.map(async change => {
    if (change.section !== 'workspace') return change;
    if (change.key === 'threadId') {
      if (change.value !== null) {
        try {
          const { claudeConversationWorkspace } = await import('./claude-agent');
          if (await claudeConversationWorkspace(ctx, change.value) !== change.workspaceId) {
            throw new HttpError(400, 'Choose a conversation in this workspace.', 'UI_STATE_THREAD_NOT_FOUND');
          }
        } catch (error) {
          if (patch.migration && error instanceof HttpError && [400, 404].includes(error.status)) return null;
          throw error;
        }
      }
    } else if (change.key === 'tabs') {
      try { await Promise.all(change.value.paths.map(file => ctx.workspaces.resolvePath(change.workspaceId, file, { allowMissing: true }))); }
      catch (error) {
        // An old browser tab can point through a link whose target is no longer safe.
        if (patch.migration && error instanceof HttpError && [400, 403, 404].includes(error.status)) return null;
        throw error;
      }
    }
    return change;
  }));
  return validated.filter((change): change is UiStateChange => change !== null);
}

export function createUiStateRouter(ctx: AppContext): Router {
  const router = Router();
  router.get('/ui-state', async (_req, res) => { res.json(await readUiState(ctx)); });
  router.patch('/ui-state', async (req, res) => {
    if (Buffer.byteLength(JSON.stringify(req.body) || '') > 512 * 1024) throw new HttpError(413, 'Too many interface preferences in one request.', 'UI_STATE_TOO_LARGE');
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Invalid interface preferences. Only supported selections can be saved.', 'VALIDATION_ERROR');
    const input: UiStatePatch = parsed.data;
    const keys = input.changes.map(fieldKey);
    if (new Set(keys).size !== keys.length) throw new HttpError(400, 'Save each interface preference once per request.', 'VALIDATION_ERROR');
    if (input.migration && input.revision !== 0) throw new HttpError(400, 'Legacy preferences can only initialize an empty profile.', 'VALIDATION_ERROR');
    // A stale browser cache never overrides any established canonical state.
    if (input.migration) {
      const current = await readUiState(ctx);
      if (current.revision !== 0) { res.json(current); return; }
    }
    const changes = await validateReferences(ctx, input);
    const saved = await ctx.store.update<UiState>(stateKey, emptyState(), value => {
      const current = validatedState(value);
      if (input.migration && current.revision !== 0) return current;
      if (input.revision > current.revision || changes.some(change => (current.fieldRevisions[fieldKey(change)] || 0) > input.revision && !sameValue(fieldValue(current, change), change.value))) {
        throw new HttpError(409, 'These interface preferences changed in another browser. Refresh the saved selections before retrying.', 'UI_STATE_CONFLICT');
      }
      const changed = changes.filter(change => !sameValue(fieldValue(current, change), change.value));
      if (!changed.length) return current;
      const nextRevision = current.revision + 1;
      for (const change of changed) {
        if (change.section === 'layout') current.layouts[change.profile] = { ...current.layouts[change.profile], [change.key]: change.value };
        else if (change.section === 'editor') current.editor = { ...current.editor, [change.key]: change.value };
        else if (change.key === 'serviceTier') current.workspaces[change.workspaceId] = { ...current.workspaces[change.workspaceId],
          serviceTiers: { ...current.workspaces[change.workspaceId]?.serviceTiers, [change.threadId ?? 'draft']: change.value } };
        else current.workspaces[change.workspaceId] = { ...current.workspaces[change.workspaceId], [change.key]: change.value };
        current.fieldRevisions[fieldKey(change)] = nextRevision;
      }
      current.revision = nextRevision;
      // Bound total state as well as each individual request.
      return validatedState(current);
    });
    res.json(saved);
  });
  return router;
}
