import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/release-archive.mjs", ...args], {
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
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("release archives are deterministic and verifiable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-archive-"));
  const source = path.join(root, "package");
  const first = path.join(root, "first.tgz");
  const second = path.join(root, "second.tgz");
  await mkdir(path.join(source, "nested"), { recursive: true });
  await writeFile(path.join(source, "manifest.json"), "{\"version\":\"0.2.0\"}\n", "utf8");
  await writeFile(path.join(source, "nested", "fixture.md"), "# Fixture\n", "utf8");

  const buildFirst = await run(["build", source, first]);
  assert.equal(buildFirst.code, 0, buildFirst.stderr);
  const buildSecond = await run(["build", source, second]);
  assert.equal(buildSecond.code, 0, buildSecond.stderr);
  assert.deepEqual(await readFile(first), await readFile(second));

  const verification = await run(["verify", source, first]);
  assert.equal(verification.code, 0, verification.stderr);
  assert.match(verification.stdout, /PASS: archive/);
});
