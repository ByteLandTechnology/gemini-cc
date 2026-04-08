# Gemini-backed plugin for Claude Code

![gemini-cc plugin logo](./logo.svg)

Use Gemini from inside Claude Code for code reviews or to delegate tasks without leaving your existing `/gemini:*` workflow.

This plugin is for Claude Code users who want Gemini to be both the provider and the visible command surface inside Claude Code.

The repository and marketplace source slug may still contain `codex-plugin-cc` as a historical identifier, but the supported provider, runtime, and slash-command surface in this project are all Gemini for Claude Code.

## What You Get

- `/gemini:review` for a normal read-only Gemini-backed review
- `/gemini:adversarial-review` for a steerable challenge review
- `/gemini:rescue`, `/gemini:status`, `/gemini:tail`, `/gemini:result`, and `/gemini:cancel` to delegate work and manage background jobs

## Requirements

- **Gemini CLI access.**
  - Supported paths include signing into Gemini CLI with a Google account or providing `GEMINI_API_KEY` / `GOOGLE_API_KEY`.
- **Node.js 18.18 or later**

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add ByteLandTechnology/gemini-cc
```

Install the plugin:

```bash
/plugin install gemini@gemini-cc
```

`ByteLandTechnology/gemini-cc` is the repository slug, while `gemini-cc` is the published marketplace name for this plugin and is declared in the repository-root [`.claude-plugin/marketplace.json`](./.claude-plugin/marketplace.json).

Reload plugins:

```bash
/reload-plugins
```

Then run:

```bash
/gemini:setup
```

`/gemini:setup` will tell you whether Gemini is ready. If Gemini CLI is missing and npm is available, it can offer to install Gemini for you.

If you prefer to install Gemini yourself, use:

```bash
npm install -g @google/gemini-cli
```

If Gemini CLI is installed but not authenticated yet, run:

```bash
gemini
```

Then complete `/auth`, or set `GEMINI_API_KEY` / `GOOGLE_API_KEY` before rerunning `/gemini:setup`.

After install, you should see:

- the slash commands listed below
- the `gemini:rescue` subagent in `/agents`

One simple first run is:

```bash
/gemini:review --background
/gemini:status
/gemini:result
```

## Maintainer Checks

```bash
npm run verify
npm run check
npm run validate:claude
npm run release:check
npm run release:bundle
npm run release:full
```

`npm run verify` is the main maintainer preflight command and runs the test suite, the repository type-check, and release metadata validation.
`npm run check` is kept as an alias for `npm run verify`.
`npm run validate:claude` runs Claude's local marketplace validator against the repository root when Claude Code is installed locally.
`npm run release:full` runs the full local release preflight: verify, Claude validation, and release bundle staging.
`npm run build` type-checks the shipped runtime scripts and the checked-in release tooling. Running `/gemini:*` commands still requires a working Gemini CLI install and authentication state.
`npm run release:bundle` writes the staged marketplace bundle to `dist/release/gemini-cc-v<version>/`, plus a tarball, SHA-256 checksum, release notes, and a release manifest in `dist/release/`.
The release checklist is documented in [`RELEASE.md`](./RELEASE.md).

## Usage

### `/gemini:review`

Runs a normal Gemini-backed review on your current work.

> [!NOTE]
> Code review especially for multi-file changes might take a while. It's generally recommended to run it in the background.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. Use `--scope working-tree` to force an uncommitted review or `--scope branch` to compare against the detected default branch. It also supports `--scope auto`, `--wait`, `--background`, and `--stream`. `--stream` forces foreground execution, conflicts with `--background`, and prints raw Gemini text as it arrives. It is not steerable and does not take custom focus text. Use [`/gemini:adversarial-review`](#geminiadversarial-review) when you want to challenge a specific decision or risk area.

Examples:

```bash
/gemini:review
/gemini:review --base main
/gemini:review --scope working-tree
/gemini:review --stream
/gemini:review --background
```

This command is read-only and will not perform any changes. When run in the background you can use [`/gemini:status`](#geministatus) to check on the progress and [`/gemini:cancel`](#geminicancel) to cancel the ongoing task.

### `/gemini:adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design.

It can be used to pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

It uses the same review target selection as `/gemini:review`, including `--base <ref>` for branch review and `--scope auto|working-tree|branch` for explicit target selection.
It also supports `--wait`, `--background`, and `--stream`. `--stream` forces foreground execution, conflicts with `--background`, and prints raw Gemini text as it arrives. Unlike `/gemini:review`, it can take extra focus text after the flags.

Use it when you want:

- a review before shipping that challenges the direction, not just the code details
- review focused on design choices, tradeoffs, hidden assumptions, and alternative approaches
- pressure-testing around specific risk areas like auth, data loss, rollback, race conditions, or reliability

Examples:

```bash
/gemini:adversarial-review
/gemini:adversarial-review --stream
/gemini:adversarial-review --base main challenge whether this was the right caching and retry design
/gemini:adversarial-review --scope branch look for rollback and migration risks
/gemini:adversarial-review --background look for race conditions and question the chosen approach
```

This command is read-only. It does not fix code.

### `/gemini:rescue`

Hands a task to Gemini through the `gemini:rescue` subagent.

