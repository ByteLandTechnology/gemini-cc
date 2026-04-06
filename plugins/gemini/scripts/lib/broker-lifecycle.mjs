import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createBrokerEndpoint,
  parseBrokerEndpoint,
} from "./broker-endpoint.mjs";
import { resolveStateDir } from "./state.mjs";

export const PID_FILE_ENV = "GEMINI_COMPANION_APP_SERVER_PID_FILE";
export const LOG_FILE_ENV = "GEMINI_COMPANION_APP_SERVER_LOG_FILE";
const BROKER_STATE_FILE = "broker.json";

function getProviderMetadata(env = process.env) {
  const providerId =
    String(env.GEMINI_COMPANION_PROVIDER_ID ?? "gemini")
      .trim()
      .toLowerCase() || "gemini";
  const providerName =
    String(env.GEMINI_COMPANION_PROVIDER_NAME ?? "Gemini").trim() || "Gemini";
  return { providerId, providerName };
}

export function brokerSessionMatchesProvider(session, provider) {
  if (!session || !provider) {
    return false;
  }
  if (session.providerId && session.providerId !== provider.providerId) {
    return false;
  }
  if (session.providerName && session.providerName !== provider.providerName) {
    return false;
  }
  if (
    session.appServerCommand &&
    provider.appServerCommand &&
    session.appServerCommand !== provider.appServerCommand
  ) {
    return false;
  }
  const sessionArgs = Array.isArray(session.appServerArgs)
    ? session.appServerArgs
    : null;
  const providerArgs = Array.isArray(provider.appServerArgs)
    ? provider.appServerArgs
    : null;
  if (
    sessionArgs &&
    providerArgs &&
    JSON.stringify(sessionArgs) !== JSON.stringify(providerArgs)
  ) {
    return false;
  }
  return true;
}

export function createBrokerSessionDir(prefix = "cxc-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function connectToEndpoint(endpoint) {
  const target = parseBrokerEndpoint(endpoint);
  return net.createConnection({ path: target.path });
}

