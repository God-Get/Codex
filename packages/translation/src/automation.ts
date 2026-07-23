import { createHash } from "node:crypto";
import type { CodexObject, CodexProject, CodexTranslationObject } from "@codex/core";
import type { RegistryData } from "@codex/registry";
import { TranslationError } from "./errors.js";

export interface GlossaryEntry {
  source: string;
  target: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}

export interface TranslationRequest {
  sourceId: string;
  sourceText: string;
  sourceLanguage: string;
  targetLanguage: string;
  glossary: GlossaryEntry[];
}

export interface TranslationUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ProviderTranslation {
  text: string;
  provider: string;
  model?: string;
  usage?: TranslationUsage;
}

export interface TranslationProvider {
  readonly id: string;
  readonly model?: string;
  translate(request: TranslationRequest): Promise<ProviderTranslation>;
}

export interface StaticProviderData {
  translations: Record<string, string>;
}

export interface OpenAICompatibleProviderOptions {
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  organization?: string;
}

export interface QualityIssue {
  code:
    | "CODEX_TRANSLATION_EMPTY_CONTENT"
    | "CODEX_TRANSLATION_QA_UNCHANGED"
    | "CODEX_TRANSLATION_QA_PLACEHOLDER_LOSS"
    | "CODEX_TRANSLATION_QA_GLOSSARY_MISSING"
    | "CODEX_TRANSLATION_QA_LENGTH_OUTLIER";
  severity: "error" | "warning";
  message: string;
}

export interface QualityReport {
  score: number;
  passed: boolean;
  issues: QualityIssue[];
}

export interface TranslationMemoryEntry {
  key: string;
  sourceId: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceHash: string;
  glossaryHash: string;
  text: string;
  provider: string;
  model?: string;
  quality: QualityReport;
  createdAt: string;
}

export interface TranslationMemory {
  version: "1";
  entries: Record<string, TranslationMemoryEntry>;
}

export interface AutomationItem {
  sourceId: string;
  targetLanguage: string;
  id: string;
  title?: string;
}

export interface AutomationOptions {
  provider: TranslationProvider;
  glossary?: GlossaryEntry[];
  memory?: TranslationMemory;
  concurrency?: number;
  requestsPerMinute?: number;
  maxRetries?: number;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface AutomationResult {
  item: AutomationItem;
  object: CodexTranslationObject;
  markdown: string;
  quality: QualityReport;
  cacheHit: boolean;
  attempts: number;
  usage?: TranslationUsage;
}

export interface AutomationBatchReport {
  results: AutomationResult[];
  failures: Array<{ item: AutomationItem; code: string; message: string }>;
  memory: TranslationMemory;
}

function normalizedText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function markdownText(value: string): string {
  return normalizedText(
    value
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^#{1,6}\s+.*$/gm, "")
  );
}

export function extractObjectText(object: CodexObject): string {
  const candidate = object.metadata?.content ?? object.metadata?.body ?? object.metadata?.text;
  return typeof candidate === "string" ? markdownText(candidate) : "";
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function relevantGlossary(entries: GlossaryEntry[], sourceLanguage: string, targetLanguage: string): GlossaryEntry[] {
  return entries
    .filter((entry) => (!entry.sourceLanguage || entry.sourceLanguage === sourceLanguage)
      && (!entry.targetLanguage || entry.targetLanguage === targetLanguage))
    .sort((a, b) => `${a.source}\0${a.target}`.localeCompare(`${b.source}\0${b.target}`));
}

export function translationMemoryKey(request: TranslationRequest): string {
  return digest(JSON.stringify({
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    sourceText: normalizedText(request.sourceText),
    glossary: relevantGlossary(request.glossary, request.sourceLanguage, request.targetLanguage)
  }));
}

export function emptyTranslationMemory(): TranslationMemory {
  return { version: "1", entries: {} };
}

export function validateGlossary(value: unknown): GlossaryEntry[] {
  if (!Array.isArray(value)) throw new TranslationError("CODEX_TRANSLATION_GLOSSARY_INVALID", "Glossary must be a JSON array.");
  const entries = value.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new TranslationError("CODEX_TRANSLATION_GLOSSARY_INVALID", `Glossary entry ${index} must be an object.`);
    const item = entry as Record<string, unknown>;
    if (typeof item.source !== "string" || !item.source.trim() || typeof item.target !== "string" || !item.target.trim()) {
      throw new TranslationError("CODEX_TRANSLATION_GLOSSARY_INVALID", `Glossary entry ${index} requires non-empty source and target.`);
    }
    if (item.sourceLanguage !== undefined && typeof item.sourceLanguage !== "string") throw new TranslationError("CODEX_TRANSLATION_GLOSSARY_INVALID", `Glossary entry ${index} has invalid sourceLanguage.`);
    if (item.targetLanguage !== undefined && typeof item.targetLanguage !== "string") throw new TranslationError("CODEX_TRANSLATION_GLOSSARY_INVALID", `Glossary entry ${index} has invalid targetLanguage.`);
    return {
      source: item.source,
      target: item.target,
      ...(typeof item.sourceLanguage === "string" ? { sourceLanguage: item.sourceLanguage } : {}),
      ...(typeof item.targetLanguage === "string" ? { targetLanguage: item.targetLanguage } : {})
    };
  });
  const targets = new Map<string, string>();
  for (const entry of entries) {
    const key = `${entry.sourceLanguage ?? "*"}\0${entry.targetLanguage ?? "*"}\0${entry.source.toLocaleLowerCase()}`;
    const existing = targets.get(key);
    if (existing !== undefined && existing !== entry.target) {
      throw new TranslationError("CODEX_TRANSLATION_GLOSSARY_INVALID", `Conflicting glossary targets for ${entry.source}.`);
    }
    targets.set(key, entry.target);
  }
  return entries;
}

