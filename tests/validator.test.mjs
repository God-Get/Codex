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
import { validateProjectSchema } from "../packages/schema/dist/index.js";
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

test("minimal project passes schema and semantic validation", async () => {
  const project = await loadFixture("examples/minimal-project.json");
  assert.deepEqual(validateProjectSchema(project), []);
  const report = validateProject(project, { registry: loadRegistry() });
  assert.equal(report.valid, true);
  assert.deepEqual(report.diagnostics, []);
  assert.deepEqual(report.summary, { errors: 0, warnings: 0, info: 0, total: 0 });
});

test("invalid schema fixture produces structural diagnostics", async () => {
  const project = await loadFixture("examples/invalid-schema.json");
  const codes = new Set(validateProjectSchema(project).map((diagnostic) => diagnostic.code));
  assert.equal(codes.has("ERR-2002"), true);
  assert.equal(codes.has("ERR-2003"), true);
  assert.equal(codes.has("ERR-2004"), true);
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
  assert.equal(coreCodes.has("CODEX_TRANSLATION_SOURCE_COUNT"), true);
  assert.equal(coreCodes.has("CODEX_TRANSLATION_LANGUAGE_REQUIRED"), true);
  assert.equal(coreCodes.has("WARN-1401"), false);
  assert.equal(strictCodes.has("WARN-1401"), true);
  assert.equal(strictReport.summary.warnings, 1);
});

test("languages and required scholarly provenance are validated", async () => {
  const project = await loadFixture("examples/invalid-language-and-provenance.json");
  const report = validateProject(project, { registry: loadRegistry() });
  const codes = new Set(report.diagnostics.map((diagnostic) => diagnostic.code));
  assert.equal(codes.has("ERR-1107"), true);
  assert.equal(codes.has("CODEX_TRANSLATION_SOURCE_COUNT"), true);
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
  assert.equal(graph.edges.length, 2);
  assert.deepEqual(graph.edges[0], { source: "TR-0001", target: "WORK-0001", type: "translation-of" });
  assert.deepEqual(graph.edges[1], { source: "TR-0001", target: "WORK-0001", type: "derivedFrom" });
  const dot = graphToDot(graph);
  assert.match(dot, /^digraph CODEX/);
  assert.match(dot, /TR-0001/);
  assert.match(dot, /translation-of/);
});

test("runtime registry matches machine-readable registry files", async () => {
  const objectRegistry = await loadFixture("registry/object-types.json");
  const relationRegistry = await loadFixture("registry/relation-types.json");
  const statusRegistry = await loadFixture("registry/lifecycle-statuses.json");
  const profileRegistry = await loadFixture("registry/validation-profiles.json");
  const languageRegistry = await loadFixture("registry/languages.json");
  const translationRuleRegistry = await loadFixture("registry/translation-rules.json");
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
  assert.deepEqual(loaded.translationRules.sourceTypes, translationRuleRegistry.sourceTypes);
  assert.deepEqual(loaded.translationRules.targetLanguages, translationRuleRegistry.targetLanguages);
  assert.deepEqual(loaded.translationRules.requiredMetadata, translationRuleRegistry.requiredMetadata);
  assert.deepEqual(loaded.diagnostics, diagnosticRegistry.diagnostics);
});

test("diagnostic registry contains unique stable codes", () => {
  const diagnostics = loadRegistry().diagnostics;
  const codes = diagnostics.map((item) => item.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const item of diagnostics) assert.match(item.code, /^(?:(ERR|WARN|INFO)-[0-9]{4}|CODEX_TRANSLATION_[A-Z0-9_]+)$/);
});

test("every emitted diagnostic is registered", async () => {
  const registry = loadRegistry();
  const registered = new Set(registry.diagnostics.map((item) => item.code));
  for (const fixture of invalidFixtures) {
    const project = await loadFixture(fixture);
    const report = validateProject(project, { registry, profile: "strict" });
    for (const diagnostic of report.diagnostics) assert.equal(registered.has(diagnostic.code), true, `unregistered diagnostic ${diagnostic.code}`);
  }
  const schemaDiagnostics = validateProjectSchema(await loadFixture("examples/invalid-schema.json"));
  for (const diagnostic of schemaDiagnostics) assert.equal(registered.has(diagnostic.code), true, `unregistered diagnostic ${diagnostic.code}`);
});
