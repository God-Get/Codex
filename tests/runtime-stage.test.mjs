import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildGraph } from "../packages/graph/dist/index.js";
import { compileProject, parseFrontMatter } from "../packages/importer/dist/index.js";
import { parseQuery, queryProject } from "../packages/query/dist/index.js";

const project = {
  codexVersion: "0.2.0",
  id: "runtime.fixture",
  title: "Runtime Fixture",
  profile: "core",
  objects: [
    { id: "work", type: "work", title: "Work", version: "1.0.0", status: "draft", language: "la", relations: [{ type: "contains", target: "fragment" }] },
    { id: "fragment", type: "fragment", title: "Fragment", version: "1.0.0", status: "draft", language: "la", metadata: { section: "1" } },
    { id: "translation", type: "translation", title: "Translation", version: "1.0.0", status: "draft", language: "ru", derivedFrom: ["fragment"] }
  ]
};

test("graph indexes and traverses project objects", () => {
  const graph = buildGraph(project);
  assert.equal(graph.getObject("fragment")?.title, "Fragment");
  assert.equal(graph.getObjectsByType("translation").length, 1);
  assert.deepEqual(graph.descendants("work").map((object) => object.id), ["fragment"]);
  assert.deepEqual(graph.descendants("translation", ["derivedFrom"]).map((object) => object.id), ["fragment"]);
  assert.deepEqual(graph.neighbours("fragment").map((object) => object.id).sort(), ["translation", "work"]);
  assert.equal(graph.edgesTo("fragment").length, 2);
  assert.equal(graph.statistics().objects, 3);
  assert.equal(graph.statistics().relations, 2);
});

test("query parses AND expressions and nested metadata fields", () => {
  assert.equal(parseQuery("type=fragment AND language=la").predicates.length, 2);
  assert.deepEqual(queryProject(project, "metadata.section=1").objects.map((object) => object.id), ["fragment"]);
  assert.equal(queryProject(project, "language=ru").count, 1);
});

test("importer compiles deterministic Markdown project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-runtime-"));
  await mkdir(path.join(root, "objects"));
  await writeFile(path.join(root, "project.yml"), "id: imported.fixture\ntitle: Imported Fixture\nprofile: core\n", "utf8");
  await writeFile(path.join(root, "objects", "b.md"), "---\nid: b\ntype: fragment\nrelations: [contains->a]\n---\n# B\n", "utf8");
  await writeFile(path.join(root, "objects", "a.md"), "---\nid: a\ntype: source\nlanguage: la\n---\n# A\n", "utf8");
  const result = await compileProject(root);
  assert.equal(result.project.id, "imported.fixture");
  assert.deepEqual(result.files, [path.join("objects", "a.md"), path.join("objects", "b.md")]);
  assert.equal(result.graph.getObject("a")?.language, "la");
  assert.equal(result.project.objects[0]?.metadata?.body, "# A");
});

test("front matter diagnostics reject malformed documents", () => {
  assert.throws(() => parseFrontMatter("# Missing"), /missing YAML front matter/);
  assert.throws(() => parseFrontMatter("---\nid: x\n"), /unterminated YAML front matter/);
});
