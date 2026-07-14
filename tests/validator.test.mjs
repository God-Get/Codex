import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateProject } from "../packages/validator/dist/index.js";

async function loadFixture(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("minimal project passes validation", async () => {
  const project = await loadFixture("examples/minimal-project.json");
  const report = validateProject(project);

  assert.equal(report.valid, true);
  assert.deepEqual(report.diagnostics, []);
});

test("invalid project produces expected diagnostics", async () => {
  const project = await loadFixture("examples/invalid-project.json");
  const report = validateProject(project);
  const codes = new Set(report.diagnostics.map((diagnostic) => diagnostic.code));

  assert.equal(report.valid, false);
  for (const expected of [
    "ERR-1001",
    "ERR-1002",
    "ERR-1102",
    "ERR-1103",
    "ERR-1104",
    "ERR-1105",
    "ERR-1202"
  ]) {
    assert.equal(codes.has(expected), true, `missing diagnostic ${expected}`);
  }
});

test("every diagnostic provides a stable error code", async () => {
  const project = await loadFixture("examples/invalid-project.json");
  const report = validateProject(project);

  for (const diagnostic of report.diagnostics) {
    assert.match(diagnostic.code, /^(ERR|WARN|INFO)-[0-9]{4}$/);
  }
});