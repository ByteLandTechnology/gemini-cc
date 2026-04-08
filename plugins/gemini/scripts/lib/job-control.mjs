import fs from "node:fs";

import { getSessionRuntimeStatus } from "./gemini.mjs";
import { getConfig, listJobs, readJobFile, resolveJobFile } from "./state.mjs";
import { SESSION_ID_ENV } from "./tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

/**
 * @fileoverview Job control and status reporting utilities.
 * Provides functions to query, filter, enrich, and render job status information.
 */

export const DEFAULT_MAX_STATUS_JOBS = 8;
export const DEFAULT_MAX_PROGRESS_LINES = 4;

/**
 * Sorts jobs by updatedAt descending (newest first).
 *
 * @param {object[]} jobs - Array of job objects
 * @returns {object[]} Sorted jobs array
 */
export function sortJobsNewestFirst(jobs) {
  return [...jobs].sort((left, right) =>
    String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")),
  );
}

function getCurrentSessionId(options = {}) {
  return options.env?.[SESSION_ID_ENV] ?? process.env[SESSION_ID_ENV] ?? null;
}

function filterJobsForCurrentSession(jobs, options = {}) {
  const sessionId = getCurrentSessionId(options);
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}

function getJobTypeLabel(job) {
  if (typeof job.kindLabel === "string" && job.kindLabel) {
    return job.kindLabel;
  }
  if (job.kind === "adversarial-review") {
    return "adversarial-review";
  }
  if (job.jobClass === "review") {
    return "review";
  }
  if (job.jobClass === "task") {
    return "rescue";
  }
  if (job.kind === "review") {
    return "review";
  }
  if (job.kind === "task") {
    return "rescue";
  }
  return "job";
}

function stripLogPrefix(line) {
  return line.replace(/^\[[^\]]+\]\s*/, "").trim();
}

function isProgressBlockTitle(line) {
  return (
    [
      "Final output",
      "Assistant message",
      "Reasoning summary",
      "Review output",
    ].includes(line) ||
    /^Subagent .+ message$/.test(line) ||
    /^Subagent .+ reasoning summary$/.test(line)
  );
}

/**
 * Reads the last N lines of a job's log file for progress preview.
 * Filters out empty lines, progress block titles, and log prefixes.
 *
 * @param {string|null} logFile - Path to log file
 * @param {number} [maxLines=DEFAULT_MAX_PROGRESS_LINES] - Max lines to return
 * @returns {string[]} Array of preview lines
 */
export function readJobProgressPreview(
  logFile,
  maxLines = DEFAULT_MAX_PROGRESS_LINES,
) {
  if (!logFile || !fs.existsSync(logFile)) {
    return [];
  }

  const lines = fs
    .readFileSync(logFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => line.startsWith("["))
    .map(stripLogPrefix)
    .filter((line) => line && !isProgressBlockTitle(line));

  return lines.slice(-maxLines);
}

