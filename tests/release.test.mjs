import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildChangelogEntry,
  bumpVersion,
  collectReleaseIssues,
  determineReleaseBump,
  getChangelogEntry,
  getBundleEntries,
  getTopChangelogVersion,
  parseConventionalCommit,
  prepareRelease,
  resolveBundleDirName,
  validateReleaseTag,
} from "../scripts/lib/release.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runNodeScript(relativePath, args = [], options = {}) {
  return spawnSync("node", [path.join(ROOT, relativePath), ...args], {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    env: options.env,
  });
}

function createReleaseFixture() {
  const repo = makeTempDir("gemini-release-fixture-");
  initGitRepo(repo);

  fs.mkdirSync(path.join(repo, "plugins", "gemini", ".claude-plugin"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(repo, ".claude-plugin"), { recursive: true });

  fs.writeFileSync(
    path.join(repo, "package.json"),
    `${JSON.stringify(
      {
        name: "@byteland/gemini-cc",
        version: "1.0.0",
        private: true,
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(repo, "plugins", "gemini", ".claude-plugin", "plugin.json"),
    `${JSON.stringify(
      {
        name: "gemini",
        version: "1.0.0",
        description:
          "Use Gemini from Claude Code to review code or delegate tasks.",
        license: "Apache-2.0",
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(repo, ".claude-plugin", "marketplace.json"),
    `${JSON.stringify(
      {
        name: "gemini-cc",
        metadata: {
          description: "Gemini-backed Claude Code plugin marketplace.",
          version: "1.0.0",
        },
        owner: {
          name: "ByteLand Technology Limited",
        },
        plugins: [
          {
            name: "gemini",
            source: "./plugins/gemini",
            version: "1.0.0",
            description:
              "Use Gemini from Claude Code to review code or delegate tasks.",
            license: "Apache-2.0",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(repo, "plugins", "gemini", "CHANGELOG.md"),
    "# Changelog\n\n## 1.0.0\n\n- Initial release.\n",
  );
  fs.writeFileSync(
    path.join(repo, "README.md"),
    [
      "# Gemini CC",
      "",
      "/plugin install gemini@gemini-cc",
      "",
      ".claude-plugin/marketplace.json",
      "",
      "npm run verify",
      "",
      "dist/release/gemini-cc-v<version>/",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(repo, "RELEASE.md"),
    [
      "# Release Process",
      "",
      "npm run verify",
      "",
      "dist/release/gemini-cc-v<version>/",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(repo, "NOTICE"), "ByteLand Technology Limited\n");
  fs.writeFileSync(
    path.join(repo, "plugins", "gemini", "NOTICE"),
    "ByteLand Technology Limited\n",
  );
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\ndist/\n");
  fs.writeFileSync(path.join(repo, "LICENSE"), "Apache-2.0\n");
  fs.writeFileSync(path.join(repo, "release-notes.txt"), "bootstrap\n");

  run("git", ["add", "."], { cwd: repo });
  run("git", ["commit", "-m", "chore: bootstrap release fixture"], {
    cwd: repo,
  });
  run("git", ["tag", "v1.0.0"], { cwd: repo });

  fs.writeFileSync(path.join(repo, "release-notes.txt"), "feat\n");
  run("git", ["add", "release-notes.txt"], { cwd: repo });
  run("git", ["commit", "-m", "feat(gemini): add automatic release prep"], {
    cwd: repo,
  });

  fs.writeFileSync(path.join(repo, "release-notes.txt"), "fix\n");
  run("git", ["add", "release-notes.txt"], { cwd: repo });
  run("git", ["commit", "-m", "fix(gemini): tighten stream handling"], {
    cwd: repo,
  });

  return repo;
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
  const parsedFeature = parseConventionalCommit("feat(gemini): add releases");
  assert.equal(parsedFeature.type, "feat");
  assert.equal(parsedFeature.scope, "gemini");
  assert.equal(parsedFeature.summary, "add releases");
  assert.equal(parsedFeature.breaking, false);
  assert.equal(parsedFeature.bump, "minor");
  assert.equal(parsedFeature.section, "Features");
  assert.equal(parsedFeature.releasable, true);
  assert.equal(
    parseConventionalCommit(
      "refactor(api)!: reshape release payload",
      "BREAKING CHANGE: payload changed",
    ).bump,
    "major",
  );
  assert.equal(
    determineReleaseBump([{ bump: "patch" }, { bump: "minor" }]),
    "minor",
  );
  assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
  assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
  const changelogEntry = buildChangelogEntry("1.3.0", [
    parseConventionalCommit("feat: add release automation"),
    parseConventionalCommit("fix: tighten version sync"),
    parseConventionalCommit(
      "feat!: break the public API",
      "BREAKING CHANGE: migration required",
    ),
  ]);
  assert.match(changelogEntry, /^## 1\.3\.0/m);
  assert.match(changelogEntry, /### Breaking Changes/);
  assert.match(changelogEntry, /### Features/);
  assert.match(changelogEntry, /### Fixes/);
});

test("automatic release preparation bumps versions and prepends changelog", () => {
  const repo = createReleaseFixture();

  const plan = prepareRelease(repo, { write: true });

  assert.equal(plan.releaseNeeded, true);
  assert.equal(plan.currentVersion, "1.0.0");
  assert.equal(plan.nextVersion, "1.1.0");
  assert.equal(plan.bump, "minor");
  assert.equal(plan.tagName, "v1.1.0");
  assert.equal(plan.releaseCommitMessage, "chore(release): v1.1.0");
  assert.deepEqual(plan.updatedFiles.length, 4);
  assert.equal(collectReleaseIssues(repo).issues.length, 0);

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repo, "package.json"), "utf8"),
  );
  const pluginJson = JSON.parse(
    fs.readFileSync(
      path.join(repo, "plugins", "gemini", ".claude-plugin", "plugin.json"),
      "utf8",
    ),
  );
  const marketplaceJson = JSON.parse(
    fs.readFileSync(
      path.join(repo, ".claude-plugin", "marketplace.json"),
      "utf8",
    ),
  );
  const changelog = fs.readFileSync(
    path.join(repo, "plugins", "gemini", "CHANGELOG.md"),
    "utf8",
  );

  assert.equal(packageJson.version, "1.1.0");
  assert.equal(pluginJson.version, "1.1.0");
  assert.equal(marketplaceJson.metadata.version, "1.1.0");
  assert.equal(marketplaceJson.plugins[0].version, "1.1.0");
  assert.match(changelog, /^# Changelog\n\n## 1\.1\.0/m);
  assert.match(changelog, /### Features/);
  assert.match(changelog, /### Fixes/);
});

test("release auto script emits JSON and then no-ops once the release is tagged", () => {
  const repo = createReleaseFixture();

  const planned = runNodeScript(
    "scripts/release-auto.mjs",
    ["--root", repo, "--json"],
    { cwd: ROOT },
  );
  assert.equal(planned.status, 0, planned.stderr);
  const plan = JSON.parse(planned.stdout);
  assert.equal(plan.releaseNeeded, true);
  assert.equal(plan.nextVersion, "1.1.0");

  const prepared = runNodeScript(
    "scripts/release-auto.mjs",
    ["--root", repo, "--write", "--json"],
    { cwd: ROOT },
  );
  assert.equal(prepared.status, 0, prepared.stderr);

  run("git", ["add", "."], { cwd: repo });
  run("git", ["commit", "-m", "chore(release): v1.1.0"], {
    cwd: repo,
  });
  run("git", ["tag", "v1.1.0"], { cwd: repo });

  const afterRelease = runNodeScript(
    "scripts/release-auto.mjs",
    ["--root", repo, "--json"],
    { cwd: ROOT },
  );
  assert.equal(afterRelease.status, 0, afterRelease.stderr);
  const afterPlan = JSON.parse(afterRelease.stdout);
  assert.equal(afterPlan.releaseNeeded, false);
  assert.equal(afterPlan.tagName, null);
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
