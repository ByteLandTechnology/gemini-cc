import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import readline from "node:readline";

import { readJsonFile } from "./fs.mjs";
import { collectReviewContext } from "./git.mjs";
import { loadBrokerSession } from "./broker-lifecycle.mjs";
import { binaryAvailable } from "./process.mjs";

const DEFAULT_PROVIDER_ID = "gemini";
const DEFAULT_PROVIDER_NAME = "Gemini";
const DEFAULT_PROVIDER_COMMAND = "gemini";
const DEFAULT_PROVIDER_INSTALL_COMMAND = "npm install -g @google/gemini-cli";
const DEFAULT_PROVIDER_RESUME_PREFIX = "gemini --resume";
const DEFAULT_PROVIDER_MODEL = "";

const TASK_THREAD_PREFIX = "Gemini Companion Task";
const DEFAULT_CONTINUE_PROMPT =
  "Continue from the current session state. Pick the next highest-value step and follow through until the task is resolved.";

const GEMINI_AUTH_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
];
const GEMINI_AUTH_CACHE_FILES = [
  path.join(os.homedir(), ".gemini", "oauth_creds.json"),
  path.join(os.homedir(), ".gemini", "credentials.json"),
];

function getProviderConfig(env = process.env) {
  const providerId =
    String(env.GEMINI_COMPANION_PROVIDER_ID ?? DEFAULT_PROVIDER_ID)
      .trim()
      .toLowerCase() || DEFAULT_PROVIDER_ID;
  const cliCommand =
    String(
      env.GEMINI_COMPANION_PROVIDER_BIN ?? DEFAULT_PROVIDER_COMMAND,
    ).trim() || DEFAULT_PROVIDER_COMMAND;
  const displayName =
    String(
      env.GEMINI_COMPANION_PROVIDER_NAME ?? DEFAULT_PROVIDER_NAME,
    ).trim() || DEFAULT_PROVIDER_NAME;
  const installCommand =
    String(
      env.GEMINI_COMPANION_PROVIDER_INSTALL ?? DEFAULT_PROVIDER_INSTALL_COMMAND,
    ).trim() || DEFAULT_PROVIDER_INSTALL_COMMAND;
  const resumePrefix =
    String(
      env.GEMINI_COMPANION_PROVIDER_RESUME_PREFIX ??
        DEFAULT_PROVIDER_RESUME_PREFIX,
    ).trim() || DEFAULT_PROVIDER_RESUME_PREFIX;
  const configuredDefaultModel = String(
    env.GEMINI_COMPANION_DEFAULT_MODEL ?? DEFAULT_PROVIDER_MODEL,
  ).trim();
  const defaultModel = configuredDefaultModel || null;

  return {
    providerId,
    cliCommand,
    displayName,
    installCommand,
    resumePrefix,
    defaultModel,
  };
}

