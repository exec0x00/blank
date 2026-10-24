import type { Project } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface BrowserCase { projectName: string; file: string; titlePath: string[] }
interface BrowserManifest { version: number; caseCount: number; files: Array<{ file: string; sha256: string }>; cases: BrowserCase[] }
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function testFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? testFiles(path.join(directory, entry.name), relative)
      : entry.isFile() && /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(entry.name) ? [relative] : [];
  }).sort();
}

/** A project ID is part of Playwright's worker identity. One exact case per
 * project therefore gives each case a fresh real worker and Chromium process,
 * while the controller keeps the normal built HTTP backend alive. */
export function browserCaseProjects(): Project[] {
  if (process.argv.some(argument => argument.startsWith('--grep') || argument === '-g' || argument.startsWith('-g') && !argument.startsWith('--'))) throw new Error('Fresh-process browser runs use exact project selections. Use --project=<case ID>, not --grep.');
  const manifest = JSON.parse(readFileSync(new URL('./browser-cases.json', import.meta.url), 'utf8')) as BrowserManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.cases) || manifest.caseCount !== manifest.cases.length || !manifest.caseCount) throw new Error('The browser case manifest is invalid. Regenerate it from the complete normal --list JSON report.');
  const testDir = fileURLToPath(new URL('./e2e/', import.meta.url));
  const registeredFiles = manifest.files.map(item => item.file).sort();
  if (JSON.stringify(registeredFiles) !== JSON.stringify(testFiles(testDir))) throw new Error('Browser spec files changed. Regenerate tests/browser-cases.json from the complete normal --list JSON report.');
  for (const entry of manifest.files) {
    const actual = createHash('sha256').update(readFileSync(path.join(testDir, entry.file))).digest('hex');
    if (actual !== entry.sha256) throw new Error(`${entry.file} changed. Regenerate tests/browser-cases.json before a fresh-process browser run.`);
  }
  const names = new Set<string>();
  const identities = new Set<string>();
  return manifest.cases.map(entry => {
    const identity = JSON.stringify([entry.file, entry.titlePath]);
    if (names.has(entry.projectName) || identities.has(identity) || !registeredFiles.includes(entry.file) || !entry.titlePath.length) throw new Error('The browser manifest contains a duplicate or invalid case.');
    names.add(entry.projectName); identities.add(identity);
    return {
      name: entry.projectName,
      testMatch: new RegExp(`(?:^|[\\\\/])${entry.file.split('/').map(escapePattern).join('[\\\\/]')}$`),
      grep: new RegExp(`^\\s*${escapePattern([entry.projectName, entry.file, ...entry.titlePath].join(' '))}$`),
    };
  });
}
