import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadRegistry } from "../packages/registry/dist/index.js";
import { validateProject } from "../packages/validator/dist/index.js";

const source = {
  id: "FRAGMENT-0001",
  type: "fragment",
  title: "Greek source",
  version: "0.1.0",
  status: "approved",
  language: "el"
};

function translation(overrides = {}) {
  return {
    id: "TRANSLATION-0001",
    type: "translation",
    title: "Russian translation",
    version: "0.1.0",
    status: "draft",
    language: "ru",
    derivedFrom: ["FRAGMENT-0001"],
    relations: [{ type: "translation-of", target: "FRAGMENT-0001" }],
    metadata: { content: "Перевод." },
    ...overrides
  };
}

function validate(objects) {
  return validateProject({ codexVersion: "0.2.0", id: "PROJECT-0001", title: "Translations", objects }, { registry: loadRegistry() });
}

function codes(report) {
  return new Set(report.diagnostics.map((diagnostic) => diagnostic.code));
}

test("valid translation passes formal translation validation", () => {
  assert.equal(validate([source, translation()]).valid, true);
});

test("translation language is required", () => {
  assert.equal(codes(validate([source, translation({ language: undefined })])).has("CODEX_TRANSLATION_LANGUAGE_REQUIRED"), true);
});

test("unknown translation language has a stable diagnostic", () => {
  assert.equal(codes(validate([source, translation({ language: "xx" })])).has("CODEX_TRANSLATION_LANGUAGE_UNKNOWN"), true);
});

test("translation language must differ from source language", () => {
  assert.equal(codes(validate([source, translation({ language: "el" })])).has("CODEX_TRANSLATION_SAME_LANGUAGE"), true);
});

test("translation source must exist", () => {
  const value = translation({ derivedFrom: ["FRAGMENT-9999"], relations: [{ type: "translation-of", target: "FRAGMENT-9999" }] });
  assert.equal(codes(validate([source, value])).has("CODEX_TRANSLATION_SOURCE_MISSING"), true);
});

test("translation cannot reference itself", () => {
  const value = translation({ derivedFrom: ["TRANSLATION-0001"], relations: [{ type: "translation-of", target: "TRANSLATION-0001" }] });
  assert.equal(codes(validate([source, value])).has("CODEX_TRANSLATION_SELF_REFERENCE"), true);
});

test("translation provenance cycles are rejected", () => {
  const first = translation({ id: "TRANSLATION-0001", language: "ru", derivedFrom: ["TRANSLATION-0002"], relations: [{ type: "translation-of", target: "TRANSLATION-0002" }] });
  const second = translation({ id: "TRANSLATION-0002", language: "en", derivedFrom: ["TRANSLATION-0001"], relations: [{ type: "translation-of", target: "TRANSLATION-0001" }] });
  assert.equal(codes(validate([source, first, second])).has("CODEX_TRANSLATION_PROVENANCE_CYCLE"), true);
});

test("published translation cannot derive from a draft source", () => {
  assert.equal(codes(validate([{ ...source, status: "draft" }, translation({ status: "published" })])).has("CODEX_TRANSLATION_PUBLISHED_FROM_DRAFT"), true);
});

test("empty translation content is rejected", () => {
  assert.equal(codes(validate([source, translation({ metadata: { content: "  " } })])).has("CODEX_TRANSLATION_EMPTY_CONTENT"), true);
});

test("translation chains retain provenance", () => {
  const intermediate = translation({ id: "TRANSLATION-0001", language: "ru" });
  const chained = translation({
    id: "TRANSLATION-0002",
    language: "en",
    derivedFrom: ["TRANSLATION-0001"],
    relations: [{ type: "translation-of", target: "TRANSLATION-0001" }],
    metadata: { content: "Translation via Russian." }
  });
  assert.equal(validate([source, intermediate, chained]).valid, true);
});

test("HERMETICA invalid translation fixtures emit stable diagnostics", async () => {
  const fixtureUrl = new URL(
    "../reference/hermetica/fixtures/invalid-translations.json",
    import.meta.url
  );
  const fixtures = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const expectations = new Map([
    ["missingLanguage", "CODEX_TRANSLATION_LANGUAGE_REQUIRED"],
    ["unknownLanguage", "CODEX_TRANSLATION_LANGUAGE_UNKNOWN"],
    ["missingSource", "CODEX_TRANSLATION_SOURCE_MISSING"],
    ["empty", "CODEX_TRANSLATION_EMPTY_CONTENT"]
  ]);

  for (const [name, code] of expectations) {
    assert.ok(
      validate([source, fixtures[name]]).diagnostics.some(
        (diagnostic) => diagnostic.code === code
      ),
      `${name} should emit ${code}`
    );
  }
});
