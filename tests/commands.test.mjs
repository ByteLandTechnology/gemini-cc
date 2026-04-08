import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "gemini");

function read(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), "utf8");
}

test("review command uses AskUserQuestion and background Bash while staying review-only", () => {
  const source = read("commands/review.md");
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /review-only/i);
  assert.match(source, /return Gemini's output verbatim to the user/i);
  assert.match(source, /```bash/);
  assert.match(source, /```typescript/);
  assert.match(source, /review "\$ARGUMENTS"/);
  assert.match(source, /\[--stream\]/);
  assert.match(source, /\[--scope auto\|working-tree\|branch\]/);
  assert.match(source, /run_in_background:\s*true/);
  assert.match(
    source,
    /command:\s*`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/gemini-companion\.mjs" review "\$ARGUMENTS"`/,
  );
  assert.match(source, /description:\s*"Gemini review"/);
  assert.match(source, /Do not call `BashOutput`/);
  assert.match(source, /Return the command stdout verbatim, exactly as-is/i);
  assert.match(source, /git status --short --untracked-files=all/);
  assert.match(source, /git diff --shortstat/);
  assert.match(
    source,
    /Treat untracked files or directories as reviewable work/i,
  );
  assert.match(
    source,
    /Recommend waiting only when the review is clearly tiny, roughly 1-2 files total/i,
  );
  assert.match(
    source,
    /In every other case, including unclear size, recommend background/i,
  );
  assert.match(
    source,
    /The companion script parses `--wait` and `--background`/i,
  );
  assert.match(source, /Preserve `--stream` exactly when the user passes it/i);
  assert.match(
    source,
    /If the raw arguments include `--stream`, do not ask\. Run the review in the foreground\./i,
  );
  assert.match(
    source,
    /If the raw arguments include both `--background` and `--stream`, stop and tell the user to choose one\./i,
  );
  assert.match(
    source,
    /`--stream` forces foreground execution and conflicts with `--background`\./i,
  );
  assert.match(
    source,
    /Claude Code's `Bash\(..., run_in_background: true\)` is what actually detaches the run/i,
  );
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /\(Recommended\)/);
  assert.match(
    source,
    /does not support staged-only review, unstaged-only review, or extra focus text/i,
  );
});

test("adversarial review command uses AskUserQuestion and background Bash while staying review-only", () => {
  const source = read("commands/adversarial-review.md");
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /review-only/i);
  assert.match(source, /return Gemini's output verbatim to the user/i);
  assert.match(source, /```bash/);
  assert.match(source, /```typescript/);
  assert.match(source, /adversarial-review "\$ARGUMENTS"/);
  assert.match(
    source,
    /\[--stream\] \[--base <ref>\] \[--scope auto\|working-tree\|branch\] \[focus \.\.\.\]/,
  );
  assert.match(source, /run_in_background:\s*true/);
  assert.match(
    source,
    /command:\s*`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/gemini-companion\.mjs" adversarial-review "\$ARGUMENTS"`/,
  );
  assert.match(source, /description:\s*"Gemini adversarial review"/);
  assert.match(source, /Do not call `BashOutput`/);
  assert.match(source, /Return the command stdout verbatim, exactly as-is/i);
  assert.match(source, /git status --short --untracked-files=all/);
  assert.match(source, /git diff --shortstat/);
  assert.match(
    source,
    /Treat untracked files or directories as reviewable work/i,
  );
  assert.match(
    source,
    /Recommend waiting only when the scoped review is clearly tiny, roughly 1-2 files total/i,
  );
  assert.match(
    source,
    /In every other case, including unclear size, recommend background/i,
  );
  assert.match(
    source,
    /The companion script parses `--wait` and `--background`/i,
  );
  assert.match(source, /Preserve `--stream` exactly when the user passes it/i);
  assert.match(
    source,
    /If the raw arguments include `--stream`, do not ask\. Run in the foreground\./i,
  );
  assert.match(
    source,
    /If the raw arguments include both `--background` and `--stream`, stop and tell the user to choose one\./i,
  );
  assert.match(
    source,
    /`--stream` forces foreground execution and conflicts with `--background`\./i,
  );
  assert.match(
    source,
    /Claude Code's `Bash\(..., run_in_background: true\)` is what actually detaches the run/i,
  );
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /\(Recommended\)/);
  assert.match(
    source,
    /uses the same review target selection as `\/gemini:review`/i,
  );
  assert.match(
    source,
    /supports working-tree review, branch review, and `--base <ref>`/i,
  );
  assert.match(
    source,
    /does not support `--scope staged` or `--scope unstaged`/i,
  );
  assert.match(source, /can still take extra focus text after the flags/i);
});

