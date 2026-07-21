import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";

const manifestPath = "releases/0.2.0/manifest.json";

async function manifest() {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

test("CODEX 0.2 manifest freezes every public runtime component", async () => {
  const release = await manifest();
  assert.equal(release.version, "0.2.0");
  assert.equal(release.formatVersion, "0.2.0");
  for (const component of ["core", "profiles", "authoring", "graph", "importer", "query", "cli"]) {
    assert.equal(release.components[component], "0.2.0", component);
  }
});

test("CODEX 0.2 manifest contains normative and reference artifacts", async () => {
  const release = await manifest();
  const required = [
    "README.md",
    "CHANGELOG.md",
    "specs/core/README.md",
    "specs/runtime/README.md",
    "schemas/cli-envelope.schema.json",
    "reference/hermetica/project.yml",
    "reference/hermetica/works/corpus-hermeticum.md",
    "reference/hermetica/fragments/ch-01.md",
    "reference/hermetica/translations/ru/ch-01.md",
    "releases/0.2.0/RELEASE-CHECKLIST.md"
  ];
  for (const artifact of required) {
    assert.ok(release.artifacts.includes(artifact), artifact);
    await access(artifact);
  }
});

test("release checklist distinguishes implementation from publication", async () => {
  const checklist = await readFile("releases/0.2.0/RELEASE-CHECKLIST.md", "utf8");
  assert.match(checklist, /\[x\] Importer is implemented/);
  assert.match(checklist, /\[x\] Query engine is implemented/);
  assert.match(checklist, /\[x\] Required GitHub Actions run is green/);
  assert.match(checklist, /Publication is complete only after/);
});