function cleanProviderStderr(stderr) {
  return String(stderr ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .join("\n");
}

function normalizeReasoningText(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeReasoningSections(existingSections, nextSections) {
  const merged = [];
  for (const section of [...existingSections, ...nextSections]) {
    const normalized = normalizeReasoningText(section);
    if (!normalized || merged.includes(normalized)) {
      continue;
    }
    merged.push(normalized);
  }
  return merged;
}

function extractReasoningSections(value) {
  if (!value) {
    return [];
  }

  if (typeof value === "string") {
    const normalized = normalizeReasoningText(value);
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractReasoningSections(entry));
  }

  if (typeof value === "object") {
    return [
      ...extractReasoningSections(value.text),
      ...extractReasoningSections(value.summary),
      ...extractReasoningSections(value.content),
      ...extractReasoningSections(value.parts),
    ];
  }

  return [];
}

function shorten(text, limit = 72) {
  const normalized = String(text ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function looksLikeVerificationCommand(command) {
  return /\b(test|tests|lint|build|typecheck|type-check|check|verify|validate|pytest|jest|vitest|cargo test|npm test|pnpm test|yarn test|go test|mvn test|gradle test|tsc|eslint|ruff)\b/i.test(
    command,
  );
}

function buildTaskThreadName(prompt) {
  const excerpt = shorten(prompt, 56);
  return excerpt ? `${TASK_THREAD_PREFIX}: ${excerpt}` : TASK_THREAD_PREFIX;
}

function emitProgress(onProgress, message, phase = null, extra = {}) {
  if (!onProgress || !message) {
    return;
  }
  if (!phase && Object.keys(extra).length === 0) {
    onProgress(message);
    return;
  }
  onProgress({ message, phase, ...extra });
}

function buildApprovalArgs({ write = false } = {}) {
  if (write) {
    return ["--approval-mode", "yolo", "--sandbox"];
  }
  return ["--approval-mode", "plan"];
}

function buildGeminiArgs(options = {}) {
  const provider = getProviderConfig(options.env);
  const args = ["--output-format", "stream-json"];

  const selectedModel = options.model ?? provider.defaultModel;
  if (selectedModel) {
    args.push("--model", selectedModel);
  }

  if (options.resumeSessionId) {
    const resumeToken = normalizeGeminiResumeToken(options.resumeSessionId);
    if (!resumeToken) {
      throw new Error(
        `Unsupported ${provider.displayName} resume token: ${options.resumeSessionId}. Use /gemini:rescue --resume to continue the latest project session.`,
      );
    }
    args.push("--resume", resumeToken);
  }

  args.push(...buildApprovalArgs({ write: options.write }));
  args.push("--prompt", options.prompt);
  return args;
}

function extractSessionIdentifier(value) {
  return String(value ?? "").trim();
}

export function isSupportedGeminiResumeToken(value) {
  const token = extractSessionIdentifier(value);
  if (!token) {
    return false;
  }
  if (token === "latest") {
    return true;
  }
  if (/^\d+$/.test(token)) {
    return true;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    token,
  );
}

export function normalizeGeminiResumeToken(value) {
  const token = extractSessionIdentifier(value);
  return isSupportedGeminiResumeToken(token) ? token : null;
}

function extractResumeToken(event) {
  return (
    normalizeGeminiResumeToken(event?.resumeToken) ??
    normalizeGeminiResumeToken(event?.resume_token) ??
    normalizeGeminiResumeToken(event?.resumeId) ??
    normalizeGeminiResumeToken(event?.resume_id) ??
    normalizeGeminiResumeToken(event?.sessionId) ??
    normalizeGeminiResumeToken(event?.session_id)
  );
}

function formatShellCommandProgress(event) {
  const rawCommand =
    event.command ??
    event.args?.command ??
    event.arguments?.command ??
    event.payload?.command ??
    event.tool_input?.command ??
    "";
  const command = String(rawCommand ?? "").trim();
  if (!command) {
    return null;
  }

  return {
    message: `Running command: ${shorten(command, 96)}`,
    phase: looksLikeVerificationCommand(command) ? "verifying" : "running",
    logTitle: "Tool request",
    logBody: command,
    command,
  };
}

function formatFileEditProgress(event) {
  const candidateFiles = [
    ...(Array.isArray(event.files) ? event.files : []),
    ...(Array.isArray(event.paths) ? event.paths : []),
    ...(Array.isArray(event.payload?.files) ? event.payload.files : []),
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  if (candidateFiles.length === 0) {
    return null;
  }

  return {
    message: `Applying ${candidateFiles.length} file change(s).`,
    phase: "editing",
    touchedFiles: candidateFiles,
  };
}

function formatToolUseProgress(event) {
  const toolName =
    String(
      event.tool ??
        event.name ??
        event.toolName ??
        event.payload?.tool ??
        event.payload?.name ??
        "",
    ).trim() || "tool";

  if (toolName === "run_shell_command") {
    return formatShellCommandProgress(event);
  }

  const fileEdit = formatFileEditProgress(event);
  if (fileEdit) {
    return fileEdit;
  }

  return {
    message: `Running tool: ${toolName}.`,
    phase: "investigating",
    logTitle: "Tool request",
    logBody: JSON.stringify(event, null, 2),
  };
}

function extractEventType(event) {
  return String(event?.type ?? event?.event ?? "")
    .trim()
    .toLowerCase();
}

function extractAssistantText(event) {
  return String(
    event?.text ??
      event?.content ??
      event?.message ??
      event?.delta ??
      event?.payload?.text ??
      event?.payload?.content ??
      "",
  );
}

function extractResultText(event) {
  return String(
    event?.response ??
      event?.result?.response ??
      event?.message ??
      event?.payload?.response ??
      event?.payload?.text ??
      "",
  );
}

function buildReviewPrompt(context) {
  return [
    "You are Gemini performing a code review.",
    "Review the repository context below and report only material issues.",
    "If the change looks safe, say that directly and keep the review concise.",
    `Target: ${context.target.label}`,
    "",
    "<review_contract>",
    "- Return plain text only.",
    "- Prefer actionable findings over stylistic feedback.",
    "- If there are no material issues, include the phrase `No material issues found.`",
    "</review_contract>",
    "",
    "<repository_context>",
    context.content,
    "</repository_context>",
  ].join("\n");
}

function appendOutputSchema(prompt, outputSchema) {
  if (!outputSchema) {
    return prompt;
  }

  return [
    prompt,
    "",
    "<output_schema>",
    "Return only valid JSON that matches this schema exactly.",
    "Do not wrap the JSON in Markdown code fences.",
    "Do not add any prose before or after the JSON.",
    "The first character of your response must be `{` (or `[` if the schema requires an array).",
    JSON.stringify(outputSchema, null, 2),
    "</output_schema>",
  ].join("\n");
}

function prependEffortHint(prompt, effort) {
  if (!effort) {
    return prompt;
  }

  return [`Reasoning effort preference: ${effort}.`, "", prompt].join("\n");
}

async function runGeminiCli(cwd, options = {}) {
  const provider = getProviderConfig(options.env);
  const availability = getGeminiAvailability(cwd, options.env);
  if (!availability.available) {
    throw new Error(
      `${provider.displayName} CLI is not installed or does not support headless mode. Install it with \`${provider.installCommand}\`, then rerun \`/gemini:setup\`.`,
    );
  }

  const args = buildGeminiArgs({
    env: options.env,
    model: options.model,
    resumeSessionId: options.resumeSessionId,
    write: options.write,
    prompt: options.prompt,
  });

  return new Promise((resolve, reject) => {
    const child = spawn(provider.cliCommand, args, {
      cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      windowsHide: true,
    });

    const state = {
      sessionId: options.resumeSessionId ?? null,
      resumeToken: normalizeGeminiResumeToken(options.resumeSessionId),
      turnId: null,
      reasoningSummary: [],
      stderr: "",
      finalMessage: "",
      errorMessage: "",
      touchedFiles: new Set(),
      commandExecutions: [],
      rawEvents: [],
      settled: false,
    };

    const maybeResolve = (exitCode) => {
      if (state.settled) {
        return;
      }
      state.settled = true;
      resolve({
        status: exitCode === 0 ? 0 : 1,
        threadId: state.sessionId,
        resumeToken: state.resumeToken,
        turnId: state.turnId,
        finalMessage: state.finalMessage.trim(),
        reasoningSummary: state.reasoningSummary,
        error: state.errorMessage ? new Error(state.errorMessage) : null,
        stderr: cleanProviderStderr(state.stderr),
        touchedFiles: [...state.touchedFiles],
        commandExecutions: state.commandExecutions,
      });
    };

    child.on("error", (error) => {
      if (state.settled) {
        return;
      }
      state.settled = true;
      reject(error);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      state.stderr += chunk;
    });

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        state.finalMessage = `${state.finalMessage}${state.finalMessage ? "\n" : ""}${line}`;
        return;
      }

      state.rawEvents.push(event);
      const type = extractEventType(event);
      if (!type) {
        return;
      }

      if (type === "init") {
        state.sessionId =
          event.sessionId ?? event.session_id ?? state.sessionId;
        state.resumeToken = extractResumeToken(event) ?? state.resumeToken;
        state.turnId = event.turnId ?? event.turn_id ?? state.turnId;
        emitProgress(
          options.onProgress,
          `Session ready (${state.sessionId ?? "pending"}).`,
          "starting",
          {
            threadId: state.sessionId,
            resumeToken: state.resumeToken,
            turnId: state.turnId,
          },
        );
        return;
      }

      if (type === "reasoning") {
        state.reasoningSummary = mergeReasoningSections(
          state.reasoningSummary,
          extractReasoningSections(event),
        );
        if (state.reasoningSummary.length > 0) {
          emitProgress(
            options.onProgress,
            "Captured reasoning summary.",
            "investigating",
            {
              logTitle: "Reasoning summary",
              logBody: state.reasoningSummary.join("\n"),
            },
          );
        }
        return;
      }

      if (type === "tool_use") {
        const progress = formatToolUseProgress(event);
        if (!progress) {
          return;
        }
        for (const touchedFile of progress.touchedFiles ?? []) {
          state.touchedFiles.add(touchedFile);
        }
        if (progress.command) {
          state.commandExecutions.push({ command: progress.command });
        }
        emitProgress(options.onProgress, progress.message, progress.phase, {
          threadId: state.sessionId,
          resumeToken: state.resumeToken,
          logTitle: progress.logTitle,
          logBody: progress.logBody,
        });
        return;
      }

      if (type === "tool_result") {
        const body =
          typeof event.output === "string"
            ? event.output
            : typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result ?? event.output ?? event, null, 2);
        emitProgress(options.onProgress, "Tool completed.", "running", {
          threadId: state.sessionId,
          resumeToken: state.resumeToken,
          logTitle: "Tool result",
          logBody: body,
        });
        return;
      }

      if (type === "message") {
        const role = String(event.role ?? "assistant")
          .trim()
          .toLowerCase();
        if (role !== "assistant") {
          return;
        }
        const text = extractAssistantText(event);
        if (!text) {
          return;
        }
        state.finalMessage = `${state.finalMessage}${text}`;
        return;
      }

      if (type === "error") {
        const errorText = String(
          event.message ?? event.error?.message ?? event.error ?? "",
        ).trim();
        if (errorText) {
          state.errorMessage = errorText;
          emitProgress(
            options.onProgress,
            `${provider.displayName} error: ${errorText}`,
            "failed",
          );
        }
        return;
      }

      if (type === "result") {
        const response = extractResultText(event).trim();
        if (response) {
          state.finalMessage = response;
        }
        state.turnId = event.turnId ?? event.turn_id ?? state.turnId;
        state.sessionId =
          event.sessionId ?? event.session_id ?? state.sessionId;
        state.resumeToken = extractResumeToken(event) ?? state.resumeToken;
        state.reasoningSummary = mergeReasoningSections(
          state.reasoningSummary,
          extractReasoningSections(
            event.reasoningSummary ?? event.reasoning ?? event.summary,
          ),
        );
        for (const touchedFile of event.touchedFiles ?? []) {
          state.touchedFiles.add(String(touchedFile));
        }
      }
    });

    child.on("close", (code) => {
      stdout.close();
      if (!state.errorMessage && code !== 0) {
        const stderr = cleanProviderStderr(state.stderr);
        state.errorMessage =
          stderr || `${provider.displayName} exited with code ${code}.`;
      }
      maybeResolve(code ?? 1);
    });
  });
}

