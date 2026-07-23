import assert from "node:assert/strict";
import test from "node:test";
import {
  assessTranslationQuality,
  createDefaultProviderRegistry,
  emptyTranslationMemory,
  emptyTranslationRunState,
  findTranslationMemoryMatch,
  mergeTranslationMemories,
  OpenAICompatibleTranslationProvider,
  runTranslationBatch,
  runTranslationStream,
  safeAuditError,
  StaticTranslationProvider,
  TranslationProviderError,
  TranslationProviderRegistry,
  validateGlossary,
  validateTranslationRunState
} from "../packages/translation/dist/index.js";
import { loadRegistry } from "../packages/registry/dist/index.js";

const project = {
  codexVersion: "0.2.0",
  id: "PROJECT-0001",
  title: "Production fixture",
  objects: [{
    id: "FRAGMENT-0001",
    type: "fragment",
    title: "Source",
    version: "0.1.0",
    status: "approved",
    language: "en",
    metadata: { content: "Hello {{name}}" }
  }]
};
const item = { sourceId: "FRAGMENT-0001", targetLanguage: "ru", id: "TRANSLATION-0001" };
const request = {
  sourceId: "FRAGMENT-0001",
  sourceText: "Hello {{name}}",
  sourceLanguage: "en",
  targetLanguage: "ru",
  glossary: []
};

async function withFetch(mock, operation) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await operation();
  } finally {
    globalThis.fetch = original;
  }
}

function provider(options = {}) {
  return new OpenAICompatibleTranslationProvider({
    endpoint: "https://provider.example/v1/chat/completions",
    model: "translator",
    apiKey: "secret",
    ...options
  });
}

function successResponse(text = "Привет {{name}}") {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
}

test("OpenAI-compatible provider times out and cancels a hanging request", async () => {
  await withFetch((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  }), async () => {
    await assert.rejects(provider({ timeoutMs: 10 }).translate(request), (error) => {
      assert.equal(error.code, "CODEX_TRANSLATION_PROVIDER_TIMEOUT");
      assert.equal(error.retryable, true);
      return true;
    });
  });
});

test("HTTP 429 honors transient retry semantics", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return calls === 1
      ? new Response("", { status: 429, headers: { "retry-after": "0" } })
      : successResponse();
  }, async () => {
    const report = await runTranslationBatch(project, loadRegistry(), [item], {
      provider: provider(),
      maxRetries: 2,
      sleep: async () => {},
      random: () => 0
    });
    assert.equal(report.failures.length, 0);
    assert.equal(report.results[0].attempts, 2);
    assert.equal(report.results[0].retries, 1);
  });
});

test("HTTP 500 and network errors are retried", async () => {
  for (const firstFailure of [
    () => new Response("", { status: 500 }),
    () => { throw new TypeError("socket reset"); }
  ]) {
    let calls = 0;
    await withFetch(async () => {
      calls += 1;
      return calls === 1 ? firstFailure() : successResponse();
    }, async () => {
      const report = await runTranslationBatch(project, loadRegistry(), [{ ...item, id: `TRANSLATION-${calls + 10}` }], {
        provider: provider(),
        maxRetries: 1,
        sleep: async () => {}
      });
      assert.equal(report.failures.length, 0);
      assert.equal(calls, 2);
    });
  }
});

test("permanent HTTP errors, empty replies, and malformed JSON are not retried", async () => {
  for (const [response, code] of [
    [new Response("", { status: 400 }), "CODEX_TRANSLATION_PROVIDER_FAILED"],
    [successResponse("   "), "CODEX_TRANSLATION_PROVIDER_EMPTY_RESPONSE"],
    [new Response("{broken", { status: 200 }), "CODEX_TRANSLATION_PROVIDER_INVALID_RESPONSE"]
  ]) {
    let calls = 0;
    await withFetch(async () => {
      calls += 1;
      return response;
    }, async () => {
      const report = await runTranslationBatch(project, loadRegistry(), [item], {
        provider: provider(),
        maxRetries: 3,
        sleep: async () => {}
      });
      assert.equal(report.failures[0].code, code);
      assert.equal(calls, 1);
    });
  }
});

