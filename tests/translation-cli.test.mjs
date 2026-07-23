import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["apps/cli/dist/index.js", ...args], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
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

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "codex-translation-cli-"));
  await mkdir(path.join(root, "fragments"), { recursive: true });
  await writeFile(path.join(root, "project.yml"), "id: PROJECT-0001\ntitle: CLI fixture\nprofile: hermetica\ncodexVersion: 0.2.0\n", "utf8");
  await writeFile(path.join(root, "fragments", "source.md"), "---\nid: FRAGMENT-0001\ntype: fragment\ntitle: Greek source\nversion: 0.1.0\nstatus: approved\nlanguage: el\n---\n# Greek source\n\nSource text.\n", "utf8");
  return root;
}

test("translation create writes Markdown and returns CODEX 0.2 JSON envelope", async () => {
  const root = await fixture();
  const output = path.join(root, "translations", "ru", "source.md");
  const response = await run(["translation", "create", "--source", "FRAGMENT-0001", "--language", "ru", "--id", "TRANSLATION-0001", "--output", output, "--json"]);
  assert.equal(response.code, 0, response.stderr);
  const payload = JSON.parse(response.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.apiVersion, "0.2");
  assert.equal(payload.command, "translation.create");
  const markdown = await readFile(output, "utf8");
  assert.match(markdown, /derivedFrom: \[FRAGMENT-0001\]/);
  assert.match(markdown, /relations: \[translation-of->FRAGMENT-0001\]/);
});

test("translation create refuses overwrite without --force", async () => {
  const root = await fixture();
  const output = path.join(root, "translations", "ru", "source.md");
  const args = ["translation", "create", "--source", "FRAGMENT-0001", "--language", "ru", "--id", "TRANSLATION-0001", "--output", output, "--json"];
  assert.equal((await run(args)).code, 0);
  const response = await run(args);
  assert.equal(response.code, 1);
  const payload = JSON.parse(response.stderr);
  assert.equal(payload.ok, false);
  assert.equal(payload.command, "translation.create");
  assert.equal(payload.diagnostic.code, "CLI-1903");
});

test("translation status reports sources, missing translations, and JSON envelope", async () => {
  const root = await fixture();
  const output = path.join(root, "translations", "ru", "source.md");
  await run(["translation", "create", "--source", "FRAGMENT-0001", "--language", "ru", "--id", "TRANSLATION-0001", "--output", output]);
  const response = await run(["translation", "status", root, "--json"]);
  assert.equal(response.code, 0, response.stderr);
  const payload = JSON.parse(response.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.apiVersion, "0.2");
  assert.equal(payload.command, "translation.status");
  assert.equal(payload.result.sources[0].id, "FRAGMENT-0001");
  assert.deepEqual(payload.result.missing, [{ sourceId: "FRAGMENT-0001", language: "en" }]);
  assert.equal(payload.result.orphans.length, 0);
});