export function validateTranslationMemory(value: unknown): TranslationMemory {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== "1") {
    throw new TranslationError("CODEX_TRANSLATION_MEMORY_INVALID", "Translation memory must use version 1.");
  }
  const entries = (value as { entries?: unknown }).entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new TranslationError("CODEX_TRANSLATION_MEMORY_INVALID", "Translation memory entries must be an object.");
  }
  for (const [key, entry] of Object.entries(entries)) {
    if (!entry || typeof entry !== "object") throw new TranslationError("CODEX_TRANSLATION_MEMORY_INVALID", `Translation memory entry ${key} must be an object.`);
    const item = entry as Record<string, unknown>;
    for (const field of ["key", "sourceId", "sourceLanguage", "targetLanguage", "sourceHash", "glossaryHash", "text", "provider", "createdAt"]) {
      if (typeof item[field] !== "string" || !(item[field] as string).length) {
        throw new TranslationError("CODEX_TRANSLATION_MEMORY_INVALID", `Translation memory entry ${key} has invalid ${field}.`);
      }
    }
    if (item.key !== key) throw new TranslationError("CODEX_TRANSLATION_MEMORY_INVALID", `Translation memory entry key mismatch: ${key}.`);
    if (!item.quality || typeof item.quality !== "object"
      || typeof (item.quality as { score?: unknown }).score !== "number"
      || typeof (item.quality as { passed?: unknown }).passed !== "boolean"
      || !Array.isArray((item.quality as { issues?: unknown }).issues)) {
      throw new TranslationError("CODEX_TRANSLATION_MEMORY_INVALID", `Translation memory entry ${key} has invalid quality report.`);
    }
  }
  return value as TranslationMemory;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{[^{}]+\}\}|%\d*\$?[a-zA-Z]|\$\{[^{}]+\}/g)].map((match) => match[0]).sort();
}

export function assessTranslationQuality(request: TranslationRequest, text: string): QualityReport {
  const issues: QualityIssue[] = [];
  const source = normalizedText(request.sourceText);
  const target = normalizedText(text);
  if (!target) {
    issues.push({ code: "CODEX_TRANSLATION_EMPTY_CONTENT", severity: "error", message: "Provider returned empty translation text." });
  } else {
    if (target.toLocaleLowerCase() === source.toLocaleLowerCase()) {
      issues.push({ code: "CODEX_TRANSLATION_QA_UNCHANGED", severity: "error", message: "Translation is unchanged from the source." });
    }
    const sourcePlaceholders = placeholders(source);
    const targetPlaceholders = placeholders(target);
    if (JSON.stringify(sourcePlaceholders) !== JSON.stringify(targetPlaceholders)) {
      issues.push({ code: "CODEX_TRANSLATION_QA_PLACEHOLDER_LOSS", severity: "error", message: "Translation does not preserve source placeholders." });
    }
    const ratio = source.length === 0 ? 1 : target.length / source.length;
    if (ratio < 0.25 || ratio > 4) {
      issues.push({ code: "CODEX_TRANSLATION_QA_LENGTH_OUTLIER", severity: "warning", message: `Translation length ratio ${ratio.toFixed(2)} is outside 0.25–4.00.` });
    }
    for (const entry of relevantGlossary(request.glossary, request.sourceLanguage, request.targetLanguage)) {
      if (source.toLocaleLowerCase().includes(entry.source.toLocaleLowerCase())
        && !target.toLocaleLowerCase().includes(entry.target.toLocaleLowerCase())) {
        issues.push({ code: "CODEX_TRANSLATION_QA_GLOSSARY_MISSING", severity: "error", message: `Required glossary target is missing: ${entry.target}` });
      }
    }
  }
  const score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + (issue.severity === "error" ? 30 : 10), 0));
  return { score, passed: !issues.some((issue) => issue.severity === "error"), issues };
}

