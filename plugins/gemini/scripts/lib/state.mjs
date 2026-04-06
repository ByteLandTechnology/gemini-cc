import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveWorkspaceRoot } from "./workspace.mjs";

/**
 * @fileoverview Persistent state management for Gemini Companion jobs.
 * Handles saving, loading, and pruning job state, configuration, and artifacts.
 */

const STATE_VERSION = 1;
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "gemini-companion");
const STATE_FILE_NAME = "state.json";
const JOBS_DIR_NAME = "jobs";
const MAX_JOBS = 50;

/**
 * @returns {string} Current ISO timestamp
 */
function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    version: STATE_VERSION,
    config: {
      stopReviewGate: false,
      defaultModel: null,
    },
    jobs: [],
  };
}

/**
 * Resolves the state directory for a given workspace.
 * Uses CLAUDE_PLUGIN_DATA env var or falls back to a temp directory.
 * The directory name includes a slug and hash to ensure uniqueness.
 *
 * @param {string} cwd - Current working directory
 * @returns {string} Resolved state directory path
 */
export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonicalWorkspaceRoot = workspaceRoot;
  try {
    canonicalWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  } catch {
    canonicalWorkspaceRoot = workspaceRoot;
  }

  const slugSource = path.basename(workspaceRoot) || "workspace";
  const slug =
    slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "workspace";
  const hash = createHash("sha256")
    .update(canonicalWorkspaceRoot)
    .digest("hex")
    .slice(0, 16);
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  const stateRoot = pluginDataDir
    ? path.join(pluginDataDir, "state")
    : FALLBACK_STATE_ROOT_DIR;
  return path.join(stateRoot, `${slug}-${hash}`);
}

/**
 * Resolves the path to the state.json file for a workspace.
 *
 * @param {string} cwd - Current working directory
 * @returns {string} Path to state.json file
 */
export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), STATE_FILE_NAME);
}

/**
 * Resolves the path to the jobs directory for a workspace.
 *
 * @param {string} cwd - Current working directory
 * @returns {string} Path to jobs directory
 */
export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), JOBS_DIR_NAME);
}

/**
 * Ensures the state directory and jobs subdirectory exist, creating them if necessary.
 *
 * @param {string} cwd - Current working directory
 */
export function ensureStateDir(cwd) {
  fs.mkdirSync(resolveJobsDir(cwd), { recursive: true });
}

/**
 * Loads the persisted state from state.json, or returns a default state if none exists.
 * Handles migration of older state versions and corrupted JSON.
 *
 * @param {string} cwd - Current working directory
 * @returns {object} Loaded or default state object
 */
export function loadState(cwd) {
  const stateFile = resolveStateFile(cwd);
  if (!fs.existsSync(stateFile)) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      config: {
        ...defaultState().config,
        ...(parsed.config ?? {}),
      },
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  } catch {
    return defaultState();
  }
}

function pruneJobs(jobs) {
  return [...jobs]
    .sort((left, right) =>
      String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")),
    )
    .slice(0, MAX_JOBS);
}

function removeFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Saves state to state.json, pruning old jobs beyond MAX_JOBS limit.
 * Removes orphaned job files and log files for dropped jobs.
 *
 * @param {string} cwd - Current working directory
 * @param {object} state - State object to save
 * @returns {object} The saved state
 */
export function saveState(cwd, state) {
  const previousJobs = loadState(cwd).jobs;
  ensureStateDir(cwd);
  const nextJobs = pruneJobs(state.jobs ?? []);
  const nextState = {
    version: STATE_VERSION,
    config: {
      ...defaultState().config,
      ...(state.config ?? {}),
    },
    jobs: nextJobs,
  };

  const retainedIds = new Set(nextJobs.map((job) => job.id));
  for (const job of previousJobs) {
    if (retainedIds.has(job.id)) {
      continue;
    }
    removeJobFile(resolveJobFile(cwd, job.id));
    removeFileIfExists(job.logFile);
  }

  fs.writeFileSync(
    resolveStateFile(cwd),
    `${JSON.stringify(nextState, null, 2)}\n`,
    "utf8",
  );
  return nextState;
}

/**
 * Loads state, applies a mutation function, and saves the result.
 * Provides an atomic load-mutate-save pattern.
 *
 * @param {string} cwd - Current working directory
 * @param {function} mutate - Function to mutate the state object
 * @returns {object} The saved state after mutation
 */
export function updateState(cwd, mutate) {
  const state = loadState(cwd);
  mutate(state);
  return saveState(cwd, state);
}

/**
 * Generates a unique job ID with format: prefix-timestamp-random.
 *
 * @param {string} [prefix="job"] - Prefix for the job ID
 * @returns {string} Generated unique job ID
 */
export function generateJobId(prefix = "job") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/**
 * Creates or updates a job in the state.
 * If job with same ID exists, merges the patch; otherwise inserts new job.
 *
 * @param {string} cwd - Current working directory
 * @param {object} jobPatch - Job fields to upsert
 * @returns {object} Updated state
 */
export function upsertJob(cwd, jobPatch) {
  return updateState(cwd, (state) => {
    const timestamp = nowIso();
    const existingIndex = state.jobs.findIndex((job) => job.id === jobPatch.id);
    if (existingIndex === -1) {
      state.jobs.unshift({
        createdAt: timestamp,
        updatedAt: timestamp,
        ...jobPatch,
      });
      return;
    }
    state.jobs[existingIndex] = {
      ...state.jobs[existingIndex],
      ...jobPatch,
      updatedAt: timestamp,
    };
  });
}

/**
 * Lists all jobs in the state, newest first.
 *
 * @param {string} cwd - Current working directory
 * @returns {object[]} Array of job objects
 */
export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

/**
 * Sets a configuration value in the state.
 *
 * @param {string} cwd - Current working directory
 * @param {string} key - Configuration key
 * @param {*} value - Configuration value
 * @returns {object} Updated state
 */
export function setConfig(cwd, key, value) {
  return updateState(cwd, (state) => {
    state.config = {
      ...state.config,
      [key]: value,
    };
  });
}

/**
 * Gets the full configuration object from state.
 *
 * @param {string} cwd - Current working directory
 * @returns {object} Configuration object
 */
export function getConfig(cwd) {
  return loadState(cwd).config;
}

/**
 * Writes a job's full payload to its individual JSON file.
 *
 * @param {string} cwd - Current working directory
 * @param {string} jobId - Job ID
 * @param {object} payload - Job payload to store
 * @returns {string} Path to the written job file
 */
export function writeJobFile(cwd, jobId, payload) {
  ensureStateDir(cwd);
  const jobFile = resolveJobFile(cwd, jobId);
  fs.writeFileSync(jobFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return jobFile;
}

/**
 * Reads and parses a job file from disk.
 *
 * @param {string} jobFile - Path to job file
 * @returns {object} Parsed job object
 */
export function readJobFile(jobFile) {
  return JSON.parse(fs.readFileSync(jobFile, "utf8"));
}

function removeJobFile(jobFile) {
  if (fs.existsSync(jobFile)) {
    fs.unlinkSync(jobFile);
  }
}

/**
 * Resolves the path to a job's log file.
 *
 * @param {string} cwd - Current working directory
 * @param {string} jobId - Job ID
 * @returns {string} Path to job log file
 */
export function resolveJobLogFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.log`);
}

/**
 * Resolves the path to a job's JSON file.
 *
 * @param {string} cwd - Current working directory
 * @param {string} jobId - Job ID
 * @returns {string} Path to job JSON file
 */
export function resolveJobFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}
