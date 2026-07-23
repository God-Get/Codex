import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { compileProject } from "../packages/importer/dist/index.js";
import { resolveProfile } from "../packages/profiles/dist/index.js";
import { analyzeTranslationStatus, createTranslationDraft } from "../packages/translation/dist/index.js";

test("translation draft uses canonical provenance fields", async () => {
  const { project } = await compileProject("reference/hermetica");
  const registry = resolveProfile("hermetica").registry;
  const draft = createTranslationDraft(project, { id: "TRANSLATION-0002", sourceId: "FRAG-0001", language: "en" }, registry);
  assert.deepEqual(draft.object.derivedFrom, ["FRAG-0001"]);
  assert.deepEqual(draft.object.relations, [{ type: "translation-of", target: "FRAG-0001" }]);
  assert.equal(draft.object.metadata.translationMode, "manual");
  assert.match(draft.markdown, /translation-of->FRAG-0001/);
});

test("HERMETICA translation status reports existing and missing languages", async () => {
  const { project } = await compileProject("reference/hermetica");
  const report = analyzeTranslationStatus(project, resolveProfile("hermetica").registry);
  const fixture = JSON.parse(await readFile("reference/hermetica/fixtures/missing-translations.json", "utf8"));
  assert.deepEqual(report.existingLanguages, ["ru"]);
  assert.deepEqual(report.missing.map((item) => ({ ...item, status: "missing" })), fixture.expected);
  assert.equal(report.orphans.length, 0);
  assert.equal(report.invalidProvenance.length, 0);
});