export class StaticTranslationProvider implements TranslationProvider {
  readonly id = "static";
  readonly model = "fixture-v1";

  constructor(private readonly data: StaticProviderData) {}

  async translate(request: TranslationRequest): Promise<ProviderTranslation> {
    const exactKey = `${request.sourceId}:${request.targetLanguage}`;
    const text = this.data.translations[exactKey] ?? this.data.translations[request.targetLanguage];
    if (!text) throw new TranslationError("CODEX_TRANSLATION_PROVIDER_FAILED", `Static provider has no translation for ${exactKey}.`);
    return { text, provider: this.id, model: this.model };
  }
}

export class OpenAICompatibleTranslationProvider implements TranslationProvider {
  readonly id = "openai-compatible";
  readonly model: string;

  constructor(private readonly options: OpenAICompatibleProviderOptions) {
    this.model = options.model;
    if (!/^https:\/\//.test(options.endpoint)) throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", "Provider endpoint must use HTTPS.");
    if (!options.apiKey) throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", "Provider API key is empty.");
  }

  async translate(request: TranslationRequest): Promise<ProviderTranslation> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60_000);
    const glossary = relevantGlossary(request.glossary, request.sourceLanguage, request.targetLanguage);
    try {
      const response = await fetch(this.options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.apiKey}`,
          ...(this.options.organization ? { "openai-organization": this.options.organization } : {})
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: "Translate faithfully. Preserve placeholders and formatting. Return only the translated text."
            },
            {
              role: "user",
              content: JSON.stringify({
                sourceLanguage: request.sourceLanguage,
                targetLanguage: request.targetLanguage,
                glossary,
                text: request.sourceText
              })
            }
          ]
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const requestId = response.headers.get("x-request-id");
        throw new Error(`HTTP ${response.status}${requestId ? ` (request ${requestId})` : ""}`);
      }
      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new Error("Response does not contain choices[0].message.content.");
      return {
        text,
        provider: this.id,
        model: this.model,
        usage: {
          ...(typeof payload.usage?.prompt_tokens === "number" ? { inputTokens: payload.usage.prompt_tokens } : {}),
          ...(typeof payload.usage?.completion_tokens === "number" ? { outputTokens: payload.usage.completion_tokens } : {})
        }
      };
    } catch (error) {
      throw new TranslationError(
        "CODEX_TRANSLATION_PROVIDER_FAILED",
        `Provider request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function frontMatterValue(value: string): string {
  return /^[A-Za-z0-9_. -]+$/.test(value) ? value : JSON.stringify(value);
}

function renderAutomatedMarkdown(
  object: CodexTranslationObject,
  source: CodexObject,
  text: string,
  providerResult: ProviderTranslation,
  quality: QualityReport,
  generatedAt: string
): string {
  return [
    "---",
    `id: ${object.id}`,
    "type: translation",
    `title: ${frontMatterValue(object.title)}`,
    `version: ${object.version}`,
    `status: ${object.status}`,
    `language: ${object.language}`,
    `derivedFrom: [${source.id}]`,
    `relations: [translation-of->${source.id}]`,
    "translationMode: machine",
    ...(source.language ? [`sourceLanguage: ${source.language}`] : []),
    `translationProvider: ${frontMatterValue(providerResult.provider)}`,
    ...(providerResult.model ? [`translationModel: ${frontMatterValue(providerResult.model)}`] : []),
    `generatedAt: ${generatedAt}`,
    `qaScore: ${quality.score}`,
    `qaPassed: ${quality.passed}`,
    "---",
    `# ${object.title}`,
    "",
    text.trim(),
    ""
  ].join("\n");
}

async function withRetries<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  sleep: (milliseconds: number) => Promise<void>
): Promise<{ value: T; attempts: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    try {
      return { value: await operation(), attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt <= maxRetries) await sleep(Math.min(250 * 2 ** (attempt - 1), 4_000));
    }
  }
  throw lastError;
}