test("custom providers register without CLI or runner changes", async () => {
  const registry = new TranslationProviderRegistry().register("custom", (config) => ({
    id: "custom",
    model: String(config.model),
    async translate() {
      return { text: "Привет {{name}}", provider: "custom", model: String(config.model) };
    }
  }));
  const custom = await registry.create({ kind: "custom", model: "v1" }, {
    readJson: async () => ({}),
    resolvePath: (value) => value,
    environment: {}
  });
  assert.equal((await custom.translate(request)).provider, "custom");
  assert.ok(createDefaultProviderRegistry());
});

test("translation memory supports fuzzy matches, deduplication, import, and exact reuse", async () => {
  const first = await runTranslationBatch(project, loadRegistry(), [item], {
    provider: new StaticTranslationProvider({ translations: { ru: "Привет {{name}}" } })
  });
  const fuzzyRequest = { ...request, sourceText: "Hello, {{name}}" };
  const match = findTranslationMemoryMatch(first.memory, fuzzyRequest, 0.7);
  assert.equal(match?.kind, "fuzzy");
  const changedProject = structuredClone(project);
  changedProject.objects[0].metadata.content = fuzzyRequest.sourceText;
  const reused = await runTranslationBatch(changedProject, loadRegistry(), [{ ...item, id: "TRANSLATION-0002" }], {
    provider: { id: "must-not-run", async translate() { throw new Error("fuzzy memory was not used"); } },
    memory: first.memory,
    fuzzyThreshold: 0.7
  });
  assert.equal(reused.results[0].memoryMatch, "fuzzy");
  assert.equal(Object.keys(first.memory.entries).length, 2);
  const merged = mergeTranslationMemories(first.memory, structuredClone(first.memory));
  assert.equal(merged.added, 0);
  assert.equal(merged.duplicates, 2);
});

test("glossary enforces required, forbidden, and case-sensitive terms", () => {
  const glossary = validateGlossary([{
    source: "CODEX",
    target: "КОДЕКС",
    required: true,
    caseSensitive: true,
    forbidden: ["Кодекс"]
  }]);
  const missing = assessTranslationQuality({ ...request, sourceText: "CODEX", glossary }, "Кодекс");
  assert.deepEqual(
    new Set(missing.issues.map((issue) => issue.code)),
    new Set(["CODEX_TRANSLATION_QA_GLOSSARY_MISSING", "CODEX_TRANSLATION_QA_GLOSSARY_FORBIDDEN"])
  );
});

test("QA preserves Markdown, links, identifiers, code, tables, lists, HTML, Unicode, and placeholders", () => {
  const source = [
    "# Heading",
    "- item [link](https://example.com/FRAGMENT-0001)",
    "| A | B |",
    "| - | - |",
    "`inline` {{name}} <span>text</span>",
    "```js",
    "const id = \"FRAGMENT-0001\";",
    "```"
  ].join("\n");
  const valid = [
    "# Заголовок",
    "- пункт [ссылка](https://example.com/FRAGMENT-0001)",
    "| А | Б |",
    "| - | - |",
    "`inline` {{name}} <span>текст</span>",
    "```js",
    "const id = \"FRAGMENT-0001\";",
    "```"
  ].join("\n");
  assert.equal(assessTranslationQuality({ ...request, sourceText: source }, valid).passed, true);
  const broken = valid
    .replace("https://example.com/FRAGMENT-0001", "https://evil.example")
    .replace("`inline`", "`changed`")
    .replace("{{name}}", "")
    .replace("</span>", "");
  const codes = new Set(assessTranslationQuality({ ...request, sourceText: source }, broken).issues.map((issue) => issue.code));
  assert.equal(codes.has("CODEX_TRANSLATION_QA_LINKS"), true);
  assert.equal(codes.has("CODEX_TRANSLATION_QA_IDENTIFIERS"), true);
  assert.equal(codes.has("CODEX_TRANSLATION_QA_INLINE_CODE"), true);
  assert.equal(codes.has("CODEX_TRANSLATION_QA_PLACEHOLDER_LOSS"), true);
  assert.equal(codes.has("CODEX_TRANSLATION_QA_HTML"), true);
});

