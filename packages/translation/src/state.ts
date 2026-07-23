import { createHash } from "node:crypto";
import { TranslationError } from "./errors.js";
import type { AutomationItem, AutomationResult } from "./automation.js";

export type TranslationRunItemStatus = "pending" | "running" | "completed" | "failed";

export interface TranslationRunItemState {
  sourceId: string;
  targetLanguage: string;
  id: string;
  output: string;
  status: TranslationRunItemStatus;
  attempts: number;
  retries: number;
  updatedAt: string;
  outputHash?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface TranslationRunState {
  version: "1";
  items: Record<string, TranslationRunItemState>;
}

export interface TranslationAuditEvent {
  timestamp: string;
  event: "completed" | "failed" | "skipped";
  sourceId: string;
  targetLanguage: string;
  translationId: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  attempts?: number;
  retries?: number;
  memoryMatch?: "none" | "exact" | "fuzzy";
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  errorCode?: string;
  errorMessage?: string;
}

export function contentHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function runItemKey(item: Pick<AutomationItem, "sourceId" | "targetLanguage">): string {
  return `${item.sourceId}\0${item.targetLanguage}`;
}

export function emptyTranslationRunState(): TranslationRunState {
  return { version: "1", items: {} };
}

export function validateTranslationRunState(value: unknown): TranslationRunState {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== "1") {
    throw new TranslationError("CODEX_TRANSLATION_STATE_INVALID", "Translation run state must use version 1.");
  }
  const items = (value as { items?: unknown }).items;
  if (!items || typeof items !== "object" || Array.isArray(items)) {
    throw new TranslationError("CODEX_TRANSLATION_STATE_INVALID", "Translation run state items must be an object.");
  }
  for (const [key, raw] of Object.entries(items)) {
    if (!raw || typeof raw !== "object") throw new TranslationError("CODEX_TRANSLATION_STATE_INVALID", `State item ${key} must be an object.`);
    const item = raw as Record<string, unknown>;
    for (const field of ["sourceId", "targetLanguage", "id", "output", "status", "updatedAt"]) {
      if (typeof item[field] !== "string" || !(item[field] as string).length) {
        throw new TranslationError("CODEX_TRANSLATION_STATE_INVALID", `State item ${key} has invalid ${field}.`);
      }
    }
    if (!["pending", "running", "completed", "failed"].includes(item.status as string)
      || typeof item.attempts !== "number"
      || typeof item.retries !== "number") {
      throw new TranslationError("CODEX_TRANSLATION_STATE_INVALID", `State item ${key} has invalid counters or status.`);
    }
  }
  return value as TranslationRunState;
}

export function auditForResult(result: AutomationResult, timestamp: string): TranslationAuditEvent {
  return {
    timestamp,
    event: "completed",
    sourceId: result.item.sourceId,
    targetLanguage: result.item.targetLanguage,
    translationId: result.item.id,
    provider: String(result.object.metadata?.translationProvider ?? "unknown"),
    ...(typeof result.object.metadata?.translationModel === "string" ? { model: result.object.metadata.translationModel } : {}),
    durationMs: result.durationMs,
    attempts: result.attempts,
    retries: result.retries,
    memoryMatch: result.memoryMatch,
    ...(result.usage?.inputTokens === undefined ? {} : { inputTokens: result.usage.inputTokens }),
    ...(result.usage?.outputTokens === undefined ? {} : { outputTokens: result.usage.outputTokens }),
    ...(result.usage?.costUsd === undefined ? {} : { costUsd: result.usage.costUsd })
  };
}

export function safeAuditError(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .slice(0, 1_000);
}
