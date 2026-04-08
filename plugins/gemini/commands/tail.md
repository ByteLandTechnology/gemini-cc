---
description: Show and optionally follow the stored Gemini job log for this repository
argument-hint: "[job-id] [--follow] [--lines <n>]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" tail $ARGUMENTS`

Present the command output to the user exactly as-is.

- If the user does not pass a job id, this command should target the latest active job for the current Claude session.
- If there is no active job for the current Claude session, it should fall back to the latest current-session job that has a log file.
- If the user passes `--follow`, continue streaming appended log lines until the job settles.
- Do not summarize, condense, or rewrite the tailed log output.
