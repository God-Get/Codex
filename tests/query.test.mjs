import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../packages/graph/dist/index.js";
import { executeQuery, parseQuery, queryProject } from "../packages/query/dist/index.js";

const project = {
  codexVersion: "0.2.0",
  id: "PROJECT-0001",
  title: "Query Fixture",
  objects: [
    { id: "WORK-0001", type: "work", title: "Work", version: "0.1.0", status: "draft", language: "en", metadata: { corpus: "hermetica" } },
    { id: "FRAGMENT-0001", type: "fragment", title: "Fragment", version: "0.1.0", status: "approved", language: "el", metadata: { corpus: "hermetica" } },
    { id: "TRANS-0001", type: "translation", title: "Translation", version: "0.1.0", status: "approved", language: "ru", derivedFrom: ["FRAGMENT-0001"] }
  ]
};

test("parseQuery parses conjunctions", () => {
  assert.deepEqual(parseQuery("type=fragment AND language=el"), {
    predicates: [
      { field: "type", value: "fragment" },
      { field: "language", value: "el" }
    ]
  });
});

test("executeQuery filters canonical graph", () => {
  const result = executeQuery(buildGraph(project), "status=approved AND language=ru");
  assert.equal(result.count, 1);
  assert.equal(result.objects[0].id, "TRANS-0001");
});

test("queryProject supports nested metadata fields", () => {
  const result = queryProject(project, "metadata.corpus=hermetica");
  assert.deepEqual(result.objects.map((object) => object.id), ["WORK-0001", "FRAGMENT-0001"]);
});

test("parseQuery rejects malformed clauses", () => {
  assert.throws(() => parseQuery("type"), /Invalid query clause/);
  assert.throws(() => parseQuery("type="), /must not be empty/);
});
