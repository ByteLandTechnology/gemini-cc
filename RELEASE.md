# Release Process

This repository ships a Claude Code plugin bundle, not a public npm package.

## Automated Flow

- Pull requests run `npm run verify`.
- Pushes to `main` inspect Conventional Commits since the latest `v*` tag.
- `feat:` bumps minor, `fix:` bumps patch, and any `BREAKING CHANGE` or `type!:` bumps major.
- When CI finds a releasable commit, it updates:
  - `package.json`
  - `plugins/gemini/.claude-plugin/plugin.json`
  - `.claude-plugin/marketplace.json`
  - `plugins/gemini/CHANGELOG.md`
- CI then commits `chore(release): v<version>`, creates `v<version>`, pushes both, and lets the tag-triggered workflow publish the GitHub Release assets.

## Maintainer Checklist

1. Use Conventional Commits on any change that should ship in a release.
2. Optionally preview the next release locally:

```bash
npm run release:auto -- --json
```

3. Run the full local preflight when you want to validate the current tree before merging:

```bash
npm run release:full
```

4. Inspect the staged bundle in `dist/release/gemini-cc-v<version>/`.
5. Confirm the generated tarball, checksum, release notes, and manifest in `dist/release/`.
6. Merge the change to `main`. CI handles the version commit, tag creation, bundle rebuild, and GitHub Release publication.

## Automation

- The `main` branch release-prep job is intentionally a no-op for non-releasable commits like `docs:`, `chore:`, or `test:`.
- Release commits are detected by their `chore(release): v<version>` prefix so the automated version write-back does not recursively trigger another release-prep run.
- Pushing a `v*` tag rebuilds the bundle and publishes the tarball plus checksum using the generated changelog entry as the GitHub release notes.
- `workflow_dispatch` re-runs the same default-branch automation path manually.
