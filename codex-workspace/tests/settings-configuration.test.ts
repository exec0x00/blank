import { describe, expect, it } from 'vitest';
import type { CodexNativeSettings } from '../shared/codex-cli';
import { basicFieldError, configAt, configEdits, configEqual, editableConfig, mcpServerErrors, parseConfigJson, previewConfig, schemaAt, schemaFields, setConfigAt,
  type ConfigSchema } from '../client/components/settings/configuration';
import { contextForModel, runtimePreferencesError, savedServiceTier, type RuntimePreferences } from '../client/components/settings/RuntimePreferencesFields';

describe('native configuration drafts', () => {
  it('preserves adjacent native options when setting or resetting a nested preference', () => {
    const before = { agents: { max_concurrent_threads_per_session: 4, max_depth: 2, researcher: { config_file: '/workspace/researcher.toml' } }, model: 'gpt-6-sol' };
    const after = setConfigAt(before, 'agents.max_concurrent_threads_per_session', 12);
    expect(before.agents.max_concurrent_threads_per_session).toBe(4);
    expect(after.agents).toEqual({ ...before.agents, max_concurrent_threads_per_session: 12 });
    expect(configEdits(before, after, ['agents', 'model'])).toEqual([{ keyPath: 'agents', value: after.agents }]);
    const reset = setConfigAt(after, 'agents.max_concurrent_threads_per_session', undefined);
    expect(reset.agents).toEqual({ max_depth: 2, researcher: { config_file: '/workspace/researcher.toml' } });
    expect(setConfigAt(before, '__proto__.unsafe', true)).toBe(before);
    expect(configAt({}, '__proto__.unsafe')).toBeUndefined();
  });

  it('distinguishes an override reset from an empty array and ignores object key order', () => {
    expect(configEqual({ first: 1, nested: { a: true, b: false } }, { nested: { b: false, a: true }, first: 1 })).toBe(true);
    expect(configEqual(['first', 'second'], ['second', 'first'])).toBe(false);
    expect(configEdits({ notify: ['command'], tool_output_token_limit: 500 }, { notify: [] }, ['notify', 'tool_output_token_limit']))
      .toEqual([{ keyPath: 'notify', value: [] }, { keyPath: 'tool_output_token_limit', value: null }]);
    expect(editableConfig({ model: 'native', model_provider: 'managed' }, ['model'])).toEqual({ model: 'native' });
  });

  it('previews staged MCP deletion while retaining inherited servers and unrelated defaults', () => {
    const effective = { mcp_servers: { inherited: { url: 'https://inherited.test/mcp' }, local: { command: 'local' } }, agents: { enabled: true, max_depth: 2 } };
    const before = { mcp_servers: { local: { command: 'local' } }, agents: { max_depth: 2 } };
    const after = { mcp_servers: {}, agents: { max_depth: 3 } };
    expect(previewConfig(effective, before, after)).toEqual({ mcp_servers: { inherited: { url: 'https://inherited.test/mcp' } }, agents: { enabled: true, max_depth: 3 } });
  });

  it('rejects non-object JSON and attempts to edit host-owned roots without echoing values', () => {
    expect(parseConfigJson('[]').error).toMatch(/JSON object/);
    expect(parseConfigJson('{').error).toMatch(/incomplete or invalid/);
    const rejected = parseConfigJson('{"model_provider":"private-test-value"}', ['model']);
    expect(rejected.error).toContain('model_provider'); expect(rejected.error).not.toContain('private-test-value');
    expect(parseConfigJson('{"__proto__":{"unsafe":true}}').error).toContain('__proto__');
  });
});

describe('official schema controls', () => {
  const schema: ConfigSchema = { type: 'object', definitions: {
    Agents: { type: 'object', properties: { enabled: { type: 'boolean', default: true }, max_depth: { type: 'integer', minimum: 1, maximum: 16 } }, additionalProperties: { type: 'object' } },
    Mode: { oneOf: [{ enum: ['first'], type: 'string' }, { enum: ['second'], type: 'string' }] },
  }, properties: { agents: { allOf: [{ $ref: '#/definitions/Agents' }] }, mode: { $ref: '#/definitions/Mode' },
    changing_feature: { anyOf: [{ type: 'boolean' }, { type: 'object', properties: { enabled: { type: 'boolean' } } }] },
    fallback_files: { type: 'array', items: { type: 'string' } } } };

  it('resolves referenced options and keeps complex unions/maps editable as JSON', () => {
    const fields = schemaFields(schema, ['agents', 'mode', 'changing_feature', 'fallback_files']);
    expect(fields.map(field => [field.path, field.kind])).toEqual([
      ['agents.enabled', 'boolean'], ['agents.max_depth', 'number'], ['agents', 'json'], ['mode', 'choice'], ['changing_feature', 'json'], ['fallback_files', 'lines'],
    ]);
    expect(fields.find(field => field.path === 'mode')?.choices).toEqual(['first', 'second']);
    expect(schemaAt(schema, 'agents.enabled')?.default).toBe(true);
    expect(basicFieldError(17, schemaAt(schema, 'agents.max_depth')!, schema)).toMatch(/16 or less/);
  });
});

