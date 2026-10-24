import { describe, expect, it } from 'vitest';
import type { CodexModel, CodexModelCatalog } from '../shared/codex-cli';
import { modelDescription, modelOptions, modelRequestError, reasoningOptions, resolvedModelPreferences,
  validModelCatalogResponse, validModelId, validReasoningEffort, visibleModelOption } from '../client/components/chat/models';

const row = (patch: Partial<CodexModel> = {}): CodexModel => ({
  id: 'catalog-identity-not-the-wire-id', model: 'owner/Native-Exact', displayName: 'Native display label', description: 'Native description',
  hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'native_high', description: 'Native effort description' }],
  defaultReasoningEffort: 'native_high', inputModalities: ['text', 'image'], isDefault: true, ...patch,
});
const catalog = (rows: CodexModel[] = [row()], connected = true): CodexModelCatalog => ({
  backend: 'codex-cli', connected, models: rows.map(value => value.model), catalog: rows,
});

describe('native catalog and explicitly literal model choices', () => {
  it('preserves actual catalog identity, literal wire ID, labels and native metadata without changing the response', () => {
    const response = catalog(), original = structuredClone(response);
    const options = modelOptions(response, response.catalog[0].model), native = options.find(value => value.model === 'owner/Native-Exact');
    expect(native).toEqual({ ...response.catalog[0], kind: 'native', available: true });
    expect(response).toEqual(original);
    expect(options.some(value => value.model === 'catalog-identity-not-the-wire-id')).toBe(false);
    expect(reasoningOptions(options, 'owner/Native-Exact')).toEqual(['native_high']);
  });

  it('keeps requested hidden Daybreak Red and actual hidden Cyber metadata visible', () => {
    const red = row({ id: 'native-red-id', model: 'gpt-daybreak-red-latest', displayName: 'Daybreak Red', hidden: true }),
      cyber = row({ id: 'native-cyber-id', model: 'gpt-5.6-cyber', hidden: true });
    const options = modelOptions(catalog([red, cyber]), 'owner/elsewhere');
    for (const actual of [red, cyber]) {
      const selected = options.find(value => value.model === actual.model)!;
      expect(selected).toEqual({ ...actual, kind: 'native', available: true });
      expect(visibleModelOption(selected, 'owner/elsewhere')).toBe(true);
      expect(options.filter(value => value.model === actual.model)).toHaveLength(1);
    }
  });

  it('represents absent requested choices as literal UI entries, with no fabricated native profile or capacities', () => {
    const options = modelOptions(catalog(), 'owner/Native-Exact');
    for (const model of ['gpt-5.6-cyber', 'gpt-daybreak-red-latest']) {
      const selected = options.find(option => option.model === model)!;
      expect(selected).toMatchObject({ kind: 'literal', model, displayName: model, available: true });
      for (const name of ['id', 'hidden', 'supportedReasoningEfforts', 'defaultReasoningEffort', 'inputModalities', 'isDefault', 'contextWindow', 'maxOutputTokens']) {
        expect(selected).not.toHaveProperty(name);
      }
      expect(modelDescription(selected)).toContain('metadata unavailable');
      expect(modelDescription(selected)).toContain('acceptance is unverified');
      expect(reasoningOptions(options, model)).toEqual([]);
    }
  });

  it('keeps other native hidden metadata available for search and for an explicit selection', () => {
    const blue = row({ model: 'gpt-daybreak-blue-latest', hidden: true }), options = modelOptions(catalog([blue]), '');
    const selected = options.find(value => value.model === blue.model)!;
    expect(selected.kind).toBe('native'); expect(visibleModelOption(selected, '')).toBe(false);
    expect(visibleModelOption(selected, blue.model)).toBe(true);
    expect(reasoningOptions(options, blue.model)).toEqual(['native_high']);
  });

  it('accepts an intentional literal wire ID without a catalog membership veto or an effort substitution', () => {
    const model = 'owner/New-Exact:model', selected = { reasoningEffort: 'retained_custom-v2', reasoningSummary: 'none' as const };
    const options = modelOptions(catalog(), model), choice = options.find(value => value.model === model)!;
    expect(choice).toMatchObject({ kind: 'literal', model, displayName: model, available: true });
    expect(reasoningOptions(options, model)).toEqual([]);
    expect(modelRequestError(options, model, selected)).toBeNull();
    expect(resolvedModelPreferences(choice, selected)).toEqual(selected);
    expect(modelRequestError(options, 'another/intentional-literal', { reasoningEffort: null })).toBeNull();
  });

  it('offers and validates only the known native model’s actual reasoning values', () => {
    const options = modelOptions(catalog(), 'owner/Native-Exact');
    expect(modelRequestError(options, 'owner/Native-Exact', { reasoningEffort: 'native_high' })).toBeNull();
    expect(modelRequestError(options, 'owner/Native-Exact', { reasoningEffort: 'max' })).toContain('does not offer');
    expect(modelRequestError(options, 'owner/Native-Exact', { reasoningEffort: null })).toBeNull();
    const empty = modelOptions(catalog([row({ supportedReasoningEfforts: [] })]), 'owner/Native-Exact');
    expect(reasoningOptions(empty, 'owner/Native-Exact')).toEqual([]);
    expect(modelRequestError(empty, 'owner/Native-Exact', { reasoningEffort: 'native_high' })).toContain('does not offer');
  });

  it('keeps native order and deduplicates wire IDs without manufacturing aliases from display labels', () => {
    const first = row(), second = row({ id: 'other-native-id', model: 'owner/second', displayName: 'Different label' });
    const options = modelOptions(catalog([first, second, { ...first, id: 'duplicate-id', displayName: 'Later duplicate' }]), '');
    expect(options.filter(value => value.kind === 'native')).toEqual([
      { ...first, kind: 'native', available: true }, { ...second, kind: 'native', available: true },
    ]);
    const rawLabel = modelOptions(catalog(), 'Name supplied literally');
    expect(rawLabel.find(value => value.model === 'Name supplied literally')).toMatchObject({ kind: 'literal', model: 'Name supplied literally' });
    expect(rawLabel.some(value => value.model === 'Native display label')).toBe(false);
  });

  it.each(['gpt-5.3-codex', 'gpt-5.4', 'gpt-5.5', 'owner/gpt-5.5-special'])('does not restore retired %s through native or literal choices', model => {
    const options = modelOptions(catalog([row({ model })]), model);
    expect(options.some(value => value.model === model)).toBe(false);
    expect(modelRequestError(options, model, { reasoningEffort: null })).toContain('retired');
  });

  it('does not restore the shipped Lightweight or Pro labels', () => {
    const options = modelOptions(catalog([row({ displayName: 'Lightweight', model: 'old/light' }), row({ displayName: 'Pro Model', model: 'old/pro' })]), '');
    expect(options.some(value => value.kind === 'native')).toBe(false);
  });

  it('does not let an unknown literal bypass disconnected or not-yet-loaded model state', () => {
    for (const response of [null, catalog([], false), catalog([row()], false)]) {
      const options = modelOptions(response, 'owner/unlisted');
      expect(options.every(value => !value.available)).toBe(true);
      expect(modelRequestError(options, 'owner/unlisted', { reasoningEffort: 'retained_literal' })).toContain('not ready');
    }
  });

  it('bounds exact IDs and efforts without trimming or truncating them into a different choice', () => {
    expect(validModelId('x'.repeat(200))).toBe(true); expect(validModelId('x'.repeat(201))).toBe(false);
    expect(validReasoningEffort('x'.repeat(100))).toBe(true); expect(validReasoningEffort('x'.repeat(101))).toBe(false);
    for (const value of ['', ' model', 'model ', 'model\nnext', 'model\u0000next']) expect(validModelId(value)).toBe(false);
    const options = modelOptions(catalog(), 'owner/literal');
    expect(modelRequestError(options, 'x'.repeat(201), { reasoningEffort: null })).toContain('1–200');
    expect(modelRequestError(options, 'owner/literal', { reasoningEffort: 'x'.repeat(101) })).toContain('1–100');
  });

  it('rejects literal UI entries masquerading as native API catalog records and preserves none as a literal summary', () => {
    const response = catalog(); expect(validModelCatalogResponse(response)).toBe(true);
    const literal = modelOptions(response, 'owner/literal').find(value => value.kind === 'literal')!;
    expect(validModelCatalogResponse({ ...response, catalog: [literal] })).toBe(false);
    expect(validModelCatalogResponse({ ...response, catalog: [{ ...row(), supportedReasoningEfforts: [{ reasoningEffort: 42, description: '' }] }] })).toBe(false);
    const options = modelOptions(response, 'owner/literal');
    expect(modelRequestError(options, 'owner/literal', { reasoningEffort: 'none', reasoningSummary: 'none' })).toBeNull();
    expect(resolvedModelPreferences(options.find(value => value.model === 'owner/literal'), { reasoningEffort: 'none', reasoningSummary: null }))
      .toEqual({ reasoningEffort: 'none', reasoningSummary: null });
  });
});

