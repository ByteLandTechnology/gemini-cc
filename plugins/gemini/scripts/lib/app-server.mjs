/**
 * @typedef {Error & { data?: unknown, rpcCode?: number }} ProtocolError
 * @typedef {import("./app-server-protocol").AppServerMethod} AppServerMethod
 * @typedef {import("./app-server-protocol").AppServerNotification} AppServerNotification
 * @typedef {import("./app-server-protocol").AppServerNotificationHandler} AppServerNotificationHandler
 * @typedef {import("./app-server-protocol").ClientInfo} ClientInfo
 * @typedef {import("./app-server-protocol").AppServerClientOptions} AppServerClientOptions
 * @typedef {import("./app-server-protocol").InitializeCapabilities} InitializeCapabilities
 */
import fs from "node:fs";
import net from "node:net";
import process from "node:process";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { parseBrokerEndpoint } from "./broker-endpoint.mjs";
import { ensureBrokerSession } from "./broker-lifecycle.mjs";
import { terminateProcessTree } from "./process.mjs";

const PLUGIN_MANIFEST_URL = new URL(
  "../../.claude-plugin/plugin.json",
  import.meta.url,
);
const PLUGIN_MANIFEST = JSON.parse(
  fs.readFileSync(PLUGIN_MANIFEST_URL, "utf8"),
);

export const BROKER_ENDPOINT_ENV = "GEMINI_COMPANION_APP_SERVER_ENDPOINT";
export const BROKER_BUSY_RPC_CODE = -32001;
export const BROKER_STARTUP_RPC_CODE = -32002;

function normalizeProviderName(providerId, explicitName) {
  const trimmed = String(explicitName ?? "").trim();
  if (trimmed) {
    return trimmed;
  }
  const normalizedId =
    String(providerId ?? "")
      .trim()
      .toLowerCase() || "provider";
  return normalizedId.charAt(0).toUpperCase() + normalizedId.slice(1);
}

function getProviderMetadata(env = process.env) {
  const providerId =
    String(env?.GEMINI_COMPANION_PROVIDER_ID ?? "gemini")
      .trim()
      .toLowerCase() || "gemini";
  return {
    providerId,
    providerName: normalizeProviderName(
      providerId,
      env?.GEMINI_COMPANION_PROVIDER_NAME,
    ),
  };
}

export function getSharedRuntimeConfig(env = process.env) {
  const provider = getProviderMetadata(env);
  const command =
    String(env?.GEMINI_COMPANION_APP_SERVER_BIN ?? "").trim() || "gemini";
  const subcommand =
    String(
      env?.GEMINI_COMPANION_APP_SERVER_SUBCOMMAND ?? "app-server",
    ).trim() || "app-server";
  const explicitOverride = Boolean(
    env?.GEMINI_COMPANION_APP_SERVER_BIN ||
    env?.GEMINI_COMPANION_APP_SERVER_SUBCOMMAND,
  );
  const supported = explicitOverride;

  return {
    ...provider,
    command,
    args: [subcommand],
    supported,
    unavailableReason: supported
      ? null
      : `${provider.providerName} uses the direct headless runtime. Shared app-server reuse is unavailable unless GEMINI_COMPANION_APP_SERVER_BIN is configured explicitly.`,
  };
}

function createUnavailableRuntimeError(env = process.env) {
  const runtime = getSharedRuntimeConfig(env);
  return createProtocolError(
    runtime.unavailableReason ?? "Shared runtime is unavailable.",
    {
      code: BROKER_STARTUP_RPC_CODE,
      kind: "session-blocked",
      reason: "shared_runtime_unavailable",
      providerId: runtime.providerId,
      providerName: runtime.providerName,
    },
  );
}

function buildDefaultClientInfo(env = process.env) {
  const runtime = getSharedRuntimeConfig(env);
  /** @type {ClientInfo} */
  const clientInfo = {
    title: `${runtime.providerName} Companion`,
    name: "Claude Code",
    version: PLUGIN_MANIFEST.version ?? "0.0.0",
  };
  return clientInfo;
}

