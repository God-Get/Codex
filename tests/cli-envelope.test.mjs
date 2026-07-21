import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["apps/cli/dist/index.js", ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function assertSuccessEnvelope(payload, command) {
  assert.equal(payload.ok, true);
  assert.equal(payload.apiVersion, "0.2");
  assert.equal(payload.command, command);
  assert.ok(Object.hasOwn(payload, "result"));
  assert.equal(Object.hasOwn(payload, "diagnostic"), false);
}

function assertFailureEnvelope(payload, command) {
  assert.equal(payload.ok, false);
  assert.equal(payload.apiVersion, "0.2");
  assert.equal(payload.command, command);
  assert.equal(typeof payload.diagnostic.code, "string");
  assert.equal(typeof payload.diagnostic.message, "string");
  assert.equal(Object.hasOwn(payload, "result"), false);
}

test("profiles list uses the shared success envelope", async () => {
  const response = await run(["profiles", "list", "--json"]);
  assert.equal(response.code, 0, response.stderr);
  assert.equal(response.stderr, "");
  const payload = JSON.parse(response.stdout);
  assertSuccessEnvelope(payload, "profiles.list");
  assert.ok(Array.isArray(payload.result.profiles));
});

test("diagnostics uses the shared success envelope", async () => {
  const response = await run(["diagnostics", "--json"]);
  assert.equal(response.code, 0, response.stderr);
  assert.equal(response.stderr, "");
  const payload = JSON.parse(response.stdout);
  assertSuccessEnvelope(payload, "diagnostics");
  assert.ok(Array.isArray(payload.result.diagnostics));
  assert.equal(payload.result.count, payload.result.diagnostics.length);
});

test("doctor uses the shared success envelope", async () => {
  const response = await run(["doctor", "--json"]);
  const payload = JSON.parse(response.stdout);
  assertSuccessEnvelope(payload, "doctor");
  assert.equal(typeof payload.result.valid, "boolean");
  assert.ok(Array.isArray(payload.result.checks));
});

test("unknown command uses the shared failure envelope on stderr", async () => {
  const response = await run(["unknown", "--json"]);
  assert.equal(response.code, 2);
  assert.equal(response.stdout, "");
  const payload = JSON.parse(response.stderr);
  assertFailureEnvelope(payload, "unknown");
  assert.equal(payload.diagnostic.code, "CLI-1000");
});

test("invalid profile uses the shared failure envelope", async () => {
  const response = await run(["profiles", "inspect", "missing-profile", "--json"]);
  assert.equal(response.code, 1);
  assert.equal(response.stdout, "");
  const payload = JSON.parse(response.stderr);
  assertFailureEnvelope(payload, "profiles.inspect");
  assert.equal(payload.diagnostic.code, "CLI-1301");
});