test("oversized and secret-bearing sources are blocked before provider invocation", async () => {
  let calls = 0;
  const counting = {
    id: "counting",
    async translate() {
      calls += 1;
      return { text: "ok", provider: "counting" };
    }
  };
  const oversized = await runTranslationBatch(project, loadRegistry(), [item], { provider: counting, maxSourceBytes: 3 });
  assert.equal(oversized.failures[0].code, "CODEX_TRANSLATION_OVERSIZED");
  const secretProject = structuredClone(project);
  secretProject.objects[0].metadata.content = "token sk-123456789012345678901234";
  const secret = await runTranslationBatch(secretProject, loadRegistry(), [item], { provider: counting });
  assert.equal(secret.failures[0].code, "CODEX_TRANSLATION_SECRET_DETECTED");
  assert.equal(calls, 0);
});

test("item timeout cancels a provider that observes the signal", async () => {
  const hanging = {
    id: "hanging",
    translate(_request, context) {
      return new Promise((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
      });
    }
  };
  const report = await runTranslationBatch(project, loadRegistry(), [item], {
    provider: hanging,
    itemTimeoutMs: 10,
    maxRetries: 4,
    sleep: async () => {}
  });
  assert.equal(report.failures[0].code, "CODEX_TRANSLATION_PROVIDER_TIMEOUT");
  assert.equal(report.failures[0].attempts, 1);
});

test("streaming runner processes 10000 items with bounded result retention", async () => {
  async function* items() {
    for (let index = 0; index < 10_000; index += 1) {
      yield {
        sourceId: `FRAGMENT-${String(index).padStart(5, "0")}`,
        targetLanguage: "ru",
        id: `TRANSLATION-${String(index).padStart(5, "0")}`
      };
    }
  }
  let completed = 0;
  let providerCalls = 0;
  let resolvedSources = 0;
  const report = await runTranslationStream({ ...project, objects: [] }, loadRegistry(), items(), {
    provider: {
      id: "large-fixture",
      async translate() {
        providerCalls += 1;
        return { text: "Привет {{name}}", provider: "large-fixture" };
      }
    },
    concurrency: 8,
    collectResults: false,
    resolveSource(sourceId) {
      resolvedSources += 1;
      return {
        id: sourceId,
        type: "fragment",
        title: sourceId,
        version: "0.1.0",
        status: "approved",
        language: "en",
        metadata: { content: "Hello {{name}}" }
      };
    },
    onResult: () => { completed += 1; }
  });
  assert.equal(completed, 10_000);
  assert.equal(resolvedSources, 10_000);
  assert.equal(report.results.length, 0);
  assert.equal(report.failures.length, 0);
  assert.equal(providerCalls, 1);
});

test("run state validation and audit redaction are deterministic", () => {
  const state = emptyTranslationRunState();
  assert.equal(validateTranslationRunState(state), state);
  assert.throws(() => validateTranslationRunState({ version: "2", items: {} }), /version 1/);
  assert.equal(safeAuditError("Bearer secret sk-12345678901234567890"), "Bearer [REDACTED] [REDACTED]");
  assert.throws(
    () => new TranslationProviderRegistry().register("x", () => ({ id: "x", translate: async () => ({ text: "x", provider: "x" }) })).register("x", () => ({ id: "x", translate: async () => ({ text: "x", provider: "x" }) })),
    /already registered/
  );
  assert.ok(TranslationProviderError);
});