function detectGeminiAuth(env = process.env) {
  const signals = [];
  for (const key of GEMINI_AUTH_ENV_KEYS) {
    if (env[key]) {
      signals.push(`detected ${key}`);
    }
  }

  for (const candidate of GEMINI_AUTH_CACHE_FILES) {
    if (fs.existsSync(candidate)) {
      signals.push(`found cached credentials at ${candidate}`);
      break;
    }
  }

  return signals;
}

export function getProviderInfo(env = process.env) {
  return getProviderConfig(env);
}

export function getGeminiAvailability(cwd, env = process.env) {
  const provider = getProviderConfig(env);
  const versionStatus = binaryAvailable(provider.cliCommand, ["--version"], {
    cwd,
    env,
  });
  if (!versionStatus.available) {
    return versionStatus;
  }

  return {
    available: true,
    detail: `${versionStatus.detail}; headless mode available`,
  };
}

export function getSessionRuntimeStatus(
  env = process.env,
  cwd = process.cwd(),
) {
  const provider = getProviderConfig(env);
  const endpoint =
    env?.GEMINI_COMPANION_APP_SERVER_ENDPOINT ??
    loadBrokerSession(cwd)?.endpoint ??
    null;
  if (endpoint) {
    return {
      mode: "shared",
      label: `shared ${provider.displayName} broker`,
      detail: `This Claude session is configured to reuse one shared ${provider.displayName} runtime.`,
      endpoint,
      providerId: provider.providerId,
      providerName: provider.displayName,
    };
  }

  return {
    mode: "direct",
    label: `${provider.displayName} direct startup`,
    detail: `No shared ${provider.displayName} runtime is active yet. The first review or task command will start one on demand.`,
    endpoint: null,
    providerId: provider.providerId,
    providerName: provider.displayName,
  };
}