Use it when you want Gemini to:

- investigate a bug
- try a fix
- continue a previous Gemini session
- take a faster or cheaper pass with a smaller model

> [!NOTE]
> Depending on the task and the model you choose these tasks might take a long time and it's generally recommended to force the task to be in the background or move the agent to the background.

It supports `--background`, `--wait`, `--stream`, `--resume`, and `--fresh`. `--stream` forces foreground execution, conflicts with `--background`, and prints raw Gemini text as it arrives. If you omit `--resume` and `--fresh`, the plugin can offer to continue the latest rescue thread for this repo.

Examples:

```bash
/gemini:rescue investigate why the tests started failing
/gemini:rescue fix the failing test with the smallest safe patch
/gemini:rescue --stream investigate why the tests started failing
/gemini:rescue --resume apply the top fix from the last run
/gemini:rescue --model pro --effort medium investigate the flaky integration test
/gemini:rescue --model flash fix the issue quickly
/gemini:rescue --background investigate the regression
```

You can also just ask for a task to be delegated to Gemini:

```text
Ask Gemini to redesign the database connection to be more resilient.
```

**Notes:**

- if you do not pass `--model` or `--effort`, Gemini CLI chooses its own defaults.
- if you say `spark`, the plugin maps that to `flash` for compatibility
- follow-up rescue requests can continue the latest Gemini session in the repo

### `/gemini:status`

Shows running and recent Gemini jobs for the current repository.
It also supports `--all`, `--wait`, and `--timeout-ms <ms>` when you want to inspect older jobs or block until a specific job settles.

Examples:

```bash
/gemini:status
/gemini:status task-abc123
/gemini:status --all
```

Use it to:

- check progress on background work
- see the latest completed job
- confirm whether a task is still running

### `/gemini:tail`

Shows the stored job log for a Gemini run, with an optional live follow mode for background work.
If you do not pass a job id, it prefers the latest active job for the current Claude session.

Examples:

```bash
/gemini:tail
/gemini:tail task-abc123
/gemini:tail --follow
/gemini:tail task-abc123 --follow --lines 80
```

Use it to:

- inspect the live log for a background review or rescue run
- keep following appended output until the job finishes
- look back at tool progress, reasoning summaries, and final output blocks without opening the log file manually

### `/gemini:result`

Shows the final stored Gemini-backed output for a finished job.
When available, it also includes the current session ID plus a supported Gemini resume command such as `gemini --resume latest` or `gemini --resume <session-id>`.

Examples:

```bash
/gemini:result
/gemini:result task-abc123
```

### `/gemini:cancel`

Cancels an active background Gemini job.

Examples:

```bash
/gemini:cancel
/gemini:cancel task-abc123
```

### `/gemini:setup`

Checks whether Gemini CLI is installed and authenticated.
If Gemini CLI is missing and npm is available, it can offer to install Gemini for you.

You can also use `/gemini:setup` to manage the optional review gate.

#### Enabling review gate

```bash
/gemini:setup --enable-review-gate
/gemini:setup --disable-review-gate
```

When the review gate is enabled, the plugin uses a `Stop` hook to run a targeted Gemini review based on Claude's response. If that review finds issues, the stop is blocked so Claude can address them first.

> [!WARNING]
> The review gate can create a long-running Claude/Gemini loop and may drain usage limits quickly. Only enable it when you plan to actively monitor the session.

## Typical Flows

### Review Before Shipping

```bash
/gemini:review
```

### Hand A Problem To Gemini

```bash
/gemini:rescue investigate why the build is failing in CI
```

### Start Something Long-Running

```bash
/gemini:adversarial-review --background
/gemini:rescue --background investigate the flaky test
```

Then check in with:

```bash
/gemini:status
/gemini:result
```

## Gemini Integration

The plugin now wraps Gemini CLI in headless mode. It uses the global `gemini` binary installed in your environment and exposes Gemini-native slash commands inside Claude Code.

### Common Configurations

Use Gemini CLI configuration, environment variables, and model flags for provider-level control. The plugin preserves `--stream`, `--model`, and `--effort` rescue flags through the companion runtime, and forwards model and effort selection on to Gemini CLI.

### Moving The Work Over To Gemini

Delegated tasks and any review-gate run can also be resumed inside Gemini with the exact `gemini --resume ...` command shown by `/gemini:result` or `/gemini:status`.

## FAQ

### Do I need a separate Gemini account for this plugin?

No separate plugin-specific account is required. The plugin uses your local Gemini CLI authentication state and environment.

### Does the plugin use a separate Gemini runtime?

No. This plugin delegates through your local Gemini CLI on the same machine.

That means:

- it uses the same Gemini install you would use directly
- it uses the same local authentication state
- it uses the same repository checkout and machine-local environment

### Can I keep using API keys?

Yes. Because the plugin uses your local Gemini CLI, environment-based authentication such as `GEMINI_API_KEY`, `GOOGLE_API_KEY`, and `GOOGLE_APPLICATION_CREDENTIALS` still applies.

## Attribution

This project is derived from [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) by OpenAI, licensed under the Apache License 2.0.

Modifications and Gemini integration by ByteLand Technology Limited.
