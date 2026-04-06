# Changelog

## 1.0.0

- Add the missing repository-level marketplace manifest so the repo validates as a Claude Code marketplace source.
- Add release verification and bundling scripts plus CI automation for release artifacts.
- Expand maintainer guidance and release tests so metadata drift is caught before publishing.

## 1.0.2

- Align the published Gemini command surface, marketplace metadata, and maintainer docs with the current `/gemini:*` workflow.
- Document the current setup, review-gate, resume, and maintainer build/test paths that are covered by the repository test suite and CI.
- Check in the app-server compatibility typings used by `npm run build` so local type-checks no longer depend on Gemini CLI code generation.

## 1.0.0

- Initial Gemini-backed version of the Gemini plugin for Claude Code