export function getGeminiLoginStatus(cwd, env = process.env) {
  const provider = getProviderConfig(env);
  const availability = getGeminiAvailability(cwd, env);
  if (!availability.available) {
    return {
      available: false,
      loggedIn: false,
      detail: availability.detail,
      providerId: provider.providerId,
      providerName: provider.displayName,
    };
  }

  const authSignals = detectGeminiAuth(env);
  if (authSignals.length > 0) {
    return {
      available: true,
      loggedIn: true,
      detail: authSignals.join("; "),
      providerId: provider.providerId,
      providerName: provider.displayName,
    };
  }

  return {
    available: true,
    loggedIn: false,
    detail:
      "No Gemini authentication detected. Set GEMINI_API_KEY or GOOGLE_API_KEY, configure GOOGLE_APPLICATION_CREDENTIALS for Vertex AI, or launch `gemini` and run `/auth` once.",
    providerId: provider.providerId,
    providerName: provider.displayName,
  };
}

export async function interruptAppServerTurn(_cwd, { threadId, turnId }) {
  const provider = getProviderConfig();
  if (!threadId && !turnId) {
    return {
      attempted: false,
      interrupted: false,
      transport: null,
      detail: "missing session or turn identifier",
    };
  }

  return {
    attempted: false,
    interrupted: false,
    transport: "direct",
    detail: `${provider.displayName} headless sessions are cancelled by terminating the running process.`,
  };
}

