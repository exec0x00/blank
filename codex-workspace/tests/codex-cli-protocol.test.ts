import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CODEX_PROTOCOL_VERSION, nativeProtocolCatalog, nativeRequest } from '../server/codex-cli/protocol';
import { collectNativeProtocolMethods, collectNativeSchemaDefinitionNames, NativeProtocolSchemaError } from '../server/codex-cli/protocol/schema';
import { nativeMethodCoverage } from '../server/codex-cli/protocol/coverage';
import manifest from '../server/codex-cli/protocol/manifest.json';
import schema from '../server/codex-cli/protocol/schema/codex_app_server_protocol.schemas.json';
import v2 from '../server/codex-cli/protocol/schema/codex_app_server_protocol.v2.schemas.json';

const generated = path.resolve('server/codex-cli/protocol');
const digest = (content: Uint8Array) => createHash('sha256').update(content).digest('hex');

describe('the reviewed official app-server protocol', () => {
  it('retains every generated request, callback, notification and type with reproducible hashes', async () => {
    expect(CODEX_PROTOCOL_VERSION).toBe('0.159.2');
    expect(manifest.codexVersion).toBe(CODEX_PROTOCOL_VERSION);
    expect(Object.keys(nativeProtocolCatalog.clientRequests)).toHaveLength(170);
    expect(Object.keys(nativeProtocolCatalog.serverRequests)).toHaveLength(11);
    expect(Object.keys(nativeProtocolCatalog.serverNotifications)).toHaveLength(85);
    expect(Object.keys(nativeProtocolCatalog.clientNotifications)).toEqual(['initialized']);
    expect(nativeProtocolCatalog.types).toHaveLength(873);
    expect(Object.keys(nativeMethodCoverage).sort()).toEqual(Object.keys(nativeProtocolCatalog.clientRequests).sort());
    expect(Object.values(nativeMethodCoverage).filter(entry => entry.state === 'implemented')).toHaveLength(129);
    expect(Object.values(nativeMethodCoverage).filter(entry => entry.state === 'excluded')).toHaveLength(32);
    expect(Object.values(nativeMethodCoverage).filter(entry => entry.state === 'not-exposed')).toHaveLength(9);
    for (const [kind, entries] of [['generated', manifest.typeFiles], ['schema', manifest.schemaFiles]] as const) {
      for (const entry of entries) {
        const content = await fs.readFile(path.join(generated, kind, entry.path));
        expect(content.length, entry.path).toBe(entry.bytes);
        expect(digest(content), entry.path).toBe(entry.sha256);
      }
    }
  });

  it('records the JSON/TypeScript generator differences without claiming absent schema methods are callable', () => {
    for (const [name, catalog] of [
      ['ClientRequest', nativeProtocolCatalog.clientRequests], ['ServerRequest', nativeProtocolCatalog.serverRequests],
      ['ServerNotification', nativeProtocolCatalog.serverNotifications], ['ClientNotification', nativeProtocolCatalog.clientNotifications],
    ] as const) {
      const actual = collectNativeProtocolMethods(schema.definitions[name]);
      const declared = Object.entries(catalog).filter(([, entry]) => entry.jsonSchema).map(([method]) => method).sort();
      expect(actual).toEqual(declared);
    }
    expect(nativeProtocolCatalog.clientRequests.getAuthStatus.jsonSchema).toBe(false);
    expect(nativeProtocolCatalog.serverNotifications['rawResponse/completed'].jsonSchema).toBe(false);
    expect(nativeProtocolCatalog.clientRequests['process/spawn'].experimental).toBe(true);
    expect(nativeProtocolCatalog.clientRequests['thread/items/list'].experimental).toBe(false);
    expect(nativeProtocolCatalog.clientRequests['thread/start'].experimental).toBe(false);
    expect(collectNativeSchemaDefinitionNames(v2)).toContain('TokenUsageBreakdown');
  });

  it('does not mistake methods inside native payload definitions for envelope capabilities', () => {
    const input = { oneOf: [{ properties: { method: { enum: ['thread/read'] }, params: {
      properties: { method: { const: 'untrusted/tool' } },
    } } }], definitions: { Unused: { properties: { method: { enum: ['account/login/start'] } } } } };
    expect(collectNativeProtocolMethods(input)).toEqual(['thread/read']);
    expect(collectNativeProtocolMethods({ oneOf: [{ $ref: '#/definitions/Request' }], definitions: {
      Request: { properties: { method: { const: 'thread/list' } } },
    } })).toEqual(['thread/list']);
    expect(() => collectNativeProtocolMethods({ oneOf: [{ $ref: 'https://untrusted.invalid/schema.json' }] })).toThrow(NativeProtocolSchemaError);
    expect(() => collectNativeProtocolMethods({ properties: { method: { enum: ['invalid\nmethod'] } } })).toThrow(NativeProtocolSchemaError);
  });

  it('dispatches exact typed parameters and leaves actual rejection authoritative', async () => {
    const failure = Object.assign(new Error('Native history is not implemented.'), { nativeCode: -32601 });
    const request = vi.fn(async () => { throw failure; });
    const params = { threadId: '01990000-0000-7000-8000-000000000001', limit: 4, cursor: null };
    await expect(nativeRequest({ request }, 'thread/items/list', params, 5000)).rejects.toBe(failure);
    expect(request).toHaveBeenCalledWith('thread/items/list', params, 5000);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
