import assert from "node:assert/strict";
import test from "node:test";
import { loadRegistry } from "../packages/registry/dist/index.js";
import { validateProject } from "../packages/validator/dist/index.js";

test("machine-readable relation constraints are normalized", () => {
  const registry = loadRegistry();

  assert.deepEqual(registry.relationConstraints.contains.sources, [
    "project", "work", "edition", "volume", "chapter", "section"
  ]);
  assert.deepEqual(registry.relationConstraints.contains.targets, [
    "work", "edition", "volume", "chapter", "section", "fragment",
    "translation", "commentary", "source", "term"
  ]);
  assert.equal(registry.relationConstraints.contains.disallowSelfReference, true);

  assert.deepEqual(registry.relationConstraints.derivedFrom.sources, []);
  assert.deepEqual(registry.relationConstraints.derivedFrom.targets, []);
  assert.equal(registry.relationConstraints.derivedFrom.disallowSelfReference, true);
});

test("constraints with omitted source or target lists do not throw", () => {
  const registry = loadRegistry();
  const project = {
    id: "PROJECT-9000",
    title: "Constraint regression",
    codexVersion: "0.2.0",
    objects: [
      {
        id: "WORK-9000",
        type: "work",
        title: "Work",
        version: "0.1.0",
        status: "draft",
        relations: [{ type: "derivedFrom", target: "SOURCE-9000" }]
      },
      {
        id: "SOURCE-9000",
        type: "source",
        title: "Source",
        version: "0.1.0",
        status: "draft"
      }
    ]
  };

  assert.doesNotThrow(() => validateProject(project, { registry }));
});

test("registry-driven self-reference restrictions are enforced", () => {
  const registry = loadRegistry();
  const project = {
    id: "PROJECT-9001",
    title: "Self-reference regression",
    codexVersion: "0.2.0",
    objects: [
      {
        id: "WORK-9001",
        type: "work",
        title: "Work",
        version: "0.1.0",
        status: "draft",
        relations: [{ type: "derivedFrom", target: "WORK-9001" }]
      }
    ]
  };

  const report = validateProject(project, { registry });
  assert.equal(report.diagnostics.some((item) => item.code === "ERR-1205"), true);
});
