import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const headerNames = ['node_api.h', 'node_api_types.h', 'js_native_api.h', 'js_native_api_types.h'];
const digest = data => createHash('sha256').update(data).digest('hex');

async function compile() {
  if (process.platform !== 'linux') throw new Error('The native atomic rename binding requires Linux. No unsafe publication fallback is available.');
  const executable = await fs.realpath(process.execPath);
  let include;
  for (const candidate of [path.resolve(path.dirname(executable), '../include/node'), '/usr/local/include/node', '/usr/include/node', '/usr/include/nodejs/src']) {
    try { await Promise.all(headerNames.map(name => fs.access(path.join(candidate, name), constants.R_OK))); include = candidate; break; }
    catch { /* Try an existing system Node-API header directory; never download. */ }
  }
  if (!include) throw new Error('Existing Node-API headers were not found; install the local Node development headers before building.');
  let compiler;
  for (const entry of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.resolve(entry, 'cc');
    try { await fs.access(candidate, constants.X_OK); compiler = await fs.realpath(candidate); break; }
    catch { /* Use only the normal, fixed C compiler name, without a shell. */ }
  }
  if (!compiler) throw new Error('The existing C compiler (cc) was not found.');
  const source = path.join(root, 'native/atomic-rename/atomic-rename.c');
  const flags = ['-std=c11', '-O2', '-fPIC', '-shared', '-Wall', '-Wextra', '-Werror', '-fvisibility=hidden',
    '-fstack-protector-strong', '-D_FORTIFY_SOURCE=2', '-DNAPI_VERSION=8', '-Wl,-z,relro,-z,now,-z,noexecstack'];
  const compilerStat = await fs.stat(compiler, { bigint: true });
  const fingerprint = createHash('sha256').update(JSON.stringify({ schema: 1, node: process.version, napi: process.versions.napi,
    platform: process.platform, arch: process.arch, executable, compiler, compilerStat: `${compilerStat.dev}:${compilerStat.ino}:${compilerStat.size}:${compilerStat.mtimeNs}`, flags }));
  const inputPaths = [fileURLToPath(import.meta.url), source, ...headerNames.map(name => path.join(include, name))];
  const inputBytes = await Promise.all(inputPaths.map(file => fs.readFile(file)));
  for (let index = 0; index < inputPaths.length; index++) fingerprint.update(JSON.stringify({ file: inputPaths[index], sha256: digest(inputBytes[index]) }));
  const identity = fingerprint.digest('hex');
  const directory = path.join(root, 'dist/native'), binary = path.join(directory, 'atomic-rename.node'), manifest = path.join(directory, 'atomic-rename.build.json');
  await fs.mkdir(directory, { recursive: true });
  try {
    const [metadataStat, binaryStat] = await Promise.all([fs.lstat(manifest), fs.lstat(binary)]);
    if (metadataStat.isFile() && !metadataStat.isSymbolicLink() && metadataStat.size <= 2048
      && binaryStat.isFile() && !binaryStat.isSymbolicLink() && binaryStat.size <= 4 * 1024 * 1024) {
      const metadata = JSON.parse(await fs.readFile(manifest, 'utf8'));
      if (metadata.fingerprint === identity && metadata.binarySha256 === digest(await fs.readFile(binary))) {
        console.log('Native atomic rename binding is current.'); return;
      }
    }
  } catch { /* Missing, stale, or malformed build artifacts must be rebuilt. */ }
  const temporary = await fs.mkdtemp(path.join(directory, '.atomic-rename-build-'));
  try {
    const output = path.join(temporary, 'atomic-rename.node');
    const snapshotInclude = path.join(temporary, 'include'), snapshotSource = path.join(temporary, 'atomic-rename.c');
    await fs.mkdir(snapshotInclude, { mode: 0o700 });
    // Compile exactly the bytes fingerprinted above. Concurrent edits to the
    // working source/headers cannot pair one input identity with another binary.
    await Promise.all([
      fs.writeFile(snapshotSource, inputBytes[1], { flag: 'wx', mode: 0o600 }),
      ...headerNames.map((name, index) => fs.writeFile(path.join(snapshotInclude, name), inputBytes[index + 2], { flag: 'wx', mode: 0o600 })),
    ]);
    await new Promise((resolve, reject) => {
      const child = spawn(compiler, [...flags, '-I', snapshotInclude, snapshotSource, '-o', output], { cwd: root, stdio: 'inherit', shell: false });
      const deadline = setTimeout(() => child.kill('SIGKILL'), 30_000);
      child.once('error', error => { clearTimeout(deadline); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(deadline); if (code === 0) resolve(); else reject(new Error(`Native compilation failed (${signal ?? code}).`)); });
    });
    await fs.chmod(output, 0o644);
    const metadata = JSON.stringify({ version: 1, fingerprint: identity, binarySha256: digest(await fs.readFile(output)) }) + '\n';
    const preparedManifest = path.join(temporary, 'manifest.json');
    await fs.writeFile(preparedManifest, metadata, { flag: 'wx', mode: 0o644 });
    await fs.rename(output, binary);
    await fs.rename(preparedManifest, manifest);
    console.log('Built native atomic rename binding.');
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

try { await compile(); }
catch (error) { console.error(error instanceof Error ? error.message : 'Native atomic rename build failed.'); process.exitCode = 1; }
