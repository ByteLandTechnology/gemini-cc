import test from "node:test";
import assert from "node:assert/strict";

import { brokerSessionMatchesProvider } from "../plugins/gemini/scripts/lib/broker-lifecycle.mjs";
import {
  AppServerClient,
  getSharedRuntimeConfig,
} from "../plugins/gemini/scripts/lib/app-server.mjs";
import { makeTempDir } from "./helpers.mjs";

test("getSharedRuntimeConfig marks Gemini shared runtime as direct-only unless explicitly configured", () => {
  const config = getSharedRuntimeConfig({
    GEMINI_COMPANION_PROVIDER_ID: "gemini",
    GEMINI_COMPANION_PROVIDER_NAME: "Gemini",
  });

  assert.equal(config.supported, false);
  assert.equal(config.command, "gemini");
  assert.deepEqual(config.args, ["app-server"]);
  assert.match(config.unavailableReason ?? "", /direct headless runtime/i);
  assert.match(
    config.unavailableReason ?? "",
    /GEMINI_COMPANION_APP_SERVER_BIN/,
  );
});

test("getSharedRuntimeConfig accepts an explicit compatibility runtime override", () => {
  const config = getSharedRuntimeConfig({
    GEMINI_COMPANION_PROVIDER_ID: "gemini",
    GEMINI_COMPANION_PROVIDER_NAME: "Gemini",
    GEMINI_COMPANION_APP_SERVER_BIN: "custom-runtime",
    GEMINI_COMPANION_APP_SERVER_SUBCOMMAND: "serve-jsonrpc",
  });

  assert.equal(config.supported, true);
  assert.equal(config.command, "custom-runtime");
  assert.deepEqual(config.args, ["serve-jsonrpc"]);
});

test("AppServerClient rejects Gemini shared runtime startup without an explicit compatibility runtime", async () => {
  await assert.rejects(
    () =>
      AppServerClient.connect(makeTempDir(), {
        disableBroker: true,
        env: {
          GEMINI_COMPANION_PROVIDER_ID: "gemini",
          GEMINI_COMPANION_PROVIDER_NAME: "Gemini",
        },
      }),
    /direct headless runtime/i,
  );
});

test("brokerSessionMatchesProvider treats legacy sessions as compatible and detects provider mismatches", () => {
  assert.equal(
    brokerSessionMatchesProvider(
      { endpoint: "unix:/tmp/broker.sock" },
      {
        providerId: "gemini",
        providerName: "Gemini",
        appServerCommand: "gemini",
        appServerArgs: ["app-server"],
      },
    ),
    true,
  );

  assert.equal(
    brokerSessionMatchesProvider(
      {
        endpoint: "unix:/tmp/broker.sock",
        providerId: "codex",
        providerName: "Codex",
        appServerCommand: "codex",
        appServerArgs: ["app-server"],
      },
      {
        providerId: "gemini",
        providerName: "Gemini",
        appServerCommand: "gemini",
        appServerArgs: ["app-server"],
      },
    ),
    false,
  );
});