export async function runTranslationBatch(
  project: CodexProject,
  registry: RegistryData,
  items: AutomationItem[],
  options: AutomationOptions
): Promise<AutomationBatchReport> {
  const memory = options.memory ?? emptyTranslationMemory();
  const glossary = options.glossary ?? [];
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 16));
  const maxRetries = Math.max(0, Math.min(options.maxRetries ?? 2, 10));
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? (() => new Date());
  const interval = options.requestsPerMinute && options.requestsPerMinute > 0 ? 60_000 / options.requestsPerMinute : 0;
  let nextRequestAt = 0;
  let rateQueue = Promise.resolve();
  let cursor = 0;
  const results: AutomationResult[] = [];
  const failures: AutomationBatchReport["failures"] = [];

  async function acquireRateSlot(): Promise<void> {
    let release = () => {};
    const previous = rateQueue;
    rateQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const wait = Math.max(0, nextRequestAt - Date.now());
      if (wait > 0) await sleep(wait);
      nextRequestAt = Date.now() + interval;
    } finally {
      release();
    }
  }

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (!item) return;
      try {
        const source = project.objects.find((object) => object.id === item.sourceId);
        if (!source) throw new TranslationError("CODEX_TRANSLATION_SOURCE_MISSING", `Translation source does not exist: ${item.sourceId}`);
        if (!registry.translationRules.sourceTypes.includes(source.type)) throw new TranslationError("CODEX_TRANSLATION_SOURCE_TYPE", `Object type ${source.type} cannot be a translation source.`);
        if (!source.language) throw new TranslationError("CODEX_TRANSLATION_PROVENANCE_INVALID", `Source ${source.id} has no language.`);
        if (source.language === item.targetLanguage) throw new TranslationError("CODEX_TRANSLATION_SAME_LANGUAGE", `Translation language ${item.targetLanguage} matches source language.`);
        if (!registry.languages.includes(item.targetLanguage)) throw new TranslationError("CODEX_TRANSLATION_LANGUAGE_UNKNOWN", `Unregistered language code: ${item.targetLanguage}`);
        if (project.objects.some((object) => object.id === item.id)) throw new TranslationError("CODEX_TRANSLATION_ID_EXISTS", `Object already exists: ${item.id}`);
        const sourceText = extractObjectText(source);
        if (!sourceText) throw new TranslationError("CODEX_TRANSLATION_EMPTY_CONTENT", `Source ${source.id} has no translatable text.`);
        const request = { sourceId: source.id, sourceText, sourceLanguage: source.language, targetLanguage: item.targetLanguage, glossary };
        const key = translationMemoryKey(request);
        const cached = memory.entries[key];
        let providerResult: ProviderTranslation;
        let attempts = 0;
        if (cached) {
          providerResult = { text: cached.text, provider: cached.provider, model: cached.model };
        } else {
          const retried = await withRetries(async () => {
            await acquireRateSlot();
            return options.provider.translate(request);
          }, maxRetries, sleep);
          providerResult = retried.value;
          attempts = retried.attempts;
        }
        const quality = assessTranslationQuality(request, providerResult.text);
        if (!quality.passed) {
          const message = quality.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join("; ");
          throw new TranslationError("CODEX_TRANSLATION_QA_FAILED", message);
        }
        const generatedAt = now().toISOString();
        const title = item.title ?? `${source.title} — ${item.targetLanguage} translation`;
        const object: CodexTranslationObject = {
          id: item.id,
          type: "translation",
          title,
          version: "0.1.0",
          status: "draft",
          language: item.targetLanguage,
          derivedFrom: [source.id],
          relations: [{ type: "translation-of", target: source.id }],
          metadata: {
            translationMode: "machine",
            sourceLanguage: source.language,
            translationProvider: providerResult.provider,
            ...(providerResult.model ? { translationModel: providerResult.model } : {}),
            generatedAt,
            qaScore: quality.score,
            qaPassed: quality.passed,
            content: providerResult.text
          }
        };
        if (!cached) {
          memory.entries[key] = {
            key,
            sourceId: source.id,
            sourceLanguage: source.language,
            targetLanguage: item.targetLanguage,
            sourceHash: digest(sourceText),
            glossaryHash: digest(JSON.stringify(relevantGlossary(glossary, source.language, item.targetLanguage))),
            text: providerResult.text,
            provider: providerResult.provider,
            ...(providerResult.model ? { model: providerResult.model } : {}),
            quality,
            createdAt: generatedAt
          };
        }
        results.push({
          item,
          object,
          markdown: renderAutomatedMarkdown(object, source, providerResult.text, providerResult, quality, generatedAt),
          quality,
          cacheHit: Boolean(cached),
          attempts,
          ...(providerResult.usage ? { usage: providerResult.usage } : {})
        });
      } catch (error) {
        failures.push({
          item,
          code: error instanceof TranslationError ? error.code : "CODEX_TRANSLATION_BATCH_PARTIAL",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => worker()));
  results.sort((a, b) => `${a.item.sourceId}\0${a.item.targetLanguage}`.localeCompare(`${b.item.sourceId}\0${b.item.targetLanguage}`));
  failures.sort((a, b) => `${a.item.sourceId}\0${a.item.targetLanguage}`.localeCompare(`${b.item.sourceId}\0${b.item.targetLanguage}`));
  return { results, failures, memory };
}
