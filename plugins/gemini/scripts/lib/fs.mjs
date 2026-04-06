import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * @fileoverview File system utility functions for reading, writing,
 * and manipulating files and directories.
 */

/**
 * Resolves a potentially relative path to an absolute path.
 *
 * @param {string} cwd - Current working directory
 * @param {string} maybePath - Path that may be relative or absolute
 * @returns {string} Absolute path
 */
export function ensureAbsolutePath(cwd, maybePath) {
  return path.isAbsolute(maybePath) ? maybePath : path.resolve(cwd, maybePath);
}

/**
 * Creates a temporary directory using mkdtemp.
 *
 * @param {string} [prefix="gemini-cc-"] - Directory name prefix
 * @returns {string} Path to created temporary directory
 */
export function createTempDir(prefix = "gemini-cc-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Reads and parses a JSON file.
 *
 * @param {string} filePath - Path to JSON file
 * @returns {*} Parsed JSON object
 */
export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * Writes a value as formatted JSON to a file.
 *
 * @param {string} filePath - Path to JSON file
 * @param {*} value - Value to serialize as JSON
 */
export function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Reads a file safely, returning empty string if it doesn't exist.
 *
 * @param {string} filePath - Path to file
 * @returns {string} File contents or empty string
 */
export function safeReadFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

/**
 * Checks if a buffer likely contains text data (not binary).
 * Returns false if any null byte is found in the first 4096 bytes.
 *
 * @param {Buffer} buffer - Buffer to check
 * @returns {boolean} True if buffer appears to be text
 */
export function isProbablyText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const value of sample) {
    if (value === 0) {
      return false;
    }
  }
  return true;
}

/**
 * Reads stdin if it is piped (not a TTY), otherwise returns empty string.
 *
 * @returns {string} Stdin contents or empty string
 */
export function readStdinIfPiped() {
  if (process.stdin.isTTY) {
    return "";
  }
  return fs.readFileSync(0, "utf8");
}
