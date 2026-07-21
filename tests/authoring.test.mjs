import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AuthoringError,
  authoringDiagnostic,
  compileAuthoringProject,
  compileMarkdownObject,
  parseMarkdownDocument
} from "../packages/authoring/dist/index.js";

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
  assert.deepEqual(project.objects.map((object) => object.id), ["SRC-0001", "TR-0001"]);
});

test("emits stable diagnostics for duplicate front matter keys", () => {
  assert.throws(
    () => parseMarkdownDocument("---\nid: one\nid: two\n---\n", "duplicate.md"),
    (error) => {
      assert.ok(error instanceof AuthoringError);
      assert.deepEqual(error.diagnostic, {
        code: "AUTH-1005",
        message: "duplicate key id",
        source: "duplicate.md",
        line: 3,
        column: 1
      });
      return true;
    }
  );
});

test("emits coordinates for malformed front matter", () => {
  const diagnostic = (() => {
    try { parseMarkdownDocument("---\nid project\n---\n", "broken.md"); }
    catch (error) { return authoringDiagnostic(error); }
    throw new Error("Expected parser failure");
  })();
  assert.deepEqual(diagnostic, {
    code: "AUTH-1003",
    message: "expected key: value",
    source: "broken.md",
    line: 2,
    column: 1
  });
});

test("rejects invalid derivedFrom arrays with a stable code", () => {
  const invalid = objectSource.replace('derivedFrom: ["source.test.grc"]', "derivedFrom: source.test.grc");
  assert.throws(
    () => compileMarkdownObject(invalid, "objects/invalid.md"),
    (error) => error instanceof AuthoringError && error.diagnostic.code === "AUTH-1007"
  );
});

test("rejects duplicate object identifiers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-authoring-"));
  await mkdir(path.join(root, "objects"));
  await writeFile(path.join(root, "project.md"), "---\ncodexVersion: 0.2.0\nid: duplicate-project\ntitle: Duplicate project\n---\n");
  const source = objectSource.replace("translation.test.en", "duplicate.object");
  await writeFile(path.join(root, "objects", "one.md"), source);
  await writeFile(path.join(root, "objects", "two.md"), source);
  await assert.rejects(
    compileAuthoringProject(root),
    (error) => error instanceof AuthoringError && error.diagnostic.code === "AUTH-1009" && /duplicate object id/.test(error.diagnostic.message)
  );
});
