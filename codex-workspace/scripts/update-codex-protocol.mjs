import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run explicitly after reviewing an official CLI update. This generates data
// only: it never starts app-server, opens a thread, or contacts a model service.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(repository, 'server/codex-cli/protocol');
const executable = process.argv[2] ?? 'codex';
if (process.argv.length > 3) throw new Error('Usage: node scripts/update-codex-protocol.mjs [official-codex-executable]');
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-workspace-protocol-'));
const digest = value => createHash('sha256').update(value).digest('hex');
const header = '// Generated from the official Codex CLI. Run scripts/update-codex-protocol.mjs; do not edit.\n';
const directions = ['ClientRequest', 'ServerRequest', 'ServerNotification', 'ClientNotification'];
const responseOverrides = {
  'account/gatewayOAuth/read': 'v2/GatewayOAuthReadResponse',
  'account/gatewayOAuth/login': 'v2/GatewayOAuthLoginResponse',
  'account/gatewayOAuth/cancel': 'v2/GatewayOAuthCancelResponse',
  'config/mcpServer/reload': 'v2/McpServerRefreshResponse',
  'account/logout': 'v2/LogoutAccountResponse',
  'account/workspaceMessages/read': 'v2/GetWorkspaceMessagesResponse',
  'externalAgentConfig/import/readHistories': 'v2/ExternalAgentConfigImportHistoriesReadResponse',
  'config/value/write': 'v2/ConfigWriteResponse',
  'config/batchWrite': 'v2/ConfigWriteResponse',
};

function run(args) {
  return execFileSync(executable, args, { encoding: 'utf8', cwd: scratch, timeout: 60_000, maxBuffer: 64 * 1024,
    env: { PATH: process.env.PATH, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' } });
}

async function files(directory, extension, base = directory) {
  const result = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(filename, extension, base));
    else if (entry.isFile() && entry.name.endsWith(extension)) result.push(path.relative(base, filename).split(path.sep).join('/'));
    else throw new Error('Unexpected generated protocol file.');
    if (result.length > 4096) throw new Error('Generated protocol file limit exceeded.');
  }
  return result.sort();
}

function methodEntries(text, direction) {
  const imports = new Map([...text.matchAll(/import type \{ (\w+) \} from "\.\/([^"\n]+)";/g)].map(match => [match[1], match[2]]));
  const entries = [];
  const pattern = direction.endsWith('Request')
    ? /\{ "method": "([^"]+)", id: RequestId, params\??: (\w+)/g
    : /\{ "method": "([^"]+)"(?:, "params": (\w+))? \}/g;
  for (const match of text.matchAll(pattern)) {
    const params = match[2] === undefined || match[2] === 'undefined' ? null : imports.get(match[2]);
    if (params === undefined) throw new Error(`Missing generated parameter type: ${match[1]}`);
    entries.push({ method: match[1], params });
  }
  const named = [...text.matchAll(/"method": "([^"]+)"/g)].map(match => match[1]);
  if (entries.length !== named.length || new Set(named).size !== named.length || !named.length) throw new Error(`Unrecognized ${direction} generation format.`);
  return entries.sort((a, b) => a.method.localeCompare(b.method));
}

function schemaMethods(value) {
  const pending = [value], result = new Set();
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const method = item.properties?.method;
    for (const name of method?.enum ?? (method?.const ? [method.const] : [])) result.add(name);
    for (const key of ['oneOf', 'anyOf', 'allOf']) if (Array.isArray(item[key])) pending.push(...item[key]);
  }
  return result;
}

