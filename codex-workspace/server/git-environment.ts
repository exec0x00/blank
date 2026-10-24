import path from 'node:path';

/** Trust one registered workspace whose canonical root the caller has already
 * validated. Git reads these as protected process configuration. Bucket-backed
 * files may have a different UID; no user/global Git config is modified.
 */
export function gitWorkspaceEnvironment(workspaceRoot: string): Record<string, string> {
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)
    || path.parse(workspaceRoot).root === workspaceRoot || path.resolve(workspaceRoot) !== workspaceRoot
    || /[\u0000-\u001f\u007f*]/.test(workspaceRoot)) {
    throw new Error('Git trust requires one exact, canonical workspace directory.');
  }
  return { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: workspaceRoot };
}
