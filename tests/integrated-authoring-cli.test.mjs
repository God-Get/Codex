import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "codex-integrated-authoring-"));
  await mkdir(path.join(root, "objects"));
  await writeFile(path.join(root, "project.md"), `---
codexVersion: 0.2.0
id: integrated.fixture
title: Integrated CLI Fixture
profile: core
---
`, "utf8");
  await writeFile(path.join(root, "objects", "source.md"), `---
id: source.integrated
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

test("integrated authoring CLI emits the shared success envelope", async () => {
  const root = await fixture();
  const output = path.join(root, "project.json");
  const response = await run(["authoring", "compile", root, `--output=${output}`, "--no-validate", "--json"]);
  assert.equal(response.code, 0, response.stderr);
  assert.equal(response.stderr, "");
  const payload = JSON.parse(response.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.apiVersion, "0.2");
  assert.equal(payload.command, "authoring.compile");
  assert.equal(payload.result.outputPath, output);
  assert.equal(payload.result.project.id, "integrated.fixture");
  assert.equal(payload.result.project.objects.length, 1);
});

test("integrated authoring CLI emits the shared failure envelope", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "objects", "broken.md"), `---
id: broken
not valid
---
`, "utf8");
  const response = await run(["authoring", "compile", root, "--json"]);
  assert.equal(response.code, 1);
  assert.equal(response.stdout, "");
  const payload = JSON.parse(response.stderr);
  assert.equal(payload.ok, false);
  assert.equal(payload.apiVersion, "0.2");
  assert.equal(payload.command, "authoring.compile");
  assert.equal(payload.diagnostic.code, "AUTH-1003");
  assert.equal(payload.diagnostic.source, path.join("objects", "broken.md"));
  assert.equal(payload.diagnostic.line, 3);
  assert.equal(payload.diagnostic.column, 1);
});

test("integrated authoring CLI includes the diagnostic code and message in human errors", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "objects", "broken.md"), "no front matter\n", "utf8");
  const response = await run(["authoring", "compile", root]);
  assert.equal(response.code, 1);
  assert.equal(response.stdout, "");
  assert.match(response.stderr, /Authoring operation failed \[AUTH-1001\]/);
  assert.match(response.stderr, /missing front matter/);
});