describe('saved response speed', () => {
  it('keeps Fast as the default and honors legacy Standard settings', () => {
    expect(savedServiceTier({})).toBe('priority');
    expect(savedServiceTier({ fastMode: true })).toBe('priority');
    expect(savedServiceTier({ fastMode: false })).toBe('default');
  });

  it('preserves literal tiers over contradictory legacy booleans', () => {
    for (const serviceTier of ['ultrafast', 'fast', 'priority', 'default', 'future/provider-tier']) {
      expect(savedServiceTier({ serviceTier, fastMode: false })).toBe(serviceTier);
      expect(savedServiceTier({ serviceTier, fastMode: true })).toBe(serviceTier);
    }
  });

  it('restores the latest native tier even when the page still has older settings', () => {
    const native = { config: { service_tier: 'ultrafast' }, settings: { serviceTier: 'ultrafast', fastMode: true } };
    expect(savedServiceTier({ serviceTier: 'priority', fastMode: true }, native)).toBe('ultrafast');
    native.config.service_tier = 'future/provider-tier';
    expect(savedServiceTier({ serviceTier: 'ultrafast', fastMode: true }, native)).toBe('future/provider-tier');
  });
});

describe('model context and MCP validation', () => {
  const snapshot = { models: [{ model: 'gpt-6-sol', maximumContextWindow: 872_000, officialMaximumContextWindow: 1_050_000 }],
    modelContext: { model: 'gpt-6-sol', maximum: 872_000, officialMaximum: 1_050_000 } } as CodexNativeSettings;
  const defaults: RuntimePreferences = { model: 'gpt-6-sol', serviceTier: 'priority', maxConcurrentAgents: null, modelContextWindow: null, autoCompactTokenLimit: null };

  it('uses the available native maximum and does not invent capacity for another model', () => {
    expect(contextForModel(snapshot, 'gpt-6-sol')).toMatchObject({ maximum: 872_000, officialMaximum: 1_050_000 });
    expect(contextForModel(snapshot, 'unknown')).toMatchObject({ maximum: null, officialMaximum: null });
    expect(runtimePreferencesError(defaults, snapshot)).toBeNull();
    expect(runtimePreferencesError({ ...defaults, modelContextWindow: 1_050_000 }, snapshot)).toMatch(/872,000/);
    expect(runtimePreferencesError({ ...defaults, modelContextWindow: 200_000, autoCompactTokenLimit: 250_000 }, snapshot)).toMatch(/cannot exceed/);
    expect(runtimePreferencesError({ ...defaults, maxConcurrentAgents: 1.5 }, snapshot)).toMatch(/whole number/);
  });

  it('accepts functional HTTP and stdio references with benign query values', () => {
    expect(mcpServerErrors({ remote: { url: 'https://mcp.test/mcp?project_ref=demo&read_only=true', bearer_token_env_var: 'MCP_PROJECT_TOKEN', env_http_headers: { Authorization: 'MCP_AUTH_TOKEN' }, tool_timeout_sec: 0 },
      local: { command: 'npx', args: ['--yes', 'mcp-server'], env_vars: ['MCP_PROJECT_TOKEN'], startup_timeout_sec: 10 } })).toEqual([]);
  });

  it('rejects missing transports, inline credentials, private URL values and invalid timeouts without exposing secrets', () => {
    const errors = mcpServerErrors({ missing: {}, both: { command: 'npx', url: 'https://mcp.test' }, private: { url: 'https://mcp.test?access_token=fixture-private-value', tool_timeout_sec: 4000 }, inline: { command: 'server', env: { TOKEN: 'fixture-inline-value' } } });
    expect(errors).toHaveLength(5); expect(errors.join(' ')).toMatch(/environment references/); expect(errors.join(' ')).not.toContain('fixture-private-value'); expect(errors.join(' ')).not.toContain('fixture-inline-value');
  });
});