export async function waitForBrokerEndpoint(endpoint, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await new Promise((resolve) => {
      const socket = connectToEndpoint(endpoint);
      socket.on("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
    });
    if (ready) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

export async function sendBrokerShutdown(endpoint) {
  await new Promise((resolve) => {
    const socket = connectToEndpoint(endpoint);
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({ id: 1, method: "broker/shutdown", params: {} })}\n`,
      );
    });
    socket.on("data", () => {
      socket.end();
      resolve();
    });
    socket.on("error", resolve);
    socket.on("close", resolve);
  });
}

export function spawnBrokerProcess({
  scriptPath,
  cwd,
  endpoint,
  pidFile,
  logFile,
  env = process.env,
}) {
  const logFd = fs.openSync(logFile, "a");
  const child = spawn(
    process.execPath,
    [
      scriptPath,
      "serve",
      "--endpoint",
      endpoint,
      "--cwd",
      cwd,
      "--pid-file",
      pidFile,
    ],
    {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    },
  );
  child.unref();
  fs.closeSync(logFd);
  return child;
}

function resolveBrokerStateFile(cwd) {
  return path.join(resolveStateDir(cwd), BROKER_STATE_FILE);
}

export function loadBrokerSession(cwd) {
  const stateFile = resolveBrokerStateFile(cwd);
  if (!fs.existsSync(stateFile)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

export function saveBrokerSession(cwd, session) {
  const stateDir = resolveStateDir(cwd);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    resolveBrokerStateFile(cwd),
    `${JSON.stringify(session, null, 2)}\n`,
    "utf8",
  );
}

export function clearBrokerSession(cwd) {
  const stateFile = resolveBrokerStateFile(cwd);
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
  }
}

async function isBrokerEndpointReady(endpoint) {
  if (!endpoint) {
    return false;
  }
  try {
    return await waitForBrokerEndpoint(endpoint, 150);
  } catch {
    return false;
  }
}

export async function ensureBrokerSession(cwd, options = {}) {
  const provider = {
    ...getProviderMetadata(options.env),
    ...(options.appServerCommand
      ? { appServerCommand: options.appServerCommand }
      : {}),
    ...(options.appServerArgs ? { appServerArgs: options.appServerArgs } : {}),
  };
  const existing = loadBrokerSession(cwd);
  if (
    existing &&
    brokerSessionMatchesProvider(existing, provider) &&
    (await isBrokerEndpointReady(existing.endpoint))
  ) {
    return {
      ...provider,
      ...existing,
    };
  }

  if (existing) {
    teardownBrokerSession({
      endpoint: existing.endpoint ?? null,
      pidFile: existing.pidFile ?? null,
      logFile: existing.logFile ?? null,
      sessionDir: existing.sessionDir ?? null,
      pid: existing.pid ?? null,
      killProcess: options.killProcess ?? null,
    });
    clearBrokerSession(cwd);
  }

  const sessionDir = createBrokerSessionDir();
  const endpointFactory = options.createBrokerEndpoint ?? createBrokerEndpoint;
  const endpoint = endpointFactory(sessionDir, options.platform);
  const pidFile = path.join(sessionDir, "broker.pid");
  const logFile = path.join(sessionDir, "broker.log");
  const scriptPath =
    options.scriptPath ??
    fileURLToPath(new URL("../app-server-broker.mjs", import.meta.url));

  let child = null;
  try {
    child = spawnBrokerProcess({
      scriptPath,
      cwd,
      endpoint,
      pidFile,
      logFile,
      env: options.env ?? process.env,
    });
  } catch (error) {
    teardownBrokerSession({
      endpoint,
      pidFile,
      logFile,
      sessionDir,
      pid: null,
      killProcess: options.killProcess ?? null,
    });
    return {
      ...provider,
      endpoint: null,
      pidFile,
      logFile,
      sessionDir,
      pid: null,
      failureReason: "spawn_failed",
      failureDetail: `Shared ${provider.providerName} broker failed to start: ${error.message}`,
    };
  }

  const ready = await waitForBrokerEndpoint(
    endpoint,
    options.timeoutMs ?? 2000,
  );
  if (!ready) {
    const brokerLogDetail = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, "utf8").trim()
      : "";
    teardownBrokerSession({
      endpoint,
      pidFile,
      logFile,
      sessionDir,
      pid: child?.pid ?? null,
      killProcess: options.killProcess ?? null,
    });
    return {
      ...provider,
      endpoint: null,
      pidFile,
      logFile,
      sessionDir,
      pid: child?.pid ?? null,
      failureReason: "endpoint_not_ready",
      failureDetail: brokerLogDetail
        ? `Shared ${provider.providerName} broker did not become ready in time. ${brokerLogDetail}`
        : `Shared ${provider.providerName} broker did not become ready in time.`,
    };
  }

  const session = {
    ...provider,
    endpoint,
    pidFile,
    logFile,
    sessionDir,
    pid: child?.pid ?? null,
  };
  saveBrokerSession(cwd, session);
  return session;
}

export function teardownBrokerSession({
  endpoint = null,
  pidFile,
  logFile,
  sessionDir = null,
  pid = null,
  killProcess = null,
}) {
  if (Number.isFinite(pid) && killProcess) {
    try {
      killProcess(pid);
    } catch {
      // Ignore missing or already-exited broker processes.
    }
  }

  if (pidFile && fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }

  if (logFile && fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }

  if (endpoint) {
    try {
      const target = parseBrokerEndpoint(endpoint);
      if (target.kind === "unix" && fs.existsSync(target.path)) {
        fs.unlinkSync(target.path);
      }
    } catch {
      // Ignore malformed or already-removed broker endpoints during teardown.
    }
  }

  const resolvedSessionDir =
    sessionDir ??
    (pidFile ? path.dirname(pidFile) : logFile ? path.dirname(logFile) : null);
  if (resolvedSessionDir && fs.existsSync(resolvedSessionDir)) {
    try {
      fs.rmdirSync(resolvedSessionDir);
    } catch {
      // Ignore non-empty or missing directories.
    }
  }
}
