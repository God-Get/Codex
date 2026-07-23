import assert from "node:assert/strict";
import test from "node:test";
import { listProfiles, loadProfile, resolveProfile } from "../packages/profiles/dist/index.js";


test("built-in profiles are discoverable", () => {
  const ids = listProfiles().map((profile) => profile.id);
  assert.deepEqual(ids, ["core", "hermetica", "scholarly-edition"]);
});

test("HERMETICA resolves deterministic inheritance", () => {
  const profile = resolveProfile("hermetica");
  assert.deepEqual(profile.chain, ["core", "scholarly-edition", "hermetica"]);
  assert.equal(profile.registry.objectTypes.includes("witness"), true);
  assert.equal(profile.registry.objectTypes.includes("hermeticFragment"), true);
  assert.equal(profile.registry.relationTypes.includes("attests"), true);
  assert.equal(profile.registry.relationTypes.includes("parallels"), true);
  assert.equal(profile.registry.languages.includes("cop"), true);
  assert.deepEqual(profile.registry.translationRules.targetLanguages, ["ru", "en"]);
  assert.deepEqual(profile.registry.translationRules.requiredMetadata, ["translationMode"]);
  assert.equal(profile.registry.translationRules.sourceTypes.includes("hermeticFragment"), true);
  assert.equal(profile.registry.diagnostics.some((item) => item.code === "HERM-1001"), true);
});

test("profile descriptors declare CODEX compatibility", () => {
  for (const profile of listProfiles()) {
    assert.match(profile.id, /^[a-z][a-z0-9-]*$/);
    assert.match(profile.version, /^\d+\.\d+\.\d+/);
    assert.equal(typeof profile.codexVersion, "string");
    assert.equal(profile.codexVersion.length > 0, true);
    assert.equal(loadProfile(profile.id).id, profile.id);
  }
});
