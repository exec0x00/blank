// Generate from an unfiltered `playwright test --list --reporter=json` report
// with CODEX_BROWSER_FRESH_PROCESS unset. This command never runs a browser.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const input = process.argv[2];
if (!input || process.argv.length !== 3) throw new Error('Usage: node tests/browser-manifest.mjs <unfiltered-playwright-list.json>');
const report = JSON.parse(readFileSync(input, 'utf8'));
if (report.errors?.length || report.config?.projects?.length !== 1 || report.config.projects[0].name !== '') throw new Error('Generate the manifest from the normal unnamed project without collection errors.');
const testDir = fileURLToPath(new URL('./e2e/', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const cases = [];
const identities = new Set();
function collect(suite, titlePath = []) {
  for (const spec of suite.specs ?? []) {
    const file = spec.file ?? suite.file;
    const test = spec.tests?.[0];
    if (spec.tests?.length !== 1 || test?.results?.length || test?.expectedStatus !== 'passed') throw new Error(`Expected one runnable, unexecuted test for ${file}: ${spec.title}.`);
    if (typeof file !== 'string' || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) throw new Error('Manifest files must be relative to tests/e2e.');
    const titles = [...titlePath, spec.title];
    const fullTitle = titles.join(' ');
    // Current tags are embedded in titles (@app). Explicitly declared tags
    // need their original suite position, which the JSON reporter omits.
    if ((spec.tags ?? []).some(tag => !fullTitle.split(/\s+/).includes(`@${String(tag).replace(/^@/, '')}`))) throw new Error(`Cannot reconstruct explicitly declared tags for ${file}: ${fullTitle}.`);
    const identity = JSON.stringify([file, titles]);
    if (identities.has(identity)) throw new Error(`Duplicate browser case: ${file}: ${fullTitle}.`);
    identities.add(identity);
    const label = path.basename(file).replace(/\.(?:spec|test)\.[^.]+$/, '').replace(/[^a-zA-Z0-9-]/g, '-');
    cases.push({ projectName: `case-${label}-${digest(identity).slice(0, 12)}`, file, titlePath: titles });
  }
  for (const child of suite.suites ?? []) collect(child, [...titlePath, ...(child.title ? [child.title] : [])]);
}
for (const suite of report.suites ?? []) collect(suite);
if (!cases.length) throw new Error('The browser inventory is empty.');

function testFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? testFiles(path.join(directory, entry.name), relative)
      : entry.isFile() && /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(entry.name) ? [relative] : [];
  }).sort();
}
const listedFiles = [...new Set(cases.map(item => item.file))].sort();
if (JSON.stringify(listedFiles) !== JSON.stringify(testFiles(testDir))) throw new Error('The report must include every browser spec; remove file, project, and grep filters.');
const files = listedFiles.map(file => ({ file, sha256: digest(readFileSync(path.join(testDir, file))) }));
const manifest = { version: 1, caseCount: cases.length, files, cases };
const output = new URL('./browser-cases.json', import.meta.url);
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${cases.length} exact browser cases across ${files.length} files to ${fileURLToPath(output)}.`);