function formatElapsedDuration(startValue, endValue = null) {
  const start = Date.parse(startValue ?? "");
  if (!Number.isFinite(start)) {
    return null;
  }

  const end = endValue ? Date.parse(endValue) : Date.now();
  if (!Number.isFinite(end) || end < start) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function looksLikeVerificationCommand(line) {
  return /\b(test|tests|lint|build|typecheck|type-check|check|verify|validate|pytest|jest|vitest|cargo test|npm test|pnpm test|yarn test|go test|mvn test|gradle test|tsc|eslint|ruff)\b/i.test(
    line,
  );
}

function inferLegacyJobPhase(job, progressPreview = []) {
  switch (job.status) {
    case "queued":
      return "queued";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "completed":
      return "done";
    default:
      break;
  }

  for (let index = progressPreview.length - 1; index >= 0; index -= 1) {
    const line = progressPreview[index].toLowerCase();
    if (
      line.startsWith("starting gemini") ||
      line.startsWith("thread ready") ||
      line.startsWith("session ready") ||
      line.startsWith("turn started")
    ) {
      return "starting";
    }
    if (line.startsWith("reviewer started") || line.includes("review mode")) {
      return "reviewing";
    }
    if (
      line.startsWith("searching:") ||
      line.startsWith("calling ") ||
      line.startsWith("running tool:")
    ) {
      return "investigating";
    }
    if (line.startsWith("starting collaboration tool:")) {
      return "investigating";
    }
    if (line.startsWith("running command:")) {
      return looksLikeVerificationCommand(line)
        ? "verifying"
        : job.jobClass === "review"
          ? "reviewing"
          : "investigating";
    }
    if (line.startsWith("command completed:")) {
      return looksLikeVerificationCommand(line) ? "verifying" : "running";
    }
    if (line.startsWith("applying ") || line.startsWith("file changes ")) {
      return "editing";
    }
    if (line.startsWith("turn completed")) {
      return "finalizing";
    }
    if (line.startsWith("gemini error:") || line.startsWith("failed:")) {
      return "failed";
    }
  }

  return job.jobClass === "review" ? "reviewing" : "running";
}

/**
 * Enriches a job object with derived fields like kindLabel, progressPreview,
 * elapsed time, duration, and inferred phase.
 *
 * @param {object} job - Job object to enrich
 * @param {object} [options={}] - Enrichment options
 * @param {number} [options.maxProgressLines] - Max progress preview lines
 * @returns {object} Enriched job object
 */
export function enrichJob(job, options = {}) {
  const maxProgressLines =
    options.maxProgressLines ?? DEFAULT_MAX_PROGRESS_LINES;
  const enriched = {
    ...job,
    kindLabel: getJobTypeLabel(job),
    progressPreview:
      job.status === "queued" ||
      job.status === "running" ||
      job.status === "failed"
        ? readJobProgressPreview(job.logFile, maxProgressLines)
        : [],
    elapsed: formatElapsedDuration(
      job.startedAt ?? job.createdAt,
      job.completedAt ?? null,
    ),
    duration:
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled"
        ? formatElapsedDuration(
            job.startedAt ?? job.createdAt,
            job.completedAt ?? job.updatedAt,
          )
        : null,
  };

  return {
    ...enriched,
    phase:
      enriched.phase ?? inferLegacyJobPhase(enriched, enriched.progressPreview),
  };
}

/**
 * Reads a stored job by ID from the workspace.
 *
 * @param {string} workspaceRoot - Workspace root directory
 * @param {string} jobId - Job ID to look up
 * @returns {object|null} Job object or null if not found
 */
export function readStoredJob(workspaceRoot, jobId) {
  const jobFile = resolveJobFile(workspaceRoot, jobId);
  if (!fs.existsSync(jobFile)) {
    return null;
  }
  return readJobFile(jobFile);
}

function matchJobReference(jobs, reference, predicate = () => true) {
  const filtered = jobs.filter(predicate);
  if (!reference) {
    return filtered[0] ?? null;
  }

  const exact = filtered.find((job) => job.id === reference);
  if (exact) {
    return exact;
  }

  const prefixMatches = filtered.filter((job) => job.id.startsWith(reference));
  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }
  if (prefixMatches.length > 1) {
    throw new Error(
      `Job reference "${reference}" is ambiguous. Use a longer job id.`,
    );
  }

  throw new Error(
    `No job found for "${reference}". Run /gemini:status to list known jobs.`,
  );
}

/**
 * Builds a comprehensive status snapshot for a workspace.
 * Includes running jobs, latest finished job, recent jobs, and config.
 *
 * @param {string} cwd - Current working directory
 * @param {object} [options={}] - Snapshot options
 * @param {boolean} [options.all] - Include all jobs, not just recent
 * @param {number} [options.maxJobs] - Maximum recent jobs to return
 * @param {number} [options.maxProgressLines] - Max progress preview lines per job
 * @param {object} [options.env] - Environment variables
 * @returns {object} Status snapshot
 */
export function buildStatusSnapshot(cwd, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = getConfig(workspaceRoot);
  const jobs = sortJobsNewestFirst(
    filterJobsForCurrentSession(listJobs(workspaceRoot), options),
  );
  const maxJobs = options.maxJobs ?? DEFAULT_MAX_STATUS_JOBS;
  const maxProgressLines =
    options.maxProgressLines ?? DEFAULT_MAX_PROGRESS_LINES;

  const running = jobs
    .filter((job) => job.status === "queued" || job.status === "running")
    .map((job) => enrichJob(job, { maxProgressLines }));

  const latestFinishedRaw =
    jobs.find((job) => job.status !== "queued" && job.status !== "running") ??
    null;
  const latestFinished = latestFinishedRaw
    ? enrichJob(latestFinishedRaw, { maxProgressLines })
    : null;

  const recent = (options.all ? jobs : jobs.slice(0, maxJobs))
    .filter(
      (job) =>
        job.status !== "queued" &&
        job.status !== "running" &&
        job.id !== latestFinished?.id,
    )
    .map((job) => enrichJob(job, { maxProgressLines }));

  return {
    workspaceRoot,
    config,
    sessionRuntime: getSessionRuntimeStatus(options.env),
    running,
    latestFinished,
    recent,
    needsReview: Boolean(config.stopReviewGate),
  };
}

