import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("authoring diagnostic schema enumerates the public AUTH codes", async () => {
  const schema = await readJson("packages/authoring/authoring-diagnostic.schema.json");
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(schema.required, ["code", "message"]);
  assert.deepEqual(schema.properties.code.enum, [
    "AUTH-1001",
    "AUTH-1002",
    "AUTH-1003",
    "AUTH-1004",
    "AUTH-1005",
    "AUTH-1006",
    "AUTH-1007",
    "AUTH-1008",
    "AUTH-1009"
  ]);
  assert.equal(schema.properties.line.minimum, 1);
  assert.equal(schema.properties.column.minimum, 1);
});

test("authoring CLI schema defines success and failure envelopes", async () => {
  const schema = await readJson("packages/authoring/authoring-cli.schema.json");
  assert.equal(schema.oneOf.length, 2);

  const [success, failure] = schema.oneOf;
  assert.deepEqual(success.required, ["outputPath", "project"]);
  assert.equal(success.properties.ok.const, true);
  assert.deepEqual(failure.required, ["ok", "diagnostic"]);
  assert.equal(failure.properties.ok.const, false);
  assert.equal(failure.properties.diagnostic.$ref, "./authoring-diagnostic.schema.json");
});