/** @type {InitializeCapabilities} */
const DEFAULT_CAPABILITIES = {
  experimentalApi: false,
  optOutNotificationMethods: [
    "item/agentMessage/delta",
    "item/reasoning/summaryTextDelta",
    "item/reasoning/summaryPartAdded",
    "item/reasoning/textDelta",
  ],
};

function buildJsonRpcError(code, message, data) {
  return data === undefined ? { code, message } : { code, message, data };
}

function createProtocolError(message, data) {
  const error = /** @type {ProtocolError} */ (new Error(message));
  error.data = data;
  if (data?.code !== undefined) {
    error.rpcCode = data.code;
  }
  return error;
}

class AppServerClientBase {
  constructor(cwd, options = {}) {
    this.cwd = cwd;
    this.options = options;
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = "";
    this.closed = false;
    this.exitError = null;
    /** @type {AppServerNotificationHandler | null} */
    this.notificationHandler = null;
    this.lineBuffer = "";
    this.transport = "unknown";

    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  setNotificationHandler(handler) {
    this.notificationHandler = handler;
  }

  /**
   * @template {AppServerMethod} M
   * @param {M} method
   * @param {import("./app-server-protocol").AppServerRequestParams<M>} params
   * @returns {Promise<import("./app-server-protocol").AppServerResponse<M>>}
   */
  request(method, params) {
    if (this.closed) {
      throw new Error("shared runtime client is closed.");
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.sendMessage({ id, method, params });
    });
  }

  notify(method, params = {}) {
    if (this.closed) {
      return;
    }
    this.sendMessage({ method, params });
  }

  handleChunk(chunk) {
    this.lineBuffer += chunk;
    let newlineIndex = this.lineBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.lineBuffer.slice(0, newlineIndex);
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      this.handleLine(line);
      newlineIndex = this.lineBuffer.indexOf("\n");
    }
  }

  handleLine(line) {
    if (!line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.handleExit(
        createProtocolError(
          `Failed to parse shared runtime JSONL: ${error.message}`,
          { line },
        ),
      );
      return;
    }

    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(
          createProtocolError(
            message.error.message ?? `shared runtime ${pending.method} failed.`,
            message.error,
          ),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    if (message.method && this.notificationHandler) {
      this.notificationHandler(/** @type {AppServerNotification} */ (message));
    }
  }

  handleServerRequest(message) {
    this.sendMessage({
      id: message.id,
      error: buildJsonRpcError(
        -32601,
        `Unsupported server request: ${message.method}`,
      ),
    });
  }

  handleExit(error) {
    if (this.exitResolved) {
      return;
    }

    this.exitResolved = true;
    this.exitError = error ?? null;

    for (const pending of this.pending.values()) {
      pending.reject(
        this.exitError ?? new Error("shared runtime connection closed."),
      );
    }
    this.pending.clear();
    this.resolveExit(undefined);
  }

  sendMessage(_message) {
    throw new Error("sendMessage must be implemented by subclasses.");
  }
}

class SpawnedGeminiAppServerClient extends AppServerClientBase {
  constructor(cwd, options = {}) {
    super(cwd, options);
    this.transport = "direct";
  }

  async initialize() {
    const runtime = getSharedRuntimeConfig(this.options.env);
    if (!runtime.supported) {
      throw createUnavailableRuntimeError(this.options.env);
    }

    this.proc = spawn(runtime.command, runtime.args, {
      cwd: this.cwd,
      env: this.options.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      windowsHide: true,
    });

    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");

    this.proc.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });

    this.proc.on("error", (error) => {
      this.handleExit(error);
    });

    this.proc.on("exit", (code, signal) => {
      const detail =
        code === 0
          ? null
          : createProtocolError(
              `${runtime.providerName} compatibility runtime exited unexpectedly (${signal ? `signal ${signal}` : `exit ${code}`}).`,
            );
      this.handleExit(detail);
    });

    this.readline = readline.createInterface({ input: this.proc.stdout });
    this.readline.on("line", (line) => {
      this.handleLine(line);
    });

    await this.request("initialize", {
      clientInfo:
        this.options.clientInfo ?? buildDefaultClientInfo(this.options.env),
      capabilities: this.options.capabilities ?? DEFAULT_CAPABILITIES,
    });
    this.notify("initialized", {});
  }

  async close() {
    if (this.closed) {
      await this.exitPromise;
      return;
    }

    this.closed = true;

    if (this.readline) {
      this.readline.close();
    }

    if (this.proc && !this.proc.killed) {
      this.proc.stdin.end();
      setTimeout(() => {
        if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
          // On Windows with shell: true, the direct child is cmd.exe.
          // Use terminateProcessTree to kill the entire tree including
          // the grandchild node process.
          if (process.platform === "win32") {
            try {
              terminateProcessTree(this.proc.pid);
            } catch {
              // Best-effort cleanup inside an unref'd timer — swallow errors
              // to avoid crashing the host process during shutdown.
            }
          } else {
            this.proc.kill("SIGTERM");
          }
        }
      }, 50).unref?.();
    }

    await this.exitPromise;
  }

  sendMessage(message) {
    const line = `${JSON.stringify(message)}\n`;
    const stdin = this.proc?.stdin;
    if (!stdin) {
      throw new Error("shared runtime stdin is not available.");
    }
    stdin.write(line);
  }
}

