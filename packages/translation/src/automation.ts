import { createHash } from "node:crypto";
import type { CodexObject, CodexProject, CodexTranslationObject } from "@codex/core";
import type { RegistryData } from "@codex/registry";
import { TranslationError } from "./errors.js";
import {
  TranslationProviderError,
  type ProviderTranslation,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationUsage
} from "./provider.js";

export type {
  OpenAICompatibleProviderOptions,
  ProviderFactoryContext,
  ProviderTranslation,
  StaticProviderData,
  TranslationContext,
  TranslationProvider,
  TranslationProviderFactory,
  TranslationRequest,
  TranslationUsage
} from "./provider.js";
export {
  createDefaultProviderRegistry,
  OpenAICompatibleTranslationProvider,
  StaticTranslationProvider,
  TranslationProviderError,
  TranslationProviderRegistry
} from "./provider.js";

export interface GlossaryEntry {
  source: string;
  target: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  required?: boolean;
  forbidden?: string[];
  caseSensitive?: boolean;
}

export interface QualityIssue {
  code:
    | "CODEX_TRANSLATION_EMPTY_CONTENT"
    | "CODEX_TRANSLATION_QA_UNCHANGED"
    | "CODEX_TRANSLATION_QA_PLACEHOLDER_LOSS"
    | "CODEX_TRANSLATION_QA_GLOSSARY_MISSING"
    | "CODEX_TRANSLATION_QA_GLOSSARY_FORBIDDEN"
    | "CODEX_TRANSLATION_QA_LENGTH_OUTLIER"
    | "CODEX_TRANSLATION_QA_MARKDOWN_STRUCTURE"
    | "CODEX_TRANSLATION_QA_LINKS"
    | "CODEX_TRANSLATION_QA_IDENTIFIERS"
    | "CODEX_TRANSLATION_QA_CODE_BLOCKS"
    | "CODEX_TRANSLATION_QA_INLINE_CODE"
    | "CODEX_TRANSLATION_QA_TABLES"
    | "CODEX_TRANSLATION_QA_LISTS"
    | "CODEX_TRANSLATION_QA_HTML"
    | "CODEX_TRANSLATION_QA_UNICODE";
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
  sourceText?: string;
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
  fuzzyThreshold?: number;
  itemTimeoutMs?: number;
  maxSourceBytes?: number;
  allowSensitiveContent?: boolean;
  signal?: AbortSignal;
  onResult?: (result: AutomationResult) => Promise<void> | void;
  onFailure?: (failure: AutomationBatchReport["failures"][number]) => Promise<void> | void;
  collectResults?: boolean;
  random?: () => number;
  resolveSource?: (sourceId: string) => Promise<CodexObject | undefined> | CodexObject | undefined;
  now?: () => Date;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface AutomationResult {
  item: AutomationItem;
  object: CodexTranslationObject;
  markdown: string;
  quality: QualityReport;
  cacheHit: boolean;
  memoryMatch: "none" | "exact" | "fuzzy";
  durationMs: number;
  retries: number;
  attempts: number;
  usage?: TranslationUsage;
}

export interface AutomationBatchReport {
  results: AutomationResult[];
  failures: Array<{ item: AutomationItem; code: string; message: string; attempts?: number; retries?: number; durationMs?: number }>;
  memory: TranslationMemory;
}

function normalizedText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function normalizedMarkdown(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "").trim();
}

