import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["packages/authoring/dist/cli.js", ...args], {
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

async function validFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "codex-authoring-cli-"));
  await mkdir(path.join(root, "objects"));
  await writeFile(path.join(root, "project.md"), `---
codexVersion: 0.2.0
id: cli.fixture
title: CLI Fixture
profile: core
---
`, "utf8");
  await writeFile(path.join(root, "objects", "source.md"), `---
id: source.cli
type: source
title: Source
version: 1.0.0
status: draft
language: en
---
Body.
`, "utf8");
  return root;
}

function assertEnvelope(payload, ok) {
  assert.equal(payload.ok, ok);
  assert.equal(payload.apiVersion, "0.2");
  assert.equal(payload.command, "authoring.compile");
}

test("standalone authoring CLI emits shared success envelope with output", async () => {
  const root = await validFixture();
  const output = path.join(root, "compiled.json");
  const response = await run([root, `--output=${output}`, "--json"]);
  assert.equal(response.code, 0, response.stderr);
  assert.equal(response.stderr, "");
  const payload = JSON.parse(response.stdout);
  assertEnvelope(payload, true);
  assert.equal(payload.result.outputPath, output);
  assert.equal(payload.result.project.id, "cli.fixture");
  assert.equal(payload.result.projectId, "cli.fixture");
  assert.equal(payload.result.objectCount, 1);
});

test("standalone authoring CLI emits shared success envelope without output", async () => {
  const root = await validFixture();
  const response = await run([root, "--json"]);
  assert.equal(response.code, 0, response.stderr);
  assert.equal(response.stderr, "");
  const payload = JSON.parse(response.stdout);
  assertEnvelope(payload, true);
  assert.equal(payload.result.outputPath, undefined);
  assert.equal(payload.result.project.id, "cli.fixture");
  assert.equal(payload.result.projectId, "cli.fixture");
  assert.equal(payload.result.objectCount, 1);
});

test("standalone authoring CLI emits shared failure envelope", async () => {
  const root = await validFixture();
  await writeFile(path.join(root, "objects", "broken.md"), `---
id: broken
not valid
---
`, "utf8");
  const response = await run([root, "--json"]);
  assert.equal(response.code, 1);
  assert.equal(response.stdout, "");
  const payload = JSON.parse(response.stderr);
  assertEnvelope(payload, false);
  assert.equal(payload.diagnostic.code, "AUTH-1003");
  assert.equal(payload.diagnostic.source, path.join("objects", "broken.md"));
  assert.equal(payload.diagnostic.line, 3);
  assert.equal(payload.diagnostic.column, 1);
  assert.equal(response.stderr.trim().split("\n").filter((line) => line.startsWith("{")).length, 1);
});

test("standalone authoring CLI keeps human errors on stderr", async () => {
  const root = await validFixture();
  await writeFile(path.join(root, "objects", "broken.md"), "no front matter\n", "utf8");
  const response = await run([root]);
  assert.equal(response.code, 1);
  assert.equal(response.stdout, "");
  assert.match(response.stderr, /AUTH-1001/);
  assert.match(response.stderr, /objects[\\/]broken\.md:1:1/);
});
