import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  collectReleaseIssues,
  getChangelogEntry,
  getBundleEntries,
  getTopChangelogVersion,
  resolveBundleDirName,
  validateReleaseTag,
} from "../scripts/lib/release.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runNodeScript(relativePath) {
  return spawnSync("node", [path.join(ROOT, relativePath)], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

test("release metadata is internally consistent for the checked-in repository", () => {
  const report = collectReleaseIssues(ROOT);
  assert.deepEqual(report.issues, []);
  assert.equal(report.packageJson.version, report.pluginJson.version);
});

test("release bundle includes the plugin root and the repository README", () => {
  const entries = getBundleEntries(ROOT);
  assert.deepEqual(
    entries.map((entry) => entry.to),
    [
      "LICENSE",
      "README.md",
      "NOTICE",
      "RELEASE.md",
      ".claude-plugin",
      "plugins/gemini",
    ],
  );
});

test("release helpers derive versions and tags consistently", () => {
  assert.equal(getTopChangelogVersion("# Changelog\n\n## 1.2.3\n"), "1.2.3");
  assert.equal(
    getChangelogEntry(
      "# Changelog\n\n## 1.2.3\n\n- shipped\n\n## 1.2.2\n",
      "1.2.3",
    ),
    "## 1.2.3\n\n- shipped",
  );
  assert.equal(validateReleaseTag("1.2.3", "v1.2.3"), null);
  assert.match(
    validateReleaseTag("1.2.3", "v1.2.4") ?? "",
    /does not match version/i,
  );
  assert.equal(resolveBundleDirName("1.2.3"), "gemini-cc-v1.2.3");
});

test("release bundle script writes tarball, checksum, and release notes", () => {
  const result = runNodeScript("scripts/release-bundle.mjs");
  assert.equal(result.status, 0, result.stderr);

  const version = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ).version;
  const bundleName = `gemini-cc-v${version}`;
  assert.equal(
    fs.existsSync(path.join(ROOT, "dist", "release", `${bundleName}.tar.gz`)),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(ROOT, "dist", "release", `${bundleName}.sha256`)),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(ROOT, "dist", "release", `${bundleName}.release-notes.md`),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(ROOT, "dist", "release", `${bundleName}.manifest.json`),
    ),
    true,
  );
});
