import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { writeExecutable } from "./helpers.mjs";

export function installFakeGemini(binDir, behavior = "review-ok") {
  const statePath = path.join(binDir, "fake-gemini-state.json");
  const scriptPath = path.join(binDir, "gemini");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const STATE_PATH = ${JSON.stringify(statePath)};
const BEHAVIOR = ${JSON.stringify(behavior)};

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { nextSessionId: 1, sessions: [], lastInvocation: null };
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function buildResumeId(index) {
  const suffix = String(index).padStart(12, "0");
  return "00000000-0000-4000-8000-" + suffix;
}

function nextSession(state, prompt) {
  const sessionNumber = state.nextSessionId++;
  const session = {
    id: "thr_" + sessionNumber,
    resumeId: buildResumeId(sessionNumber),
    preview: String(prompt || "").trim().slice(0, 80),
    createdAt: Date.now()
  };
  state.sessions.unshift(session);
  saveState(state);
  return session;
}

function findSessionByResumeToken(state, resumeToken) {
  if (!resumeToken) {
    return null;
  }
  if (resumeToken === "latest") {
    return state.sessions[0] || null;
  }
  if (/^\\d+$/.test(resumeToken)) {
    const index = Number.parseInt(resumeToken, 10);
    return Number.isInteger(index) && index > 0 ? state.sessions[index - 1] || null : null;
  }
  return state.sessions.find((session) => session.resumeId === resumeToken) || null;
}

function outputJsonLine(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

function structuredReviewPayload(prompt) {
  if (BEHAVIOR === "invalid-json") {
    return "not valid json";
  }

  if (prompt.includes("adversarial software review")) {
    if (BEHAVIOR === "adversarial-clean") {
      return JSON.stringify({
        verdict: "approve",
        summary: "No material issues found.",
        findings: [],
        next_steps: []
      });
    }

    return JSON.stringify({
      verdict: "needs-attention",
      summary: "One adversarial concern surfaced.",
      findings: [
        {
          severity: "high",
          title: "Missing empty-state guard",
          body: "The change assumes data is always present.",
          file: "src/app.js",
          line_start: 4,
          line_end: 6,
          confidence: 0.87,
          recommendation: "Handle empty collections before indexing."
        }
      ],
      next_steps: ["Add an empty-state test."]
    });
  }

  if (prompt.includes("Target: branch diff against")) {
    const branch = prompt.match(/Target: branch diff against ([^\\n]+)/)?.[1] || "main";
    return "Reviewed changes against " + branch + ".\\nNo material issues found.";
  }

  return "Reviewed uncommitted changes.\\nNo material issues found.";
}

function taskPayload(prompt, resumeSessionId) {
  if (prompt.includes("Only review the work from the previous Claude turn.")) {
    if (BEHAVIOR === "adversarial-clean") {
      return "ALLOW: No blocking issues found in the previous turn.";
    }
    return "BLOCK: Missing empty-state guard in src/app.js:4-6.";
  }

  if (resumeSessionId || prompt.includes("follow up") || prompt.includes("Continue from the current session state")) {
    return "Resumed the prior run.\\nFollow-up prompt accepted.";
  }

  return "Handled the requested task.\\nTask prompt accepted.";
}

function parseArgs(argv) {
  const args = [...argv];
  const parsed = {
    model: null,
    approvalMode: "default",
    outputFormat: "text",
    resume: null,
    sandbox: false,
    prompt: "",
    promptFlag: false,
    positionalPrompt: false
  };

  while (args.length > 0) {
    const current = args.shift();
    if (current === "--model" && args[0]) {
      parsed.model = args.shift();
      continue;
    }
    if (current === "--approval-mode" && args[0]) {
      parsed.approvalMode = args.shift();
      continue;
    }
    if (current === "--output-format" && args[0]) {
      parsed.outputFormat = args.shift();
      continue;
    }
    if ((current === "--resume" || current === "-r") && args[0]) {
      parsed.resume = args.shift();
      continue;
    }
    if ((current === "--prompt" || current === "-p") && args[0]) {
      parsed.prompt = args.shift();
      parsed.promptFlag = true;
      continue;
    }
    if (current === "--sandbox" || current === "-s") {
      parsed.sandbox = true;
      continue;
    }
    if (current === "--help") {
      console.log("fake gemini help");
      process.exit(0);
    }
    if (current === "--version") {
      console.log("gemini-cli test");
      process.exit(0);
    }
    if (current === "--list-sessions") {
      parsed.listSessions = true;
      continue;
    }
    parsed.prompt = [current, ...args].join(" ").trim();
    parsed.positionalPrompt = true;
    break;
  }

  return parsed;
}

const parsed = parseArgs(process.argv.slice(2));
const state = loadState();

if (parsed.listSessions) {
  for (const session of state.sessions) {
    process.stdout.write(session.resumeId + "\\t" + session.preview + "\\n");
  }
  process.exit(0);
}

if (BEHAVIOR === "logged-out" && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
  process.stderr.write("authentication missing\\n");
  process.exit(1);
}

const session = parsed.resume ? findSessionByResumeToken(state, parsed.resume) || nextSession(state, parsed.prompt) : nextSession(state, parsed.prompt);

state.lastInvocation = {
  sessionId: session.id,
  resumeId: session.resumeId,
  model: parsed.model,
  approvalMode: parsed.approvalMode,
  outputFormat: parsed.outputFormat,
  resume: parsed.resume,
  sandbox: parsed.sandbox,
  prompt: parsed.prompt,
  promptFlag: parsed.promptFlag,
  positionalPrompt: parsed.positionalPrompt
};
saveState(state);

const response =
  parsed.prompt.includes("<structured_output_contract>") || parsed.prompt.includes("You are Gemini performing a code review.")
    ? structuredReviewPayload(parsed.prompt)
    : taskPayload(parsed.prompt, parsed.resume);

if (parsed.outputFormat === "json") {
  process.stdout.write(
    JSON.stringify({
      response,
      stats: {
        input_tokens: 10,
        output_tokens: 20
      }
    }) + "\\n"
  );
  process.exit(0);
}

if (parsed.outputFormat === "stream-json") {
  outputJsonLine({
    type: "init",
    sessionId: session.id,
    resumeToken: session.resumeId,
    model: parsed.model
  });

  if (BEHAVIOR === "interruptible-slow-task") {
    setTimeout(() => {
      outputJsonLine({
        type: "message",
        role: "assistant",
        content: response
      });
      outputJsonLine({
        type: "result",
        sessionId: session.id,
        resumeToken: session.resumeId,
        response,
        stats: {
          input_tokens: 10,
          output_tokens: 20
        }
      });
      process.exit(0);
    }, 30000);
    return;
  }

  if (BEHAVIOR === "slow-stream") {
    setTimeout(() => {
      outputJsonLine({
        type: "message",
        role: "assistant",
        content: response
      });
      setTimeout(() => {
        outputJsonLine({
          type: "result",
          sessionId: session.id,
          resumeToken: session.resumeId,
          response,
          stats: {
            input_tokens: 10,
            output_tokens: 20
          }
        });
        process.exit(0);
      }, 80);
    }, 80);
    return;
  }

  if (BEHAVIOR === "nested-stream") {
    const nestedParts = response.split("\\n").map((text, index, parts) => ({
      text: index < parts.length - 1 ? text + "\\n" : text
    }));
    setTimeout(() => {
      outputJsonLine({
        type: "content_delta",
        role: "model",
        content: {
          parts: nestedParts
        }
      });
      setTimeout(() => {
        outputJsonLine({
          type: "result",
          sessionId: session.id,
          resumeToken: session.resumeId,
          response: {
            content: {
              parts: nestedParts
            }
          },
          stats: {
            input_tokens: 10,
            output_tokens: 20
          }
        });
        process.exit(0);
      }, 80);
    }, 80);
    return;
  }

  if (BEHAVIOR === "with-reasoning") {
    outputJsonLine({
      type: "reasoning",
      summary: [
        {
          text: parsed.prompt.includes("<structured_output_contract>")
            ? "Reviewed the changed files and checked the likely regression paths first."
            : "Inspected the prompt, gathered evidence, and checked the highest-risk paths first."
        }
      ]
    });
  }

  outputJsonLine({
    type: "message",
    role: "assistant",
    content: response
  });
  outputJsonLine({
    type: "result",
    sessionId: session.id,
    resumeToken: session.resumeId,
    response,
    stats: {
      input_tokens: 10,
      output_tokens: 20
    }
  });
  process.exit(0);
}

process.stdout.write(response + "\\n");
`;
  writeExecutable(scriptPath, source);

  if (process.platform === "win32") {
    const geminiCmd = `@echo off\r\nnode "%~dp0gemini" %*\r\n`;
    fs.writeFileSync(path.join(binDir, "gemini.cmd"), geminiCmd, {
      encoding: "utf8",
    });
  }
}

export function buildEnv(binDir) {
  const sep = process.platform === "win32" ? ";" : ":";
  const homeDir = path.join(binDir, "fake-home");
  fs.mkdirSync(homeDir, { recursive: true });
  // Clean up session-related env vars to prevent cross-test pollution
  const {
    GEMINI_COMPANION_SESSION_ID: _sess,
    GEMINI_COMPANION_APP_SERVER_ENDPOINT: _endpoint,
    ...cleanParentEnv
  } = process.env;
  return {
    ...cleanParentEnv,
    HOME: homeDir,
    USERPROFILE: homeDir,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || "test-gemini-key",
    PATH: `${binDir}${sep}${process.env.PATH}`,
  };
}