export function extractObjectText(object: CodexObject): string {
  const candidate = object.metadata?.content ?? object.metadata?.body ?? object.metadata?.text;
  return typeof candidate === "string" ? normalizedMarkdown(candidate) : "";
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function relevantGlossary(entries: GlossaryEntry[], sourceLanguage: string, targetLanguage: string): GlossaryEntry[] {
  return entries
    .filter((entry) => (!entry.sourceLanguage || entry.sourceLanguage === sourceLanguage)
      && (!entry.targetLanguage || entry.targetLanguage === targetLanguage))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
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

function bigrams(value: string): Set<string> {
  const normalized = normalizedText(value).toLocaleLowerCase();
  const result = new Set<string>();
  if (normalized.length < 2) {
    if (normalized) result.add(normalized);
    return result;
  }
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

export function fuzzySimilarity(left: string, right: string): number {
  if (normalizedText(left) === normalizedText(right)) return 1;
  const leftSet = bigrams(left);
  const rightSet = bigrams(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let overlap = 0;
  for (const gram of leftSet) if (rightSet.has(gram)) overlap += 1;
  return 2 * overlap / (leftSet.size + rightSet.size);
}

export interface TranslationMemoryMatch {
  entry: TranslationMemoryEntry;
  kind: "exact" | "fuzzy";
  similarity: number;
}

export function findTranslationMemoryMatch(
  memory: TranslationMemory,
  request: TranslationRequest,
  fuzzyThreshold = 0.92
): TranslationMemoryMatch | undefined {
  const exact = memory.entries[translationMemoryKey(request)];
  if (exact) return { entry: exact, kind: "exact", similarity: 1 };
  if (fuzzyThreshold > 1) return undefined;
  const glossaryHash = digest(JSON.stringify(relevantGlossary(request.glossary, request.sourceLanguage, request.targetLanguage)));
  let best: TranslationMemoryMatch | undefined;
  for (const entry of Object.values(memory.entries)) {
    if (!entry.sourceText
      || entry.sourceLanguage !== request.sourceLanguage
      || entry.targetLanguage !== request.targetLanguage
      || entry.glossaryHash !== glossaryHash) continue;
    const similarity = fuzzySimilarity(entry.sourceText, request.sourceText);
    if (similarity >= fuzzyThreshold && (!best || similarity > best.similarity)) {
      best = { entry, kind: "fuzzy", similarity };
    }
  }
  return best;
}

class TranslationMemoryIndex {
  private readonly postings = new Map<string, Map<string, Set<string>>>();

  constructor(private readonly memory: TranslationMemory) {
    for (const entry of Object.values(memory.entries)) this.index(entry);
  }

  private group(entry: Pick<TranslationMemoryEntry, "sourceLanguage" | "targetLanguage" | "glossaryHash">): string {
    return `${entry.sourceLanguage}\0${entry.targetLanguage}\0${entry.glossaryHash}`;
  }

  index(entry: TranslationMemoryEntry): void {
    if (!entry.sourceText) return;
    const group = this.group(entry);
    const groupPostings = this.postings.get(group) ?? new Map<string, Set<string>>();
    this.postings.set(group, groupPostings);
    for (const gram of bigrams(entry.sourceText)) {
      const keys = groupPostings.get(gram) ?? new Set<string>();
      groupPostings.set(gram, keys);
      keys.add(entry.key);
    }
  }

  find(request: TranslationRequest, threshold: number): TranslationMemoryMatch | undefined {
    const exact = this.memory.entries[translationMemoryKey(request)];
    if (exact) return { entry: exact, kind: "exact", similarity: 1 };
    if (threshold > 1) return undefined;
    const glossaryHash = digest(JSON.stringify(relevantGlossary(request.glossary, request.sourceLanguage, request.targetLanguage)));
    const groupPostings = this.postings.get(`${request.sourceLanguage}\0${request.targetLanguage}\0${glossaryHash}`);
    if (!groupPostings) return undefined;
    const grams = [...bigrams(request.sourceText)]
      .map((gram) => ({ gram, size: groupPostings.get(gram)?.size ?? 0 }))
      .filter((item) => item.size > 0)
      .sort((a, b) => a.size - b.size);
    const candidates = new Set<string>();
    for (const { gram } of grams) {
      for (const key of groupPostings.get(gram) ?? []) {
        candidates.add(key);
        if (candidates.size >= 1_000) break;
      }
      if (candidates.size >= 1_000) break;
    }
    let best: TranslationMemoryMatch | undefined;
    for (const key of candidates) {
      const entry = this.memory.entries[key];
      if (!entry?.sourceText) continue;
      const similarity = fuzzySimilarity(entry.sourceText, request.sourceText);
      if (similarity >= threshold && (!best || similarity > best.similarity)) {
        best = { entry, kind: "fuzzy", similarity };
      }
    }
    return best;
  }
}

export function mergeTranslationMemories(
  target: TranslationMemory,
  imported: TranslationMemory
): { memory: TranslationMemory; added: number; duplicates: number } {
  let added = 0;
  let duplicates = 0;
  const signatures = new Set(Object.values(target.entries).map((entry) => JSON.stringify([
    entry.sourceLanguage,
    entry.targetLanguage,
    entry.sourceHash,
    entry.glossaryHash,
    normalizedText(entry.text)
  ])));
  for (const [key, entry] of Object.entries(imported.entries)) {
    const signature = JSON.stringify([
      entry.sourceLanguage,
      entry.targetLanguage,
      entry.sourceHash,
      entry.glossaryHash,
      normalizedText(entry.text)
    ]);
    if (target.entries[key] || signatures.has(signature)) {
      duplicates += 1;
      continue;
    }
    target.entries[key] = entry;
    signatures.add(signature);
    added += 1;
  }
  return { memory: target, added, duplicates };
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
    if (item.required !== undefined && typeof item.required !== "boolean") throw new TranslationError("CODEX_TRANSLATION_GLOSSARY_INVALID", `Glossary entry ${index} has invalid required.`);
    if (item.caseSensitive !== undefined && typeof item.caseSensitive !== "boolean") throw new TranslationError("CODEX_TRANSLATION_GLOSSARY_INVALID", `Glossary entry ${index} has invalid caseSensitive.`);
    if (item.forbidden !== undefined && (!Array.isArray(item.forbidden)
      || item.forbidden.some((variant) => typeof variant !== "string" || !variant.trim()))) {
      throw new TranslationError("CODEX_TRANSLATION_GLOSSARY_INVALID", `Glossary entry ${index} has invalid forbidden variants.`);
    }
    return {
      source: item.source,
      target: item.target,
      ...(typeof item.sourceLanguage === "string" ? { sourceLanguage: item.sourceLanguage } : {}),
      ...(typeof item.targetLanguage === "string" ? { targetLanguage: item.targetLanguage } : {}),
      ...(typeof item.required === "boolean" ? { required: item.required } : {}),
      ...(typeof item.caseSensitive === "boolean" ? { caseSensitive: item.caseSensitive } : {}),
      ...(Array.isArray(item.forbidden) ? { forbidden: item.forbidden as string[] } : {})
    };
  });
  const targets = new Map<string, string>();
  for (const entry of entries) {
    const normalizedSource = entry.caseSensitive ? entry.source : entry.source.toLocaleLowerCase();
    const key = `${entry.sourceLanguage ?? "*"}\0${entry.targetLanguage ?? "*"}\0${entry.caseSensitive ? "case" : "fold"}\0${normalizedSource}`;
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

function occurrences(value: string, expression: RegExp, transform: (match: RegExpMatchArray) => string = (match) => match[0]): string[] {
  return [...value.matchAll(expression)].map(transform);
}

function structuralIssues(source: string, target: string): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const compare = (code: QualityIssue["code"], message: string, left: string[], right: string[]): void => {
    if (JSON.stringify(left) !== JSON.stringify(right)) issues.push({ code, severity: "error", message });
  };
  compare(
    "CODEX_TRANSLATION_QA_MARKDOWN_STRUCTURE",
    "Translation does not preserve Markdown heading structure.",
    occurrences(source, /^(#{1,6})\s+/gm, (match) => match[1]!),
    occurrences(target, /^(#{1,6})\s+/gm, (match) => match[1]!)
  );
  compare(
    "CODEX_TRANSLATION_QA_LINKS",
    "Translation does not preserve Markdown links and destinations.",
    occurrences(source, /!?\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (match) => `${match[0].startsWith("!") ? "image" : "link"}:${match[1]}`),
    occurrences(target, /!?\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (match) => `${match[0].startsWith("!") ? "image" : "link"}:${match[1]}`)
  );
  compare(
    "CODEX_TRANSLATION_QA_IDENTIFIERS",
    "Translation does not preserve CODEX identifiers.",
    occurrences(source, /\b[A-Z][A-Z0-9_-]*-\d{4,}\b/g).sort(),
    occurrences(target, /\b[A-Z][A-Z0-9_-]*-\d{4,}\b/g).sort()
  );
  compare(
    "CODEX_TRANSLATION_QA_CODE_BLOCKS",
    "Translation does not preserve fenced code blocks.",
    occurrences(source, /(```|~~~)([^\n]*)\n([\s\S]*?)\n\1/g, (match) => `${match[1]}${match[2]}\n${match[3]}`),
    occurrences(target, /(```|~~~)([^\n]*)\n([\s\S]*?)\n\1/g, (match) => `${match[1]}${match[2]}\n${match[3]}`)
  );
  const withoutFences = (value: string): string => value.replace(/(```|~~~)[^\n]*\n[\s\S]*?\n\1/g, "");
  compare(
    "CODEX_TRANSLATION_QA_INLINE_CODE",
    "Translation does not preserve inline code.",
    occurrences(withoutFences(source), /`([^`\n]+)`/g, (match) => match[1]!),
    occurrences(withoutFences(target), /`([^`\n]+)`/g, (match) => match[1]!)
  );
  compare(
    "CODEX_TRANSLATION_QA_TABLES",
    "Translation does not preserve Markdown table structure.",
    occurrences(source, /^\s*\|.*\|\s*$/gm, (match) => String((match[0].match(/\|/g) ?? []).length)),
    occurrences(target, /^\s*\|.*\|\s*$/gm, (match) => String((match[0].match(/\|/g) ?? []).length))
  );
  compare(
    "CODEX_TRANSLATION_QA_LISTS",
    "Translation does not preserve Markdown list structure.",
    occurrences(source, /^(\s*)([-+*]|\d+\.)\s+/gm, (match) => `${match[1]!.length}:${/\d/.test(match[2]!) ? "ol" : "ul"}`),
    occurrences(target, /^(\s*)([-+*]|\d+\.)\s+/gm, (match) => `${match[1]!.length}:${/\d/.test(match[2]!) ? "ol" : "ul"}`)
  );
  compare(
    "CODEX_TRANSLATION_QA_HTML",
    "Translation does not preserve HTML structure.",
    occurrences(source, /<\/?([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/g, (match) => `${match[0].startsWith("</") ? "/" : ""}${match[1]!.toLowerCase()}`),
    occurrences(target, /<\/?([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/g, (match) => `${match[0].startsWith("</") ? "/" : ""}${match[1]!.toLowerCase()}`)
  );
  if (/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(target)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(target)) {
    issues.push({ code: "CODEX_TRANSLATION_QA_UNICODE", severity: "error", message: "Translation contains invalid Unicode or control characters." });
  }
  return issues;
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
      const comparableSource = entry.caseSensitive ? source : source.toLocaleLowerCase();
      const comparableTarget = entry.caseSensitive ? target : target.toLocaleLowerCase();
      const sourceTerm = entry.caseSensitive ? entry.source : entry.source.toLocaleLowerCase();
      const targetTerm = entry.caseSensitive ? entry.target : entry.target.toLocaleLowerCase();
      if ((entry.required ?? true) && comparableSource.includes(sourceTerm) && !comparableTarget.includes(targetTerm)) {
        issues.push({ code: "CODEX_TRANSLATION_QA_GLOSSARY_MISSING", severity: "error", message: `Required glossary target is missing: ${entry.target}` });
      }
      for (const forbidden of entry.forbidden ?? []) {
        const comparableForbidden = entry.caseSensitive ? forbidden : forbidden.toLocaleLowerCase();
        if (comparableTarget.includes(comparableForbidden)) {
          issues.push({ code: "CODEX_TRANSLATION_QA_GLOSSARY_FORBIDDEN", severity: "error", message: `Forbidden glossary variant is present: ${forbidden}` });
        }
      }
    }
    issues.push(...structuralIssues(request.sourceText, text));
  }
  const score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + (issue.severity === "error" ? 30 : 10), 0));
  return { score, passed: !issues.some((issue) => issue.severity === "error"), issues };
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
    text.trim(),
    ""
  ].join("\n");
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const aborted = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

async function withRetries<T>(
  operation: (attempt: number, signal: AbortSignal) => Promise<T>,
  maxRetries: number,
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  signal: AbortSignal,
  random: () => number
): Promise<{ value: T; attempts: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    try {
      return { value: await operation(attempt, signal), attempts: attempt };
    } catch (error) {
      lastError = error;
      if (signal.aborted || !(error instanceof TranslationProviderError) || !error.retryable || attempt > maxRetries) break;
      const exponential = Math.min(250 * 2 ** (attempt - 1), 30_000);
      const jittered = Math.round(exponential * (0.75 + random() * 0.5));
      await sleep(Math.max(error.retryAfterMs ?? 0, jittered), signal);
    }
  }
  throw lastError;
}

function containsLikelySecret(value: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}/m.test(value);
}

function safeFailureMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .slice(0, 1_000);
}

export async function runTranslationStream(
  project: CodexProject,
  registry: RegistryData,
  items: AsyncIterable<AutomationItem>,
  options: AutomationOptions
): Promise<AutomationBatchReport> {
  const memory = options.memory ?? emptyTranslationMemory();
  const glossary = options.glossary ?? [];
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 16));
  const maxRetries = Math.max(0, Math.min(options.maxRetries ?? 2, 10));
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const sourceById = new Map(project.objects.map((object) => [object.id, object]));
  const memoryIndex = new TranslationMemoryIndex(memory);
  const inFlight = new Map<string, Promise<{ value: ProviderTranslation; attempts: number }>>();
  const interval = options.requestsPerMinute && options.requestsPerMinute > 0 ? 60_000 / options.requestsPerMinute : 0;
  let nextRequestAt = 0;
  let rateQueue = Promise.resolve();
  const iterator = items[Symbol.asyncIterator]();
  let iteratorQueue = Promise.resolve();
  const results: AutomationResult[] = [];
  const failures: AutomationBatchReport["failures"] = [];

  async function nextItem(): Promise<IteratorResult<AutomationItem>> {
    let release = () => {};
    const previous = iteratorQueue;
    iteratorQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await iterator.next();
    } finally {
      release();
    }
  }

  async function acquireRateSlot(signal: AbortSignal): Promise<void> {
    let release = () => {};
    const previous = rateQueue;
    rateQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const wait = Math.max(0, nextRequestAt - Date.now());
      if (wait > 0) await sleep(wait, signal);
      nextRequestAt = Date.now() + interval;
    } finally {
      release();
    }
  }

  async function worker(): Promise<void> {
    while (true) {
      const next = await nextItem();
      if (next.done) return;
      const item = next.value;
      const startedAt = Date.now();
      let attempts = 0;
      const itemController = new AbortController();
      const outerSignal = options.signal;
      const cancel = (): void => itemController.abort(outerSignal?.reason);
      outerSignal?.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(
        () => itemController.abort(new TranslationProviderError(
          "CODEX_TRANSLATION_PROVIDER_TIMEOUT",
          `Translation task exceeded ${options.itemTimeoutMs ?? 300_000} ms.`,
          "timeout",
          false
        )),
        options.itemTimeoutMs ?? 300_000
      );
      try {
        if (itemController.signal.aborted) throw itemController.signal.reason;
        const source = options.resolveSource
          ? await options.resolveSource(item.sourceId)
          : sourceById.get(item.sourceId);
        if (!source) throw new TranslationError("CODEX_TRANSLATION_SOURCE_MISSING", `Translation source does not exist: ${item.sourceId}`);
        if (!registry.translationRules.sourceTypes.includes(source.type)) throw new TranslationError("CODEX_TRANSLATION_SOURCE_TYPE", `Object type ${source.type} cannot be a translation source.`);
        if (!source.language) throw new TranslationError("CODEX_TRANSLATION_PROVENANCE_INVALID", `Source ${source.id} has no language.`);
        if (source.language === item.targetLanguage) throw new TranslationError("CODEX_TRANSLATION_SAME_LANGUAGE", `Translation language ${item.targetLanguage} matches source language.`);
        if (!registry.languages.includes(item.targetLanguage)) throw new TranslationError("CODEX_TRANSLATION_LANGUAGE_UNKNOWN", `Unregistered language code: ${item.targetLanguage}`);
        if (project.objects.some((object) => object.id === item.id)) throw new TranslationError("CODEX_TRANSLATION_ID_EXISTS", `Object already exists: ${item.id}`);
        const sourceText = extractObjectText(source);
        if (!sourceText) throw new TranslationError("CODEX_TRANSLATION_EMPTY_CONTENT", `Source ${source.id} has no translatable text.`);
        const maximumSourceBytes = options.maxSourceBytes ?? 8 * 1024 * 1024;
        if (Buffer.byteLength(sourceText, "utf8") > maximumSourceBytes) {
          throw new TranslationError("CODEX_TRANSLATION_OVERSIZED", `Source ${source.id} exceeds ${maximumSourceBytes} bytes.`);
        }
        if (!options.allowSensitiveContent && containsLikelySecret(sourceText)) {
          throw new TranslationError("CODEX_TRANSLATION_SECRET_DETECTED", `Source ${source.id} appears to contain a secret and was not sent.`);
        }
        const request = { sourceId: source.id, sourceText, sourceLanguage: source.language, targetLanguage: item.targetLanguage, glossary };
        const key = translationMemoryKey(request);
        const memoryMatch = memoryIndex.find(request, options.fuzzyThreshold ?? 0.92);
        const cached = memoryMatch?.entry;
        let providerResult: ProviderTranslation;
        if (cached) {
          providerResult = { text: cached.text, provider: cached.provider, model: cached.model };
        } else {
          let pending = inFlight.get(key);
          const ownsRequest = !pending;
          if (!pending) {
            pending = withRetries(async (attempt, signal) => {
              attempts = attempt;
              await acquireRateSlot(signal);
              return options.provider.translate(request, { attempt, signal });
            }, maxRetries, sleep, itemController.signal, random);
            inFlight.set(key, pending);
          }
          let retried: { value: ProviderTranslation; attempts: number };
          try {
            retried = await pending;
          } finally {
            if (ownsRequest) inFlight.delete(key);
          }
          providerResult = retried.value;
          attempts = ownsRequest ? retried.attempts : 0;
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
        if (!memory.entries[key]) {
          memory.entries[key] = {
            key,
            sourceId: source.id,
            sourceLanguage: source.language,
            targetLanguage: item.targetLanguage,
            sourceHash: digest(sourceText),
            sourceText,
            glossaryHash: digest(JSON.stringify(relevantGlossary(glossary, source.language, item.targetLanguage))),
            text: providerResult.text,
            provider: providerResult.provider,
            ...(providerResult.model ? { model: providerResult.model } : {}),
            quality,
            createdAt: generatedAt
          };
          memoryIndex.index(memory.entries[key]!);
        }
        const result: AutomationResult = {
          item,
          object,
          markdown: renderAutomatedMarkdown(object, source, providerResult.text, providerResult, quality, generatedAt),
          quality,
          cacheHit: Boolean(cached) || attempts === 0,
          memoryMatch: memoryMatch?.kind ?? (attempts === 0 ? "exact" : "none"),
          attempts,
          retries: Math.max(0, attempts - 1),
          durationMs: Date.now() - startedAt,
          ...(providerResult.usage ? { usage: providerResult.usage } : {})
        };
        if (options.collectResults !== false) results.push(result);
        await options.onResult?.(result);
      } catch (error) {
        const failure = {
          item,
          code: error instanceof TranslationError
            ? error.code
            : itemController.signal.aborted
              ? "CODEX_TRANSLATION_PROVIDER_CANCELLED"
              : "CODEX_TRANSLATION_BATCH_PARTIAL",
          message: safeFailureMessage(error),
          attempts,
          retries: Math.max(0, attempts - 1),
          durationMs: Date.now() - startedAt
        };
        failures.push(failure);
        await options.onFailure?.(failure);
      } finally {
        clearTimeout(timeout);
        outerSignal?.removeEventListener("abort", cancel);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  results.sort((a, b) => `${a.item.sourceId}\0${a.item.targetLanguage}`.localeCompare(`${b.item.sourceId}\0${b.item.targetLanguage}`));
  failures.sort((a, b) => `${a.item.sourceId}\0${a.item.targetLanguage}`.localeCompare(`${b.item.sourceId}\0${b.item.targetLanguage}`));
  return { results, failures, memory };
}

export async function runTranslationBatch(
  project: CodexProject,
  registry: RegistryData,
  items: AutomationItem[],
  options: AutomationOptions
): Promise<AutomationBatchReport> {
  async function* source(): AsyncGenerator<AutomationItem> {
    yield* items;
  }
  return runTranslationStream(project, registry, source(), options);
}
