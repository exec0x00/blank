import type { CodexModel, CodexModelCatalog } from '../../../shared/types';

export type ModelOption = (CodexModel & { kind: 'native'; available: boolean }) | {
  kind: 'literal'; model: string; displayName: string; description: string; available: boolean;
};
export type NativeReasoningSummary = 'auto' | 'concise' | 'detailed' | 'none';
export interface ModelRunPreferences { reasoningEffort: string | null; reasoningSummary?: NativeReasoningSummary | null }
export interface ResolvedModelPreferences { reasoningEffort: string | null; reasoningSummary: NativeReasoningSummary | null }
export type ModelCatalogResponse = CodexModelCatalog;
export const REASONING_SUMMARIES: readonly NativeReasoningSummary[] = ['auto', 'concise', 'detailed', 'none'];
export const REQUESTED_TEAM_RED_MODELS = ['gpt-5.6-cyber', 'gpt-daybreak-red-latest'] as const;
export const MODEL_ID_MAX_LENGTH = 200;
export const REASONING_EFFORT_MAX_LENGTH = 100;
const literalText = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length > 0
  && value.length <= maximum && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
export const validModelId = (value: unknown): value is string => literalText(value, MODEL_ID_MAX_LENGTH);
export const validReasoningEffort = (value: unknown): value is string => literalText(value, REASONING_EFFORT_MAX_LENGTH);
export const retiredModel = (value: string): boolean => /(?:^|[\s/-])gpt[- ]?5\.[345](?:\b|-)/i.test(value);
const requested = (model: string) => REQUESTED_TEAM_RED_MODELS.some(value => value === model);
const literalDescription = 'Model ID · metadata unavailable. Service acceptance is unverified.';

export function resolvedModelPreferences(_model: ModelOption | undefined, selected: ModelRunPreferences): ResolvedModelPreferences {
  const bridge = _model?.kind === 'native' && _model.provider === 'bridge';
  return { reasoningEffort: bridge && selected.reasoningEffort === 'none' ? null : selected.reasoningEffort,
    reasoningSummary: bridge ? null : selected.reasoningSummary ?? null };
}

const text = (value: unknown): value is string => typeof value === 'string';
export function validModelCatalogResponse(value: unknown): value is CodexModelCatalog {
  if (!value || typeof value !== 'object') return false;
  const result = value as CodexModelCatalog;
  return result.backend === 'codex-cli' && typeof result.connected === 'boolean'
    && Array.isArray(result.models) && result.models.length <= 4096 && result.models.every(validModelId)
    && Array.isArray(result.catalog) && result.catalog.length <= 4096
    && result.catalog.every(model => model && text(model.id) && !!model.id && validModelId(model.model)
      && text(model.displayName) && text(model.description) && typeof model.hidden === 'boolean'
      && typeof model.isDefault === 'boolean' && text(model.defaultReasoningEffort)
      && Array.isArray(model.inputModalities) && model.inputModalities.every(text)
      && Array.isArray(model.supportedReasoningEfforts) && model.supportedReasoningEfforts.length <= 64
      && model.supportedReasoningEfforts.every(option => option && validReasoningEffort(option.reasoningEffort) && text(option.description)));
}

/** Native catalog records and literal UI choices remain different types. The
 * latter have no invented native id, effort list, modality or capacity. */
export function modelOptions(response: CodexModelCatalog | null, selectedModel: string): ModelOption[] {
  const result = new Map<string, ModelOption>();
  for (const model of response?.catalog ?? []) {
    if (!retiredModel(model.model) && !/^(?:Lightweight|Pro)(?:\s|$)/i.test(model.displayName) && !result.has(model.model)) {
      result.set(model.model, { ...model, kind: 'native', available: response?.connected === true });
    }
  }
  for (const model of response?.catalog.some(row => row.provider === 'bridge') ? [selectedModel] : [...REQUESTED_TEAM_RED_MODELS, selectedModel]) {
    if (validModelId(model) && !retiredModel(model) && !result.has(model)) result.set(model, {
      kind: 'literal', model, displayName: model, description: literalDescription, available: response?.connected === true && !response?.catalog.some(row => row.provider === 'bridge'),
    });
  }
  return [...result.values()];
}

/** Other native hidden models are searchable without inventing a literal row
 * for metadata that the CLI actually supplied. Requested/selected rows remain
 * visible even in the default picker. */
export function visibleModelOption(model: ModelOption, selectedModel: string): boolean {
  return model.kind === 'literal' || !model.hidden || requested(model.model) || model.model === selectedModel;
}

export function reasoningOptions(options: readonly ModelOption[], model: string): string[] {
  const selected = options.find(option => option.model === model && option.available);
  return selected?.kind === 'native' ? [...new Set(selected.supportedReasoningEfforts.map(option => option.reasoningEffort))] : [];
}

export function modelRequestError(options: readonly ModelOption[], model: string, selected: ModelRunPreferences): string | null {
  if (!validModelId(model)) return 'Enter a model ID of 1–200 characters without outer spaces or control characters.';
  if (retiredModel(model)) return 'This retired model is not offered. Choose another model ID.';
  const entry = options.find(option => option.model === model);
  if (!entry && options.some(option => option.kind === 'native' && option.provider === 'bridge')) return 'Choose a model offered by the test Space API.';
  if (!options.some(option => option.available) || entry?.available === false) return 'Codex is not ready. Refresh models before using this choice.';
  if (selected.reasoningEffort !== null && !validReasoningEffort(selected.reasoningEffort)) {
    return 'Use a reasoning effort of 1–100 characters without outer spaces or control characters, or choose the Codex default.';
  }
  if (entry?.kind === 'native' && selected.reasoningEffort !== null && !reasoningOptions(options, model).includes(selected.reasoningEffort)) {
    return `${entry.displayName || entry.model} does not offer reasoning effort “${selected.reasoningEffort}”. Choose an available effort or the Codex default.`;
  }
  if (selected.reasoningSummary != null && !REASONING_SUMMARIES.includes(selected.reasoningSummary)) return 'Choose a supported public reasoning summary setting.';
  return null;
}

export function modelDescription(model: ModelOption | undefined): string {
  if (!model) return 'Choose a model offered by the test Space API.';
  if (!model.available) return 'Refresh models when Codex is ready.';
  return model.kind === 'literal' ? literalDescription : model.description || 'Model choices and reasoning efforts are provided by Codex.';
}

export const OMIT_MODEL_OPTION = '$omit';
export const DEFAULT_MODEL_OPTION = '$default';
export function modelOptionValue(value: string | null | undefined): string { return value == null ? OMIT_MODEL_OPTION : value; }
export function parseModelOption(value: string): string | null { return value === DEFAULT_MODEL_OPTION || value === OMIT_MODEL_OPTION ? null : value; }
