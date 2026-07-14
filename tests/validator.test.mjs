import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  lifecycleStatuses,
  objectTypes,
  relationConstraints,
  relationTypes
} from "../packages/registry/dist/index.js";
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

test("semantic relation violations are detected", async () => {
  const project = await loadFixture("examples/invalid-relations.json");
  const report = validateProject(project);
  const codes = new Set(report.diagnostics.map((diagnostic) => diagnostic.code));

  assert.equal(report.valid, false);
  assert.equal(codes.has("ERR-1203"), true);
  assert.equal(codes.has("ERR-1204"), true);
  assert.equal(codes.has("ERR-1205"), true);
});

test("runtime registry matches machine-readable registry files", async () => {
  const objectRegistry = await loadFixture("registry/object-types.json");
  const relationRegistry = await loadFixture("registry/relation-types.json");
  const statusRegistry = await loadFixture("registry/lifecycle-statuses.json");
  const constraintRegistry = await loadFixture("registry/relation-constraints.json");

  assert.deepEqual(objectRegistry.values, [...objectTypes]);
  assert.deepEqual(relationRegistry.values, [...relationTypes]);
  assert.deepEqual(statusRegistry.values, [...lifecycleStatuses]);
  assert.deepEqual(constraintRegistry.constraints, relationConstraints);
});

test("every diagnostic provides a stable error code", async () => {
  for (const fixture of ["examples/invalid-project.json", "examples/invalid-relations.json"]) {
    const project = await loadFixture(fixture);
    const report = validateProject(project);

    for (const diagnostic of report.diagnostics) {
      assert.match(diagnostic.code, /^(ERR|WARN|INFO)-[0-9]{4}$/);
    }
  }
});