test("continue is not exposed as a user-facing command", () => {
  const commandFiles = fs
    .readdirSync(path.join(PLUGIN_ROOT, "commands"))
    .sort();
  assert.deepEqual(commandFiles, [
    "adversarial-review.md",
    "cancel.md",
    "rescue.md",
    "result.md",
    "review.md",
    "setup.md",
    "status.md",
    "tail.md",
  ]);
});

test("rescue command absorbs continue semantics", () => {
  const rescue = read("commands/rescue.md");
  const agent = read("agents/rescue.md");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const runtimeSkill = read("skills/gemini-cli-runtime/SKILL.md");

  assert.match(
    rescue,
    /The final user-visible response must be Gemini's output verbatim/i,
  );
  assert.match(rescue, /allowed-tools:\s*Bash\(node:\*\),\s*AskUserQuestion/);
  assert.match(rescue, /--background\|--wait/);
  assert.match(rescue, /\[--stream\]/);
  assert.match(rescue, /--resume\|--fresh/);
  assert.match(rescue, /--model <model\|flash>/);
  assert.match(rescue, /--effort <none\|minimal\|low\|medium\|high\|xhigh>/);
  assert.match(rescue, /task-resume-candidate --json/);
  assert.match(rescue, /AskUserQuestion/);
  assert.match(rescue, /Continue current Gemini session/);
  assert.match(rescue, /Start a new Gemini session/);
  assert.match(rescue, /run the `gemini:rescue` subagent in the background/i);
  assert.match(rescue, /default to foreground/i);
  assert.match(rescue, /Do not forward them to `task`/i);
  assert.match(
    rescue,
    /`--stream`, `--model`, and `--effort` are runtime-selection flags/i,
  );
  assert.match(
    rescue,
    /If the request includes `--stream`, run the `gemini:rescue` subagent in the foreground\./i,
  );
  assert.match(
    rescue,
    /If the request includes both `--background` and `--stream`, stop and tell the user to choose one\./i,
  );
  assert.match(
    rescue,
    /Leave `--effort` unset unless the user explicitly asks for a specific reasoning effort/i,
  );
  assert.match(rescue, /If they ask for `spark`, map it to `flash`/i);
  assert.match(
    rescue,
    /If the request includes `--resume`, do not ask whether to continue/i,
  );
  assert.match(
    rescue,
    /If the request includes `--fresh`, do not ask whether to continue/i,
  );
  assert.match(rescue, /If the user chooses continue, add `--resume`/i);
  assert.match(rescue, /If the user chooses a new thread, add `--fresh`/i);
  assert.match(rescue, /thin forwarder only/i);
  assert.match(
    rescue,
    /Return the Gemini companion stdout verbatim to the user/i,
  );
  assert.match(
    rescue,
    /`--stream` forces foreground execution and conflicts with `--background`\./i,
  );
  assert.match(
    rescue,
    /Do not paraphrase, summarize, rewrite, or add commentary before or after it/i,
  );
  assert.match(rescue, /return that command's stdout as-is/i);
  assert.match(
    rescue,
    /Leave `--resume` and `--fresh` in the forwarded request/i,
  );
  assert.match(agent, /--resume/);
  assert.match(agent, /--fresh/);
  assert.match(agent, /thin forwarding wrapper/i);
  assert.match(
    agent,
    /prefer foreground for a small, clearly bounded rescue request/i,
  );
  assert.match(
    agent,
    /If the user did not explicitly choose `--background` or `--wait` and the task looks complicated, open-ended, multi-step, or likely to keep Gemini running for a long time, prefer background execution/i,
  );
  assert.match(agent, /Use exactly one `Bash` call/i);
  assert.match(
    agent,
    /Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own/i,
  );
  assert.match(
    agent,
    /Do not call `review`, `adversarial-review`, `status`, `result`, or `cancel`/i,
  );
  assert.match(
    agent,
    /Leave `--effort` unset unless the user explicitly requests a specific reasoning effort/i,
  );
  assert.match(agent, /Leave model unset by default/i);
  assert.match(
    agent,
    /If the user asks for `spark`, map that to `--model flash`/i,
  );
  assert.match(
    agent,
    /If the user asks for a concrete Gemini model name, pass it through with `--model`/i,
  );
  assert.match(
    agent,
    /Preserve `--stream` when the user explicitly asks for streaming output/i,
  );
  assert.match(
    agent,
    /Treat `--stream`, `--effort <value>`, and `--model <value>` as runtime controls/i,
  );
  assert.match(
    agent,
    /`--stream` forces foreground execution and conflicts with `--background`\./i,
  );
  assert.match(
    agent,
    /Return the stdout of the `gemini-companion` command exactly as-is/i,
  );
  assert.match(
    agent,
    /If the Bash call fails or Gemini cannot be invoked, return nothing/i,
  );
  assert.match(agent, /gemini-prompting/);
  assert.match(
    agent,
    /only to tighten the user's request into a better Gemini prompt/i,
  );
  assert.match(
    agent,
    /Do not use that skill to inspect the repository, reason through the problem yourself, draft a solution, or do any independent work/i,
  );
  assert.match(
    runtimeSkill,
    /only job is to invoke `task` once and return that stdout unchanged/i,
  );
  assert.match(
    runtimeSkill,
    /Do not call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel`/i,
  );
  assert.match(
    runtimeSkill,
    /use the `gemini-prompting` skill to rewrite the user's request into a tighter Gemini prompt/i,
  );
  assert.match(
    runtimeSkill,
    /That prompt drafting is the only Claude-side work allowed/i,
  );
  assert.match(
    runtimeSkill,
    /Leave `--effort` unset unless the user explicitly requests a specific effort/i,
  );
  assert.match(runtimeSkill, /Leave model unset by default/i);
  assert.match(
    runtimeSkill,
    /Preserve `--stream` when the user explicitly asks for streaming output/i,
  );
  assert.match(runtimeSkill, /Map `spark` to `--model flash`/i);
  assert.match(
    runtimeSkill,
    /If the forwarded request includes `--background` or `--wait`, treat that as Claude-side execution control only/i,
  );
  assert.match(
    runtimeSkill,
    /If the forwarded request includes `--stream`, pass it through to `task`/i,
  );
  assert.match(
    runtimeSkill,
    /`--stream` forces foreground execution and conflicts with `--background`\./i,
  );
  assert.match(runtimeSkill, /Strip it before calling `task`/i);
  assert.match(
    runtimeSkill,
    /`--effort`: accepted values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`/i,
  );
  assert.match(
    runtimeSkill,
    /Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own/i,
  );
  assert.match(
    runtimeSkill,
    /If the Bash call fails or Gemini cannot be invoked, return nothing/i,
  );
  assert.match(readme, /`gemini:rescue` subagent/i);
  assert.match(
    readme,
    /if you do not pass `--model` or `--effort`, Gemini CLI chooses its own defaults/i,
  );
  assert.match(readme, /--model pro --effort medium/i);
  assert.match(readme, /`spark`, the plugin maps that to `flash`/i);
  assert.match(readme, /continue a previous Gemini session/i);
  assert.match(readme, /### `\/gemini:setup`/);
  assert.match(readme, /### `\/gemini:review`/);
  assert.match(readme, /### `\/gemini:adversarial-review`/);
  assert.match(readme, /\/gemini:review --stream/);
  assert.match(readme, /\/gemini:adversarial-review --stream/);
  assert.match(
    readme,
    /\/gemini:rescue --stream investigate why the tests started failing/,
  );
  assert.match(
    readme,
    /uses the same review target selection as `\/gemini:review`/i,
  );
  assert.match(
    readme,
    /--base main challenge whether this was the right caching and retry design/,
  );
  assert.match(readme, /### `\/gemini:rescue`/);
  assert.match(readme, /### `\/gemini:status`/);
  assert.match(readme, /### `\/gemini:tail`/);
  assert.match(readme, /### `\/gemini:result`/);
  assert.match(readme, /### `\/gemini:cancel`/);
  assert.match(
    readme,
    /`--stream` forces foreground execution, conflicts with `--background`, and prints raw Gemini text as it arrives/i,
  );
});

test("result and cancel commands are exposed as deterministic runtime entrypoints", () => {
  const result = read("commands/result.md");
  const cancel = read("commands/cancel.md");
  const status = read("commands/status.md");
  const setup = read("commands/setup.md");
  const tail = read("commands/tail.md");
  const resultHandling = read("skills/gemini-result-handling/SKILL.md");

  assert.match(result, /disable-model-invocation:\s*true/);
  assert.match(result, /argument-hint:\s*"\[job-id\] \[--stream\]"/);
  assert.match(result, /gemini-companion\.mjs" result \$ARGUMENTS/);
  assert.match(cancel, /disable-model-invocation:\s*true/);
  assert.match(cancel, /argument-hint:\s*"\[job-id\] \[--stream\]"/);
  assert.match(cancel, /gemini-companion\.mjs" cancel \$ARGUMENTS/);
  assert.match(
    status,
    /argument-hint:\s*"\[job-id\] \[--wait\] \[--timeout-ms <ms>\] \[--all\] \[--stream\]"/,
  );
  assert.match(
    setup,
    /argument-hint:\s*["']\[--enable-review-gate\|--disable-review-gate\] \[--set-model <model>\] \[--stream\]["']/,
  );
  assert.match(tail, /disable-model-invocation:\s*true/);
  assert.match(tail, /gemini-companion\.mjs" tail \$ARGUMENTS/);
  assert.match(
    tail,
    /argument-hint:\s*"\[job-id\] \[--follow\] \[--lines <n>\]"/,
  );
  assert.match(tail, /latest active job for the current Claude session/i);
  assert.match(
    tail,
    /continue streaming appended log lines until the job settles/i,
  );
  assert.match(
    resultHandling,
    /do not turn a failed or incomplete Gemini run into a Claude-side implementation attempt/i,
  );
  assert.match(
    resultHandling,
    /if Gemini was never successfully invoked, do not generate a substitute answer at all/i,
  );
});

test("internal docs use task terminology for rescue runs", () => {
  const runtimeSkill = read("skills/gemini-cli-runtime/SKILL.md");
  const promptingSkill = read("skills/gemini-prompting/SKILL.md");
  const promptRecipes = read(
    "skills/gemini-prompting/references/gemini-prompt-recipes.md",
  );

  assert.match(runtimeSkill, /gemini-companion\.mjs" task "<raw arguments>"/);
  assert.match(runtimeSkill, /Use `task` for every rescue request/i);
  assert.match(runtimeSkill, /task --resume-last/i);
  assert.match(promptingSkill, /Use `task` when the task is diagnosis/i);
  assert.match(promptRecipes, /Gemini task prompts/i);
  assert.match(
    promptRecipes,
    /Use these as starting templates for Gemini task prompts/i,
  );
  assert.match(promptRecipes, /## Diagnosis/);
  assert.match(promptRecipes, /## Narrow Fix/);
});

test("hooks keep session-end cleanup and stop gating enabled", () => {
  const source = read("hooks/hooks.json");
  assert.match(source, /SessionStart/);
  assert.match(source, /SessionEnd/);
  assert.match(source, /stop-review-gate-hook\.mjs/);
  assert.match(source, /session-lifecycle-hook\.mjs/);
});

test("setup command can offer Gemini install and points users to Gemini auth", () => {
  const setup = read("commands/setup.md");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  assert.match(
    setup,
    /argument-hint:\s*["']\[--enable-review-gate\|--disable-review-gate\] \[--set-model <model>\] \[--stream\]["']/,
  );
  assert.match(setup, /AskUserQuestion/);
  assert.match(setup, /npm install -g @google\/gemini-cli/);
  assert.match(setup, /gemini-companion\.mjs" setup --json/);
  assert.match(setup, /gemini-3\.1-pro-preview/);
  assert.match(setup, /Custom model/);
  assert.match(setup, /Auto/);
  assert.match(readme, /gemini/);
  assert.match(readme, /offer to install Gemini for you/i);
  assert.match(readme, /\/gemini:setup --enable-review-gate/);
  assert.match(readme, /\/gemini:setup --disable-review-gate/);
});
