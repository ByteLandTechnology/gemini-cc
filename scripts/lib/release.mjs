import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
export const PLUGIN_DIR = path.join(REPO_ROOT, "plugins", "gemini");
export const PACKAGE_JSON_PATH = path.join(REPO_ROOT, "package.json");
export const PLUGIN_MANIFEST_PATH = path.join(
  PLUGIN_DIR,
  ".claude-plugin",
  "plugin.json",
);
export const MARKETPLACE_PATH = path.join(
  REPO_ROOT,
  ".claude-plugin",
  "marketplace.json",
);
export const CHANGELOG_PATH = path.join(PLUGIN_DIR, "CHANGELOG.md");
export const README_PATH = path.join(REPO_ROOT, "README.md");
export const RELEASE_GUIDE_PATH = path.join(REPO_ROOT, "RELEASE.md");
export const ROOT_NOTICE_PATH = path.join(REPO_ROOT, "NOTICE");
export const PLUGIN_NOTICE_PATH = path.join(PLUGIN_DIR, "NOTICE");
export const GITIGNORE_PATH = path.join(REPO_ROOT, ".gitignore");
export const DIST_DIR = path.join(REPO_ROOT, "dist", "release");
export const RELEASE_COMMIT_PREFIX = "chore(release): v";

const SEMVER_PATTERN = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/;
const CONVENTIONAL_HEADER_PATTERN =
  /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s+(?<description>.+)$/i;

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function writeText(filePath, content) {
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runGit(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function getTopChangelogVersion(changelogText) {
  const match = String(changelogText).match(
    /^##\s+([0-9]+\.[0-9]+\.[0-9]+)\s*$/m,
  );
  return match?.[1] ?? null;
}

export function getChangelogEntry(changelogText, version) {
  const source = String(changelogText);
  const marker = `## ${version}`;
  const start = source.indexOf(marker);
  if (start === -1) {
    return null;
  }

  const rest = source.slice(start + marker.length);
  const nextHeader = rest.search(/\n##\s+/);
  const body = (nextHeader === -1 ? rest : rest.slice(0, nextHeader)).trim();
  return [marker, body].filter(Boolean).join("\n\n").trim();
}

export function validateReleaseTag(version, tag) {
  if (!tag) {
    return null;
  }
  const normalized = String(tag).trim();
  return normalized === `v${version}`
    ? null
    : `Git tag ${normalized} does not match version v${version}.`;
}

export function resolveBundleDirName(version) {
  return `gemini-cc-v${version}`;
}

export function parseSemver(version) {
  const match = String(version ?? "")
    .trim()
    .match(SEMVER_PATTERN);
  if (!match) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

export function bumpVersion(version, bump) {
  const parsed = parseSemver(version);
  if (bump === "major") {
    return `${parsed.major + 1}.0.0`;
  }
  if (bump === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }
  if (bump === "patch") {
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }
  if (bump === "none" || bump == null) {
    return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  }
  throw new Error(`Unsupported release bump: ${bump}`);
}

function bumpPriority(bump) {
  if (bump === "major") {
    return 3;
  }
  if (bump === "minor") {
    return 2;
  }
  if (bump === "patch") {
    return 1;
  }
  return 0;
}

export function isReleaseCommit(message) {
  return String(message ?? "")
    .trim()
    .toLowerCase()
    .startsWith(RELEASE_COMMIT_PREFIX);
}

export function isAutomatedReleaseCommit(message) {
  return /^chore\(release\): v\d+\.\d+\.\d+$/i.test(String(message ?? "").trim());
}

export function parseConventionalCommit(subject, body = "") {
  const normalizedSubject = String(subject ?? "").trim();
  const normalizedBody = String(body ?? "").trim();

  if (!normalizedSubject || isReleaseCommit(normalizedSubject)) {
    return {
      type: null,
      scope: null,
      summary: normalizedSubject,
      breaking: false,
      bump: "none",
      releasable: false,
      section: null,
    };
  }

  const match = normalizedSubject.match(CONVENTIONAL_HEADER_PATTERN);
  const breakingInBody = /(^|\n)BREAKING[ -]CHANGES?:/im.test(normalizedBody);

  if (!match) {
    return {
      type: null,
      scope: null,
      summary: normalizedSubject,
      breaking: breakingInBody,
      bump: breakingInBody ? "major" : "none",
      releasable: breakingInBody,
      section: breakingInBody ? "Breaking Changes" : null,
    };
  }

  const type = match.groups.type.toLowerCase();
  const scope = match.groups.scope ?? null;
  const summary = match.groups.description.trim();
  const breaking = Boolean(match.groups.breaking) || breakingInBody;

  if (breaking) {
    return {
      type,
      scope,
      summary,
      breaking: true,
      bump: "major",
      releasable: true,
      section: "Breaking Changes",
    };
  }

  if (type === "feat") {
    return {
      type,
      scope,
      summary,
      breaking: false,
      bump: "minor",
      releasable: true,
      section: "Features",
    };
  }

  if (type === "fix") {
    return {
      type,
      scope,
      summary,
      breaking: false,
      bump: "patch",
      releasable: true,
      section: "Fixes",
    };
  }

  return {
    type,
    scope,
    summary,
    breaking: false,
    bump: "none",
    releasable: false,
    section: null,
  };
}

export function resolveReleaseBump(commits) {
  let selected = "none";
  for (const commit of commits) {
    const bump =
      typeof commit === "string"
        ? commit
        : (commit?.parsed?.bump ?? commit?.bump ?? "none");
    if (bumpPriority(bump) > bumpPriority(selected)) {
      selected = bump;
    }
  }
  return selected;
}

export const determineReleaseBump = resolveReleaseBump;

function normalizeChangelogSentence(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function groupReleaseCommits(commits) {
  const groups = {
    "Breaking Changes": [],
    Features: [],
    Fixes: [],
  };

  for (const commit of commits) {
    const parsed = commit?.parsed ?? commit;
    if (!parsed?.section || !(parsed.section in groups)) {
      continue;
    }
    const summary = normalizeChangelogSentence(parsed.summary);
    if (summary) {
      groups[parsed.section].push(`- ${summary}`);
    }
  }

  return groups;
}

export function buildGeneratedChangelogEntry(version, commits) {
  const groups = groupReleaseCommits(commits);
  const lines = [`## ${version}`];

  for (const [title, entries] of Object.entries(groups)) {
    if (entries.length === 0) {
      continue;
    }
    lines.push("", `### ${title}`, "", entries.join("\n"));
  }

  return lines.join("\n").trim();
}

export const buildChangelogEntry = buildGeneratedChangelogEntry;

function stripChangelogHeader(changelogText) {
  return String(changelogText ?? "")
    .replace(/^#\s+Changelog\s*/i, "")
    .trim();
}

function removeChangelogEntry(changelogText, version) {
  const source = stripChangelogHeader(changelogText);
  const marker = `## ${version}`;
  const start = source.indexOf(marker);
  if (start === -1) {
    return source;
  }

  const rest = source.slice(start + marker.length);
  const nextHeader = rest.search(/\n##\s+/);
  const prefix = source.slice(0, start).trim();
  const suffix = (nextHeader === -1 ? "" : rest.slice(nextHeader)).trim();
  return [prefix, suffix].filter(Boolean).join("\n\n").trim();
}

export function prependChangelogEntry(changelogText, entry) {
  const version = getTopChangelogVersion(entry);
  if (!version) {
    throw new Error(
      "Generated changelog entry is missing a semantic version heading.",
    );
  }

  const body = removeChangelogEntry(changelogText, version);
  return [`# Changelog`, "", entry.trim(), body ? `\n${body}` : ""]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

export function getLatestReleaseTag(root = REPO_ROOT) {
  try {
    const output = runGit(root, [
      "tag",
      "--list",
      "v*",
      "--sort=-version:refname",
    ]);
    const [firstTag] = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return firstTag ?? null;
  } catch {
    return null;
  }
}

export function listCommitsSinceRef(root = REPO_ROOT, sinceRef = null) {
  const range = sinceRef ? `${sinceRef}..HEAD` : "HEAD";
  const raw = runGit(root, ["log", "--format=%H%x1f%s%x1f%b%x1e", range]);
  if (!raw) {
    return [];
  }

  return raw
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body = ""] = record.split("\x1f");
      return {
        hash: hash?.trim() ?? "",
        subject: subject?.trim() ?? "",
        body: body?.trim() ?? "",
      };
    });
}

export function collectReleaseCommits(root = REPO_ROOT, sinceRef = null) {
  return listCommitsSinceRef(root, sinceRef)
    .map((commit) => ({
      ...commit,
      parsed: parseConventionalCommit(commit.subject, commit.body),
    }))
    .filter(
      (commit) =>
        commit.subject &&
        !isAutomatedReleaseCommit(commit.subject) &&
        commit.parsed.releasable,
    );
}

function writeReleaseVersionFiles(root, version) {
  const packageJsonPath = path.join(root, "package.json");
  const pluginManifestPath = path.join(
    root,
    "plugins",
    "gemini",
    ".claude-plugin",
    "plugin.json",
  );
  const marketplacePath = path.join(root, ".claude-plugin", "marketplace.json");

  const packageJson = readJson(packageJsonPath);
  const pluginJson = readJson(pluginManifestPath);
  const marketplaceJson = readJson(marketplacePath);
  const pluginEntry = Array.isArray(marketplaceJson.plugins)
    ? marketplaceJson.plugins.find((entry) => entry?.name === pluginJson.name)
    : null;

  if (!pluginEntry) {
    throw new Error(
      `.claude-plugin/marketplace.json is missing the ${pluginJson.name} plugin entry.`,
    );
  }

  packageJson.version = version;
  pluginJson.version = version;
  marketplaceJson.metadata = {
    ...(marketplaceJson.metadata ?? {}),
    version,
  };
  pluginEntry.version = version;

  writeJson(packageJsonPath, packageJson);
  writeJson(pluginManifestPath, pluginJson);
  writeJson(marketplacePath, marketplaceJson);

  return [packageJsonPath, pluginManifestPath, marketplacePath];
}

export function writeReleaseVersion(
  root = REPO_ROOT,
  version,
  changelogEntry = null,
) {
  const updatedFiles = writeReleaseVersionFiles(root, version);
  if (changelogEntry) {
    const changelogPath = path.join(root, "plugins", "gemini", "CHANGELOG.md");
    writeText(
      changelogPath,
      prependChangelogEntry(readText(changelogPath), changelogEntry),
    );
    updatedFiles.push(changelogPath);
  }
  return updatedFiles;
}

export function prepareAutomaticRelease(root = REPO_ROOT, options = {}) {
  const { issues, version: currentVersion } = collectReleaseIssues(root);
  if (issues.length > 0) {
    throw new Error(`Release validation failed:\n- ${issues.join("\n- ")}`);
  }

  const latestTag = options.latestTag ?? getLatestReleaseTag(root);
  const commits = collectReleaseCommits(root, latestTag);
  const bump = resolveReleaseBump(commits);

  if (bump === "none") {
    return {
      releaseNeeded: false,
      currentVersion,
      nextVersion: null,
      bump,
      latestTag,
      commits: [],
      tagName: null,
      releaseCommitMessage: null,
      commitMessage: null,
      changelogEntry: null,
      updatedFiles: [],
    };
  }

  const nextVersion = bumpVersion(currentVersion, bump);
  const changelogEntry = buildGeneratedChangelogEntry(nextVersion, commits);
  const updatedFiles = options.write
    ? writeReleaseVersion(root, nextVersion, changelogEntry)
    : [];

  return {
    releaseNeeded: true,
    currentVersion,
    nextVersion,
    bump,
    latestTag,
    commits: commits.map((commit) => ({
      hash: commit.hash,
      subject: commit.subject,
      type: commit.parsed.type,
      scope: commit.parsed.scope,
      summary: commit.parsed.summary,
      breaking: commit.parsed.breaking,
      bump: commit.parsed.bump,
      section: commit.parsed.section,
    })),
    tagName: `v${nextVersion}`,
    releaseCommitMessage: `chore(release): v${nextVersion}`,
    commitMessage: `chore(release): v${nextVersion}`,
    changelogEntry,
    updatedFiles,
  };
}

export const prepareRelease = prepareAutomaticRelease;

export function getBundleEntries(root = REPO_ROOT) {
  return [
    {
      from: path.join(root, "LICENSE"),
      to: "LICENSE",
    },
    {
      from: path.join(root, "README.md"),
      to: "README.md",
    },
    {
      from: path.join(root, "NOTICE"),
      to: "NOTICE",
    },
    {
      from: path.join(root, "RELEASE.md"),
      to: "RELEASE.md",
    },
    {
      from: path.join(root, ".claude-plugin"),
      to: ".claude-plugin",
    },
    {
      from: path.join(root, "plugins", "gemini"),
      to: "plugins/gemini",
    },
  ];
}

export function collectReleaseIssues(root = REPO_ROOT, options = {}) {
  const issues = [];
  const packageJson = readJson(path.join(root, "package.json"));
  const pluginJson = readJson(
    path.join(root, "plugins", "gemini", ".claude-plugin", "plugin.json"),
  );
  const marketplaceJson = readJson(
    path.join(root, ".claude-plugin", "marketplace.json"),
  );
  const changelog = readText(
    path.join(root, "plugins", "gemini", "CHANGELOG.md"),
  );
  const readme = readText(path.join(root, "README.md"));
  const releaseGuide = readText(path.join(root, "RELEASE.md"));
  const rootNotice = readText(path.join(root, "NOTICE"));
  const pluginNotice = readText(path.join(root, "plugins", "gemini", "NOTICE"));
  const gitignore = fs.existsSync(path.join(root, ".gitignore"))
    ? readText(path.join(root, ".gitignore"))
    : "";
  const version = pluginJson.version;
  const pluginEntry = Array.isArray(marketplaceJson.plugins)
    ? marketplaceJson.plugins.find((entry) => entry?.name === pluginJson.name)
    : null;

  if (packageJson.version !== version) {
    issues.push(
      `package.json version ${packageJson.version} does not match plugin version ${version}.`,
    );
  }

  if (marketplaceJson.name !== "gemini-cc") {
    issues.push(
      `.claude-plugin/marketplace.json name must be gemini-cc, found ${marketplaceJson.name}.`,
    );
  }

  if (marketplaceJson.metadata?.version !== version) {
    issues.push(
      `.claude-plugin/marketplace.json metadata.version ${marketplaceJson.metadata?.version ?? "missing"} does not match ${version}.`,
    );
  }

  if (!marketplaceJson.owner?.name) {
    issues.push(".claude-plugin/marketplace.json must declare owner.name.");
  }

  if (!pluginEntry) {
    issues.push(
      `.claude-plugin/marketplace.json is missing the ${pluginJson.name} plugin entry.`,
    );
  } else {
    if (pluginEntry.source !== "./plugins/gemini") {
      issues.push(
        `.claude-plugin/marketplace.json source must be ./plugins/gemini, found ${pluginEntry.source}.`,
      );
    }
    if (pluginEntry.version !== version) {
      issues.push(
        `.claude-plugin/marketplace.json plugin version ${pluginEntry.version ?? "missing"} does not match ${version}.`,
      );
    }
    if (pluginEntry.description !== pluginJson.description) {
      issues.push(
        ".claude-plugin/marketplace.json plugin description must match plugins/gemini/.claude-plugin/plugin.json.",
      );
    }
    if (pluginEntry.license !== pluginJson.license) {
      issues.push(
        ".claude-plugin/marketplace.json plugin license must match plugins/gemini/.claude-plugin/plugin.json.",
      );
    }
  }

  const changelogVersion = getTopChangelogVersion(changelog);
  if (changelogVersion !== version) {
    issues.push(
      `plugins/gemini/CHANGELOG.md top version ${changelogVersion ?? "missing"} does not match ${version}.`,
    );
  }
  if (!getChangelogEntry(changelog, version)) {
    issues.push(
      `plugins/gemini/CHANGELOG.md is missing a release entry for ${version}.`,
    );
  }

  if (!readme.includes("/plugin install gemini@gemini-cc")) {
    issues.push(
      "README.md no longer contains the expected marketplace install command.",
    );
  }

  if (!readme.includes(".claude-plugin/marketplace.json")) {
    issues.push(
      "README.md should point maintainers at the checked-in .claude-plugin/marketplace.json file.",
    );
  }
  if (!readme.includes("npm run verify")) {
    issues.push("README.md should document npm run verify for maintainers.");
  }
  if (!readme.includes("dist/release/gemini-cc-v<version>/")) {
    issues.push("README.md should document the staged bundle path.");
  }
  if (!releaseGuide.includes("npm run verify")) {
    issues.push("RELEASE.md should document npm run verify.");
  }
  if (!releaseGuide.includes("dist/release/gemini-cc-v<version>/")) {
    issues.push("RELEASE.md should document the staged bundle path.");
  }

  if (!rootNotice.includes("ByteLand Technology Limited")) {
    issues.push(
      "NOTICE is missing the ByteLand attribution required for redistribution.",
    );
  }

  if (pluginNotice !== rootNotice) {
    issues.push(
      "plugins/gemini/NOTICE is out of sync with the repository NOTICE.",
    );
  }

  if (!gitignore.includes("node_modules/")) {
    issues.push(".gitignore must ignore node_modules/.");
  }

  if (!gitignore.includes("dist/")) {
    issues.push(".gitignore must ignore dist/.");
  }

  const tagIssue = validateReleaseTag(version, options.tag);
  if (tagIssue) {
    issues.push(tagIssue);
  }

  return {
    version,
    packageJson,
    marketplaceJson,
    pluginJson,
    issues,
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyEntry(sourcePath, targetPath) {
  const stats = fs.statSync(sourcePath);
  if (stats.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, {
      recursive: true,
    });
    return;
  }
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

export function buildReleaseBundle(root = REPO_ROOT, outDir = DIST_DIR) {
  const { issues, version } = collectReleaseIssues(root);
  if (issues.length > 0) {
    throw new Error(`Release validation failed:\n- ${issues.join("\n- ")}`);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  ensureDir(outDir);

  const bundleDirName = resolveBundleDirName(version);
  const bundleDir = path.join(outDir, bundleDirName);
  const tarballPath = path.join(outDir, `${bundleDirName}.tar.gz`);
  const checksumPath = path.join(outDir, `${bundleDirName}.sha256`);
  const releaseNotesPath = path.join(
    outDir,
    `${bundleDirName}.release-notes.md`,
  );
  const manifestPath = path.join(outDir, `${bundleDirName}.manifest.json`);
  const releaseNotes = getChangelogEntry(
    readText(path.join(root, "plugins", "gemini", "CHANGELOG.md")),
    version,
  );
  ensureDir(bundleDir);

  for (const entry of getBundleEntries(root)) {
    const targetPath =
      entry.to === "." ? bundleDir : path.join(bundleDir, entry.to);
    copyEntry(entry.from, targetPath);
  }

  fs.writeFileSync(
    path.join(bundleDir, "bundle-manifest.json"),
    `${JSON.stringify(
      {
        version,
        bundleDirName,
        files: getBundleEntries(root).map((entry) => entry.to),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  fs.writeFileSync(releaseNotesPath, `${releaseNotes}\n`, "utf8");
  execFileSync("tar", ["-czf", tarballPath, "-C", outDir, bundleDirName], {
    stdio: "inherit",
  });

  const sha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(tarballPath))
    .digest("hex");
  fs.writeFileSync(
    checksumPath,
    `${sha256}  ${path.basename(tarballPath)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        version,
        bundleDirName,
        tarball: path.basename(tarballPath),
        checksum: {
          algorithm: "sha256",
          value: sha256,
          file: path.basename(checksumPath),
        },
        releaseNotes: path.basename(releaseNotesPath),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    version,
    bundleDirName,
    bundleDir,
    tarballPath,
    checksumPath,
    releaseNotesPath,
    manifestPath,
  };
}