describe('test Space model choices', () => {
  it('allows only advertised bridge models and drops unsupported reasoning summary', () => {
    const bridge = row({ id: 'claude-sonnet-5-5', model: 'claude-sonnet-5-5', provider: 'bridge',
      supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'high', description: '' }] });
    const options = modelOptions(catalog([bridge]), 'gpt-6-sol');
    expect(options.find(option => option.model === bridge.model)).toMatchObject({ kind: 'native', available: true, provider: 'bridge' });
    expect(options.find(option => option.model === 'gpt-6-sol')).toMatchObject({ kind: 'literal', available: false });
    expect(options.some(option => option.model === 'gpt-daybreak-red-latest')).toBe(false);
    expect(modelRequestError(options, 'gpt-6-sol', { reasoningEffort: null })).toBeTruthy();
    expect(modelRequestError(options, bridge.model, { reasoningEffort: 'high', reasoningSummary: 'detailed' })).toBeNull();
    expect(resolvedModelPreferences(options[0], { reasoningEffort: 'high', reasoningSummary: 'detailed' }))
      .toEqual({ reasoningEffort: 'high', reasoningSummary: null });
    expect(resolvedModelPreferences(options[0], { reasoningEffort: 'none', reasoningSummary: 'auto' }))
      .toEqual({ reasoningEffort: null, reasoningSummary: null });
  });
});
