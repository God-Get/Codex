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

async function automationFixture() {
  const root = await fixture();
  await mkdir(path.join(root, "automation"), { recursive: true });
  await writeFile(path.join(root, "automation", "static.json"), JSON.stringify({
    translations: {
      "FRAGMENT-0001:en": "# English translation\n\nEnglish translation.",
      "FRAGMENT-0001:ru": "# Перевод\n\nПереведённый текст."
    }
  }), "utf8");
  const config = path.join(root, "automation", "config.json");
  await writeFile(config, JSON.stringify({
    provider: { kind: "static", dataFile: "static.json" },
    memoryFile: ".codex-ci/translation-memory.json",
    outputDirectory: "translations",
    concurrency: 2,
    maxRetries: 1
  }), "utf8");
  return { root, config };
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

test("translation commands reject output path traversal", async () => {
  const root = await fixture();
  const output = path.resolve(root, "..", "escaped-translation.md");
  const response = await run([
    "translation", "create",
    "--root", root,
    "--source", "FRAGMENT-0001",
    "--language", "ru",
    "--id", "TRANSLATION-0001",
    "--output", output,
    "--json"
  ]);
  assert.equal(response.code, 1);
  assert.equal(JSON.parse(response.stderr).diagnostic.code, "CODEX_TRANSLATION_PROVIDER_CONFIG");
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

test("translation run generates Markdown, persists memory, and reuses the cache", async () => {
  const { root, config } = await automationFixture();
  const output = path.join(root, "translations", "ru", "source.md");
  const args = [
    "translation", "run", root,
    "--config", config,
    "--source", "FRAGMENT-0001",
    "--language", "ru",
    "--id", "TRANSLATION-0001",
    "--output", output,
    "--json"
  ];
  const first = await run(args);
  assert.equal(first.code, 0, first.stderr);
  const firstPayload = JSON.parse(first.stdout);
  assert.equal(firstPayload.apiVersion, "0.2");
  assert.equal(firstPayload.command, "translation.run");
  assert.equal(firstPayload.result.generated, 1);
  assert.equal(firstPayload.result.cacheHits, 0);
  const markdown = await readFile(output, "utf8");
  assert.match(markdown, /translationMode: machine/);
  assert.match(markdown, /qaPassed: true/);
  const audit = await readFile(path.join(root, ".codex", "translation-audit.jsonl"), "utf8");
  assert.match(audit, /"provider":"static"/);
  assert.match(audit, /"retries":0/);
  assert.doesNotMatch(audit, /Переведённый текст/);

  const statePath = path.join(root, ".codex", "translation-state.json");
  const interruptedState = JSON.parse(await readFile(statePath, "utf8"));
  interruptedState.items["FRAGMENT-0001\u0000ru"].status = "running";
  delete interruptedState.items["FRAGMENT-0001\u0000ru"].outputHash;
  await writeFile(statePath, JSON.stringify(interruptedState), "utf8");
  const resumed = await run(args);
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).result.skipped, 1);
  assert.equal(JSON.parse(resumed.stdout).result.generated, 0);
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).items["FRAGMENT-0001\u0000ru"].status, "completed");

  const second = await run([...args, "--force"]);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).result.cacheHits, 1);
});

test("translation run dry-run does not require provider credentials", async () => {
  const root = await fixture();
  const config = path.join(root, "external.json");
  await writeFile(config, JSON.stringify({
    provider: {
      kind: "openai-compatible",
      endpoint: "https://translations.example/v1/chat/completions",
      model: "translator",
      apiKeyEnv: "CODEX_TEST_MISSING_KEY"
    }
  }), "utf8");
  const response = await run([
    "translation", "run", root,
    "--config", config,
    "--source", "FRAGMENT-0001",
    "--language", "ru",
    "--dry-run",
    "--json"
  ]);
  assert.equal(response.code, 0, response.stderr);
  assert.equal(JSON.parse(response.stdout).result.provider, "openai-compatible");
});

test("translation qa, review, and memory commands use JSON envelopes", async () => {
  const { root, config } = await automationFixture();
  const output = path.join(root, "translations", "ru", "source.md");
  const generated = await run([
    "translation", "run", root,
    "--config", config,
    "--source", "FRAGMENT-0001",
    "--language", "ru",
    "--id", "TRANSLATION-0001",
    "--output", output,
    "--json"
  ]);
  assert.equal(generated.code, 0, generated.stderr);

  const qa = await run(["translation", "qa", root, "--json"]);
  assert.equal(qa.code, 0, qa.stderr);
  assert.equal(JSON.parse(qa.stdout).result.passed, true);

  const prematureApproval = await run([
    "translation", "review",
    "--file", output,
    "--status", "approved",
    "--reviewer", "Reviewer",
    "--json"
  ]);
  assert.equal(prematureApproval.code, 1);
  assert.equal(JSON.parse(prematureApproval.stderr).diagnostic.code, "CODEX_TRANSLATION_REVIEW_BLOCKED");

  const review = await run([
    "translation", "review",
    "--file", output,
    "--status", "review",
    "--reviewer", "Reviewer",
    "--json"
  ]);
  assert.equal(review.code, 0, review.stderr);
  assert.equal(JSON.parse(review.stdout).result.status, "review");
  const approval = await run([
    "translation", "review",
    "--file", output,
    "--status", "approved",
    "--reviewer", "Reviewer",
    "--json"
  ]);
  assert.equal(approval.code, 0, approval.stderr);
  assert.equal(JSON.parse(approval.stdout).result.status, "approved");
  assert.match(await readFile(output, "utf8"), /reviewedBy: "Reviewer"/);
  assert.match(await readFile(output, "utf8"), /approvedBy: "Reviewer"/);

  const publication = await run([
    "translation", "review",
    "--file", output,
    "--status", "published",
    "--reviewer", "Publisher",
    "--json"
  ]);
  assert.equal(publication.code, 0, publication.stderr);
  assert.equal(JSON.parse(publication.stdout).result.status, "published");
  assert.match(await readFile(output, "utf8"), /publishedBy: "Publisher"/);

  const memory = await run([
    "translation", "memory",
    "--file", path.join(root, ".codex-ci", "translation-memory.json"),
    "--json"
  ]);
  assert.equal(memory.code, 0, memory.stderr);
  assert.equal(JSON.parse(memory.stdout).result.entries, 1);

  const exported = path.join(root, ".codex-ci", "translation-memory-export.json");
  const exportResult = await run([
    "translation", "memory", "export",
    "--file", path.join(root, ".codex-ci", "translation-memory.json"),
    "--output", exported,
    "--json"
  ]);
  assert.equal(exportResult.code, 0, exportResult.stderr);
  const imported = path.join(root, ".codex-ci", "translation-memory-imported.json");
  const importResult = await run([
    "translation", "memory", "import",
    "--file", imported,
    "--input", exported,
    "--json"
  ]);
  assert.equal(importResult.code, 0, importResult.stderr);
  assert.equal(JSON.parse(importResult.stdout).result.added, 1);
});