try {
  const version = /^codex-cli (\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\s*$/.exec(run(['--version']))?.[1];
  if (!version) throw new Error('The executable did not return an official Codex CLI version.');
  for (const [command, directory, experimental] of [
    ['generate-ts', 'types', true], ['generate-ts', 'stable-types', false],
    ['generate-json-schema', 'schema', true],
  ]) run(['app-server', command, '--out', path.join(scratch, directory), ...(experimental ? ['--experimental'] : [])]);

  const typeFiles = await files(path.join(scratch, 'types'), '.ts');
  const typeFilesByName = new Map();
  for (const filename of typeFiles) {
    if (path.basename(filename) === 'index.ts') continue;
    const name = path.basename(filename, '.ts');
    const existing = typeFilesByName.get(name) ?? [];
    existing.push(filename.slice(0, -3)); typeFilesByName.set(name, existing);
  }
  const catalog = { version, documentationUrl: 'https://developers.openai.com/codex/app-server',
    experimental: true, types: [], clientRequests: {}, serverRequests: {}, serverNotifications: {}, clientNotifications: {} };
  const keys = ['clientRequests', 'serverRequests', 'serverNotifications', 'clientNotifications'];
  for (const [index, direction] of directions.entries()) {
    const entries = methodEntries(await fs.readFile(path.join(scratch, 'types', `${direction}.ts`), 'utf8'), direction);
    const stable = new Set(methodEntries(await fs.readFile(path.join(scratch, 'stable-types', `${direction}.ts`), 'utf8'), direction).map(entry => entry.method));
    const schema = schemaMethods(JSON.parse(await fs.readFile(path.join(scratch, 'schema', `${direction}.json`), 'utf8')));
    for (const entry of entries) {
      let result = null;
      if (direction.endsWith('Request')) {
        const name = entry.params === null
          ? entry.method.split(/[/_]/).map(part => part[0].toUpperCase() + part.slice(1)).join('') + 'Response'
          : path.basename(entry.params).replace(/Params$/, '') + 'Response';
        const candidates = typeFilesByName.get(name) ?? [];
        result = responseOverrides[entry.method] ?? (candidates.length === 1 ? candidates[0] : undefined);
        if (!result || !typeFiles.includes(`${result}.ts`)) throw new Error(`Review response association for ${entry.method}.`);
      }
      catalog[keys[index]][entry.method] = { params: entry.params, ...(result ? { result } : {}), experimental: !stable.has(entry.method), jsonSchema: schema.has(entry.method) };
    }
    if ([...schema].some(method => !Object.hasOwn(catalog[keys[index]], method))) throw new Error(`Schema has an untyped ${direction} method.`);
  }

  await fs.mkdir(path.join(destination, 'generated'), { recursive: true });
  const previousManifest = await fs.readFile(path.join(destination, 'manifest.json'), 'utf8').then(JSON.parse, failure => {
    if (failure.code === 'ENOENT') return null;
    throw failure;
  });
  const typeManifest = [];
  for (const filename of typeFiles) {
    const content = await fs.readFile(path.join(scratch, 'types', filename));
    if (content.length > 2 * 1024 * 1024) throw new Error('Generated type file limit exceeded.');
    const target = path.join(destination, 'generated', filename);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content);
    typeManifest.push({ path: filename, bytes: content.length, sha256: digest(content) });
    if (path.basename(filename) !== 'index.ts') catalog.types.push(filename.slice(0, -3));
  }
  for (const prior of previousManifest?.typeFiles ?? []) {
    if (typeof prior.path !== 'string' || !/^(?:[A-Za-z0-9_]+\/)*[A-Za-z0-9_]+\.ts$/.test(prior.path)) throw new Error('Invalid old generation manifest.');
    if (!typeFiles.includes(prior.path)) await fs.unlink(path.join(destination, 'generated', prior.path)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  const schemaManifest = [];
  await fs.mkdir(path.join(destination, 'schema'), { recursive: true });
  for (const filename of ['codex_app_server_protocol.schemas.json', 'codex_app_server_protocol.v2.schemas.json']) {
    const content = await fs.readFile(path.join(scratch, 'schema', filename));
    await fs.writeFile(path.join(destination, 'schema', filename), content);
    schemaManifest.push({ path: filename, bytes: content.length, sha256: digest(content) });
  }
  const manifest = { formatVersion: 1, codexVersion: version, experimental: true, typeFiles: typeManifest, schemaFiles: schemaManifest,
    sha256: digest(JSON.stringify({ types: typeManifest, schema: schemaManifest })) };
  await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await fs.writeFile(path.join(destination, 'catalog.generated.ts'), header + `export const nativeProtocolCatalog = ${JSON.stringify(catalog, null, 2)} as const;\n`);
  const resultType = filename => `import('./generated/${filename}').${path.basename(filename)}`;
  const resultMap = (name, entries) => `export interface ${name} {\n` + Object.entries(entries)
    .map(([method, entry]) => `  ${JSON.stringify(method)}: ${resultType(entry.result)};`).join('\n') + '\n}\n';
  await fs.writeFile(path.join(destination, 'results.generated.ts'), header
    + resultMap('NativeResponseMap', catalog.clientRequests) + '\n' + resultMap('NativeServerResponseMap', catalog.serverRequests));
  process.stdout.write(`Codex ${version}: ${Object.keys(catalog.clientRequests).length} client requests, ${Object.keys(catalog.serverRequests).length} server requests, ${Object.keys(catalog.serverNotifications).length} notifications, ${catalog.types.length} types.\n`);
} finally { await fs.rm(scratch, { recursive: true, force: true }); }
