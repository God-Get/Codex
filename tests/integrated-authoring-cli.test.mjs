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

test("integrated authoring CLI preserves successful JSON envelope", async () => {
  const root = await fixture();
  const output = path.join(root, "project.json");
  const result = await run(["authoring", "compile", root, `--output=${output}`, "--no-validate", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.outputPath, output);
  assert.equal(payload.project.id, "integrated.fixture");
  assert.equal(payload.projectId, "integrated.fixture");
  assert.equal(payload.objectCount, 1);
});

test("integrated authoring CLI emits AUTH diagnostic JSON on stderr", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "objects", "broken.md"), `---
id: broken
not valid
---
`, "utf8");
  const result = await run(["authoring", "compile", root, "--json"]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.ok, false);
  assert.equal(payload.diagnostic.code, "AUTH-1003");
  assert.equal(payload.diagnostic.source, path.join("objects", "broken.md"));
  assert.equal(payload.diagnostic.line, 3);
  assert.equal(payload.diagnostic.column, 1);
});

test("integrated authoring CLI includes the diagnostic code in human errors", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "objects", "broken.md"), "no front matter\n", "utf8");
  const result = await run(["authoring", "compile", root]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Authoring operation failed \[AUTH-1001\]/);
  assert.match(result.stderr, /objects[\\/]broken\.md:1:1/);
});
