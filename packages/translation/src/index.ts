import type { CodexObject, CodexProject, CodexTranslationObject, LifecycleStatus } from "@codex/core";
import { identifierPattern, isRegisteredLanguage, type RegistryData } from "@codex/registry";
import { TranslationError } from "./errors.js";

export { TranslationError } from "./errors.js";

export interface CreateTranslationOptions {
  id: string;
  sourceId: string;
  language: string;
  title?: string;
  version?: string;
  status?: LifecycleStatus;
  translationMode?: string;
}

export interface TranslationDraft {
  object: CodexTranslationObject;
  markdown: string;
}

export interface TranslationSummaryItem {
  id: string;
  language?: string;
  status: string;
  sourceId?: string;
}

export interface TranslationSourceStatus {
  id: string;
  title: string;
  language?: string;
  status: string;
  translations: TranslationSummaryItem[];
}

export interface MissingTranslation {
  sourceId: string;
  language: string;
}

export interface InvalidTranslationProvenance {
  translationId: string;
  reason: string;
}

export interface TranslationStatusReport {
  projectId: string;
  expectedLanguages: string[];
  existingLanguages: string[];
  sources: TranslationSourceStatus[];
  missing: MissingTranslation[];
  statuses: Record<string, number>;
  orphans: TranslationSummaryItem[];
  invalidProvenance: InvalidTranslationProvenance[];
}

function frontMatterString(value: string): string {
  return /^[A-Za-z0-9_. -]+$/.test(value) ? value : JSON.stringify(value);
}

function translationSourceId(object: CodexObject): string | undefined {
  return object.derivedFrom?.length === 1 ? object.derivedFrom[0] : undefined;
}

export function createTranslationDraft(project: CodexProject, options: CreateTranslationOptions, registry: RegistryData): TranslationDraft {
  if (!identifierPattern.test(options.id)) throw new TranslationError("CODEX_TRANSLATION_ID_INVALID", `Invalid translation identifier: ${options.id}`);
  if (project.objects.some((object) => object.id === options.id)) throw new TranslationError("CODEX_TRANSLATION_ID_EXISTS", `Object already exists: ${options.id}`);
  if (!isRegisteredLanguage(options.language, registry)) throw new TranslationError("CODEX_TRANSLATION_LANGUAGE_UNKNOWN", `Unregistered language code: ${options.language}`);
  const source = project.objects.find((object) => object.id === options.sourceId);
  if (!source) throw new TranslationError("CODEX_TRANSLATION_SOURCE_MISSING", `Translation source does not exist: ${options.sourceId}`);
  if (!registry.translationRules.sourceTypes.includes(source.type)) throw new TranslationError("CODEX_TRANSLATION_SOURCE_TYPE", `Object type ${source.type} cannot be a translation source.`);
  if (source.language && source.language === options.language) throw new TranslationError("CODEX_TRANSLATION_SAME_LANGUAGE", `Translation language ${options.language} matches source language.`);

  const title = options.title ?? `${source.title} — ${options.language} translation`;
  const translationMode = options.translationMode ?? "manual";
  const object: CodexTranslationObject = {
    id: options.id,
    type: "translation",
    title,
    version: options.version ?? "0.1.0",
    status: options.status ?? "draft",
    language: options.language,
    derivedFrom: [source.id],
    relations: [{ type: "translation-of", target: source.id }],
    metadata: { translationMode, sourceLanguage: source.language ?? null, content: "" }
  };
  const markdown = [
    "---",
    `id: ${object.id}`,
    "type: translation",
    `title: ${frontMatterString(title)}`,
    `version: ${object.version}`,
    `status: ${object.status}`,
    `language: ${object.language}`,
    `derivedFrom: [${source.id}]`,
    `relations: [translation-of->${source.id}]`,
    `translationMode: ${frontMatterString(translationMode)}`,
    ...(source.language ? [`sourceLanguage: ${source.language}`] : []),
    "---",
    `# ${title}`,
    "",
    "<!-- Add translation text here. -->",
    ""
  ].join("\n");
  return { object, markdown };
}

function provenanceCycles(translations: CodexObject[]): Set<string> {
  const byId = new Map(translations.map((object) => [object.id, object]));
  const cyclic = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const index = stack.indexOf(id);
      for (const member of stack.slice(index)) cyclic.add(member);
      return;
    }
    visiting.add(id);
    stack.push(id);
    const sourceId = translationSourceId(byId.get(id)!);
    if (sourceId && byId.has(sourceId)) visit(sourceId);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  return cyclic;
}

export function analyzeTranslationStatus(project: CodexProject, registry: RegistryData): TranslationStatusReport {
  const objectsById = new Map(project.objects.map((object) => [object.id, object]));
  const translations = project.objects.filter((object) => object.type === "translation");
  const directlyTranslatedIds = new Set(
    translations.map(translationSourceId).filter((value): value is string => Boolean(value))
  );
  const sourceObjects = project.objects.filter((object) => {
    if (object.type === "translation" || !registry.translationRules.sourceTypes.includes(object.type)) return false;
    const isStructuralContainer = (object.relations ?? []).some((relation) => relation.type === "contains");
    return directlyTranslatedIds.has(object.id) || !isStructuralContainer;
  });
  const cyclic = provenanceCycles(translations);
  const orphans: TranslationSummaryItem[] = [];
  const invalidProvenance: InvalidTranslationProvenance[] = [];
  const statuses: Record<string, number> = {};

  for (const translation of translations) {
    statuses[translation.status] = (statuses[translation.status] ?? 0) + 1;
    const sourceId = translationSourceId(translation);
    const item = { id: translation.id, language: translation.language, status: translation.status, ...(sourceId ? { sourceId } : {}) };
    if (!sourceId || !objectsById.has(sourceId)) orphans.push(item);
    if ((translation.derivedFrom?.length ?? 0) !== 1) invalidProvenance.push({ translationId: translation.id, reason: "derivedFrom must contain exactly one source" });
    else if (sourceId === translation.id) invalidProvenance.push({ translationId: translation.id, reason: "self-reference" });
    else if (sourceId && !objectsById.has(sourceId)) invalidProvenance.push({ translationId: translation.id, reason: `missing source ${sourceId}` });
    const relation = (translation.relations ?? []).filter((value) => value.type === "translation-of");
    if (relation.length > 0 && (relation.length !== 1 || relation[0]?.target !== sourceId)) invalidProvenance.push({ translationId: translation.id, reason: "translation-of does not match derivedFrom" });
    if (cyclic.has(translation.id)) invalidProvenance.push({ translationId: translation.id, reason: "provenance cycle" });
  }

  const sources = sourceObjects.map((source) => ({
    id: source.id,
    title: source.title,
    language: source.language,
    status: source.status,
    translations: translations
      .filter((translation) => translationSourceId(translation) === source.id)
      .map((translation) => ({ id: translation.id, language: translation.language, status: translation.status, sourceId: source.id }))
  }));
  const existingLanguages = [...new Set(translations.map((object) => object.language).filter((value): value is string => Boolean(value)))].sort();
  const expectedLanguages = [...registry.translationRules.targetLanguages];
  const missing = sources.flatMap((source) => expectedLanguages
    .filter((language) => language !== source.language && !source.translations.some((translation) => translation.language === language))
    .map((language) => ({ sourceId: source.id, language })));
  return { projectId: project.id, expectedLanguages, existingLanguages, sources, missing, statuses, orphans, invalidProvenance };
}

export * from "./automation.js";
export * from "./state.js";