export async function runAppServerReview(cwd, options = {}) {
  const provider = getProviderConfig(options.env);
  emitProgress(
    options.onProgress,
    `Starting ${provider.displayName} review session.`,
    "starting",
  );
  const target =
    options.target?.type === "baseBranch"
      ? {
          mode: "branch",
          label: `branch diff against ${options.target.branch}`,
          baseRef: options.target.branch,
        }
      : { mode: "working-tree", label: "working tree diff" };
  const context = collectReviewContext(cwd, target);
  const result = await runGeminiCli(context.repoRoot, {
    env: options.env,
    model: options.model,
    prompt: buildReviewPrompt(context),
    write: false,
    onProgress: options.onProgress,
  });

  return {
    status: result.status,
    threadId: result.threadId,
    resumeToken: result.resumeToken,
    sourceThreadId: result.threadId,
    turnId: result.turnId,
    reviewText: result.finalMessage,
    reasoningSummary: result.reasoningSummary,
    turn: null,
    error: result.error,
    stderr: result.stderr,
  };
}

export async function runAppServerTurn(cwd, options = {}) {
  const provider = getProviderConfig(options.env);
  const prompt = options.prompt?.trim() || options.defaultPrompt || "";
  if (!prompt) {
    throw new Error(
      `A prompt is required for this ${provider.displayName} run.`,
    );
  }

  if (options.resumeThreadId) {
    emitProgress(
      options.onProgress,
      `Resuming session ${options.resumeThreadId}.`,
      "starting",
    );
  } else {
    emitProgress(
      options.onProgress,
      `Starting ${provider.displayName} session.`,
      "starting",
    );
  }

  const executionPrompt = appendOutputSchema(
    prependEffortHint(prompt, options.effort),
    options.outputSchema,
  );
  const result = await runGeminiCli(cwd, {
    env: options.env,
    model: options.model,
    resumeSessionId: options.resumeThreadId,
    prompt: executionPrompt,
    write: options.sandbox === "workspace-write",
    onProgress: options.onProgress,
  });

  return {
    status: result.status,
    threadId: result.threadId,
    resumeToken: result.resumeToken,
    turnId: result.turnId,
    finalMessage: result.finalMessage,
    reasoningSummary: result.reasoningSummary,
    turn: null,
    error: result.error,
    stderr: result.stderr,
    fileChanges: [],
    touchedFiles: result.touchedFiles,
    commandExecutions: result.commandExecutions,
  };
}

