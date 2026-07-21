import assert from "node:assert/strict";
import test from "node:test";
import { compileProject } from "../packages/importer/dist/index.js";
import { queryProject } from "../packages/query/dist/index.js";

const root = "reference/hermetica";

test("HERMETICA reference corpus compiles into runtime graph", async () => {
  const result = await compileProject(root);
  assert.equal(result.project.id, "HERMETICA-0001");
  assert.equal(result.project.profile, "hermetica");
  assert.equal(result.project.objects.length, 3);
  assert.deepEqual(result.files, [
    "fragments/ch-01.md",
    "translations/ru/ch-01.md",
    "works/corpus-hermeticum.md"
  ]);
  assert.equal(result.graph.getObject("WORK-0001")?.type, "work");
  assert.deepEqual(result.graph.descendants("WORK-0001", ["contains"]).map((object) => object.id), ["FRAG-0001"]);
  assert.equal(result.graph.edgesTo("FRAG-0001").length, 2);
});

test("HERMETICA reference corpus supports translation queries", async () => {
  const { project } = await compileProject(root);
  const result = queryProject(project, "type=translation AND language=ru");
  assert.equal(result.count, 1);
  assert.equal(result.objects[0]?.id, "TRANS-0001");
});
