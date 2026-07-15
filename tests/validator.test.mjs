import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  languages,
  lifecycleStatuses,
  loadRegistry,
  objectTypes,
  relationTypes,
  validationProfiles
} from "../packages/registry/dist/index.js";
import { buildProjectGraph, graphToDot, inspectProject, validateProject } from "../packages/validator/dist/index.js";

async function loadFixture(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const invalidFixtures = [
  "examples/invalid-project.json",
  "examples/invalid-relations.json",
  "examples/invalid-cycles-and-versions.json",
  "examples/invalid-provenance-and-reachability.json",
  "examples/invalid-language-and-provenance.json"
];

test("minimal project passes validation using JSON registry", async () => {
  const project = await loadFixture("examples/minimal-project.json");
  const report = validateProject(project, { registry: loadRegistry() });
  assert.equal(report.valid, true);
  assert.deepEqual(report.diagnostics, []);
  assert.deepEqual(report.summary, { errors: 0, warnings: 0, info: 0, total: 0 });
});

test("invalid project produces expected diagnostics", async () => {
  const project = await loadFixture("examples/invalid-project.json");
  const report = validateProject(project, { registry: loadRegistry() });
  const codes = new Set(report.diagnostics.map((diagnostic) => diagnostic.code));
  assert.equal(report.valid, false);
  for (const expected of ["ERR-1001", "ERR-1002", "ERR-1102", "ERR-1103", "ERR-1104", "ERR-1105", "ERR-1202"]) {
    assert.equal(codes.has(expected), true, `missing diagnostic ${expected}`);
  }
  assert.equal(report.summary.errors, report.diagnostics.length);
  assert.equal(report.summary.total, report.diagnostics.length);
});

test("semantic relation violations are detected", async () => {
  const project = await loadFixture("examples/invalid-relations.json");
  const report = validateProject(project, { registry: loadRegistry() });
  const codes = new Set(report.diagnostics.map((diagnostic) => diagnostic.code));
  assert.equal(report.valid, false);
  assert.equal(codes.has("ERR-1203"), true);
  assert.equal(codes.has("ERR-1204"), true);
  assert.equal(codes.has("ERR-1205"), true);
});

test("semantic versions and graph cycles are validated", async () => {
  const project = await loadFixture("examples/invalid-cycles-and-versions.json");
  const report = validateProject(project, { registry: loadRegistry() });
  const codes = report.diagnostics.map((diagnostic) => diagnostic.code);
  assert.equal(report.valid, false);
  assert.equal(codes.includes("ERR-1004"), true);
  assert.equal(codes.includes("ERR-1106"), true);
  assert.equal(codes.filter((code) => code === "ERR-1206").length >= 2, true);
});

test("provenance references and strict reachability are validated", async () => {
  const project = await loadFixture("examples/invalid-provenance-and-reachability.json");
  const coreReport = validateProject(project, { registry: loadRegistry(), profile: "core" });
  const strictReport = validateProject(project, { registry: loadRegistry(), profile: "strict" });
  const coreCodes = new Set(coreReport.diagnostics.map((diagnostic) => diagnostic.code));
  const strictCodes = new Set(strictReport.diagnostics.map((diagnostic) => diagnostic.code));
  assert.equal(coreCodes.has("ERR-1301"), true);
  assert.equal(coreCodes.has("ERR-1302"), true);
  assert.equal(coreCodes.has("ERR-1303"), true);
  assert.equal(coreCodes.has("WARN-1401"), false);
  assert.equal(strictCodes.has("WARN-1401"), true);
  assert.equal(strictReport.summary.warnings, 1);
});

test("languages and required scholarly provenance are validated", async () => {
  const project = await loadFixture("examples/invalid-language-and-provenance.json");
  const report = validateProject(project, { registry: loadRegistry() });
  const codes = new Set(report.diagnostics.map((diagnostic) => diagnostic.code));
  assert.equal(codes.has("ERR-1107"), true);
  assert.equal(codes.has("ERR-1304"), true);
  assert.equal(codes.has("ERR-1305"), true);
});

test("inspection reports project structure", async () => {
  const project = await loadFixture("examples/invalid-provenance-and-reachability.json");
  const inspection = inspectProject(project);
  assert.equal(inspection.objectCount, 3);
  assert.equal(inspection.relationCount, 1);
  assert.equal(inspection.derivedFromCount, 3);
  assert.deepEqual(inspection.rootObjectIds, ["WORK-0005"]);
  assert.deepEqual(inspection.unreachableObjectIds, ["TR-0005"]);
  assert.equal(inspection.objectTypes.translation, 1);
});

test("graph export includes relation and provenance edges", async () => {
  const project = await loadFixture("examples/minimal-project.json");
  const graph = buildProjectGraph(project);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.deepEqual(graph.edges[0], { source: "TR-0001", target: "WORK-0001", type: "translates" });
  const dot = graphToDot(graph);
  assert.match(dot, /^digraph CODEX/);
  assert.match(dot, /TR-0001/);
  assert.match(dot, /translates/);
});

test("runtime registry matches machine-readable registry files", async () => {
  const objectRegistry = await loadFixture("registry/object-types.json");
  const relationRegistry = await loadFixture("registry/relation-types.json");
  const statusRegistry = await loadFixture("registry/lifecycle-statuses.json");
  const profileRegistry = await loadFixture("registry/validation-profiles.json");
  const languageRegistry = await loadFixture("registry/languages.json");
  const diagnosticRegistry = await loadFixture("registry/diagnostic-codes.json");
  const loaded = loadRegistry();
  assert.deepEqual(objectRegistry.values, [...objectTypes]);
  assert.deepEqual(relationRegistry.values, [...relationTypes]);
  assert.deepEqual(statusRegistry.values, [...lifecycleStatuses]);
  assert.deepEqual(profileRegistry.values, [...validationProfiles]);
  assert.deepEqual(languageRegistry.values, [...languages]);
  assert.deepEqual(loaded.objectTypes, objectRegistry.values);
  assert.deepEqual(loaded.relationTypes, relationRegistry.values);
  assert.deepEqual(loaded.lifecycleStatuses, statusRegistry.values);
  assert.deepEqual(loaded.validationProfiles, profileRegistry.values);
  assert.deepEqual(loaded.languages, languageRegistry.values);
  assert.deepEqual(loaded.diagnostics, diagnosticRegistry.diagnostics);
});

test("diagnostic registry contains unique stable codes", () => {
  const diagnostics = loadRegistry().diagnostics;
  const codes = diagnostics.map((item) => item.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const item of diagnostics) assert.match(item.code, /^(ERR|WARN|INFO)-[0-9]{4}$/);
});

test("every emitted diagnostic is registered", async () => {
  const registry = loadRegistry();
  const registered = new Set(registry.diagnostics.map((item) => item.code));
  for (const fixture of invalidFixtures) {
    const project = await loadFixture(fixture);
    const report = validateProject(project, { registry, profile: "strict" });
    for (const diagnostic of report.diagnostics) {
      assert.equal(registered.has(diagnostic.code), true, `unregistered diagnostic ${diagnostic.code}`);
    }
  }
});
