# Release Process

This repository ships a Claude Code plugin bundle, not a public npm package.

## Release Checklist

1. Update `plugins/gemini/CHANGELOG.md` with the next release notes.
2. Keep these files on the same version:
   - `package.json`
   - `plugins/gemini/.claude-plugin/plugin.json`
   - `plugins/gemini/CHANGELOG.md`
3. Keep `.claude-plugin/marketplace.json` checked in and pointing at `./plugins/gemini`.
4. Run the full local preflight:

```bash
npm run release:full
```

5. Inspect the staged bundle in `dist/release/gemini-cc-v<version>/`.
6. Confirm the generated tarball, checksum, release notes, and manifest in `dist/release/`.
7. Create and push a matching Git tag: `v<version>`.

## Automation

- Pull requests run `npm run verify`.
- Pushing a `v*` tag runs the release workflow, rebuilds the bundle, and publishes the tarball plus checksum using the checked-in changelog entry as the GitHub release notes.
- You can also run the release workflow manually with `workflow_dispatch` to validate the release path without cutting a tag.
