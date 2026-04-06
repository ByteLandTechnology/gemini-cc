import { ensureGitRepository } from "./git.mjs";

/**
 * @fileoverview Workspace resolution utilities.
 */

/**
 * Resolves the workspace root directory, falling back to cwd if not a git repo.
 *
 * @param {string} cwd - Current working directory
 * @returns {string} Workspace root directory
 */
export function resolveWorkspaceRoot(cwd) {
  try {
    return ensureGitRepository(cwd);
  } catch {
    return cwd;
  }
}