class BrokerGeminiAppServerClient extends AppServerClientBase {
  constructor(cwd, options = {}) {
    super(cwd, options);
    this.transport = "broker";
    this.endpoint = options.brokerEndpoint;
  }

  async initialize() {
    await new Promise((resolve, reject) => {
      const target = parseBrokerEndpoint(this.endpoint);
      this.socket = net.createConnection({ path: target.path });
      this.socket.setEncoding("utf8");
      this.socket.on("connect", resolve);
      this.socket.on("data", (chunk) => {
        this.handleChunk(chunk);
      });
      this.socket.on("error", (error) => {
        if (!this.exitResolved) {
          reject(error);
        }
        this.handleExit(error);
      });
      this.socket.on("close", () => {
        this.handleExit(this.exitError);
      });
    });

    await this.request("initialize", {
      clientInfo:
        this.options.clientInfo ?? buildDefaultClientInfo(this.options.env),
      capabilities: this.options.capabilities ?? DEFAULT_CAPABILITIES,
    });
    this.notify("initialized", {});
  }

  async close() {
    if (this.closed) {
      await this.exitPromise;
      return;
    }

    this.closed = true;
    if (this.socket) {
      this.socket.end();
    }
    await this.exitPromise;
  }

  sendMessage(message) {
    const line = `${JSON.stringify(message)}\n`;
    const socket = this.socket;
    if (!socket) {
      throw new Error("shared runtime broker connection is not connected.");
    }
    socket.write(line);
  }
}

export class AppServerClient {
  static async connect(cwd, options = {}) {
    const runtime = getSharedRuntimeConfig(options.env);
    let brokerEndpoint = null;
    if (!options.disableBroker) {
      brokerEndpoint =
        options.brokerEndpoint ??
        options.env?.[BROKER_ENDPOINT_ENV] ??
        process.env[BROKER_ENDPOINT_ENV] ??
        null;
      if (!brokerEndpoint) {
        if (!runtime.supported) {
          throw createUnavailableRuntimeError(options.env);
        }
        const brokerSession = await ensureBrokerSession(cwd, {
          env: options.env,
          providerId: runtime.providerId,
          providerName: runtime.providerName,
          appServerCommand: runtime.command,
          appServerArgs: runtime.args,
        });
        brokerEndpoint = brokerSession?.endpoint ?? null;
        if (!brokerEndpoint && brokerSession?.failureReason) {
          throw createProtocolError(
            brokerSession.failureDetail ||
              `Shared ${runtime.providerName} broker startup is not ready.`,
            {
              code: BROKER_STARTUP_RPC_CODE,
              kind: "session-blocked",
              reason: brokerSession.failureReason,
              providerName: runtime.providerName,
              providerId: runtime.providerId,
            },
          );
        }
      }
    }
    const client = brokerEndpoint
      ? new BrokerGeminiAppServerClient(cwd, { ...options, brokerEndpoint })
      : new SpawnedGeminiAppServerClient(cwd, options);
    await client.initialize();
    return client;
  }
}

export { AppServerClient as GeminiAppServerClient };
