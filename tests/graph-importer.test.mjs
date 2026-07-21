import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildGraph } from "../packages/graph/dist/index.js";
import { compileProject, parseFrontMatter } from "../packages/importer/dist/index.js";

test("parseFrontMatter reads metadata and body", () => {
  const parsed = parseFrontMatter("---\nid: FRAG-1\ntype: fragment\n---\n# Fragment\nText");
  assert.equal(parsed.metadata.id, "FRAG-1");
  assert.equal(parsed.body, "# Fragment\nText");
});

test("graph indexes edges and descendants", () => {
  const graph = buildGraph({ codexVersion: "0.2.0", id: "P", title: "P", objects: [
    { id: "A", type: "work", title: "A", version: "0.1.0", status: "draft", relations: [{ type: "contains", target: "B" }] },
    { id: "B", type: "fragment", title: "B", version: "0.1.0", status: "draft" }
  ]});
  assert.equal(graph.getObject("B")?.type, "fragment");
  assert.deepEqual(graph.descendants("A").map(object => object.id), ["B"]);
  assert.equal(graph.statistics().relations, 1);
});

test("compileProject builds canonical project from Markdown", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-importer-"));
  await mkdir(path.join(root, "fragments"));
  await writeFile(path.join(root, "project.yml"), "id: HERMETICA\ntitle: Hermetica\nprofile: hermetica\n");
  await writeFile(path.join(root, "fragments", "one.md"), "---\nid: FRAG-1\ntype: hermeticFragment\nlanguage: grc\nstatus: approved\n---\n# Fragment One\nλόγος");
  const result = await compileProject(root);
  assert.equal(result.project.id, "HERMETICA");
  assert.equal(result.project.objects[0].id, "FRAG-1");
  assert.equal(result.graph.statistics().objects, 1);
});