/**
 * Builds a snapshot for a single specific job by reference (ID or prefix).
 *
 * @param {string} cwd - Current working directory
 * @param {string} reference - Job ID or prefix to match
 * @param {object} [options={}] - Snapshot options
 * @returns {object} Single job snapshot
 * @throws {Error} If no job or multiple jobs match the reference
 */
export function buildSingleJobSnapshot(cwd, reference, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  const selected = matchJobReference(jobs, reference);
  if (!selected) {
    throw new Error(
      `No job found for "${reference}". Run /gemini:status to inspect known jobs.`,
    );
  }

  return {
    workspaceRoot,
    job: enrichJob(selected, { maxProgressLines: options.maxProgressLines }),
  };
}

/**
 * Resolves a finished (completed/failed/cancelled) job by reference.
 * Throws if job is still running or not found.
 *
 * @param {string} cwd - Current working directory
 * @param {string} [reference] - Job ID or prefix to match
 * @returns {{workspaceRoot: string, job: object}} Resolved job
 * @throws {Error} If job is active, not found, or ambiguous
 */
export function resolveResultJob(cwd, reference) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(
    reference
      ? listJobs(workspaceRoot)
      : filterJobsForCurrentSession(listJobs(workspaceRoot)),
  );
  const selected = matchJobReference(
    jobs,
    reference,
    (job) =>
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled",
  );

  if (selected) {
    return { workspaceRoot, job: selected };
  }

  const active = matchJobReference(
    jobs,
    reference,
    (job) => job.status === "queued" || job.status === "running",
  );
  if (active) {
    throw new Error(
      `Job ${active.id} is still ${active.status}. Check /gemini:status and try again once it finishes.`,
    );
  }

  if (reference) {
    throw new Error(
      `No finished job found for "${reference}". Run /gemini:status to inspect active jobs.`,
    );
  }

  throw new Error("No finished Gemini jobs found for this repository yet.");
}

/**
 * Resolves an active (queued/running) job that can be cancelled.
 *
 * @param {string} cwd - Current working directory
 * @param {string} [reference] - Job ID or prefix to match
 * @returns {{workspaceRoot: string, job: object}} Cancelable job
 * @throws {Error} If no active jobs or reference is ambiguous
 */
export function resolveCancelableJob(cwd, reference) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  const activeJobs = jobs.filter(
    (job) => job.status === "queued" || job.status === "running",
  );

  if (reference) {
    const selected = matchJobReference(activeJobs, reference);
    if (!selected) {
      throw new Error(`No active job found for "${reference}".`);
    }
    return { workspaceRoot, job: selected };
  }

  if (activeJobs.length === 1) {
    return { workspaceRoot, job: activeJobs[0] };
  }
  if (activeJobs.length > 1) {
    throw new Error(
      "Multiple Gemini jobs are active. Pass a job id to /gemini:cancel.",
    );
  }

  throw new Error("No active Gemini jobs to cancel.");
}

/**
 * Resolves the best job to tail based on an explicit reference or the latest
 * current-session job with a log file, preferring active jobs first.
 *
 * @param {string} cwd - Current working directory
 * @param {string} [reference] - Optional job ID or prefix
 * @param {object} [options={}] - Resolution options
 * @param {object} [options.env] - Environment variables used for session filtering
 * @returns {{workspaceRoot: string, job: object}} Tail target job
 * @throws {Error} If no matching job with a log file can be found
 */
export function resolveTailJob(cwd, reference, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(
    reference
      ? listJobs(workspaceRoot)
      : filterJobsForCurrentSession(listJobs(workspaceRoot), options),
  );
  const loggedJobs = jobs.filter(
    (job) => typeof job.logFile === "string" && job.logFile.trim(),
  );

  if (reference) {
    const selected = matchJobReference(loggedJobs, reference);
    if (!selected) {
      throw new Error(`No job with a log file found for "${reference}".`);
    }
    return { workspaceRoot, job: selected };
  }

  const active = loggedJobs.find(
    (job) => job.status === "queued" || job.status === "running",
  );
  if (active) {
    return { workspaceRoot, job: active };
  }

  if (loggedJobs.length > 0) {
    return { workspaceRoot, job: loggedJobs[0] };
  }

  throw new Error("No Gemini job logs found for this repository yet.");
}
