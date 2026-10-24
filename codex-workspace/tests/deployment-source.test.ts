import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const directories: string[] = [];
const required = ['app.py', 'requirements.txt', 'packages.txt', 'README.md', 'package-lock.json', 'server/index.ts', 'index.html'];
async function validate(contents: Uint8Array | string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'arc-source-validation-')); directories.push(directory);
  for (const filename of [...required, 'upstream/reference.tar.gz']) await mkdir(path.dirname(path.join(directory, filename)), { recursive: true });
  for (const filename of required) await writeFile(path.join(directory, filename), 'source fixture');
  await writeFile(path.join(directory, 'upstream/reference.tar.gz'), contents);
  // Execute the actual validation function without loading Hub networking or
  // requiring deployment credentials in the test environment.
  const script = `import ast,json,os,re,sys
from pathlib import Path
tree=ast.parse(Path(sys.argv[1]).read_text())
function=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='validate_source')
root=Path(sys.argv[2])
scope={'ROOT':root,'os':os,'re':re,'source_files':lambda:list(root.rglob('*.*'))}
exec(compile(ast.Module(body=[function],type_ignores=[]),sys.argv[1],'exec'),scope)
try:
 scope['validate_source']('test-only-deployment-credential',None)
 print(json.dumps({'accepted':True}))
except ValueError as error:print(json.dumps({'accepted':False,'error':str(error)}))
`;
  const result = await execute('python3', ['-c', script, path.resolve('scripts/deploy.py'), directory]);
  return JSON.parse(result.stdout) as { accepted: boolean; error?: string };
}

afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
describe('deployment source integrity', () => {
  it.each(['\n', '\r\n'])('rejects an unresolved LFS archive before upload (%j line endings)', async newline => {
    const pointer = ['version https://git-lfs.github.com/spec/v1', 'oid sha256:' + 'a'.repeat(64), 'size 15527826', ''].join(newline);
    expect(await validate(pointer)).toEqual({ accepted: false,
      error: 'Unresolved Git LFS pointer in upstream/reference.tar.gz; fetch and verify the actual file before publishing.' });
  });
  it('accepts materialized binary content and keeps deployment secret scanning active', async () => {
    expect(await validate(new Uint8Array([31, 139, 8, 0, 1, 2, 3, 4]))).toEqual({ accepted: true });
    expect(await validate('test-only-deployment-credential')).toEqual({ accepted: false,
      error: 'A deployment secret occurs in upstream/reference.tar.gz; upload stopped.' });
  });
});
