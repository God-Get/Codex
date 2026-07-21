import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

test("parses scalar and JSON front matter values", () => {
  const parsed = parseMarkdownDocument([
    "---",
    "draft: true",
    "sequence: 1",
    "empty: null",
    "tags: [\"hermetica\", \"greek\"]",
    "---",
    "Body"
  ].join("\n"), "scalars.md");
  assert.deepEqual(parsed.attributes, {
    draft: true,
    sequence: 1,
    empty: null,
    tags: ["hermetica", "greek"]
  });
});

test("compiles Markdown objects and preserves author metadata", () => {
  const object = compileMarkdownObject(objectSource, "objects/translation.md");
  assert.equal(object.id, "translation.test.en");
  assert.deepEqual(object.derivedFrom, ["source.test.grc"]);
  assert.deepEqual(object.relations, [{ type: "translates", target: "source.test.grc" }]);
  assert.equal(object.metadata?.editor, "Ada");
  assert.equal(object.metadata?.content, "\n# Test\n\nBody.");
  assert.equal(object.metadata?.sourcePath, "objects/translation.md");
});

test("compiles an authoring directory into a canonical project", async () => {
  const project = await compileAuthoringProject("examples/authoring");
  assert.equal(project.codexVersion, "0.2.0");
  assert.equal(project.profile, "hermetica");
  assert.deepEqual(project.objects.map((object) => object.id), ["source.poimandres.grc", "translation.poimandres.en"]);
});

test("recursively compiles object files in deterministic path order", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-authoring-order-"));
  await mkdir(path.join(root, "objects", "nested"), { recursive: true });
  await writeFile(path.join(root, "project.md"), "---\ncodexVersion: 0.2.0\nid: ordering\ntitle: Ordering\n---\n");
  const object = (id) => `---\nid: ${id}\ntype: source\ntitle: ${id}\nversion: 1.0.0\nstatus: draft\n---\nBody`;
  await writeFile(path.join(root, "objects", "z.md"), object("z"));
  await writeFile(path.join(root, "objects", "nested", "a.md"), object("a"));

  const project = await compileAuthoringProject(root);
  assert.deepEqual(project.objects.map((item) => item.id), ["a", "z"]);
  assert.deepEqual(project.objects.map((item) => item.metadata?.sourcePath), ["objects/nested/a.md", "objects/z.md"]);
});

test("rejects duplicate front matter keys", () => {
  assert.throws(() => parseMarkdownDocument("---\nid: one\nid: two\n---\n", "duplicate.md"), /duplicate key id/);
});

test("rejects duplicate object identifiers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-authoring-duplicate-"));
  await mkdir(path.join(root, "objects"));
  await writeFile(path.join(root, "project.md"), "---\ncodexVersion: 0.2.0\nid: duplicate\ntitle: Duplicate\n---\n");
  const object = "---\nid: same\ntype: source\ntitle: Same\nversion: 1.0.0\nstatus: draft\n---\n";
  await writeFile(path.join(root, "objects", "a.md"), object);
  await writeFile(path.join(root, "objects", "b.md"), object);
  await assert.rejects(() => compileAuthoringProject(root), /Duplicate object id: same/);
});

test("rejects malformed collection fields", () => {
  const base = "---\nid: malformed\ntype: translation\ntitle: Malformed\nversion: 1.0.0\nstatus: draft\n";
  assert.throws(() => compileMarkdownObject(`${base}derivedFrom: source.one\n---\nBody`), /derivedFrom must be a JSON string array/);
  assert.throws(() => compileMarkdownObject(`${base}relations: [\"source.one\"]\n---\nBody`), /relations must be a JSON array/);
});
