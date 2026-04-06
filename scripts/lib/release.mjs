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

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
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