export async function findLatestTaskThread(cwd) {
  const provider = getProviderConfig();
  const availability = getGeminiAvailability(cwd);
  if (!availability.available) {
    throw new Error(
      `${provider.displayName} CLI is not installed or does not support headless mode. Install it with \`${provider.installCommand}\`, then rerun \`/gemini:setup\`.`,
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(provider.cliCommand, ["--list-sessions"], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.on("error", reject);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if ((code ?? 1) !== 0) {
        reject(
          new Error(
            cleanProviderStderr(stderr) ||
              `${provider.displayName} failed to list sessions.`,
          ),
        );
        return;
      }

      const sessions = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (sessions.length === 0) {
        resolve(null);
        return;
      }

      resolve({
        id: "latest",
        threadId: null,
        resumeToken: "latest",
      });
    });
  });
}

export function buildPersistentTaskThreadName(prompt) {
  return buildTaskThreadName(prompt);
}

export function formatResumeCommand(resumeToken, env = process.env) {
  if (!resumeToken) {
    return null;
  }

  const provider = getProviderConfig(env);
  return `${provider.resumePrefix} ${resumeToken}`;
}

function extractStructuredJsonCandidates(rawOutput) {
  const text = typeof rawOutput === "string" ? rawOutput.trim() : "";
  if (!text) {
    return [];
  }

  const seen = new Set();
  const candidates = [];
  const pushCandidate = (value) => {
    const candidate = String(value ?? "").trim();
    if (!candidate || seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    candidates.push(candidate);
  };

  const fencedBlockPattern =
    /```([a-zA-Z0-9_-]+)?[ \t]*\r?\n([\s\S]*?)\r?\n```/g;
  for (const match of text.matchAll(fencedBlockPattern)) {
    const language = String(match[1] ?? "")
      .trim()
      .toLowerCase();
    const body = String(match[2] ?? "").trim();
    if (!body) {
      continue;
    }
    if (
      language === "json" ||
      (!language && (body.startsWith("{") || body.startsWith("[")))
    ) {
      pushCandidate(body);
    }
  }

  return candidates;
}

export function parseStructuredOutput(rawOutput, fallback = {}) {
  if (!rawOutput) {
    return {
      parsed: null,
      parseError:
        fallback.failureMessage ??
        "Gemini did not return a final structured message.",
      rawOutput: rawOutput ?? "",
      ...fallback,
    };
  }

  for (const candidate of extractStructuredJsonCandidates(rawOutput)) {
    try {
      return {
        parsed: JSON.parse(candidate),
        parseError: null,
        rawOutput,
        ...fallback,
      };
    } catch {
      // Fall back to parsing the original raw output so parseError still reflects the original payload.
    }
  }

  try {
    return {
      parsed: JSON.parse(rawOutput),
      parseError: null,
      rawOutput,
      ...fallback,
    };
  } catch (error) {
    return {
      parsed: null,
      parseError: error.message,
      rawOutput,
      ...fallback,
    };
  }
}

export function readOutputSchema(schemaPath) {
  return readJsonFile(schemaPath);
}

export { DEFAULT_CONTINUE_PROMPT, TASK_THREAD_PREFIX };
