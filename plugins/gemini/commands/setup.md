---
description: Check Gemini CLI status, configure default model, and manage review gate
argument-hint: '[--enable-review-gate|--disable-review-gate] [--set-model <model>]'
allowed-tools: Bash(node:*), Bash(npm:*), AskUserQuestion
---

First, run the setup helper with any explicit flags the user provided:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json $ARGUMENTS
```

Parse the JSON output to extract:
- `ready` — whether Gemini is installed and authenticated
- `provider.available` — whether Gemini CLI is installed
- `auth.loggedIn` — whether Gemini is authenticated
- `auth.detail` — authentication detail message
- `reviewGateEnabled` — current review gate state
- `defaultModel` — current default model (may be null)

**If explicit flags were provided** (i.e., `$ARGUMENTS` is not empty):
- Present the final setup output to the user.
- Stop here.

**If no explicit flags were provided**, proceed to interactive mode:

If `provider.available` is false and npm is available:

- Use `AskUserQuestion` exactly once to ask whether Claude should install Gemini now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install Gemini CLI (Recommended)`
  - `Skip for now`
- If the user chooses install, run:

```bash
npm install -g @google/gemini-cli
```

- Then rerun: `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json`

If `provider.available` is true but `auth.loggedIn` is false:

- Present the auth guidance from `auth.detail` and stop.
- Do not offer to install; the CLI is already installed.
- Preserve guidance to run `gemini` and complete `/auth`, or set `GEMINI_API_KEY` / `GOOGLE_API_KEY`.

If `ready` is true, present a menu using `AskUserQuestion` to configure settings.

**Menu questions (ask one at a time in this order):**

1. **Model selection** — ask which model to use as default:
   ```
   question: "Which model should be the default for /gemini:rescue and /gemini:review?"
   header: "Default Model"
   options:
     - label: "gemini-3.1-pro-preview (Recommended)"
       description: "Latest pro, highest capability"
     - label: "gemini-2.5-pro"
       description: "Pro tier, strong reasoning"
     - label: "gemini-3-flash-preview"
       description: "Latest flash, fast and capable"
     - label: "gemini-2.5-flash"
       description: "Fast, lower cost, good for most tasks"
     - label: "gemini-3.1-flash-lite-preview"
       description: "Latest lite model, lowest latency"
     - label: "gemini-2.5-flash-lite"
       description: "Lighter weight, lowest cost"
     - label: "Auto"
       description: "Let Gemini CLI decide"
     - label: "Custom model..."
       description: "Enter a custom model name"
   multiSelect: false
   ```

   - If user selects "Auto", run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --set-model "" --json`
   - If user selects "Custom model...", ask a follow-up question:
     ```
     question: "Enter the custom model name:"
     header: "Custom Model"
     options:
       - label: "Continue"
         description: "Use the model name you provide"
     multiSelect: false
     ```
     The user's answer is the custom model name. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --set-model <answer> --json`
   - Otherwise run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --set-model <model-id> --json`
     (Use the model ID from the selected option label, e.g. `gemini-2.5-flash`)

2. **Review gate** — if `reviewGateEnabled` is false, ask:
   ```
   question: "Enable the stop-time review gate? When enabled, Gemini reviews Claude's response before each stop and may block the stop if issues are found."
   header: "Review Gate"
   options:
     - label: "Enable review gate"
       description: "Require Gemini review before stops"
     - label: "Keep disabled (Recommended)"
       description: "No extra review at stop time"
   multiSelect: false
   ```

   If `reviewGateEnabled` is true, ask:
   ```
   question: "The review gate is currently enabled. Disable it?"
   header: "Review Gate"
   options:
     - label: "Disable review gate"
       description: "Stop requiring Gemini review before stops"
     - label: "Keep enabled"
       description: "Continue requiring review before stops"
   multiSelect: false
   ```

**Applying selections:**

- If user chooses to enable review gate:
  - Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --enable-review-gate --json`

- If user chooses to disable review gate:
  - Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --disable-review-gate --json`

After applying any changes, rerun the setup helper to confirm and present the final status.

**Output rules:**

- Present the final setup output to the user.
- If installation was skipped, present the original setup output.
