import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  createBrokerEndpoint,
  parseBrokerEndpoint,
} from "../plugins/gemini/scripts/lib/broker-endpoint.mjs";
import { ensureBrokerSession } from "../plugins/gemini/scripts/lib/broker-lifecycle.mjs";
import { makeTempDir } from "./helpers.mjs";

test("createBrokerEndpoint uses Unix sockets on non-Windows platforms", () => {
  const endpoint = createBrokerEndpoint("/tmp/cxc-12345", "darwin");
  assert.equal(endpoint, "unix:/tmp/cxc-12345/broker.sock");
  assert.deepEqual(parseBrokerEndpoint(endpoint), {
    kind: "unix",
    path: "/tmp/cxc-12345/broker.sock",
  });
});

test("createBrokerEndpoint uses named pipes on Windows", () => {
  const endpoint = createBrokerEndpoint("C:\\\\Temp\\\\cxc-12345", "win32");
  assert.equal(endpoint, "pipe:\\\\.\\pipe\\cxc-12345-gemini-app-server");
  assert.deepEqual(parseBrokerEndpoint(endpoint), {
    kind: "pipe",
    path: "\\\\.\\pipe\\cxc-12345-gemini-app-server",
  });
});

test("ensureBrokerSession returns provider-aware failure details when the broker never becomes ready", async () => {
  const workspace = makeTempDir();
  const scriptPath = path.join(workspace, "noop-broker.mjs");
  fs.writeFileSync(scriptPath, "process.exit(0);\n", "utf8");

  const session = await ensureBrokerSession(workspace, {
    scriptPath,
    timeoutMs: 75,
    env: {
      ...process.env,
      GEMINI_COMPANION_PROVIDER_ID: "gemini",
      GEMINI_COMPANION_PROVIDER_NAME: "Gemini",
    },
  });

  assert.equal(session?.endpoint ?? null, null);
  assert.equal(session?.providerId, "gemini");
  assert.equal(session?.providerName, "Gemini");
  assert.equal(session?.failureReason, "endpoint_not_ready");
  assert.match(
    session?.failureDetail ?? "",
    /Shared Gemini broker did not become ready in time\./,
  );
});
