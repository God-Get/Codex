import assert from "node:assert/strict";
import test from "node:test";
import { compileAuthoringProject, compileMarkdownObject, parseMarkdownDocument } from "../packages/authoring/dist/index.js";

const objectSource = `---
id: translation.test.en
type: translation
title: Test Translation
version: 1.0.0
status: draft
language: en
derivedFrom: ["source.test.grc"]
relations: [{"type":"translates","target":"source.test.grc"}]
editor: Ada
---

# Test

Body.`;

test("parses deterministic Markdown front matter", () => {
  const parsed = parseMarkdownDocument(objectSource, "fixture.md");
  assert.equal(parsed.attributes.id, "translation.test.en");
  assert.equal(parsed.body, "\n# Test\n\nBody.");
});

test("compiles Markdown objects and preserves author metadata", () => {
  const object = compileMarkdownObject(objectSource, "objects/translation.md");
  assert.equal(object.id, "translation.test.en");
  assert.deepEqual(object.derivedFrom, ["source.test.grc"]);
  assert.deepEqual(object.relations, [{ type: "translates", target: "source.test.grc" }]);
  assert.equal(object.metadata?.editor, "Ada");
  assert.equal(object.metadata?.sourcePath, "objects/translation.md");
});

test("compiles an authoring directory into a canonical project", async () => {
  const project = await compileAuthoringProject("examples/authoring");
  assert.equal(project.codexVersion, "0.2.0");
  assert.equal(project.profile, "hermetica");
  assert.deepEqual(project.objects.map((object) => object.id), ["source.poimandres.grc", "translation.poimandres.en"]);
});

test("rejects duplicate front matter keys", () => {
  assert.throws(() => parseMarkdownDocument("---\nid: one\nid: two\n---\n", "duplicate.md"), /duplicate key id/);
});
