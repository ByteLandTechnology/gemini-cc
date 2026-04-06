import { spawnSync } from "node:child_process";
import process from "node:process";

/**
 * @fileoverview Process management utilities for spawning and terminating processes.
 * Provides functions to run commands synchronously, check binary availability,
 * and terminate process trees across different platforms.
 */

/**
 * Runs a command synchronously and returns the result.
 *
 * @param {string} command - The command to execute
 * @param {string[]} [args=[]] - Command arguments
 * @param {object} [options={}] - Spawn options (cwd, env, input, stdio, shell, windowsHide)
 * @returns {object} Result with status, stdout, stderr, signal, and error
 */
export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    stdio: options.stdio ?? "pipe",
    shell: process.platform === "win32",
    windowsHide: true,
  });

  return {
    command,
    args,
    status: result.status ?? 0,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

/**
 * Runs a command and throws if it fails (non-zero exit or error).
 *
 * @param {string} command - The command to execute
 * @param {string[]} [args=[]] - Command arguments
 * @param {object} [options={}] - Spawn options
 * @returns {object} Result from runCommand
 * @throws {Error} If command exits non-zero or errors
 */
export function runCommandChecked(command, args = [], options = {}) {
  const result = runCommand(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return result;
}

/**
 * Checks if a binary is available and optionally verifies its version.
 *
 * @param {string} command - The binary name or path to check
 * @param {string[]} [versionArgs=["--version"]] - Args to pass to check version
 * @param {object} [options={}] - Spawn options
 * @returns {{available: boolean, detail: string}} Availability status and detail
 */
export function binaryAvailable(
  command,
  versionArgs = ["--version"],
  options = {},
) {
  const result = runCommand(command, versionArgs, options);
  if (
    result.error &&
    /** @type {NodeJS.ErrnoException} */ (result.error).code === "ENOENT"
  ) {
    return { available: false, detail: "not found" };
  }
  if (result.error) {
    return { available: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    const detail =
      result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    return { available: false, detail };
  }
  return {
    available: true,
    detail: result.stdout.trim() || result.stderr.trim() || "ok",
  };
}

function looksLikeMissingProcessMessage(text) {
  return /not found|no running instance|cannot find|does not exist|no such process/i.test(
    text,
  );
}

/**
 * Terminates a process and its children on Windows or sends SIGTERM to process group on Unix.
 *
 * @param {number} pid - Process ID to terminate
 * @param {object} [options={}] - Termination options
 * @param {string} [options.platform] - Override platform (darwin/linux/win32)
 * @param {string} [options.cwd] - Working directory for the kill command
 * @param {object} [options.env] - Environment variables for the kill command
 * @param {function} [options.runCommandImpl] - Override run command implementation
 * @param {function} [options.killImpl] - Override kill signal implementation
 * @returns {{attempted: boolean, delivered: boolean, method: string|null, result?: object}} Termination result
 */
export function terminateProcessTree(pid, options = {}) {
  if (!Number.isFinite(pid)) {
    return { attempted: false, delivered: false, method: null };
  }

  const platform = options.platform ?? process.platform;
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const killImpl = options.killImpl ?? process.kill.bind(process);

  if (platform === "win32") {
    const result = runCommandImpl(
      "taskkill",
      ["/PID", String(pid), "/T", "/F"],
      {
        cwd: options.cwd,
        env: options.env,
      },
    );

    if (!result.error && result.status === 0) {
      return { attempted: true, delivered: true, method: "taskkill", result };
    }

    const combinedOutput = `${result.stderr}\n${result.stdout}`.trim();
    if (!result.error && looksLikeMissingProcessMessage(combinedOutput)) {
      return { attempted: true, delivered: false, method: "taskkill", result };
    }

    if (result.error?.code === "ENOENT") {
      try {
        killImpl(pid);
        return { attempted: true, delivered: true, method: "kill" };
      } catch (error) {
        if (error?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "kill" };
        }
        throw error;
      }
    }

    if (result.error) {
      throw result.error;
    }

    throw new Error(formatCommandFailure(result));
  }

  try {
    killImpl(-pid, "SIGTERM");
    return { attempted: true, delivered: true, method: "process-group" };
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        killImpl(pid, "SIGTERM");
        return { attempted: true, delivered: true, method: "process" };
      } catch (innerError) {
        if (innerError?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "process" };
        }
        throw innerError;
      }
    }

    return { attempted: true, delivered: false, method: "process-group" };
  }
}

/**
 * Formats a command failure result into a human-readable error string.
 *
 * @param {object} result - Command result with command, args, status, signal, stderr, stdout
 * @returns {string} Formatted error message
 */
export function formatCommandFailure(result) {
  const parts = [`${result.command} ${result.args.join(" ")}`.trim()];
  if (result.signal) {
    parts.push(`signal=${result.signal}`);
  } else {
    parts.push(`exit=${result.status}`);
  }
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  if (stderr) {
    parts.push(stderr);
  } else if (stdout) {
    parts.push(stdout);
  }
  return parts.join(": ");
}
