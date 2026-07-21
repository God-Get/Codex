import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function run(entry, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
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
  const root = await mkdtemp(path.join(tmpdir(), "codex-runtime-cli-"));
  await mkdir(path.join(root, "objects"));
  await writeFile(path.join(root, "project.yml"), "id: runtime.cli\ntitle: Runtime CLI\nprofile: core\n", "utf8");
  await writeFile(path.join(root, "objects", "source.md"), "---\nid: source.cli\ntype: source\nlanguage: la\n---\n# Source\n", "utf8");
  await writeFile(path.join(root, "objects", "translation.md"), "---\nid: translation.cli\ntype: translation\nlanguage: ru\nderivedFrom: [source.cli]\n---\n# Translation\n", "utf8");
  return root;
}

test("codex-import writes deterministic project and JSON envelope", async () => {
  const root = await fixture();
  const output = path.join(root, "project.json");
  const result = await run("packages/importer/dist/cli.js", [root, `--output=${output}`, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.apiVersion, "0.2");
  assert.equal(payload.command, "import.compile");
  assert.equal(payload.result.project.id, "runtime.cli");
  assert.equal(payload.result.statistics.objects, 2);
  assert.deepEqual(payload.result.files, ["objects/source.md", "objects/translation.md"]);
  const project = JSON.parse(await readFile(output, "utf8"));
  assert.equal(project.objects.length, 2);
});

test("codex-query executes expression and emits JSON envelope", async () => {
  const root = await fixture();
  const output = path.join(root, "project.json");
  const imported = await run("packages/importer/dist/cli.js", [root, `--output=${output}`, "--json"]);
  assert.equal(imported.code, 0, imported.stderr);
  const result = await run("packages/query/dist/cli.js", [output, "type=translation AND language=ru", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.apiVersion, "0.2");
  assert.equal(payload.command, "query.execute");
  assert.equal(payload.result.count, 1);
  assert.equal(payload.result.objects[0].id, "translation.cli");
});

test("runtime CLIs keep machine errors on stderr", async () => {
  const missingImport = await run("packages/importer/dist/cli.js", ["--json"]);
  assert.equal(missingImport.code, 2);
  assert.equal(missingImport.stdout, "");
  assert.equal(JSON.parse(missingImport.stderr).diagnostic.code, "IMPORT-1001");

  const missingQuery = await run("packages/query/dist/cli.js", ["missing.json", "type=source", "--json"]);
  assert.equal(missingQuery.code, 1);
  assert.equal(missingQuery.stdout, "");
  assert.equal(JSON.parse(missingQuery.stderr).diagnostic.code, "QUERY-1002");
});
