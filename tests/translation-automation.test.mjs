import assert from "node:assert/strict";
import test from "node:test";
import {
  assessTranslationQuality,
  emptyTranslationMemory,
  OpenAICompatibleTranslationProvider,
  runTranslationBatch,
  StaticTranslationProvider,
  translationMemoryKey,
  validateGlossary,
  validateTranslationMemory
} from "../packages/translation/dist/index.js";
import { loadRegistry } from "../packages/registry/dist/index.js";

const project = {
  codexVersion: "0.2.0",
  id: "PROJECT-0001",
  title: "Automation fixture",
  objects: [{
    id: "FRAGMENT-0001",
    type: "fragment",
    title: "Greeting",
    version: "0.1.0",
    status: "approved",
    language: "en",
    metadata: { content: "Hello {{name}}" }
  }]
};

const item = { sourceId: "FRAGMENT-0001", targetLanguage: "ru", id: "TRANSLATION-0001" };
const glossary = [{ source: "Hello", target: "Привет", sourceLanguage: "en", targetLanguage: "ru" }];

test("automation produces a draft, QA report, and translation memory entry", async () => {
  const report = await runTranslationBatch(project, loadRegistry(), [item], {
    provider: new StaticTranslationProvider({ translations: { "FRAGMENT-0001:ru": "Привет {{name}}" } }),
    glossary,
    now: () => new Date("2026-01-02T03:04:05.000Z")
  });
  assert.equal(report.failures.length, 0);
  assert.equal(report.results[0].object.status, "draft");
  assert.equal(report.results[0].object.metadata.translationMode, "machine");
  assert.equal(report.results[0].quality.passed, true);
  assert.match(report.results[0].markdown, /generatedAt: 2026-01-02T03:04:05.000Z/);
  assert.equal(Object.keys(report.memory.entries).length, 1);
});

test("translation memory avoids a repeated provider call", async () => {
  let calls = 0;
  const provider = {
    id: "counting",
    async translate() {
      calls += 1;
      return { text: "Привет {{name}}", provider: "counting" };
    }
  };
  const first = await runTranslationBatch(project, loadRegistry(), [item], { provider, glossary });
  const second = await runTranslationBatch(project, loadRegistry(), [{ ...item, id: "TRANSLATION-0002" }], {
    provider,
    glossary,
    memory: first.memory
  });
  assert.equal(calls, 1);
  assert.equal(second.results[0].cacheHit, true);
  assert.equal(second.results[0].attempts, 0);
});

test("provider failures are retried with bounded attempts", async () => {
  let calls = 0;
  const provider = {
    id: "flaky",
    async translate() {
      calls += 1;
      if (calls === 1) throw new Error("temporary");
      return { text: "Привет {{name}}", provider: "flaky" };
    }
  };
  const report = await runTranslationBatch(project, loadRegistry(), [item], {
    provider,
    glossary,
    maxRetries: 2,
    sleep: async () => {}
  });
  assert.equal(report.failures.length, 0);
  assert.equal(report.results[0].attempts, 2);
});

test("QA blocks unchanged text, placeholder loss, and missing glossary terms", () => {
  const request = {
    sourceId: "FRAGMENT-0001",
    sourceText: "Hello {{name}}",
    sourceLanguage: "en",
    targetLanguage: "ru",
    glossary
  };
  const report = assessTranslationQuality(request, "Hello");
  const codes = new Set(report.issues.map((issue) => issue.code));
  assert.equal(report.passed, false);
  assert.equal(codes.has("CODEX_TRANSLATION_QA_PLACEHOLDER_LOSS"), true);
  assert.equal(codes.has("CODEX_TRANSLATION_QA_GLOSSARY_MISSING"), true);
});

test("batch failures are isolated and reported", async () => {
  const report = await runTranslationBatch(project, loadRegistry(), [
    item,
    { sourceId: "FRAGMENT-9999", targetLanguage: "ru", id: "TRANSLATION-0002" }
  ], {
    provider: new StaticTranslationProvider({ translations: { ru: "Привет {{name}}" } }),
    glossary
  });
  assert.equal(report.results.length, 1);
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0].code, "CODEX_TRANSLATION_SOURCE_MISSING");
});

test("glossary and memory validation reject malformed data", () => {
  assert.throws(() => validateGlossary([{ source: "", target: "x" }]), /requires non-empty/);
  assert.throws(() => validateGlossary([
    { source: "logos", target: "word", targetLanguage: "en" },
    { source: "logos", target: "reason", targetLanguage: "en" }
  ]), /Conflicting glossary targets/);
  assert.throws(() => validateTranslationMemory({ version: "2", entries: {} }), /version 1/);
  assert.deepEqual(emptyTranslationMemory(), { version: "1", entries: {} });
});

test("memory keys change with glossary constraints", () => {
  const base = { sourceId: "FRAGMENT-0001", sourceText: "Hello", sourceLanguage: "en", targetLanguage: "ru", glossary: [] };
  assert.notEqual(translationMemoryKey(base), translationMemoryKey({ ...base, glossary }));
});

test("OpenAI-compatible provider sends the constrained request and reports usage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://provider.example/v1/chat/completions");
    assert.equal(options.headers.authorization, "Bearer secret");
    const body = JSON.parse(options.body);
    assert.equal(body.temperature, 0);
    assert.equal(body.model, "translator");
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Привет {{name}}" } }],
      usage: { prompt_tokens: 12, completion_tokens: 4 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = new OpenAICompatibleTranslationProvider({
      endpoint: "https://provider.example/v1/chat/completions",
      model: "translator",
      apiKey: "secret"
    });
    const result = await provider.translate({
      sourceId: "FRAGMENT-0001",
      sourceText: "Hello {{name}}",
      sourceLanguage: "en",
      targetLanguage: "ru",
      glossary
    });
    assert.equal(result.text, "Привет {{name}}");
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
