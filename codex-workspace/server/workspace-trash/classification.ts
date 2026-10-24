import path from 'node:path';
import type { Workspace } from '../../shared/types';
import type { AppConfig } from '../config';
import { HttpError } from '../errors';
import { checkedDirectory, errno, lstatMaybe, readText } from './filesystem';
import { runGit } from '../git';

export const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

function uncertain(): never {
  throw new HttpError(409, 'The repository’s local remote configuration could not be verified safely. Fix its configuration before deleting the workspace.', 'WORKSPACE_REPOSITORY_UNVERIFIED');
}

/** Parse ordinary local Git config values without executing Git, helpers, hooks or includes. */
function configValue(input: string): string {
  let quoted = false;
  let result = '';
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && (char === '#' || char === ';')) break;
    if (char !== '\\') { result += char; continue; }
    const escaped = input[++index];
    if (escaped === '\\' || escaped === '"') result += escaped;
    else if (escaped === 'n') result += '\n';
    else if (escaped === 't') result += '\t';
    else if (escaped === 'b') result += '\b';
    else uncertain();
  }
  if (quoted) uncertain();
  return result.trim();
}

function githubRemote(value: string): boolean {
  if (!value || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) uncertain();
  const scp = value.match(/^(?:[^@/:]+@)?(github\.com|ssh\.github\.com):([^?#]+)$/i);
  if (scp) return GITHUB_REPOSITORY.test(scp[2].replace(/\.git\/?$/, '').replace(/\/$/, ''));
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { return false; }
  if (!['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol)
    || !['github.com', 'ssh.github.com'].includes(parsed.hostname.toLowerCase()) || parsed.search || parsed.hash) return false;
  const repository = parsed.pathname.replace(/^\//, '').replace(/\.git\/?$/, '').replace(/\/$/, '');
  return GITHUB_REPOSITORY.test(repository);
}

/** Account selection is deliberately irrelevant to deletion policy. */
export async function isGithubWorkspace(config: AppConfig, workspace: Workspace): Promise<boolean> {
  if (workspace.source?.kind === 'github') {
    if (!GITHUB_REPOSITORY.test(workspace.source.fullName)) uncertain();
    return true;
  }
  const git = path.join(workspace.path, '.git');
  const stat = await lstatMaybe(git);
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink()) uncertain();
  await checkedDirectory(config.workspacesDir, git);
  let contents: string;
  try { contents = await readText(path.join(git, 'config'), 256 * 1024); }
  catch (error) { if (errno(error, 'ENOENT')) uncertain(); throw error; }
  let remote = false;
  let github = false;
  for (const line of contents.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#') || clean.startsWith(';')) continue;
    if (clean.startsWith('[')) {
      if (/^\[\s*(?:include|includeIf|url)\b/i.test(clean)) uncertain();
      const section = clean.match(/^\[\s*([A-Za-z0-9-]+)(?:\s+"((?:[^"\\]|\\.)*)"|\.([^\]\s]+))?\s*\]\s*(?:[#;].*)?$/);
      if (!section) uncertain();
      // A bare [remote] is not a named remote. Git also supports the older
      // [remote.origin] spelling, so do not silently miss that real remote.
      remote = section[1].toLowerCase() === 'remote' && !!(section[2] ?? section[3]);
      continue;
    }
    const assignment = clean.match(/^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/);
    if (!assignment) uncertain();
    if (remote && assignment[1].toLowerCase() === 'url') github ||= githubRemote(configValue(assignment[2] ?? ''));
  }
  if (github) {
    try {
      const result = await runGit(workspace.path, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'], { timeout: 10_000, outputLimit: 16 * 1024 });
      const locations = result.stdout.toString('utf8').trim().split(/\r?\n/);
      if (locations.length !== 3 || locations[0] !== workspace.path || locations[1] !== git || locations[2] !== git) uncertain();
    } catch { uncertain(); }
  }
  return github;
}
